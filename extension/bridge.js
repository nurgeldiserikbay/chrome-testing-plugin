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
      if (kind === 'console' || kind === 'net') q(kind, data);
    } catch (_) {}
  });

  if (!isTop) return; // действия пользователя пишем только в основном фрейме

  const fromOverlay = (e) => e.composedPath().some((n) => n && n.tagName === OVERLAY_TAG);

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
      q('action', {
        kind: 'click',
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: U.text(el) || (el.tagName === 'INPUT' ? U.label(el) : ''),
        selector: U.cssPath(el),
        href: el.href || '',
      });
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
      q('action', {
        kind: el.tagName === 'SELECT' ? 'select' : el.type === 'checkbox' || el.type === 'radio' ? 'toggle' : 'input',
        tag: el.tagName.toLowerCase(),
        label: U.label(el),
        value,
        selector: U.cssPath(el),
      });
    },
    true
  );

  document.addEventListener(
    'submit',
    (e) => {
      if (!e.isTrusted) return;
      const f = e.target;
      q('action', { kind: 'submit', tag: 'form', selector: U.cssPath(f), text: f.getAttribute('name') || f.id || f.getAttribute('action') || '' });
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
          q('action', { kind: 'key', key: e.key, tag: el.tagName.toLowerCase(), label: U.label(el), selector: U.cssPath(el) });
        }
      }
    },
    true
  );
})();
