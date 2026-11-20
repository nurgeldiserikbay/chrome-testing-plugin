// Выполняется в контексте страницы (MAIN world): перехватывает console, ошибки JS, fetch и XHR.
// Данные передаются в bridge.js через CustomEvent.
(() => {
  if (window.__qaBugHook) return;
  window.__qaBugHook = true;

  const TAG = '__qa_bug_recorder__';
  const MAX_BODY = 20000;
  let busy = false;

  const post = (kind, data) => {
    if (busy) return;
    busy = true;
    try {
      document.dispatchEvent(new CustomEvent(TAG, { detail: JSON.stringify({ kind, data }) }));
    } catch (_) {
      /* ignore */
    } finally {
      busy = false;
    }
  };

  const tr = (s, n = MAX_BODY) =>
    s == null ? s : s.length > n ? s.slice(0, n) + `\n… [обрезано, всего ${s.length} символов]` : s;

  let seq = 0;
  const rid = () => 'h' + Date.now().toString(36) + (seq++).toString(36);

  const abs = (u) => {
    try { return new URL(String(u), location.href).href; } catch (_) { return String(u); }
  };

  // ---------- сериализация значений console ----------
  function ser(v, d = 0, seen = new WeakSet()) {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return d ? JSON.stringify(v.length > 300 ? v.slice(0, 300) + '…' : v) : v;
    if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'undefined') return String(v);
    if (t === 'symbol') return v.toString();
    if (t === 'function') return `ƒ ${v.name || 'anonymous'}()`;
    try {
      if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
      if (typeof Element !== 'undefined' && v instanceof Element) {
        let s = '<' + v.tagName.toLowerCase();
        if (v.id) s += '#' + v.id;
        if (typeof v.className === 'string' && v.className.trim()) s += '.' + v.className.trim().split(/\s+/).join('.');
        return s + '>';
      }
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      if (d > 3) return Array.isArray(v) ? '[…]' : '{…}';
      if (Array.isArray(v)) {
        return '[' + v.slice(0, 50).map((x) => ser(x, d + 1, seen)).join(', ') + (v.length > 50 ? ', …' : '') + ']';
      }
      if (v instanceof Map) return `Map(${v.size})`;
      if (v instanceof Set) return `Set(${v.size})`;
      const keys = Object.keys(v);
      const name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + ' ' : '';
      return (
        name + '{' + keys.slice(0, 40).map((k) => k + ': ' + ser(v[k], d + 1, seen)).join(', ') + (keys.length > 40 ? ', …' : '') + '}'
      );
    } catch (_) {
      return '[object]';
    }
  }

  const callerLoc = () => {
    const st = (new Error().stack || '').split('\n');
    // 0: Error, 1: callerLoc, 2: обёртка console, 3: реальный вызов
    const line = st[3] || '';
    const m = line.match(/\(?((?:https?|file|chrome-extension|webpack):\/\/[^\s)]+)\)?\s*$/);
    return m ? m[1] : '';
  };

  // ---------- console ----------
  const LEVELS = { log: 'log', info: 'info', warn: 'warn', error: 'error', debug: 'debug', trace: 'debug' };
  for (const [method, level] of Object.entries(LEVELS)) {
    const orig = console[method];
    if (typeof orig !== 'function') continue;
    console[method] = function (...args) {
      try {
        const text = args.map((a) => ser(a)).join(' ');
        post('console', {
          ts: Date.now(),
          level,
          source: 'console',
          text: tr(text, 5000),
          loc: level === 'error' || level === 'warn' ? callerLoc() : '',
        });
      } catch (_) {}
      return orig.apply(this, args);
    };
  }
  const origAssert = console.assert;
  console.assert = function (cond, ...args) {
    if (!cond) {
      try {
        post('console', { ts: Date.now(), level: 'error', source: 'assert', text: 'Assertion failed: ' + args.map((a) => ser(a)).join(' ') });
      } catch (_) {}
    }
    return origAssert.apply(this, [cond, ...args]);
  };

  // ---------- ошибки JS и ресурсов ----------
  window.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t !== window && t.tagName) {
        const url = t.src || t.href || t.currentSrc || '';
        post('console', { ts: Date.now(), level: 'error', source: 'resource', text: `Не загрузился ресурс <${t.tagName.toLowerCase()}>: ${url}`, loc: url });
        return;
      }
      const loc = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '';
      post('console', {
        ts: Date.now(),
        level: 'error',
        source: 'exception',
        text: tr((e.error && e.error.stack) || e.message || 'Script error', 5000),
        loc,
      });
    },
    true
  );
  window.addEventListener('unhandledrejection', (e) => {
    post('console', {
      ts: Date.now(),
      level: 'error',
      source: 'promise',
      text: tr('Unhandled promise rejection: ' + ser(e.reason), 5000),
    });
  });

  // ---------- вспомогательное для сети ----------
  const hdrObj = (h) => {
    const o = {};
    try {
      if (!h) return o;
      if (typeof h.forEach === 'function' && !(Array.isArray(h))) h.forEach((v, k) => (o[k] = v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => (o[k] = v));
      else Object.assign(o, h);
    } catch (_) {}
    return o;
  };
  const parseHdrs = (raw) => {
    const o = {};
    (raw || '').trim().split(/[\r\n]+/).forEach((l) => {
      const i = l.indexOf(':');
      if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return o;
  };
  const bodyStr = (b) => {
    try {
      if (b == null) return undefined;
      if (typeof b === 'string') return tr(b);
      if (b instanceof URLSearchParams) return tr(b.toString());
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        const parts = [];
        b.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : `[файл ${v.name}, ${v.size} байт]`}`));
        return tr('FormData: ' + parts.join('&'));
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) return `[Blob ${b.type || ''} ${b.size} байт]`;
      if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return `[бинарные данные ${b.byteLength} байт]`;
      return tr(String(b));
    } catch (_) {
      return undefined;
    }
  };
  const textual = (ct) => /json|text|xml|javascript|html|x-www-form-urlencoded|graphql/i.test(ct || '') && !/event-stream/i.test(ct || '');

  // ---------- 🧪 подмена ответов ----------
  // Правила приходят из bridge.js (хранятся в настройках расширения).
  let MOCKS = [];
  // правила приходят асинхронно; самые ранние запросы страницы ждут их (обычно несколько миллисекунд)
  let mocksLoaded = false, mocksResolve;
  const mocksReady = new Promise((r) => (mocksResolve = r));
  setTimeout(() => { mocksLoaded = true; mocksResolve(); }, 300);
  document.addEventListener(TAG + ':mocks', (ev) => { try { MOCKS = JSON.parse(ev.detail) || []; } catch (_) {} mocksLoaded = true; mocksResolve(); });
  document.dispatchEvent(new CustomEvent(TAG + ':mocks-req'));
  const globRe = (p) => new RegExp(p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
  const findMock = (method, url) => {
    if (!MOCKS.length) return null;
    return MOCKS.find((m) => {
      if (m.method && m.method !== 'ANY' && m.method !== method) return false;
      const p = String(m.match || '').trim();
      if (!p) return false;
      return p.includes('*') ? globRe(p).test(url) : url.includes(p);
    }) || null;
  };
  const mockLabel = (m) => m.action === 'network' ? 'подмена: нет сети' : m.action === 'delay' ? `подмена: задержка ${m.delay} мс` : `подмена: ${m.status}`;
  const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, +ms || 0)));
  const NULL_BODY = [101, 204, 205, 304];
  const fireMock = (m, url) => document.dispatchEvent(new CustomEvent(TAG + ':mock-hit', { detail: JSON.stringify({ id: m.id, url }) }));

  // ---------- fetch ----------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function qaFetch(input, init) {
      if (!mocksLoaded) { const self0 = this, args0 = arguments; return mocksReady.then(() => qaFetch.apply(self0, args0)); }
      const ts = Date.now();
      const t0 = performance.now();
      let method = 'GET';
      let url = '';
      let reqHeaders = {};
      let postData;
      try {
        const isReq = typeof Request !== 'undefined' && input instanceof Request;
        method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
        url = abs(isReq ? input.url : input);
        reqHeaders = hdrObj((init && init.headers) || (isReq ? input.headers : null));
        postData = bodyStr(init && init.body);
      } catch (_) {}
      const id = rid();
      const self = this, args = arguments;
      const mk = findMock(method, url);
      if (mk) {
        fireMock(mk, url);
        if (mk.action === 'network') {
          return wait(mk.delay).then(() => {
            post('net', { id, ts, method, url, reqHeaders, postData, type: 'Fetch', failed: true, error: 'Сетевая ошибка (подмена)', mocked: mockLabel(mk), duration: Math.round(performance.now() - t0), source: 'hook' });
            throw new TypeError('Failed to fetch');
          });
        }
        if (mk.action !== 'delay') {
          return wait(mk.delay).then(() => {
            const st = +mk.status || 200;
            const body = NULL_BODY.includes(st) ? null : String(mk.body == null ? '' : mk.body);
            const res = new Response(body, { status: st, statusText: mk.statusText || '', headers: { 'content-type': mk.contentType || 'application/json; charset=utf-8' } });
            post('net', { id, ts, method, url, reqHeaders, postData, type: 'Fetch', status: st, statusText: mk.statusText || '', resHeaders: { 'content-type': mk.contentType || 'application/json' }, mime: mk.contentType || 'application/json', body: body == null ? undefined : tr(body), size: body ? body.length : 0, mocked: mockLabel(mk), duration: Math.round(performance.now() - t0), source: 'hook' });
            return res;
          });
        }
      }
      const real = () => origFetch.apply(self, args).then(
        (res) => {
          try {
            const ct = res.headers.get('content-type') || '';
            const e = {
              id, ts, method, url, reqHeaders, postData, type: 'Fetch',
              status: res.status, statusText: res.statusText,
              resHeaders: hdrObj(res.headers), mime: ct,
              duration: Math.round(performance.now() - t0), source: 'hook',
            };
            if (mk) e.mocked = mockLabel(mk);
            if (textual(ct) && res.type !== 'opaque') {
              const timeout = new Promise((r) => setTimeout(() => r(null), 4000));
              Promise.race([res.clone().text(), timeout])
                .then((t) => {
                  if (t != null) { e.body = tr(t); e.size = t.length; }
                  post('net', e);
                })
                .catch(() => post('net', e));
            } else {
              const len = res.headers.get('content-length');
              if (len) e.size = +len;
              post('net', e);
            }
          } catch (_) {}
          return res;
        },
        (err) => {
          post('net', {
            id, ts, method, url, reqHeaders, postData, type: 'Fetch', failed: true,
            error: String((err && err.message) || err), canceled: err && err.name === 'AbortError',
            duration: Math.round(performance.now() - t0), source: 'hook',
          });
          throw err;
        }
      );
      return mk && mk.action === 'delay' ? wait(mk.delay).then(real) : real();
    };
  }

  // ---------- XMLHttpRequest ----------
  const XP = XMLHttpRequest.prototype;
  const oOpen = XP.open, oSend = XP.send, oSet = XP.setRequestHeader;
  XP.open = function (m, u, async) {
    try { this.__qa = { method: String(m).toUpperCase(), url: abs(u), reqHeaders: {}, sync: async === false }; } catch (_) {}
    return oOpen.apply(this, arguments);
  };
  XP.setRequestHeader = function (k, v) {
    try { if (this.__qa) this.__qa.reqHeaders[k] = v; } catch (_) {}
    return oSet.apply(this, arguments);
  };
  XP.send = function qaSend(body) {
    const q = this.__qa;
    const x = this;
    if (!mocksLoaded && q && !q.sync) { mocksReady.then(() => qaSend.call(x, body)); return; }
    const mk = q && findMock(q.method, q.url);
    if (mk) { q.mocked = mockLabel(mk); fireMock(mk, q.url); }
    if (q) {
      q.ts = Date.now();
      q.t0 = performance.now();
      q.postData = bodyStr(body);
      let aborted = false;
      this.addEventListener('abort', () => (aborted = true));
      this.addEventListener('loadend', () => {
        try {
          const e = {
            id: rid(), ts: q.ts, method: q.method, url: q.url, reqHeaders: q.reqHeaders, postData: q.postData,
            type: 'XHR', duration: Math.round(performance.now() - q.t0), status: this.status, statusText: this.statusText,
            resHeaders: parseHdrs(this.getAllResponseHeaders()), mime: this.getResponseHeader('content-type') || '', source: 'hook',
          };
          if (q.mocked) e.mocked = q.mocked;
          if (this.status === 0) {
            e.failed = true;
            e.canceled = aborted;
            e.error = aborted ? 'Запрос отменён' : 'Сетевая ошибка (нет ответа, CORS или блокировка)';
          }
          try {
            if (this.responseType === '' || this.responseType === 'text') {
              e.body = tr(this.responseText);
              e.size = (this.responseText || '').length;
            } else if (this.responseType === 'json') {
              const t = JSON.stringify(this.response);
              e.body = tr(t);
              e.size = t ? t.length : 0;
            }
          } catch (_) {}
          post('net', e);
        } catch (_) {}
      });
    }
    if (mk) {
      if (mk.action === 'delay') { setTimeout(() => oSend.call(x, body), Math.max(0, +mk.delay || 0)); return; }
      const fake = (props) => Object.keys(props).forEach((k) => Object.defineProperty(x, k, { configurable: true, get: () => props[k] }));
      const fire = (type) => { try { x.dispatchEvent(type === 'readystatechange' ? new Event(type) : new ProgressEvent(type)); } catch (_) {} };
      setTimeout(() => {
        if (mk.action === 'network') {
          fake({ readyState: 4, status: 0, statusText: '', responseText: '', response: '' });
          fire('readystatechange'); fire('error'); fire('loadend');
          return;
        }
        const st = +mk.status || 200;
        const text = NULL_BODY.includes(st) ? '' : String(mk.body == null ? '' : mk.body);
        let response = text;
        if (x.responseType === 'json') { try { response = JSON.parse(text); } catch (_) { response = null; } }
        const ct = mk.contentType || 'application/json; charset=utf-8';
        fake({ readyState: 4, status: st, statusText: mk.statusText || '', responseText: text, response, responseURL: q ? q.url : '' });
        x.getResponseHeader = (h) => (/^content-type$/i.test(h) ? ct : null);
        x.getAllResponseHeaders = () => `content-type: ${ct}\r\n`;
        fire('readystatechange'); fire('load'); fire('loadend');
      }, Math.max(0, +mk.delay || 0));
      return;
    }
    return oSend.apply(this, arguments);
  };
})();
