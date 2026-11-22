// Перевод интерфейса. Исходные строки расширения — русские; при английском языке
// они заменяются по словарю (i18n/<язык>.js) на лету: в DOM страниц расширения, в панели
// на сайте (shadow DOM) и в выгрузках через T(). Тексты пользователя и сайта не трогаются:
// фраза переводится, только если целиком есть в словаре.
(function (g) {
  if (g.QAI18N) return;
  const LANGS = { ru: 'Русский', en: 'English', zh: '中文（简体）', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', kk: 'Қазақша' };
  const LOCALE = { ru: 'ru-RU', en: 'en-GB', zh: 'zh-CN', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', kk: 'kk-KZ' };
  const AI_LANG = { en: 'English', zh: 'Simplified Chinese', es: 'Spanish', pt: 'Portuguese (Brazil)', fr: 'French', de: 'German', kk: 'Kazakh' };
  const isExtPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  let D = {}, DL = {};
  let lang = 'ru';
  const setDict = (d) => { D = d || {}; DL = {}; for (const k of Object.keys(D)) DL[k.toLowerCase()] = D[k]; };
  const RUN = /[А-Яа-яЁё][А-Яа-яЁё\s ,.:;!?«»()\-–—/%№’]*/g;
  const SEP = /(\s*[:—·«»\n]\s*|\.\s+|\s+–\s+|\(\s*|\s*\)|;\s*|!\s+|\?\s+)/;
  const EDGE = /^[\s ,.:;!?«»()\-–—/%№’]+|[\s ,.:;!?«»()\-–—/%№’]+$/g;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function trPiece(p) {
    const core = p.replace(EDGE, '');
    if (!core) return p;
    let t = D[core];
    if (t == null) {
      const l = DL[core.toLowerCase()];
      if (l != null) t = /^[А-ЯЁ]/.test(core) ? cap(l) : l;
    }
    if (t == null) return p;
    const i = p.indexOf(core);
    return p.slice(0, i) + t + p.slice(i + core.length);
  }
  const SING = { steps: 'step', items: 'item', requests: 'request', pages: 'page', cases: 'case', errors: 'error', rules: 'rule', seconds: 'second', minutes: 'minute', checks: 'check', times: 'time', elements: 'element', domains: 'domain', scenarios: 'scenario', endpoints: 'endpoint', remarks: 'remark', records: 'record', actions: 'action', problems: 'problem', issues: 'issue', nodes: 'node', mismatches: 'mismatch', images: 'image', updates: 'update' };
  // порядок слов в английском отличается — частые сочетания правим после перевода
  const FIX = [
    [/\bError JavaScript\b/g, 'JavaScript error'], [/\berror JavaScript\b/g, 'JavaScript error'],
    [/\bre-renders React\b/g, 'React re-renders'], [/\bRe-renders React\b/g, 'React re-renders'],
    [/\bResponse mocking API\b/g, 'API response mocking'], [/\bMocking API\b/g, 'API mocking'],
    [/\bAPI-tests\b/g, 'API tests'], [/\btests by Swagger\b/g, 'tests from Swagger'],
    [/\bCORS-errors\b/g, 'CORS errors'], [/ — is a failure\b/g, ' count as failures'],
    [/\bAutotests from recording\b/g, 'Autotests from recordings'], [/\bor a collection Postman\b/g, 'or a Postman collection'], [/\ba collection Postman\b/g, 'a Postman collection'],
  ];
  function T(s) {
    if (lang === 'ru' || typeof s !== 'string' || !/[А-Яа-яЁё]/.test(s)) return s;
    let out = s.replace(RUN, (run) => run.split(SEP).map((part, i) => (i % 2 ? part : trPiece(part))).join(''));
    if (lang !== 'en') return out;
    for (const [re, to] of FIX) out = out.replace(re, to);
    out = out.replace(/(^|[^\d.,])1 (steps|items|requests|pages|cases|errors|rules|seconds|minutes|checks|times|elements|domains|scenarios|endpoints|remarks|records|actions|problems|issues|nodes|mismatches|images|updates)\b/g, (m, a, w) => `${a}1 ${SING[w]}`);
    return out;
  }

  // ---------- DOM ----------
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-tip'];
  const SKIP = 'script,style,textarea,pre,code,[data-no-i18n],[contenteditable=""],[contenteditable=true]';
  const seen = new WeakMap();
  function trText(n) {
    const v = n.nodeValue;
    if (!v || seen.get(n) === v || !/[А-Яа-яЁё]/.test(v)) return;
    const p = n.parentElement;
    if (p && p.closest(SKIP)) return;
    const t = T(v);
    seen.set(n, t);
    if (t !== v) n.nodeValue = t;
  }
  function trAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && /[А-Яа-яЁё]/.test(v)) { const t = T(v); if (t !== v) el.setAttribute(a, t); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && /[А-Яа-яЁё]/.test(el.value)) el.value = T(el.value);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType === 1) { if (root.closest && root.closest(SKIP) && root.tagName !== 'TEXTAREA') return; trAttrs(root); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) n.nodeType === 3 ? trText(n) : trAttrs(n);
  }
  const watched = new WeakSet();
  function watch(root) {
    if (lang === 'ru' || !root || watched.has(root)) return;
    watched.add(root);
    walk(root);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') trAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---------- язык ----------
  const fromUi = (ui) => {
    ui = String(ui || '').toLowerCase();
    if (/^kk/.test(ui)) return 'kk';
    if (/^(ru|uk|be|ky|uz|tg|hy|az)/.test(ui)) return 'ru';
    const two = ui.slice(0, 2);
    return LANGS[two] ? two : 'en';
  };
  const autoLang = () => { try { return fromUi(chrome.i18n.getUILanguage()); } catch (_) { return fromUi(navigator.language); } };
  const loadDict = (l) => new Promise((res) => {
    const have = g.QA_I18N_DICTS && g.QA_I18N_DICTS[l];
    if (have || !isExtPage) return res(have || null);
    const sc = document.createElement('script');
    sc.src = chrome.runtime.getURL(`i18n/${l}.js`);
    sc.onload = () => res((g.QA_I18N_DICTS || {})[l] || null);
    sc.onerror = () => res(null);
    (document.head || document.documentElement).appendChild(sc);
  });
  if (isExtPage && document.documentElement) document.documentElement.style.visibility = 'hidden';
  const ready = (async () => {
    let pref = 'auto';
    try { pref = (await chrome.storage.local.get('qa_lang')).qa_lang || 'auto'; } catch (_) {}
    lang = pref === 'auto' ? autoLang() : LANGS[pref] ? pref : 'ru';
    if (lang !== 'ru') {
      const d = await loadDict(lang);
      if (!d) lang = 'ru';
      else setDict(d);
    }
    if (lang !== 'ru') {
      // alert/confirm/prompt наших скриптов
      for (const f of ['alert', 'confirm', 'prompt']) {
        const o = g[f];
        if (typeof o === 'function') g[f] = function (msg, ...rest) { return o.call(this, T(String(msg == null ? '' : msg)), ...rest); };
      }
    }
    if (isExtPage) {
      const go = () => {
        if (lang !== 'ru') { document.documentElement.lang = lang; document.title = T(document.title); watch(document.documentElement); }
        document.documentElement.style.visibility = '';
      };
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go, { once: true }) : go();
    }
    return lang;
  })();

  g.QAI18N = {
    T, watch, ready,
    get lang() { return lang; },
    locale: () => LOCALE[lang] || 'ru-RU',
    LANGS, AI_LANG, fromUi,
    aiLang: () => AI_LANG[lang] || '',
    setLang: (l) => chrome.storage.local.set({ qa_lang: l }),
  };
})(globalThis);
