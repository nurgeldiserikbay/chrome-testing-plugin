importScripts('db.js');

// ================= настройки и лимиты =================
const DEFAULT_SETTINGS = { bufferMin: 2, videoOnStart: false, tabAudio: false, cdp: false, reactRenders: true, autoErrors: true, ownOnly: true, autoAudit: true };
const BUF_LIM = { console: 800, network: 500, actions: 300, nav: 100, events: 1500, samples: 60, resources: 400 };
const SES_LIM = { console: 5000, network: 3000, actions: 2000, nav: 500, events: 10000, samples: 2000, resources: 3000 };
const BUF_BODY = 4000;

let buffers = {}; // tabId -> {console, network, actions, nav}
let S = null; // активный баг-репорт (сессия)

const ready = (async () => {
  try {
    const r = await chrome.storage.session.get('qa_buf');
    buffers = r.qa_buf || {};
  } catch (_) {}
  try {
    const r = await chrome.storage.local.get('qa_active');
    if (r.qa_active) {
      const s = await QADB.get('reports', r.qa_active);
      S = s && s.active ? s : null;
      if (!S) await chrome.storage.local.remove('qa_active');
    }
  } catch (_) {}
})();

async function getSettings() {
  const r = await chrome.storage.local.get('qa_settings');
  return Object.assign({}, DEFAULT_SETTINGS, r.qa_settings || {});
}

const throttle = (fn, ms) => {
  let t = null;
  return () => {
    if (t) return;
    t = setTimeout(() => { t = null; fn(); }, ms);
  };
};
const saveBuf = throttle(() => chrome.storage.session.set({ qa_buf: buffers }).catch(() => {}), 2000);
const saveSession = throttle(() => { if (S) QADB.put('reports', S.id, S).catch(() => {}); }, 1000);
const saveSessionNow = async () => { if (S) await QADB.put('reports', S.id, S); };

// ================= фоновый буфер =================
const KINDS = ['console', 'network', 'actions', 'nav', 'events', 'samples', 'resources'];
function getBuf(tabId) {
  const b = (buffers[tabId] ||= {});
  for (const k of KINDS) b[k] ||= [];
  return b;
}
function pushBuf(tabId, kind, e) {
  const arr = getBuf(tabId)[kind];
  arr.push(e);
  const cut = Date.now() - 15 * 60 * 1000; // буфер храним максимум 15 минут
  while (arr.length && (arr.length > BUF_LIM[kind] || arr[0].ts < cut)) arr.shift();
}

function ingest(tabId, kind, e) {
  e.ts = e.ts || Date.now();
  const inSession = S && S.active && S.tabId === tabId;
  if (inSession) {
    const skipHookNet = (kind === 'network' || kind === 'resources') && S.meta.cdp && e.source !== 'cdp';
    if (!skipHookNet) {
      S[kind] ||= [];
      if (S[kind].length < SES_LIM[kind]) S[kind].push(e);
      else S.meta.truncated = true;
      saveSession();
      if (kind === 'console' || kind === 'network') autoCheck(kind, e);
    }
  }
  if (e.source === 'cdp') return; // данные DevTools-протокола только в сессию
  const be = kind === 'network' && e.body && e.body.length > BUF_BODY ? { ...e, body: e.body.slice(0, BUF_BODY) + '\n… [обрезано]' } : e;
  pushBuf(tabId, kind, be);
  saveBuf();
}

// ================= автоматические пункты «Ошибка» =================
// Ошибка JS или упавший запрос во время проверки → отдельный пункт со скриншотом и контекстом.
const AUTO_LIMIT = 40;
const autoState = { group: null, timer: null };
const noiseUrl = (u) => /\/favicon\.ico(\?|$)|\/__webpack_hmr|hot-update|sockjs-node/.test(u || '');
let autoSettingsCache = null;
async function autoEnabled() {
  if (autoSettingsCache === null) autoSettingsCache = (await getSettings()).autoErrors !== false;
  return autoSettingsCache;
}
chrome.storage.onChanged.addListener((ch) => { if (ch.qa_settings) autoSettingsCache = null; });

function pathOf(u) { try { const x = new URL(u); return x.pathname + (x.search.length > 60 ? x.search.slice(0, 60) + '…' : x.search); } catch (_) { return u; } }

// сайт (регистрируемый домен): shop.example.kz и api.example.kz — один сайт
function siteOf(u) {
  try {
    const h = new URL(u).hostname;
    if (/^[\d.]+$/.test(h) || h === 'localhost' || !h.includes('.')) return h;
    const p = h.split('.');
    const second = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'gen'];
    return p.length > 2 && p[p.length - 1].length === 2 && second.includes(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  } catch (_) { return ''; }
}
// подпись ошибки без изменчивых частей (числа, id) — чтобы повторы и игнор работали
const normSig = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{20,}/gi, '#').replace(/\d+/g, '#').slice(0, 200);

let ignoreCache = null;
async function ignoreList() {
  if (!ignoreCache) ignoreCache = (await chrome.storage.local.get('qa_ignore')).qa_ignore || [];
  return ignoreCache;
}
chrome.storage.onChanged.addListener((ch) => { if (ch.qa_ignore) ignoreCache = null; });

function autoCheck(kind, e) {
  if (!S || !S.active) return;
  if (e.mocked) return; // ответ подменён тестировщиком — это не баг сайта
  let err = null;
  const mySite = siteOf(S.meta.startUrl);
  if (kind === 'console' && e.level === 'error' && e.source !== 'resource') {
    const first = String(e.text || '').split('\n')[0];
    const where = e.loc || (String(e.text || '').match(/(https?|chrome-extension):\/\/[^\s)]+/) || [])[0] || '';
    if (/^chrome-extension:|moz-extension:/.test(where)) return; // ошибки других расширений браузера
    err = { type: 'js', sig: 'js:' + normSig(first), title: first.slice(0, 200), ts: e.ts, foreign: !!(where && /^https?:/.test(where) && siteOf(where) !== mySite), ref: { ts: e.ts, text: e.text, loc: e.loc, source: e.source } };
  } else if (kind === 'network' && (e.failed || e.status >= 400) && !e.canceled && !noiseUrl(e.url)) {
    if (e.source === 'perf' || ['Image', 'Stylesheet', 'Font', 'Media'].includes(e.type)) return;
    const st = e.failed ? (e.error || 'сбой') : e.status;
    err = { type: 'request', sig: normSig(`req:${e.method}:${siteOf(e.url)}${pathOf(e.url).split('?')[0]}:${e.failed ? 'fail' : e.status}`), title: `${e.method} ${st} ${pathOf(e.url)}`, ts: e.ts, foreign: siteOf(e.url) !== mySite, ref: { id: e.id, ts: e.ts, url: e.url, method: e.method } };
  }
  if (!err) return;
  Promise.all([getSettings(), ignoreList()]).then(([st, ign]) => {
    if (st.autoErrors === false) return;
    if (st.ownOnly !== false && err.foreign) { S.meta.foreignSkipped = (S.meta.foreignSkipped || 0) + 1; return; }
    if (ign.some((x) => x.sig === err.sig)) { S.meta.ignoredSkipped = (S.meta.ignoredSkipped || 0) + 1; return; }
    queueAuto(err);
  });
}

async function ignoreError(m) {
  await ready;
  if (!S || !S.active) return { ok: false };
  const it = (S.errors || []).find((x) => x.n === m.n);
  if (!it) return { ok: false, error: 'Пункт не найден' };
  const list = (await chrome.storage.local.get('qa_ignore')).qa_ignore || [];
  it.sigs.forEach((sig, i) => { if (!list.some((x) => x.sig === sig)) list.push({ sig, title: it.title, added: Date.now(), site: siteOf(it.url || '') }); });
  await chrome.storage.local.set({ qa_ignore: list });
  ignoreCache = null;
  await deleteError({ n: m.n });
  return { ok: true, count: list.length };
}

function queueAuto(err) {
  if (!S || !S.active) return;
  S.errors ||= [];
  // повтор той же ошибки в течение минуты — считаем, а не создаём новый пункт
  const same = S.errors.find((x) => x.sigs.includes(err.sig) && err.ts - x.lastTs < 60000);
  if (same) {
    // запрос и ошибка консоли от одного действия приходят почти одновременно — это один повтор, а не два
    if (err.ts - (same.lastInc || same.ts) > 2500) { same.count++; same.lastInc = err.ts; }
    same.lastTs = err.ts;
    saveSession(); pushOverlayState();
    return;
  }
  if (S.errors.length >= AUTO_LIMIT) { S.meta.autoErrorsTruncated = (S.meta.autoErrorsTruncated || 0) + 1; return; }
  if (!autoState.group) autoState.group = [];
  if (!autoState.group.some((x) => x.sig === err.sig)) autoState.group.push(err);
  clearTimeout(autoState.timer);
  // ждём немного: связанные ошибки (упал запрос → ошибка JS) попадут в один пункт, а сайт успеет показать сообщение
  autoState.timer = setTimeout(flushAuto, 1200);
}

async function flushAuto() {
  const group = autoState.group;
  autoState.group = null;
  if (!group || !group.length || !S || !S.active) return;
  const n = (S.errors.reduce((m, x) => Math.max(m, x.n), 0) || 0) + 1;
  const req = group.find((x) => x.type === 'request');
  const js = group.find((x) => x.type === 'js');
  const item = {
    n,
    ts: Math.min(...group.map((x) => x.ts)),
    lastTs: Math.max(...group.map((x) => x.ts)),
    lastInc: Math.max(...group.map((x) => x.ts)),
    count: 1,
    kind: req && js ? 'mixed' : req ? 'request' : 'js',
    title: req ? `Ошибка запроса: ${req.title}` : `Ошибка JavaScript: ${js.title}`,
    sigs: group.map((x) => x.sig),
    refs: group.map((x) => ({ type: x.type, ...x.ref })),
    url: null,
    shotKey: null,
  };
  try {
    const tab = await chrome.tabs.get(S.tabId);
    item.url = tab.url;
    // скриншот только если вкладка с проверкой сейчас на экране
    if (tab.active) {
      const ready = await chrome.tabs.sendMessage(S.tabId, { type: 'qa-capture-prep' }).catch(() => null);
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        item.shotKey = `${S.id}_err_${n}`;
        await QADB.put('blobs', item.shotKey, dataUrl);
      } catch (_) {}
      if (ready) chrome.tabs.sendMessage(S.tabId, { type: 'qa-capture-done' }).catch(() => {});
    }
  } catch (_) {}
  item.cond = emuLabel(S.tabId);
  S.errors.push(item);
  await saveSessionNow();
  pushOverlayState();
  toast(`⚠ ${item.kind === 'js' ? 'Ошибка JavaScript' : 'Ошибка запроса'} — сохранена отдельным пунктом${item.shotKey ? ' (со скриншотом)' : ''}. Лишняя? Нажмите ⚠ на панели → 🙈`, 'warn');
}

async function deleteError(m) {
  await ready;
  if (!S || !S.active) return { ok: false };
  const it = (S.errors || []).find((x) => x.n === m.n);
  if (!it) return { ok: false, error: 'Пункт не найден' };
  S.errors = S.errors.filter((x) => x !== it);
  if (it.shotKey) await QADB.del('blobs', it.shotKey).catch(() => {});
  await saveSessionNow();
  pushOverlayState();
  return { ok: true };
}

// ================= 🩺 автопроверка страницы: доступность (axe-core), изображения, DOM =================
let axeLocale = null;
const UI_LANGS = ['ru', 'en', 'zh', 'es', 'pt', 'fr', 'de', 'kk'];
async function uiLang() {
  const { qa_lang } = await chrome.storage.local.get('qa_lang');
  if (qa_lang && qa_lang !== 'auto' && UI_LANGS.includes(qa_lang)) return qa_lang;
  const ui = chrome.i18n.getUILanguage().toLowerCase();
  if (/^kk/.test(ui)) return 'kk';
  if (/^(ru|uk|be|ky|uz|tg|hy|az)/.test(ui)) return 'ru';
  return UI_LANGS.includes(ui.slice(0, 2)) ? ui.slice(0, 2) : 'en';
}
// словарь для скриптов на странице (панель, запись автотеста)
const i18nFiles = async () => { const l = await uiLang(); return l === 'ru' ? ['i18n.js'] : [`i18n/${l}.js`, 'i18n.js']; };
const AXE_LOCALE = { ru: 'vendor/axe-ru.json', kk: 'vendor/axe-ru.json', de: 'vendor/axe-locales/de.json', es: 'vendor/axe-locales/es.json', fr: 'vendor/axe-locales/fr.json', pt: 'vendor/axe-locales/pt_BR.json', zh: 'vendor/axe-locales/zh_CN.json' };
async function getAxeLocale() {
  const f = AXE_LOCALE[await uiLang()];
  if (!f) return null; // у axe по умолчанию английские тексты
  if (!axeLocale || axeLocale.__f !== f) { axeLocale = await (await fetch(chrome.runtime.getURL(f))).json(); axeLocale.__f = f; }
  const { __f, ...loc } = axeLocale;
  return loc;
}
// выполняется на странице (изолированный мир), должна быть самодостаточной
async function pageAudit(locale) {
  const out = { url: location.href, title: document.title, ts: Date.now(), a11y: [], images: [], dom: {}, error: null };
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  try {
    if (window.axe) {
      try { if (locale) window.axe.configure({ locale }); } catch (_) {}
      const r = await window.axe.run(
        { exclude: [['qa-bug-overlay']] },
        { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'], iframes: false }
      );
      out.a11y = r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, description: v.description, helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 8).map((n) => ({ target: (n.target || []).join(' '), html: short(n.html, 300), summary: short(n.failureSummary, 400) })),
        count: v.nodes.length,
      }));
    }
  } catch (e) { out.error = String(e && e.message || e); }
  // изображения: слишком большие для размера на экране и тяжёлые
  const dpr = window.devicePixelRatio || 1;
  for (const img of [...document.images].slice(0, 400)) {
    if (!img.complete || !img.naturalWidth) continue;
    const w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) continue;
    const entry = performance.getEntriesByName(img.currentSrc || img.src)[0];
    const bytes = entry ? entry.encodedBodySize || entry.transferSize || 0 : 0;
    const ratio = (img.naturalWidth * img.naturalHeight) / (w * h * dpr * dpr);
    const noSize = !img.getAttribute('width') && !img.getAttribute('height') && !img.style.width && !img.style.height;
    if ((ratio >= 4 && bytes > 50000) || bytes > 500000) {
      out.images.push({ src: short(img.currentSrc || img.src, 200), natural: `${img.naturalWidth}×${img.naturalHeight}`, shown: `${w}×${h}`, ratio: Math.round(ratio * 10) / 10, bytes, noSize });
    }
  }
  // DOM
  const all = document.getElementsByTagName('*');
  const ids = new Map();
  for (const el of all) if (el.id) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  let depth = 0;
  const walk = (el, d) => { if (d > depth) depth = d; if (d > 60) return; for (const c of el.children) walk(c, d + 1); };
  walk(document.documentElement, 1);
  out.dom = { nodes: all.length, depth, dupIds: [...ids.entries()].filter(([, c]) => c > 1).slice(0, 20).map(([id, c]) => ({ id, count: c })) };

  // ---------- общие помощники ----------
  const web = /^https?:$/.test(location.protocol);
  const own = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch (_) { return false; } };
  const sel = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => !/^(css|sc|jsx|svelte|_)-?[a-z0-9]{4,}$/i.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      parts.unshift(p);
      if (e.id) { parts[0] = '#' + CSS.escape(e.id); break; }
    }
    return parts.join(' > ');
  };
  const txt = (el) => short((el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), 60);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const head = async (u, method = 'HEAD') => { try { const r = await withTimeout(fetch(u, { method, cache: 'no-store', credentials: 'same-origin', redirect: 'follow' }), 6000); return r; } catch (_) { return null; } };
  const metaC = (q) => { const e = document.querySelector(q); return e ? (e.getAttribute('content') ?? e.getAttribute('href') ?? '').trim() : null; };

  // ---------- 🔎 SEO ----------
  const seo = {
    title: document.title.trim(),
    description: metaC('meta[name="description" i]'),
    canonical: metaC('link[rel="canonical" i]'),
    robots: [metaC('meta[name="robots" i]'), metaC('meta[name="googlebot" i]')].filter(Boolean).join(', '),
    viewport: metaC('meta[name="viewport" i]'),
    lang: document.documentElement.getAttribute('lang') || '',
    h1: [...document.querySelectorAll('h1')].filter(vis).map((h) => short(h.textContent.replace(/\s+/g, ' ').trim(), 120)),
    og: { title: metaC('meta[property="og:title" i]'), description: metaC('meta[property="og:description" i]'), image: metaC('meta[property="og:image" i]') },
    jsonld: document.querySelectorAll('script[type="application/ld+json"]').length,
    favicon: !!document.querySelector('link[rel~="icon" i]'),
    robotsTxt: null, xRobots: null,
  };
  out.seo = seo;

  // заголовки ответа главного документа (для SEO и безопасности)
  let H = null;
  if (web) {
    let r = await head(location.href);
    if (r && r.status === 405) r = await head(location.href, 'GET');
    if (r) {
      H = { status: r.status };
      ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'x-robots-tag', 'server', 'x-powered-by', 'cache-control'].forEach((k) => (H[k] = r.headers.get(k)));
      seo.xRobots = H['x-robots-tag'];
    }
    // robots.txt — только для главной страницы сайта достаточно один раз, но запрос дешёвый
    const rt = await head(location.origin + '/robots.txt', 'GET');
    if (rt && rt.ok && /text\/plain/i.test(rt.headers.get('content-type') || '')) {
      const t = (await rt.text()).slice(0, 50000);
      let star = false, group = false, blockAll = false;
      for (let line of t.split(/\r?\n/)) {
        line = line.replace(/#.*$/, '').trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (!group) star = false; group = true; if (v === '*') star = true; }
        else { group = false; if (k === 'disallow' && star && v === '/') blockAll = true; }
      }
      seo.robotsTxt = { found: true, blockAll, sitemap: /^\s*sitemap\s*:/im.test(t) };
    } else if (rt) seo.robotsTxt = { found: false };
    if (!seo.favicon) { const f = await head(location.origin + '/favicon.ico'); seo.favicon = !!(f && f.ok); }
  }
  out.headers = H;

  // ---------- 🏷 семантика и формы ----------
  const sem = { clickable: [], emptyHeadings: [], fakeLinks: [], formButtons: [], inputTypes: [], headings: [] };
  const INTER = 'a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=radio],[contenteditable=""],[contenteditable=true]';
  let scanned = 0;
  for (const el of document.body ? document.body.querySelectorAll('div,span,li,img,svg,p,i,td,section,article') : []) {
    if (++scanned > 4000 || sem.clickable.length >= 15) break;
    if (el.closest(INTER) || el.closest('qa-bug-overlay')) continue;
    const cs = getComputedStyle(el);
    if (cs.cursor !== 'pointer' && !el.hasAttribute('onclick')) continue;
    const par = el.parentElement;
    if (par && getComputedStyle(par).cursor === 'pointer' && !par.closest(INTER)) continue; // берём верхний
    if (!vis(el)) continue;
    sem.clickable.push({ sel: sel(el), text: txt(el), tab: el.hasAttribute('tabindex') });
  }
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (!vis(h)) return;
    const t = (h.textContent || '').trim() || [...h.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ').trim() || h.getAttribute('aria-label');
    if (!t) sem.emptyHeadings.push({ sel: sel(h), tag: h.tagName.toLowerCase() });
    if (sem.headings.length < 60) sem.headings.push(h.tagName.toLowerCase() + ' ' + short((h.textContent || '').replace(/\s+/g, ' ').trim(), 70));
  });
  document.querySelectorAll('a').forEach((a) => {
    const h = (a.getAttribute('href') || '').trim();
    if (sem.fakeLinks.length < 15 && vis(a) && (!a.hasAttribute('href') || h === '#' || /^javascript:/i.test(h)) && !a.getAttribute('role')) sem.fakeLinks.push({ sel: sel(a), text: txt(a), href: h || '(нет href)' });
  });
  document.querySelectorAll('form').forEach((f) => {
    const bs = [...f.querySelectorAll('button:not([type])')].filter(vis);
    if (bs.length > 1) sem.formButtons.push({ sel: sel(f), buttons: bs.slice(0, 4).map(txt) });
  });
  document.querySelectorAll('input:not([type]),input[type=text]').forEach((i) => {
    if (sem.inputTypes.length >= 10 || !vis(i)) return;
    const hint = [i.name, i.id, i.placeholder, i.getAttribute('autocomplete'), i.getAttribute('aria-label')].join(' ').toLowerCase();
    const want = /e-?mail|почт/.test(hint) ? 'email' : /phone|tel\b|телефон|mobile/.test(hint) ? 'tel' : /url|сайт|website/.test(hint) ? 'url' : null;
    if (want) sem.inputTypes.push({ sel: sel(i), want, hint: short(i.placeholder || i.name || i.id, 40) });
  });
  out.sem = sem;

  // ---------- ✅ лучшие практики и безопасность ----------
  const res = performance.getEntriesByType('resource');
  const best = { mixed: [], brokenRes: [], brokenLinks: [], checkedLinks: 0, passOnHttp: false, headers: H };
  if (location.protocol === 'https:') {
    res.forEach((r) => { if (/^http:/i.test(r.name)) best.mixed.push(short(r.name, 160)); });
    document.querySelectorAll('img[src^="http:"],script[src^="http:"],iframe[src^="http:"],link[href^="http:"][rel~="stylesheet"]').forEach((e) => best.mixed.push(short(e.src || e.href, 160)));
    best.mixed = [...new Set(best.mixed)].slice(0, 15);
    best.formHttp = [...document.querySelectorAll('form[action^="http:"]')].slice(0, 5).map((f) => short(f.action, 120));
  } else if (location.protocol === 'http:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) {
    best.passOnHttp = !!document.querySelector('input[type=password]');
    best.noHttps = true;
  }
  res.forEach((r) => { if (r.responseStatus >= 400 && best.brokenRes.length < 20) best.brokenRes.push({ url: short(r.name, 180), status: r.responseStatus, type: r.initiatorType }); });
  if (web) {
    const links = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href.split('#')[0]).filter((u) => /^https?:/.test(u) && own(u) && u !== location.href.split('#')[0] && !/log-?out|sign-?out|exit|delete|remove|destroy|unsubscribe|cancel|выход|удал/i.test(u)))].slice(0, 40);
    best.checkedLinks = links.length;
    for (let k = 0; k < links.length; k += 6) {
      const part = await Promise.all(links.slice(k, k + 6).map(async (u) => {
        let r = await head(u);
        if (r && (r.status === 405 || r.status === 501)) r = await head(u, 'GET');
        return r && r.status >= 400 ? { url: short(u, 180), status: r.status } : null;
      }));
      part.forEach((x) => x && best.brokenLinks.push(x));
    }
  }
  out.best = best;

  // ---------- ⚡ производительность загрузки ----------
  const navE = performance.getEntriesByType('navigation')[0];
  const TEXT = /\.(m?js|css|json|html?|svg|xml|txt|map)(\?|$)/i;
  const px = { blocking: [], uncompressed: [], bigJs: [], jsTotal: 0, cssTotal: 0, weight: 0, requests: res.length, thirdParty: {}, fonts: [], lazyFirst: [], noLazy: 0, oldFormat: [], noSizeImgs: [], protocol: navE ? navE.nextHopProtocol : '', cache: [] };
  res.forEach((r) => {
    px.weight += r.transferSize || 0;
    if (r.renderBlockingStatus === 'blocking') px.blocking.push({ url: short(r.name, 160), ms: Math.round(r.duration), kb: Math.round((r.encodedBodySize || 0) / 1024) });
    if (r.encodedBodySize > 20000 && r.decodedBodySize && r.encodedBodySize >= r.decodedBodySize * 0.97 && TEXT.test(new URL(r.name).pathname)) px.uncompressed.push({ url: short(r.name, 160), kb: Math.round(r.encodedBodySize / 1024) });
    const path = (() => { try { return new URL(r.name).pathname; } catch (_) { return ''; } })();
    if (r.initiatorType === 'script' || /\.m?js$/i.test(path)) { px.jsTotal += r.decodedBodySize || 0; if (r.decodedBodySize > 400000) px.bigJs.push({ url: short(r.name, 160), kb: Math.round(r.decodedBodySize / 1024), gz: Math.round((r.encodedBodySize || 0) / 1024) }); }
    if (/\.css$/i.test(path)) px.cssTotal += r.decodedBodySize || 0;
    if (/\.(jpe?g|png|gif|bmp)$/i.test(path) && r.encodedBodySize > 150000) px.oldFormat.push({ url: short(r.name, 160), kb: Math.round(r.encodedBodySize / 1024) });
    if (!own(r.name)) { try { const h = new URL(r.name).hostname; const t = px.thirdParty[h] || (px.thirdParty[h] = { n: 0, kb: 0 }); t.n++; t.kb += Math.round((r.transferSize || 0) / 1024); } catch (_) {} }
  });
  if (navE) {
    px.weight += navE.transferSize || 0;
    if (navE.encodedBodySize > 20000 && navE.decodedBodySize && navE.encodedBodySize >= navE.decodedBodySize * 0.97) px.uncompressed.unshift({ url: short(location.href, 160) + ' (сама страница)', kb: Math.round(navE.encodedBodySize / 1024) });
  }
  px.blocking = px.blocking.slice(0, 15); px.uncompressed = px.uncompressed.slice(0, 15); px.oldFormat = px.oldFormat.slice(0, 10);
  for (const sh of [...document.styleSheets].slice(0, 60)) {
    let rules;
    try { rules = sh.cssRules; } catch (_) { continue; }
    for (const r of rules || []) {
      if (r.type === 5) { const fd = r.style.getPropertyValue('font-display'); if (!fd || fd === 'auto' || fd === 'block') px.fonts.push(short(r.style.getPropertyValue('font-family').replace(/["']/g, ''), 60) + (fd ? ` (font-display: ${fd})` : '')); }
    }
  }
  document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach((l) => { if (!/display=(swap|optional|fallback)/.test(l.href)) px.fonts.push('Google Fonts без &display=swap'); });
  px.fonts = [...new Set(px.fonts)].slice(0, 12);
  const vh = innerHeight;
  [...document.images].forEach((img) => {
    if (!img.naturalWidth || !vis(img)) return;
    const r = img.getBoundingClientRect(), top = r.top + scrollY;
    const big = r.width * r.height > 40000;
    if (img.loading === 'lazy' && top < vh && big && px.lazyFirst.length < 5) px.lazyFirst.push(short(img.currentSrc || img.src, 140));
    if (img.loading !== 'lazy' && top > vh * 1.5 && big) px.noLazy++;
    if (!img.getAttribute('width') && !img.getAttribute('height') && !img.style.width && !img.style.aspectRatio && big && px.noSizeImgs.length < 10) {
      const cs = getComputedStyle(img);
      if (cs.aspectRatio === 'auto') px.noSizeImgs.push(short(img.currentSrc || img.src, 140));
    }
  });
  if (web) {
    const statics = res.filter((r) => own(r.name) && /\.(m?js|css|woff2?|png|jpe?g|webp|avif|svg)(\?|$)/i.test(r.name)).slice(0, 6);
    for (const r of statics) {
      const h = await head(r.name);
      if (!h || !h.ok) continue;
      const cc = (h.headers.get('cache-control') || '').toLowerCase();
      const age = +((cc.match(/max-age=(\d+)/) || [])[1] || 0);
      if (!cc || /no-store|no-cache/.test(cc) || age < 3600) px.cache.push({ url: short(r.name, 160), cc: cc || '(нет Cache-Control)' });
    }
  }
  px.thirdParty = Object.entries(px.thirdParty).sort((a, b) => b[1].kb - a[1].kb).slice(0, 12).map(([h, v]) => ({ host: h, ...v }));
  out.perfx = px;
  return out;
}

async function auditPage(tabId) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Проверка не активна' };
  tabId = tabId || S.tabId;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['vendor/axe.min.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pageAudit, args: [await getAxeLocale()] });
    if (!result) return { ok: false, error: 'Страница не ответила' };
    S.audits ||= [];
    const key = result.url.replace(/#.*$/, '');
    S.audits = S.audits.filter((a) => a.url.replace(/#.*$/, '') !== key);
    S.audits.push(result);
    await saveSessionNow();
    const n = result.a11y.reduce((s, v) => s + v.count, 0);
    return { ok: true, a11y: result.a11y.length, nodes: n, images: result.images.length, error: result.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ================= жизненный цикл бага =================
const status = () => ({
  active: !!(S && S.active),
  id: S && S.id,
  tabId: S && S.tabId,
  startTime: S && S.startTime,
  annotations: S ? S.annotations.length : 0,
  network: S ? S.network.length : 0,
  console: S ? S.console.length : 0,
  errors: S ? S.console.filter((c) => c.level === 'error').length + S.network.filter((n) => n.failed || n.status >= 400).length : 0,
  actions: S ? S.actions.length : 0,
  events: S ? (S.events || []).length : 0,
  video: !!(S && S.videos.some((v) => v.recording)),
  videoStart: S && (S.videos.find((v) => v.recording) || {}).start,
  voice: !!(S && S.voice.some((v) => v.recording)),
  voiceStart: S && (S.voice.find((v) => v.recording) || {}).start,
  cdp: !!(S && S.meta.cdp),
  bugType: (S && S.bugType) || 'auto',
  autoErrors: S ? (S.errors || []).length : 0,
});

function pushOverlayState() {
  if (!S || !S.active) return;
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-state', state: status() }).catch(() => {});
}
function toast(text, kind = 'info') {
  if (!S || !S.active) return;
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-toast', text, kind }).catch(() => {});
}

async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js', ...(await i18nFiles()), 'overlay.js'] });
  } catch (_) {}
}

async function startBug(tabId) {
  await ready;
  // сначала пользователь должен прочитать, какие данные собираются
  if (!(await chrome.storage.local.get('qa_consent')).qa_consent) {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    return { ok: false, error: 'Сначала прочитайте, какие данные использует расширение, и нажмите «Понятно, начать работу».' };
  }
  if (S && S.active) {
    if (S.tabId === tabId) {
      await injectOverlay(tabId);
      return status();
    }
    await finishBug({ open: false });
  }
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) throw new Error('На служебных страницах Chrome фиксация недоступна. Откройте тестируемый сайт.');
  const st = await getSettings();
  const now = Date.now();
  const from = now - st.bufferMin * 60 * 1000;
  const b = getBuf(tabId);
  const within = (arr) => arr.filter((e) => e.ts >= from).map((e) => ({ ...e }));
  S = {
    id: 'r' + now,
    active: true,
    tabId,
    startTime: now,
    endTime: 0,
    options: { tabAudio: st.tabAudio, bufferMin: st.bufferMin },
    meta: {
      startUrl: tab.url,
      title: tab.title,
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: (navigator.userAgentData && navigator.userAgentData.platform) || '',
      bufferFrom: from,
    },
    console: within(b.console),
    network: within(b.network),
    actions: within(b.actions),
    nav: within(b.nav),
    events: within(b.events),
    samples: within(b.samples),
    resources: within(b.resources),
    snapshot: null,
    annotations: [],
    errors: [],
    bugType: 'auto',
    videos: [],
    voice: [],
    fields: null,
  };
  if (!S.nav.length || S.nav[S.nav.length - 1].url !== tab.url) S.nav.push({ ts: now, url: tab.url, title: tab.title });
  await chrome.storage.local.set({ qa_active: S.id });
  if (st.cdp) await attachCdp(tabId);
  S.snapshot = await takeSnapshot(tabId);
  if (S.meta.cdp) S.meta.cdpMetricsStart = await cdpMetrics(tabId);
  await saveSessionNow();
  setBadge(true);
  await injectOverlay(tabId);
  if (st.videoOnStart) {
    try { await startVideo(); } catch (e) { toast(e.message, 'error'); }
  }
  return status();
}

let finishing = null;
function finishBug(opts) {
  if (!finishing) finishing = doFinish(opts).finally(() => (finishing = null));
  return finishing;
}
async function doFinish({ open = true } = {}) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Нет активного бага' };
  if (autoState.group) { clearTimeout(autoState.timer); await flushAuto(); }
  try {
    const tab = await chrome.tabs.get(S.tabId);
    const key = (tab.url || '').replace(/#.*$/, '');
    if (/^https?:|^file:/.test(tab.url) && !(S.audits || []).some((a) => a.url.replace(/#.*$/, '') === key)) await auditPage(S.tabId);
  } catch (_) {}
  try { await stopVoice(); } catch (_) {}
  try { await stopVideo(); } catch (_) {}
  S.snapshotEnd = await takeSnapshot(S.tabId);
  if (S.meta.cdp) {
    S.meta.cdpMetricsEnd = await cdpMetrics(S.tabId);
    if (emuActive(S.tabId)) dbgOwned.add(S.tabId); // условия (сеть, устройство) продолжают действовать
    else try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {}
    S.meta.cdp = false;
  }
  S.active = false;
  S.endTime = Date.now();
  try { S.meta.endUrl = (await chrome.tabs.get(S.tabId)).url; } catch (_) {}
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-remove' }).catch(() => {});
  const id = S.id;
  await saveSessionNow();
  await chrome.storage.local.remove('qa_active');
  S = null;
  setBadge(false);
  await maybeCloseOffscreen();
  if (open) await chrome.tabs.create({ url: chrome.runtime.getURL('report.html?id=' + id) });
  return { ok: true, id };
}

async function cancelBug() {
  await ready;
  if (!S || !S.active) return { ok: false };
  const id = S.id;
  try { await stopVoice(); } catch (_) {}
  try { await stopVideo(); } catch (_) {}
  if (S.meta.cdp) { if (emuActive(S.tabId)) dbgOwned.add(S.tabId); else try { await chrome.debugger.detach({ tabId: S.tabId }); } catch (_) {} }
  chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-remove' }).catch(() => {});
  S = null;
  await chrome.storage.local.remove('qa_active');
  await QADB.del('reports', id).catch(() => {});
  await QADB.delPrefix('blobs', id + '_').catch(() => {});
  setBadge(false);
  await maybeCloseOffscreen();
  return { ok: true };
}

function setBadge(on) {
  const rec = on && S && S.videos.some((v) => v.recording);
  chrome.action.setBadgeText({ text: on ? (rec ? 'REC' : 'BUG') : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff2d55' });
}

// ================= пометки и скриншоты =================
async function addAnnotation(m, sender) {
  await ready;
  if (!S || !S.active || !sender.tab || sender.tab.id !== S.tabId) return { ok: false, error: 'Фиксация бага не активна' };
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  } catch (e) {
    return { ok: false, error: 'Не удалось сделать скриншот: ' + e.message };
  }
  const n = S.annotations.reduce((m, a) => Math.max(m, a.n), 0) + 1; // номера не переиспользуются после удаления
  const key = `${S.id}_shot_${n}`;
  await QADB.put('blobs', key, dataUrl);
  S.annotations.push({
    n,
    ts: Date.now(),
    kind: m.kind,
    comment: m.comment || '',
    severity: m.severity || 'minor',
    element: m.element || null,
    shape: m.shape || null,
    viewport: m.viewport || null,
    url: sender.tab.url,
    title: sender.tab.title,
    shotKey: key,
    voiceRecording: S.voice.some((v) => v.recording),
    cond: emuLabel(sender.tab.id),
  });
  if (m.viewport && !S.meta.viewport) S.meta.viewport = m.viewport;
  await saveSessionNow();
  pushOverlayState();
  return { ok: true, n, count: S.annotations.length };
}

async function deleteAnnotation(m) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Фиксация бага не активна' };
  const a = S.annotations.find((x) => x.n === m.n);
  if (!a) return { ok: false, error: 'Пометка не найдена' };
  S.annotations = S.annotations.filter((x) => x !== a);
  await QADB.del('blobs', a.shotKey).catch(() => {});
  await saveSessionNow();
  pushOverlayState();
  return { ok: true, count: S.annotations.length };
}

async function updateAnnotation(m, sender) {
  await ready;
  if (!S || !S.active) return { ok: false, error: 'Фиксация бага не активна' };
  const a = S.annotations.find((x) => x.n === m.n);
  if (!a) return { ok: false, error: 'Пометка не найдена' };
  a.comment = m.comment || '';
  if (m.severity) a.severity = m.severity;
  if (m.recapture && sender.tab && sender.tab.id === S.tabId) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      await QADB.put('blobs', a.shotKey, dataUrl);
      if (m.shape) a.shape = m.shape;
      if (m.viewport) a.viewport = m.viewport;
      a.url = sender.tab.url;
    } catch (e) {
      await saveSessionNow();
      return { ok: false, error: 'Текст сохранён, но скриншот не обновился: ' + e.message };
    }
  }
  a.edited = Date.now();
  await saveSessionNow();
  return { ok: true, count: S.annotations.length };
}

// ================= offscreen: видео и микрофон =================
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Запись видео вкладки и голосовых комментариев тестировщика',
  });
}
async function maybeCloseOffscreen() {
  if (S && (S.videos.some((v) => v.recording) || S.voice.some((v) => v.recording))) return;
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctx.length) await chrome.offscreen.closeDocument();
  } catch (_) {}
}
const sendOff = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg });

async function startVideo(streamId) {
  if (!S || !S.active) throw new Error('Сначала начните проверку');
  if (S.videos.some((v) => v.recording)) return status();
  try {
    if (!streamId) streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: S.tabId });
  } catch (e) {
    throw new Error('Chrome требует подтверждения для записи: нажмите иконку расширения → «⏺ Видео». (' + e.message + ')');
  }
  await ensureOffscreen();
  const n = S.videos.length + 1;
  const key = `${S.id}_video_${n}`;
  const r = await sendOff({ type: 'video-start', streamId, tabAudio: !!S.options.tabAudio, key });
  if (!r || !r.ok) {
    await maybeCloseOffscreen();
    throw new Error('Не удалось начать запись видео: ' + ((r && r.error) || 'неизвестная ошибка'));
  }
  S.videos.push({ n, key, start: Date.now(), recording: true });
  setBadge(true);
  await saveSessionNow();
  pushOverlayState();
  return status();
}
async function stopVideo() {
  const v = S && S.videos.find((x) => x.recording);
  if (!v) return status();
  let r = null;
  try { r = await sendOff({ type: 'video-stop' }); } catch (e) { r = { ok: false, error: e.message }; }
  v.recording = false;
  v.end = Date.now();
  v.saved = !!(r && r.ok);
  v.size = r && r.size;
  v.mime = r && r.mime;
  if (!v.saved) v.error = r && r.error;
  if (S.active) setBadge(true);
  await saveSessionNow();
  await maybeCloseOffscreen();
  pushOverlayState();
  return status();
}

async function startVoice() {
  if (!S || !S.active) throw new Error('Сначала начните проверку');
  if (S.voice.some((v) => v.recording)) return status();
  await ensureOffscreen();
  const n = S.voice.length + 1;
  const key = `${S.id}_voice_${n}`;
  const r = await sendOff({ type: 'mic-start', key });
  if (!r || !r.ok) {
    await maybeCloseOffscreen();
    if (r && r.permission) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('mic.html'), active: true });
      throw new Error('Нужно один раз разрешить микрофон: подтвердите доступ в открывшейся вкладке и нажмите 🎤 снова.');
    }
    throw new Error('Микрофон недоступен: ' + ((r && r.error) || 'неизвестная ошибка'));
  }
  S.voice.push({ n, key, start: Date.now(), recording: true });
  await saveSessionNow();
  pushOverlayState();
  return status();
}
async function stopVoice() {
  const v = S && S.voice.find((x) => x.recording);
  if (!v) return status();
  let r = null;
  try { r = await sendOff({ type: 'mic-stop' }); } catch (e) { r = { ok: false, error: e.message }; }
  v.recording = false;
  v.end = Date.now();
  v.saved = !!(r && r.ok);
  v.size = r && r.size;
  if (!v.saved) v.error = r && r.error;
  await saveSessionNow();
  await maybeCloseOffscreen();
  pushOverlayState();
  return status();
}

// ================= DevTools-протокол (полный захват сети) =================
const cdpReq = {};
const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function attachCdp(tabId) {
  try {
    if (!chrome.debugger || !(await hasDebugger())) throw new Error('нет разрешения на отладку вкладки — включите «Полный захват сети» в окне расширения ещё раз');
    try { await chrome.debugger.attach({ tabId }, '1.3'); } catch (e) { if (!/already attached/i.test(e.message)) throw e; }
    await cdp(tabId, 'Network.enable', { maxPostDataSize: 20000 });
    await cdp(tabId, 'Log.enable');
    await cdp(tabId, 'Performance.enable').catch(() => {});
    S.meta.cdp = true;
    S.meta.cdpUsed = true;
  } catch (e) {
    S.meta.cdpError = e.message;
  }
}
async function cdpMetrics(tabId) {
  try {
    const r = await cdp(tabId, 'Performance.getMetrics');
    return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
  } catch (_) {
    return null;
  }
}
async function takeSnapshot(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'qa-snapshot' }, { frameId: 0 });
  } catch (_) {
    return null;
  }
}

// ================= подключение счётчика перерисовок React =================
async function syncReactProbe() {
  try {
    const st = await getSettings();
    const ex = await chrome.scripting.getRegisteredContentScripts({ ids: ['qa-react'] });
    if (st.reactRenders && !ex.length) {
      await chrome.scripting.registerContentScripts([
        { id: 'qa-react', js: ['react-probe.js'], matches: ['<all_urls>'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true },
      ]);
    } else if (!st.reactRenders && ex.length) {
      await chrome.scripting.unregisterContentScripts({ ids: ['qa-react'] });
    }
  } catch (e) {
    console.warn('[QA Bug Recorder] react probe', e);
  }
}
syncReactProbe();
chrome.storage.onChanged.addListener((ch) => { if (ch.qa_settings) syncReactProbe(); });

const trunc = (s, n) => (s == null ? s : s.length > n ? s.slice(0, n) + `\n… [обрезано, всего ${s.length} символов]` : s);
function applyResp(e, r) {
  e.status = r.status;
  e.statusText = r.statusText;
  e.mime = r.mimeType;
  e.resHeaders = r.headers;
  e.remoteIP = r.remoteIPAddress;
  e.protocol = r.protocol;
  e.fromCache = !!(r.fromDiskCache || r.fromPrefetchCache || r.fromServiceWorker);
}

const onDbgEvent = async (src, method, p) => {
  await ready;
  if (!S || !S.active || src.tabId !== S.tabId) return;
  const tabId = src.tabId;
  switch (method) {
    case 'Network.requestWillBeSent': {
      const prev = cdpReq[p.requestId];
      if (p.redirectResponse && prev) {
        applyResp(prev, p.redirectResponse);
        prev.redirectedTo = p.request.url;
        prev.finished = true;
      }
      const e = {
        id: p.requestId,
        ts: p.wallTime ? Math.round(p.wallTime * 1000) : Date.now(),
        method: p.request.method,
        url: p.request.url,
        type: p.type || 'Other',
        reqHeaders: p.request.headers,
        postData: trunc(p.request.postData, 20000),
        initiator: p.initiator && p.initiator.type,
        source: 'cdp',
        _t: p.timestamp,
      };
      cdpReq[p.requestId] = e;
      ingest(tabId, 'network', e);
      break;
    }
    case 'Network.responseReceived': {
      const e = cdpReq[p.requestId];
      if (e) { applyResp(e, p.response); if (p.type) e.type = p.type; saveSession(); if (e.status >= 400 && ['XHR', 'Fetch', 'Document'].includes(e.type)) autoCheck('network', e); }
      break;
    }
    case 'Network.loadingFinished': {
      const e = cdpReq[p.requestId];
      if (!e) break;
      e.finished = true;
      e.size = p.encodedDataLength;
      e.duration = Math.round((p.timestamp - e._t) * 1000);
      delete cdpReq[p.requestId];
      if (['XHR', 'Fetch'].includes(e.type)) {
        try {
          const b = await cdp(tabId, 'Network.getResponseBody', { requestId: p.requestId });
          e.body = b.base64Encoded ? `[бинарные данные, ${b.body.length} символов base64]` : trunc(b.body, 20000);
        } catch (_) {}
      }
      saveSession();
      break;
    }
    case 'Network.loadingFailed': {
      const e = cdpReq[p.requestId];
      if (!e) break;
      e.failed = true;
      e.error = p.errorText;
      e.canceled = p.canceled;
      e.blocked = p.blockedReason || (p.corsErrorStatus && 'CORS: ' + p.corsErrorStatus.corsError);
      e.duration = Math.round((p.timestamp - e._t) * 1000);
      delete cdpReq[p.requestId];
      saveSession();
      if (['XHR', 'Fetch', 'Document'].includes(e.type)) autoCheck('network', e);
      break;
    }
    case 'Log.entryAdded': {
      const en = p.entry;
      ingest(tabId, 'console', {
        ts: en.timestamp ? Math.round(en.timestamp) : Date.now(),
        level: en.level === 'verbose' ? 'debug' : en.level === 'warning' ? 'warn' : en.level,
        source: 'browser:' + en.source,
        text: en.text + (en.url ? ' — ' + en.url : ''),
        loc: en.url ? `${en.url}${en.lineNumber != null ? ':' + (en.lineNumber + 1) : ''}` : '',
      });
      break;
    }
  }
};

const onDbgDetach = async (src, reason) => {
  await ready;
  if (S && S.active && src.tabId === S.tabId) {
    S.meta.cdp = false;
    S.meta.cdpDetached = reason;
    saveSession();
    if (reason !== 'target_closed') toast('Расширенный захват сети отключён (панель отладки закрыта). Сбор продолжается в обычном режиме.', 'warn');
  }
};

// ================= события вкладок =================
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  await ready;
  if (info.url && /^(https?|file):/.test(info.url)) ingest(tabId, 'nav', { ts: Date.now(), url: info.url, title: tab.title });
  if (S && S.active && tabId === S.tabId && info.status === 'complete') injectOverlay(tabId);
  if (S && S.active && tabId === S.tabId && (info.status === 'complete' || info.url)) scheduleAudit(tabId);
});

// автопроверка каждой новой страницы (раз на адрес, после того как страница успокоится)
let auditTimer = null, auditBusy = false;
function scheduleAudit(tabId) {
  clearTimeout(auditTimer);
  auditTimer = setTimeout(async () => {
    if (!S || !S.active || tabId !== S.tabId || auditBusy) return;
    if (!(await getSettings()).autoAudit) return;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch (_) { return; }
    if (tab.status !== 'complete' || !/^(https?|file):/.test(tab.url || '')) return;
    const key = tab.url.replace(/#.*$/, '');
    if ((S.audits || []).some((a) => a.url.replace(/#.*$/, '') === key)) return;
    auditBusy = true;
    try { await auditPage(tabId); } finally { auditBusy = false; }
  }, 4000);
}
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  delete buffers[tabId];
  saveBuf();
  if (S && S.active && S.tabId === tabId) finishBug({ open: true });
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  await ready;
  try {
    const t = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!t) return;
    if (cmd === 'found-bug') await startBug(t.id);
    else if (cmd === 'finish') await finishBug({ open: true });
    else if (cmd === 'pick-element' || cmd === 'annotate') {
      if (!S || !S.active) await startBug(t.id);
      chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-tool', tool: cmd === 'pick-element' ? 'element' : 'arrow' }).catch(() => {});
    }
  } catch (e) {
    console.warn('[QA Bug Recorder]', e);
  }
});

// ================= сообщения =================
const handlers = {
  buf: async (m, sender) => {
    await ready;
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return {};
    for (const it of m.items || []) {
      const kind = { console: 'console', net: 'network', action: 'actions', event: 'events', sample: 'samples', res: 'resources' }[it.kind];
      if (kind) ingest(tabId, kind, it.data);
    }
    return {};
  },
  keepalive: async () => ({ ok: true }),
  status: async () => { await ready; return status(); },
  'start-bug': async (m) => startBug(m.tabId),
  finish: async () => finishBug({ open: true }),
  cancel: async () => cancelBug(),
  'video-toggle': async (m) => {
    await ready;
    return S && S.videos.some((v) => v.recording) ? stopVideo() : startVideo(m.streamId);
  },
  'voice-toggle': async () => {
    await ready;
    return S && S.voice.some((v) => v.recording) ? stopVoice() : startVoice();
  },
  tool: async (m) => {
    await ready;
    if (!S || !S.active) return { ok: false };
    await chrome.tabs.update(S.tabId, { active: true });
    chrome.tabs.sendMessage(S.tabId, { type: 'qa-overlay-tool', tool: m.tool }).catch(() => {});
    return { ok: true };
  },
  annotation: (m, sender) => addAnnotation(m, sender),
  'annotation-delete': (m) => deleteAnnotation(m),
  'error-delete': (m) => deleteError(m),
  'error-ignore': (m) => ignoreError(m),
  'audit-page': (m, sender) => auditPage(sender.tab && sender.tab.id),
  'set-type': async (m) => {
    await ready;
    if (!S || !S.active) return { ok: false };
    S.bugType = m.bugType || 'auto';
    await saveSessionNow();
    return { ok: true, bugType: S.bugType };
  },
  'annotation-update': (m, sender) => updateAnnotation(m, sender),
  'annotations-list': async () => {
    await ready;
    return {
      ok: true,
      items: S && S.active ? S.annotations.map((a) => ({ n: a.n, kind: a.kind, comment: a.comment, url: a.url })) : [],
      errors: S && S.active ? (S.errors || []).map((x) => ({ n: x.n, kind: x.kind, title: x.title, count: x.count, url: x.url })) : [],
    };
  },
  'overlay-hello': async (m, sender) => {
    await ready;
    const st = status();
    st.mine = !!(sender.tab && S && S.tabId === sender.tab.id);
    return st;
  },
  'off-video-ended': async () => { await ready; if (S) { await stopVideo(); toast('Запись видео остановлена'); } return {}; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg, sender))
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

// после установки — страница с описанием данных и согласием
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }); });

// отладка вкладки — необязательное разрешение: обработчики подключаются, когда оно выдано
let dbgHooked = false;
function hookDebugger() {
  if (dbgHooked || !chrome.debugger) return;
  dbgHooked = true;
  chrome.debugger.onEvent.addListener(onDbgEvent);
  chrome.debugger.onDetach.addListener(onDbgDetach);
  if (typeof onToolsDbgDetach === 'function') chrome.debugger.onDetach.addListener(onToolsDbgDetach);
}
chrome.permissions.onAdded.addListener(() => hookDebugger());
const hasDebugger = () => chrome.permissions.contains({ permissions: ['debugger'] });

// инструменты: автотесты, условия, скриншоты экранов
importScripts('tools-bg.js');
hookDebugger();
