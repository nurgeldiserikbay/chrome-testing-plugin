// Изолированный контент-скрипт: принимает данные от inject.js, фиксирует действия пользователя
// (клики, ввод, отправку форм) и пачками отправляет всё в service worker.
(() => {
  if (globalThis.__qaBridge) return;
  globalThis.__qaBridge = true;
  const isTop = window === window.top;

  const TAG = '__qa_bug_recorder__';
  const OVERLAY_TAG = 'QA-BUG-OVERLAY';
  const SENSITIVE = /pass|pwd|secret|token|card|cvv|cvc|ccnum|cc-num|iban|\bpin\b|otp|ssn|снилс|паспорт/i;

  // ---------- утилиты, общие с overlay.js ----------
  const U = (globalThis.__qaUtil = {
    cssPath(el) {
      if (!(el instanceof Element)) return '';
      const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
      const testAttrs = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id', 'data-automation-id'];
      const parts = [];
      let cur = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 7) {
        for (const a of testAttrs) {
          const v = cur.getAttribute(a);
          if (v) {
            parts.unshift(`[${a}="${v.replace(/"/g, '\\"')}"]`);
            return parts.join(' > ');
          }
        }
        if (cur.id && !/\d{4,}/.test(cur.id)) {
          try {
            if (document.querySelectorAll('#' + esc(cur.id)).length === 1) {
              parts.unshift('#' + esc(cur.id));
              return parts.join(' > ');
            }
          } catch (_) {}
        }
        let s = cur.tagName.toLowerCase();
        const cls = [...cur.classList]
          .filter((c) => c.length < 32 && !/\d{3,}|^(is-|has-|ng-|css-|sc-|jsx-|active$|hover$|focus)/.test(c))
          .slice(0, 2);
        if (cls.length) s += '.' + cls.map(esc).join('.');
        const p = cur.parentElement;
        if (p) {
          const same = [...p.children].filter((c) => c.tagName === cur.tagName);
          if (same.length > 1) s += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
        parts.unshift(s);
        if (s === 'body' || s === 'html') break;
        cur = p;
        depth++;
      }
      return parts.join(' > ');
    },
    text(el, n = 80) {
      if (!el) return '';
      let t = '';
      try {
        t = el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.alt || el.getAttribute('placeholder') || '';
      } catch (_) {}
      t = String(t).replace(/\s+/g, ' ').trim();
      return t.length > n ? t.slice(0, n) + '…' : t;
    },
    label(el) {
      if (!el) return '';
      try {
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        if (el.labels && el.labels[0]) return el.labels[0].innerText.replace(/\s+/g, ' ').trim();
        const by = el.getAttribute('aria-labelledby');
        if (by) {
          const l = document.getElementById(by);
          if (l) return l.innerText.trim();
        }
        return el.getAttribute('placeholder') || el.name || el.id || el.tagName.toLowerCase();
      } catch (_) {
        return '';
      }
    },
    isSensitive(el) {
      return (
        el.type === 'password' ||
        SENSITIVE.test(el.name || '') ||
        SENSITIVE.test(el.id || '') ||
        SENSITIVE.test(el.getAttribute('autocomplete') || '')
      );
    },
    // устойчивые локаторы для «автотеста из последних действий» (те же правила, что в recorder.js)
    locators(el) {
      try {
        const TA = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-test-id', 'data-automation-id'];
        const esc = (v) => CSS.escape(v);
        const qv = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
        const genId = (id) => /\d{3,}|^:r|^(ember|react|radix|headlessui|mui|rc_|downshift|chakra)/i.test(id) || id.length > 40;
        const textOf = (e) => norm(e.innerText || e.textContent || e.value || '');
        const unique = (css) => { try { const l = document.querySelectorAll(css); return l.length === 1 && l[0] === el; } catch (_) { return false; } };
        const path = () => {
          const parts = [];
          for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 6; e = e.parentElement) {
            if (e.id && !genId(e.id)) { parts.unshift('#' + esc(e.id)); break; }
            const ta = TA.find((a) => e.getAttribute(a));
            if (ta) { parts.unshift(`[${ta}=${qv(e.getAttribute(ta))}]`); break; }
            let p = e.tagName.toLowerCase();
            const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
            if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
            parts.unshift(p);
          }
          return parts.join(' > ');
        };
        const tag = el.tagName.toLowerCase();
        const L = [];
        const add = (css) => { if (css && unique(css) && !L.some((x) => x.css === css)) L.push({ css }); };
        TA.forEach((a) => el.getAttribute(a) && add(`[${a}=${qv(el.getAttribute(a))}]`));
        if (el.id && !genId(el.id)) add('#' + esc(el.id));
        if (el.getAttribute('name')) add(`${tag}[name=${qv(el.getAttribute('name'))}]`);
        if (el.getAttribute('aria-label')) add(`${tag}[aria-label=${qv(el.getAttribute('aria-label'))}]`);
        if (el.getAttribute('placeholder')) add(`${tag}[placeholder=${qv(el.getAttribute('placeholder'))}]`);
        const t = textOf(el);
        if (t && t.length <= 60 && /^(a|button|summary|label|li|option|h[1-6]|span|div|td|th|p)$/.test(tag)) {
          if ([...document.querySelectorAll(tag)].filter((e) => textOf(e) === t).length === 1) L.push({ text: t, tag });
        }
        if (tag === 'a' && el.getAttribute('href') && !/^(#|javascript:)/.test(el.getAttribute('href'))) add(`a[href=${qv(el.getAttribute('href'))}]`);
        add(path());
        if (!L.length) L.push({ css: path() });
        return L.slice(0, 4);
      } catch (_) { return [{ css: U.cssPath(el) }]; }
    },
    stepDesc(el) {
      const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
      const tag = el.tagName.toLowerCase();
      const field = /^(input|textarea|select)$/.test(tag);
      const lbl = field && el.labels && el.labels[0] ? norm(el.labels[0].innerText || el.labels[0].textContent) : '';
      const t = (field ? lbl || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') : norm(el.innerText || el.textContent || el.value)).slice(0, 50) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '';
      const kind = tag === 'a' ? 'ссылка' : tag === 'button' || el.getAttribute('role') === 'button' ? 'кнопка' : tag === 'input' ? 'поле' : tag === 'select' ? 'список' : tag === 'textarea' ? 'поле' : 'элемент';
      return t ? `${kind} «${t}»` : `${kind} ${tag}`;
    },
    describe(el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const pick = ['display', 'position', 'width', 'height', 'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'opacity', 'visibility', 'z-index', 'overflow'];
      const styles = {};
      pick.forEach((p) => (styles[p] = cs.getPropertyValue(p)));
      let html = '';
      try {
        const clone = el.cloneNode(true);
        clone.querySelectorAll && clone.querySelectorAll('input[type=password]').forEach((i) => i.setAttribute('value', '••••'));
        html = clone.outerHTML || '';
      } catch (_) {}
      return {
        selector: U.cssPath(el),
        tag: el.tagName.toLowerCase(),
        text: U.text(el, 300),
        html: html.length > 3000 ? html.slice(0, 3000) + '…' : html,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        styles,
      };
    },
  });

  // ---------- очередь и отправка ----------
  let queue = [];
  let dead = false;
  const q = (kind, data) => {
    if (dead) return;
    data.ts = data.ts || Date.now();
    data.page = location.href;
    queue.push({ kind, data });
    if (queue.length > 200) flush();
  };
  const flush = () => {
    if (!queue.length || dead) return;
    const items = queue;
    queue = [];
    try {
      chrome.runtime.sendMessage({ type: 'buf', items, top: isTop }).catch(() => {});
    } catch (_) {
      dead = true; // расширение перезагружено, контекст недействителен
      clearInterval(timer);
    }
  };
  const timer = setInterval(flush, 1000);
  window.addEventListener('pagehide', flush);

  // данные из inject.js (MAIN world)
  document.addEventListener(TAG, (e) => {
    try {
      const { kind, data } = JSON.parse(e.detail);
      if (['console', 'net', 'event', 'sample', 'res'].includes(kind)) q(kind, data);
    } catch (_) {}
  });

  // ---------- снимок состояния страницы в момент бага ----------
  const SECRET = /pass|pwd|secret|token|auth|session|sid|card|cvv|jwt|key|csrf|xsrf/i;
  const storageDump = (st) => {
    const out = [];
    try {
      for (let i = 0; i < st.length && i < 200; i++) {
        const k = st.key(i);
        const v = st.getItem(k) || '';
        out.push({ key: k, size: v.length, value: SECRET.test(k) ? '•••' : v.length > 300 ? v.slice(0, 300) + '…' : v });
      }
    } catch (_) {}
    return out;
  };
  const snapshot = () => {
    const c = navigator.connection || {};
    const mem = performance.memory;
    const mq = (q) => { try { return matchMedia(q).matches; } catch (_) { return false; } };
    return {
      url: location.href,
      title: document.title,
      referrer: document.referrer,
      lang: document.documentElement.lang || '',
      readyState: document.readyState,
      domNodes: document.getElementsByTagName('*').length,
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      screen: { w: screen.width, h: screen.height },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY), height: document.documentElement.scrollHeight },
      colorScheme: mq('(prefers-color-scheme: dark)') ? 'тёмная' : 'светлая',
      reducedMotion: mq('(prefers-reduced-motion: reduce)'),
      zoomHint: Math.round((outerWidth / innerWidth) * 100) || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      online: navigator.onLine,
      connection: c.effectiveType ? { type: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: !!c.saveData } : null,
      cpu: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      touch: navigator.maxTouchPoints || 0,
      serviceWorker: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      cookies: (document.cookie || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
        const i = x.indexOf('=');
        const name = i > 0 ? x.slice(0, i) : x;
        const val = i > 0 ? x.slice(i + 1) : '';
        return { name, size: val.length, value: SECRET.test(name) ? '•••' : val.length > 120 ? val.slice(0, 120) + '…' : val };
      }),
      localStorage: storageDump(window.localStorage),
      sessionStorage: storageDump(window.sessionStorage),
    };
  };
  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m && m.type === 'qa-snapshot' && isTop) { try { send(snapshot()); } catch (e) { send(null); } }
  });

  if (!isTop) return; // действия пользователя пишем только в основном фрейме

  // ---------- ⏪ повтор страницы (rr.js в MAIN-мире) → фон ----------
  let rrQueue = [], rrBytes = 0, rrOn = false;
  const rrFlush = () => {
    if (!rrQueue.length || dead) return;
    const chunks = rrQueue; rrQueue = []; rrBytes = 0;
    try { chrome.runtime.sendMessage({ type: 'rr', chunks, url: location.href }).catch(() => {}); } catch (_) { dead = true; }
  };
  document.addEventListener(TAG + ':rr', (e) => {
    if (!rrOn || typeof e.detail !== 'string') return;
    rrQueue.push(e.detail); rrBytes += e.detail.length;
    if (rrBytes > 4e6) rrFlush();
  });
  setInterval(rrFlush, 2500);
  window.addEventListener('pagehide', rrFlush);
  const rrCtl = () => document.dispatchEvent(new CustomEvent(TAG + ':rr-ctl', { detail: JSON.stringify({ on: rrOn }) }));
  document.addEventListener(TAG + ':rr-ready', rrCtl);
  const rrCheck = () => chrome.storage.local.get(['qa_settings', 'qa_consent']).then((st) => {
    const on = !!(st.qa_consent && st.qa_consent.v >= 2) && !(st.qa_settings && st.qa_settings.replay === false);
    if (on !== rrOn) { rrOn = on; rrCtl(); }
  }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.qa_settings || ch.qa_consent)) rrCheck(); });
  rrCheck();

  // ---------- 📸 скриншот после действия (кольцевой буфер в фоне) ----------
  let lastShot = 0;
  function actShot(label) {
    if (dead || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastShot < 700) return;
    lastShot = now;
    try { chrome.runtime.sendMessage({ type: 'act-shot', label, url: location.href }).catch(() => {}); } catch (_) {}
  }
  const loadShot = () => setTimeout(() => actShot('Страница открыта: ' + (document.title || location.pathname).slice(0, 80)), 600);
  if (document.readyState === 'complete') loadShot(); else window.addEventListener('load', loadShot, { once: true });

  const fromOverlay = (e) => e.composedPath().some((n) => n && (n.tagName === OVERLAY_TAG || n.tagName === 'QA-MOCK-PILL' || n.tagName === 'QA-REC-BAR'));

  document.addEventListener(
    'click',
    (e) => {
      if (fromOverlay(e) || !e.isTrusted) return;
      let el = e.target;
      if (!(el instanceof Element)) return;
      const target = el.closest(
        'a,button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],input,select,textarea,label,summary,[onclick],[tabindex]'
      );
      if (!target) {
        // клики по обычному тексту не пишем, если элемент не выглядит кликабельным
        let pointer = false;
        try { pointer = getComputedStyle(el).cursor === 'pointer'; } catch (_) {}
        if (!pointer) return;
      } else el = target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !['checkbox', 'radio', 'submit', 'button', 'reset', 'file'].includes(el.type)) return;
      const desc = U.stepDesc(el);
      q('action', {
        kind: 'click',
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        role: el.getAttribute('role') || '',
        text: U.text(el) || (el.tagName === 'INPUT' ? U.label(el) : ''),
        selector: U.cssPath(el),
        loc: U.locators(el),
        desc,
        forCheck: !!(el.tagName === 'LABEL' && el.control && /^(checkbox|radio)$/i.test(el.control.type)),
        href: el.href || '',
      });
      actShot('Клик: ' + desc);
    },
    true
  );

  document.addEventListener(
    'change',
    (e) => {
      if (fromOverlay(e) || !e.isTrusted) return;
      const el = e.target;
      if (!(el instanceof Element) || !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      let value;
      if (U.isSensitive(el)) value = '••••••';
      else if (el.tagName === 'SELECT') value = [...el.selectedOptions].map((o) => o.text.trim()).join(', ');
      else if (el.type === 'checkbox' || el.type === 'radio') value = el.checked ? 'включено' : 'выключено';
      else if (el.type === 'file') value = [...(el.files || [])].map((f) => f.name).join(', ');
      else value = String(el.value || '').slice(0, 200);
      const kind = el.tagName === 'SELECT' ? 'select' : el.type === 'checkbox' || el.type === 'radio' ? 'toggle' : 'input';
      q('action', {
        kind,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        label: U.label(el),
        value,
        optValue: el.tagName === 'SELECT' ? el.value : undefined,
        checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
        secret: U.isSensitive(el) || undefined,
        selector: U.cssPath(el),
        loc: U.locators(el),
        desc: U.stepDesc(el),
      });
      if (kind !== 'input') actShot((kind === 'select' ? 'Выбор: ' : 'Отметка: ') + U.stepDesc(el));
    },
    true
  );

  document.addEventListener(
    'submit',
    (e) => {
      if (!e.isTrusted) return;
      const f = e.target;
      q('action', { kind: 'submit', tag: 'form', selector: U.cssPath(f), text: f.getAttribute('name') || f.id || f.getAttribute('action') || '' });
      actShot('Отправка формы');
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || fromOverlay(e)) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        const el = e.target;
        if (el instanceof Element && (el.tagName === 'INPUT' || el.isContentEditable)) {
          q('action', { kind: 'key', key: e.key, tag: el.tagName.toLowerCase(), label: U.label(el), selector: U.cssPath(el), loc: U.locators(el), desc: U.stepDesc(el) });
          if (e.key === 'Enter') actShot('Enter в ' + U.stepDesc(el));
        }
      }
    },
    true
  );

  // ---------- 🧪 подмена ответов: правила → inject.js, плашка на странице ----------
  const host = location.hostname;
  let activeMocks = [];
  const mocksFor = (st) => (st.qa_mocks_on === false ? [] : (st.qa_mocks || []).filter((m) => m.on && (!m.host || host === m.host || host.endsWith('.' + m.host))));
  const sendMocks = () => document.dispatchEvent(new CustomEvent(TAG + ':mocks', { detail: JSON.stringify(activeMocks) }));
  // плашка подмены — на языке интерфейса
  const PILL = {
    ru: ['🧪 Подмена ответов', (n) => (n === 1 ? 'правило' : n < 5 ? 'правила' : 'правил'), 'сработала', 'Часть ответов сервера подменяется расширением QA Bug Recorder. Нажмите, чтобы открыть правила.'],
    en: ['🧪 Mocked responses', (n) => (n === 1 ? 'rule' : 'rules'), 'triggered', 'Some server responses are being mocked by the QA Bug Recorder extension. Click to open the rules.'],
    zh: ['🧪 响应模拟', () => '条规则', '已触发', '部分服务器响应正在被 QA Bug Recorder 扩展模拟。点击打开规则。'],
    es: ['🧪 Respuestas simuladas', (n) => (n === 1 ? 'regla' : 'reglas'), 'activada', 'La extensión QA Bug Recorder está simulando algunas respuestas del servidor. Haz clic para abrir las reglas.'],
    pt: ['🧪 Respostas simuladas', (n) => (n === 1 ? 'regra' : 'regras'), 'acionada', 'A extensão QA Bug Recorder está simulando algumas respostas do servidor. Clique para abrir as regras.'],
    fr: ['🧪 Réponses simulées', (n) => (n === 1 ? 'règle' : 'règles'), 'déclenchée', "L'extension QA Bug Recorder simule certaines réponses du serveur. Cliquez pour ouvrir les règles."],
    de: ['🧪 Simulierte Antworten', (n) => (n === 1 ? 'Regel' : 'Regeln'), 'ausgelöst', 'Einige Serverantworten werden von der Erweiterung QA Bug Recorder simuliert. Klicken, um die Regeln zu öffnen.'],
    kk: ['🧪 Жауаптарды алмастыру', () => 'ереже', 'іске қосылды', 'Сервердің кейбір жауаптарын QA Bug Recorder кеңейтімі алмастырып жатыр. Ережелерді ашу үшін басыңыз.'],
  };
  let PL = PILL.ru;
  const pickLang = (pref) => {
    if (pref && pref !== 'auto' && PILL[pref]) return pref;
    const ui = chrome.i18n.getUILanguage().toLowerCase();
    if (/^kk/.test(ui)) return 'kk';
    if (/^(ru|uk|be|ky|uz|tg|hy|az)/.test(ui)) return 'ru';
    return PILL[ui.slice(0, 2)] ? ui.slice(0, 2) : 'en';
  };
  const loadMocks = () => chrome.storage.local.get(['qa_mocks', 'qa_mocks_on', 'qa_lang']).then((st) => { PL = PILL[pickLang(st.qa_lang)]; activeMocks = mocksFor(st); sendMocks(); if (isTop) pill(); }).catch(() => {});
  document.addEventListener(TAG + ':mocks-req', sendMocks);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.qa_mocks || ch.qa_mocks_on || ch.qa_lang)) loadMocks(); });
  loadMocks();
  let pillEl = null, hits = 0;
  function pill() {
    if (!activeMocks.length) { if (pillEl) { pillEl.remove(); pillEl = null; } return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', pill, { once: true }); return; }
    if (!pillEl) {
      pillEl = document.createElement('qa-mock-pill');
      pillEl.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483646';
      const sh = pillEl.attachShadow({ mode: 'closed' });
      sh.innerHTML = '<style>b{font:600 12px/1 system-ui,sans-serif;background:#7c3aed;color:#fff;border-radius:999px;padding:7px 12px;box-shadow:0 6px 18px -6px rgba(0,0,0,.4);cursor:pointer;display:inline-block}</style><b></b>';

      sh.querySelector('b').onclick = () => chrome.runtime.sendMessage({ type: 'open-tools', hash: 'mocks' }).catch(() => {});
      pillEl.__b = sh.querySelector('b');
      document.documentElement.appendChild(pillEl);
    }
    const n = activeMocks.length;
    pillEl.__b.title = PL[3];
    pillEl.__b.textContent = `${PL[0]}: ${n} ${PL[1](n)}${hits ? ` · ${PL[2]} ${hits}×` : ''}`;
  }
  document.addEventListener(TAG + ':mock-hit', () => { hits++; if (isTop) pill(); });
})();
