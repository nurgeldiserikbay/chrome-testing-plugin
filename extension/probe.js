// MAIN world: события страницы, изменения DOM, производительность, ресурсы, WebSocket, storage, диалоги.
// Всё передаётся в bridge.js тем же каналом CustomEvent, что и inject.js.
(() => {
  if (window.__qaBugProbe) return;
  window.__qaBugProbe = true;

  const TAG = '__qa_bug_recorder__';
  const OVERLAY = 'QA-BUG-OVERLAY';
  const SENS = /pass|pwd|secret|token|auth|session|card|cvv|jwt|key/i;
  const post = (kind, data) => {
    try { document.dispatchEvent(new CustomEvent(TAG, { detail: JSON.stringify({ kind, data }) })); } catch (_) {}
  };
  const ev = (cat, kind, text, extra) => post('event', Object.assign({ ts: Date.now(), cat, kind, text, level: 'info' }, extra || {}));
  const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const ms = (v) => Math.round(v);
  const absTs = (t) => Math.round(performance.timeOrigin + t);

  // ---------- компактный CSS-селектор ----------
  function sel(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    for (let d = 0; cur && cur.nodeType === 1 && d < 4; d++) {
      const tid = cur.getAttribute('data-testid') || cur.getAttribute('data-test') || cur.getAttribute('data-qa');
      if (tid) { parts.unshift(`[data-testid="${tid}"]`); break; }
      if (cur.id && !/\d{4,}/.test(cur.id)) { parts.unshift('#' + cur.id); break; }
      let s = cur.tagName.toLowerCase();
      const cls = [...cur.classList].filter((c) => c.length < 30 && !/\d{3,}|^(css-|sc-|jsx-)/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      if (s === 'body') break;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  const label = (el) => {
    try {
      return short(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.name || el.id || el.tagName.toLowerCase(), 60);
    } catch (_) { return ''; }
  };
  const inOverlay = (n) => {
    for (let x = n; x; x = x.parentNode) if (x.nodeName === OVERLAY) return true;
    return false;
  };

  // ---------- действия на странице ----------
  let scrollT = null;
  addEventListener('scroll', (e) => {
    clearTimeout(scrollT);
    const t = e.target;
    scrollT = setTimeout(() => {
      if (t === document || t === document.documentElement || t === window) {
        const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
        ev('user', 'scroll', `Прокрутка страницы до ${ms(scrollY)} px (${Math.min(100, ms((scrollY / max) * 100))}%)`, { value: ms(scrollY) });
      } else if (t && t.nodeType === 1 && !inOverlay(t)) {
        ev('user', 'scroll', `Прокрутка блока ${sel(t)} до ${ms(t.scrollTop)} px`, { selector: sel(t) });
      }
    }, 500);
  }, { passive: true, capture: true });

  let resizeT = null;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => ev('user', 'resize', `Размер окна изменён: ${innerWidth}×${innerHeight}`), 400);
  });
  document.addEventListener('visibilitychange', () => ev('user', 'visibility', document.hidden ? 'Вкладка скрыта (переключились на другую)' : 'Вкладка снова видима'));
  addEventListener('focus', () => ev('user', 'focus', 'Окно получило фокус'));
  addEventListener('blur', () => ev('user', 'focus', 'Окно потеряло фокус'));
  addEventListener('online', () => ev('user', 'network', 'Сеть восстановлена (online)', { level: 'warn' }));
  addEventListener('offline', () => ev('user', 'network', 'Пропала сеть (offline)', { level: 'error' }));
  addEventListener('hashchange', () => ev('user', 'hash', `Смена якоря: ${location.hash}`));
  addEventListener('beforeunload', () => ev('user', 'unload', 'Уход со страницы / перезагрузка'));
  ['copy', 'cut', 'paste'].forEach((t) =>
    document.addEventListener(t, (e) => {
      if (inOverlay(e.target)) return;
      const ru = { copy: 'Копирование', cut: 'Вырезание', paste: 'Вставка' }[t];
      ev('user', t, `${ru} в ${e.target && e.target.nodeType === 1 ? '«' + label(e.target) + '»' : 'странице'}`);
    }, true)
  );
  document.addEventListener('invalid', (e) => {
    const el = e.target;
    ev('user', 'invalid', `Поле «${label(el)}» не прошло проверку: ${el.validationMessage || 'неверное значение'}`, { level: 'warn', selector: sel(el) });
  }, true);

  // ---------- alert / confirm / prompt ----------
  ['alert', 'confirm', 'prompt'].forEach((name) => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (msg) {
      const res = orig.apply(this, arguments);
      let tail = '';
      if (name === 'confirm') tail = ` → ${res ? 'OK' : 'Отмена'}`;
      if (name === 'prompt') tail = res == null ? ' → Отмена' : ' → введено значение';
      ev('user', 'dialog', `Диалог ${name}(): «${short(msg, 200)}»${tail}`, { level: 'warn' });
      return res;
    };
  });

  // ---------- localStorage / sessionStorage ----------
  let stCount = 0;
  setInterval(() => (stCount = 0), 10000);
  const SP = Storage.prototype;
  const which = (s) => { try { return s === localStorage ? 'localStorage' : 'sessionStorage'; } catch (_) { return 'storage'; } };
  const oSet = SP.setItem, oRem = SP.removeItem, oClr = SP.clear;
  SP.setItem = function (k, v) {
    if (stCount++ < 40) {
      const val = SENS.test(k) ? '•••' : short(v, 80);
      ev('storage', 'set', `${which(this)}.setItem("${k}") = ${val}`, { key: String(k) });
    }
    return oSet.apply(this, arguments);
  };
  SP.removeItem = function (k) {
    if (stCount++ < 40) ev('storage', 'remove', `${which(this)}.removeItem("${k}")`, { key: String(k) });
    return oRem.apply(this, arguments);
  };
  SP.clear = function () {
    ev('storage', 'clear', `${which(this)}.clear() — хранилище очищено`, { level: 'warn' });
    return oClr.apply(this, arguments);
  };

  // ---------- WebSocket ----------
  const WS = window.WebSocket;
  if (WS) {
    const stats = new Map();
    const oSend = WS.prototype.send;
    WS.prototype.send = function (d) {
      const s = stats.get(this);
      if (s) { s.out++; s.lastOut = typeof d === 'string' ? d : '[бинарные данные]'; }
      return oSend.apply(this, arguments);
    };
    window.WebSocket = new Proxy(WS, {
      construct(t, args) {
        const ws = Reflect.construct(t, args);
        const url = String(args[0]);
        stats.set(ws, { url, in: 0, out: 0 });
        ws.addEventListener('open', () => ev('ws', 'open', `WebSocket открыт: ${url}`));
        ws.addEventListener('error', () => ev('ws', 'error', `Ошибка WebSocket: ${url}`, { level: 'error' }));
        ws.addEventListener('close', (e) => {
          ev('ws', 'close', `WebSocket закрыт: код ${e.code}${e.reason ? ' «' + e.reason + '»' : ''}${e.wasClean ? '' : ' (обрыв соединения)'}`, { level: e.wasClean ? 'info' : 'error' });
          flushWs(ws);
          stats.delete(ws);
        });
        ws.addEventListener('message', (e) => {
          const s = stats.get(ws);
          if (s) { s.in++; s.lastIn = typeof e.data === 'string' ? e.data : '[бинарные данные]'; }
        });
        return ws;
      },
    });
    const flushWs = (ws) => {
      const s = stats.get(ws);
      if (!s || (!s.in && !s.out)) return;
      ev('ws', 'messages', `WebSocket ${s.url}: ↓ ${s.in} сообщ., ↑ ${s.out} сообщ.`, {
        detail: { lastIn: short(s.lastIn, 300), lastOut: short(s.lastOut, 300) },
      });
      s.in = s.out = 0;
    };
    setInterval(() => stats.forEach((_, ws) => flushWs(ws)), 3000);
  }

  // ---------- изменения DOM ----------
  const NOTABLE_ROLE = /^(alert|alertdialog|dialog|status)$/;
  const NOTABLE_CLASS = /toast|snack|notif|alert|error|modal|popup|dialog|tooltip|warning/i;
  let mAdd = 0, mRem = 0, mAttr = 0, mText = 0, notableCount = 0;
  let targets = new Map();
  setInterval(() => (notableCount = 0), 10000);
  function notable(el) {
    if (el.nodeType !== 1 || el.nodeName === OVERLAY || notableCount > 15) return;
    const role = el.getAttribute('role') || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!(NOTABLE_ROLE.test(role) || el.tagName === 'DIALOG' || el.hasAttribute('aria-live') || NOTABLE_CLASS.test(cls))) return;
    const text = short(el.innerText || el.textContent, 160);
    if (!text) return;
    notableCount++;
    const isErr = /error|danger|fail|alert/i.test(cls + ' ' + role) || /ошибк|не удалось|error|failed/i.test(text);
    ev('dom', 'appeared', `Появился элемент ${sel(el)}: «${text}»`, { level: isErr ? 'error' : 'info', selector: sel(el) });
  }
  // лишние перерисовки на любом сайте (без привязки к фреймворку):
  // пересоздание элемента с тем же содержимым и запись того же значения в атрибут/текст
  let recreated = new Map(), noop = new Map();
  const sigOf = (n) => n.nodeType === 1 ? `${n.tagName}|${typeof n.className === 'string' ? n.className : ''}|${(n.textContent || '').slice(0, 160)}|${n.childElementCount}` : null;
  const mo = new MutationObserver((list) => {
    // 1) что удалено в этой пачке изменений (по родителю)
    const removedSig = new Map();
    for (const m of list) {
      if (m.type !== 'childList' || !m.removedNodes.length || inOverlay(m.target)) continue;
      let mp = removedSig.get(m.target);
      for (const n of m.removedNodes) {
        const sg = sigOf(n);
        if (!sg) continue;
        if (!mp) { mp = new Map(); removedSig.set(m.target, mp); }
        mp.set(sg, (mp.get(sg) || 0) + 1);
      }
    }
    for (const m of list) {
      if (inOverlay(m.target)) continue;
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeName === OVERLAY) continue;
          mAdd++;
          if (n.nodeType === 1) {
            const mp = removedSig.get(m.target);
            if (mp) {
              const sg = sigOf(n);
              const c = mp.get(sg);
              if (c) { mp.set(sg, c - 1); recreated.set(m.target, (recreated.get(m.target) || 0) + 1); }
            }
            notable(n);
            if (n.querySelectorAll) n.querySelectorAll('[role=alert],[role=alertdialog],[role=dialog],[aria-live],dialog').forEach(notable);
          }
        }
        mRem += m.removedNodes.length;
      } else if (m.type === 'attributes') {
        mAttr++;
        if (m.oldValue === m.target.getAttribute(m.attributeName)) noop.set(m.target, (noop.get(m.target) || 0) + 1);
      } else {
        mText++;
        if (m.oldValue === m.target.data && m.target.parentElement) noop.set(m.target.parentElement, (noop.get(m.target.parentElement) || 0) + 1);
      }
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (t) targets.set(t, (targets.get(t) || 0) + 1);
    }
  });
  const startMo = () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
  if (document.documentElement) startMo();
  setInterval(() => {
    const total = mAdd + mRem + mAttr + mText;
    if (total >= 3) {
      const top = [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([el, c]) => ({ selector: sel(el), count: c }));
      const parts = [];
      if (mAdd) parts.push(`+${mAdd} узлов`);
      if (mRem) parts.push(`−${mRem} узлов`);
      if (mAttr) parts.push(`${mAttr} атрибутов`);
      if (mText) parts.push(`${mText} текстов`);
      ev('dom', 'mutations', `DOM изменился: ${parts.join(', ')}` + (top[0] ? ` · чаще всего в ${top[0].selector}` : ''), {
        value: total,
        detail: { added: mAdd, removed: mRem, attrs: mAttr, text: mText, top },
      });
    }
    const rc = [...recreated.values()].reduce((a, b) => a + b, 0);
    const nc = [...noop.values()].reduce((a, b) => a + b, 0);
    if (rc >= 2 || nc >= 5) {
      const topR = [...recreated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([el, c]) => ({ selector: sel(el), count: c }));
      const topN = [...noop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([el, c]) => ({ selector: sel(el), count: c }));
      const parts = [];
      if (rc) parts.push(`пересоздано без изменений: ${rc}${topR[0] ? ' в ' + topR[0].selector : ''}`);
      if (nc) parts.push(`пустых обновлений: ${nc}${topN[0] ? ' в ' + topN[0].selector : ''}`);
      ev('dom', 'rerender', `Лишние перерисовки: ${parts.join('; ')}`, {
        level: rc >= 10 || nc >= 30 ? 'warn' : 'info', value: rc + nc,
        detail: { recreated: topR, noop: topN, rc, nc },
      });
    }
    recreated = new Map(); noop = new Map();
    mAdd = mRem = mAttr = mText = 0;
    targets = new Map();
  }, 1000);

  // ---------- производительность ----------
  const page = location.href;
  const vital = (name, value, extra) => post('event', Object.assign({ ts: Date.now(), cat: 'perf', kind: 'vital', name, value, page, text: `${name}: ${name === 'CLS' ? value.toFixed(3) : ms(value) + ' мс'}` }, extra || {}));
  const observe = (type, cb, opts) => {
    try {
      if (PerformanceObserver.supportedEntryTypes && !PerformanceObserver.supportedEntryTypes.includes(type)) return false;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { try { cb(e); } catch (_) {} })).observe(Object.assign({ type, buffered: true }, opts || {}));
      return true;
    } catch (_) { return false; }
  };

  observe('paint', (e) => { if (e.name === 'first-contentful-paint') vital('FCP', e.startTime); });

  let lcpT = null;
  observe('largest-contentful-paint', (e) => {
    clearTimeout(lcpT);
    lcpT = setTimeout(() => vital('LCP', e.startTime, { selector: sel(e.element), detail: { url: e.url || '' } }), 1500);
  });

  let cls = 0, sessVal = 0, sessFirst = 0, sessLast = 0;
  observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (sessVal && e.startTime - sessLast < 1000 && e.startTime - sessFirst < 5000) sessVal += e.value;
    else { sessVal = e.value; sessFirst = e.startTime; }
    sessLast = e.startTime;
    if (sessVal > cls) { cls = sessVal; vital('CLS', cls); }
    if (e.value >= 0.02) {
      const src = (e.sources || []).map((s) => sel(s.node)).filter(Boolean).slice(0, 3);
      ev('perf', 'layout-shift', `Сдвиг макета ${e.value.toFixed(3)}${src.length ? ': ' + src.join(', ') : ''}`, {
        ts: absTs(e.startTime), level: e.value >= 0.1 ? 'warn' : 'info', value: +e.value.toFixed(4), selector: src[0] || '',
      });
    }
  });

  let inp = 0;
  // одно действие = несколько событий (pointerdown/up/click); серия нажатий в одном поле — одна запись
  const NAMES = { pointerdown: 'клик', pointerup: 'клик', click: 'клик', mousedown: 'клик', mouseup: 'клик', keydown: 'ввод', keyup: 'ввод', keypress: 'ввод', input: 'ввод' };
  const seenIds = new Set();
  const groups = new Map(); // what+selector -> {count, worst, first, t}
  observe('event', (e) => {
    if (!e.interactionId) return;
    if (e.duration > inp) { inp = e.duration; vital('INP', inp, { selector: sel(e.target) }); }
    if (e.duration < 200) return;
    const what = NAMES[e.name] || e.name;
    const target = sel(e.target);
    const key = what + '|' + target;
    let g = groups.get(key);
    if (!g) { g = { count: 0, worst: null, first: e.startTime, ids: new Set() }; groups.set(key, g); }
    if (!g.ids.has(e.interactionId)) { g.ids.add(e.interactionId); g.count++; }
    if (!g.worst || e.duration > g.worst.duration) g.worst = e;
    clearTimeout(g.t);
    g.t = setTimeout(() => {
      groups.delete(key);
      const w = g.worst;
      const times = g.count > 1 ? `${g.count} раз, до ${ms(w.duration)} мс` : `${ms(w.duration)} мс`;
      ev('perf', 'slow-interaction', `Медленный отклик на ${what}${target ? ' в ' + target : ''}: ${times}`, {
        ts: absTs(g.first), level: w.duration >= 500 ? 'error' : 'warn', value: ms(w.duration), selector: target,
        detail: { count: g.count, input: ms(w.processingStart - w.startTime), processing: ms(w.processingEnd - w.processingStart), presentation: ms(w.startTime + w.duration - w.processingEnd) },
      });
    }, 1500);
  }, { durationThreshold: 40 });

  const loaf = observe('long-animation-frame', (e) => {
    if (e.duration < 100) return;
    const scripts = (e.scripts || [])
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map((s) => ({ src: short(s.sourceURL || '(inline)', 140) + (s.sourceFunctionName ? ' → ' + s.sourceFunctionName : ''), invoker: short(s.invoker, 80), duration: ms(s.duration) }));
    ev('perf', 'long-frame', `Долгий кадр ${ms(e.duration)} мс (блокировка ${ms(e.blockingDuration || 0)} мс)` + (scripts[0] ? ` · ${scripts[0].src}` : ''), {
      ts: absTs(e.startTime), level: e.duration >= 250 ? 'error' : 'warn', value: ms(e.duration), detail: { scripts },
    });
  });
  if (!loaf) {
    observe('longtask', (e) => {
      if (e.duration < 100) return;
      ev('perf', 'long-frame', `Долгая задача ${ms(e.duration)} мс`, { ts: absTs(e.startTime), level: e.duration >= 250 ? 'error' : 'warn', value: ms(e.duration) });
    });
  }

  let navDone = false;
  observe('navigation', (e) => {
    const done = () => {
      if (navDone) return;
      navDone = true;
      vital('TTFB', e.responseStart);
      ev('perf', 'navigation',
        `Загрузка страницы: ответ сервера ${ms(e.responseStart)} мс, DOMContentLoaded ${ms(e.domContentLoadedEventEnd)} мс, load ${ms(e.loadEventEnd)} мс`,
        { ts: absTs(0), detail: { ttfb: ms(e.responseStart), dcl: ms(e.domContentLoadedEventEnd), load: ms(e.loadEventEnd), type: e.type, transferSize: e.transferSize } });
    };
    if (e.loadEventEnd > 0) done();
    else addEventListener('load', () => setTimeout(() => { const n = performance.getEntriesByType('navigation')[0]; if (n) { e = n; done(); } }, 0), { once: true });
  });

  // все загруженные ресурсы (картинки, скрипты, стили, шрифты) — fetch/XHR уже пишет inject.js
  const RT = { img: 'Image', script: 'Script', link: 'Stylesheet', css: 'Stylesheet', font: 'Font', iframe: 'Document', video: 'Media', audio: 'Media', other: 'Other' };
  observe('resource', (e) => {
    if (['fetch', 'xmlhttprequest', 'beacon'].includes(e.initiatorType)) return;
    if (/^(data|blob|chrome-extension):/.test(e.name)) return;
    post('res', {
      ts: absTs(e.startTime), method: 'GET', url: e.name, type: RT[e.initiatorType] || e.initiatorType || 'Other',
      status: e.responseStatus || undefined, duration: ms(e.duration),
      size: e.transferSize || e.encodedBodySize || undefined,
      fromCache: e.transferSize === 0 && e.decodedBodySize > 0, source: 'perf',
    });
  });

  // ---------- FPS, память, число DOM-узлов ----------
  let frames = 0, lastLowFps = 0;
  let fpsMin = Infinity;
  const loop = () => { frames++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  setInterval(() => {
    const fps = frames;
    frames = 0;
    if (document.hidden) return;
    fpsMin = Math.min(fpsMin, fps);
    if (fps < 20 && Date.now() - lastLowFps > 3000) {
      lastLowFps = Date.now();
      ev('perf', 'fps', `Просадка FPS: ${fps} кадров/с — страница подтормаживает`, { level: fps < 10 ? 'error' : 'warn', value: fps });
    }
  }, 1000);
  setInterval(() => {
    if (document.hidden) return;
    const m = performance.memory;
    post('sample', {
      ts: Date.now(),
      heap: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null,
      nodes: document.getElementsByTagName('*').length,
      fps: fpsMin === Infinity ? null : fpsMin,
    });
    fpsMin = Infinity;
  }, 5000);
})();
