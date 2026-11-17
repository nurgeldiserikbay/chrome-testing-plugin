// Панель «Нашёл баг» поверх страницы: выбор элемента, стрелка, область, заметка, голос, видео.
(() => {
  if (globalThis.__qaOverlay) { globalThis.__qaOverlay.ping(); return; }
  const U = globalThis.__qaUtil;
  const RED = '#ff2d55';
  const BLUE = '#2563eb';

  const host = document.createElement('qa-bug-overlay');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
<style>
  *{box-sizing:border-box}
  .cv{position:fixed;inset:0;pointer-events:none}
  .cv.on{pointer-events:auto;cursor:crosshair}
  .cv.pick{cursor:pointer}
  .bar{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:2px;padding:5px;background:#111827;color:#f9fafb;border-radius:12px;
       box-shadow:0 10px 30px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.06);font:500 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:auto;user-select:none}
  .bar button{appearance:none;border:0;background:transparent;font:inherit;cursor:pointer;padding:8px 9px;border-radius:8px;color:#e5e7eb;white-space:nowrap;display:flex;align-items:center;gap:5px}
  .bar button:hover{background:#374151}
  .bar button.act{background:${BLUE};color:#fff}
  .bar button.rec{background:${RED};color:#fff;animation:pl 1.4s infinite}
  .bar .done{background:#059669;color:#fff;font-weight:600}
  .bar .done:hover{background:#047857}
  .bar .x{color:#9ca3af}
  .bar .x.warn{background:#7f1d1d;color:#fff}
  .sep{width:1px;height:22px;background:#374151;margin:0 3px}
  .grip{cursor:move;padding:0 5px;color:#6b7280;font-size:14px;letter-spacing:-3px}
  .title{display:flex;align-items:center;gap:6px;padding:0 8px 0 2px;font-weight:600;font-variant-numeric:tabular-nums}
  .title i{font-style:normal;font-size:14px}
  .vrec{display:none;color:#fff;background:${RED};border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700;animation:pl 1.4s infinite}
  .vrec.on{display:inline-block}
  .cnt{min-width:20px;text-align:center;background:#374151;border-radius:10px;padding:3px 7px;font-size:12px;margin:0 2px}
  @keyframes pl{50%{background:#be123c}}
  .hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:9px 16px;border-radius:10px;
        font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:80vw;text-align:center}
  .toast{position:fixed;bottom:76px;right:16px;max-width:380px;background:#111827;color:#fff;padding:11px 14px;border-radius:10px;
         font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:auto;border-left:4px solid ${BLUE}}
  .toast.error{border-left-color:${RED}} .toast.warn{border-left-color:#f59e0b} .toast.ok{border-left-color:#10b981}
  .note{position:fixed;width:340px;background:#fff;color:#111827;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);padding:12px;
        pointer-events:auto;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-top:4px solid ${RED}}
  .nt{font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px}
  .nt small{font-weight:400;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;font-family:ui-monospace,Consolas,monospace;font-size:11px;padding-top:2px}
  textarea{display:block;width:100%;min-height:84px;max-height:220px;resize:vertical;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;
           font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;background:#fff;outline:none;margin:0}
  textarea:focus{border-color:${BLUE};box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .row{display:flex;gap:8px;align-items:center;margin-top:10px}
  .row button{appearance:none;border:0;font:600 13px system-ui,sans-serif;padding:8px 14px;border-radius:8px;cursor:pointer}
  .save{background:${RED};color:#fff} .save:hover{background:#e11d48}
  .cancel{background:#f3f4f6;color:#374151} .cancel:hover{background:#e5e7eb}
  .k{margin-left:auto;color:#9ca3af;font-size:11px}
  .vo{font-size:12px;color:#b91c1c;margin-top:6px}
  [hidden]{display:none!important}
</style>
<canvas class="cv"></canvas>
<div class="hint" hidden></div>
<div class="toast" hidden></div>
<div class="note" hidden>
  <div class="nt"><span>Пометка #<span class="nn">1</span></span><small class="sel"></small></div>
  <textarea placeholder="Что здесь не так? Опишите проблему…"></textarea>
  <div class="vo" hidden>🎤 Идёт запись голоса — можно просто рассказать</div>
  <div class="row"><button class="save">Сохранить</button><button class="cancel">Отмена</button><span class="k">Ctrl+Enter · Esc</span></div>
</div>
<div class="bar">
  <span class="grip" title="Перетащить панель">⋮⋮</span>
  <span class="title" title="Фиксация бага: пометки, логи и запросы. Видео пишется, только если нажать «Записать видео»"><i>🐞</i>Баг <b class="t">00:00</b><span class="vrec">● REC</span></span>
  <span class="sep"></span>
  <button data-tool="element" title="Выбрать элемент с багом (Alt+Shift+E)">🎯 Элемент</button>
  <button data-tool="arrow" title="Нарисовать стрелку (Alt+Shift+A)">➚ Стрелка</button>
  <button data-tool="rect" title="Выделить область">▭ Область</button>
  <button data-tool="note" title="Комментарий со скриншотом без выделения">💬 Заметка</button>
  <span class="sep"></span>
  <button data-act="voice" title="Голосовой комментарий с микрофона">🎤 <span class="vt">Голос</span></button>
  <button data-act="video" title="Начать или остановить запись видео вкладки"><span class="vdt">⏺ Записать видео</span></button>
  <span class="sep"></span>
  <button data-act="marks" class="eye" title="Скрыть или показать пометки на странице">👁</button>
  <span class="cnt" title="Сделано пометок">0</span>
  <button class="done" data-act="finish" title="Завершить и открыть отчёт (Alt+Shift+S)">✓ Готово</button>
  <button class="x" data-act="cancel" title="Отменить и удалить этот баг">✕</button>
</div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const cv = $('.cv'), ctx = cv.getContext('2d'), bar = $('.bar'), note = $('.note'), ta = $('textarea'), hint = $('.hint'), toastEl = $('.toast');

  let state = { startTime: Date.now(), annotations: 0 };
  let dpr = 1, mode = null, drawing = null, hover = null, pending = null, shapes = [], busy = false;
  let toastTimer = null, cancelArmed = null, marksHidden = false;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message }));
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // ---------- canvas ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';
    redraw();
  }

  function arrowPath(x1, y1, x2, y2, w, color) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(16, w * 4.5);
    const bx = x2 - Math.cos(a) * head * 0.8, by = y2 - Math.sin(a) * head * 0.8;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.42), y2 - head * Math.sin(a - 0.42));
    ctx.lineTo(x2 - head * Math.cos(a + 0.42), y2 - head * Math.sin(a + 0.42));
    ctx.closePath(); ctx.fill();
  }

  function wrap(text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      }
      out.push(line);
    }
    if (out.length > 7) { out.length = 7; out[6] += ' …'; }
    return out;
  }

  function badge(x, y, n, color) {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function label(s) {
    const text = s.label;
    if (!text) return;
    ctx.font = '600 14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    const lines = wrap(text, 280);
    const lh = 19, pad = 9;
    const w = Math.min(300, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = lines.length * lh + pad * 2 - 4;
    let x, y;
    if (s.kind === 'arrow') {
      x = s.x2 > s.x1 ? s.x1 - w - 10 : s.x1 + 10;
      y = s.y1 - h / 2;
    } else if (s.kind === 'note') {
      x = s.ax + 24; y = s.ay + 24;
    } else {
      const r = norm(s);
      x = r.x; y = r.y + r.h + 10;
      if (y + h > scrollY + innerHeight - 8) y = r.y - h - 10;
    }
    // подпись не уходит за края видимой области
    x = Math.max(scrollX + 8, Math.min(scrollX + innerWidth - w - 8, x));
    y = Math.max(8, y);
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = RED;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + 13 + i * lh));
  }

  const norm = (s) => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) });

  function drawShape(s, color = RED) {
    ctx.save();
    ctx.globalAlpha = s.alpha == null ? 1 : s.alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.kind === 'arrow') {
      arrowPath(s.x1, s.y1, s.x2, s.y2, 9, '#fff');
      arrowPath(s.x1, s.y1, s.x2, s.y2, 4.5, color);
      if (s.n) badge(s.x1, s.y1, s.n, color);
    } else if (s.kind === 'rect' || s.kind === 'element') {
      const r = norm(s);
      ctx.fillStyle = color === BLUE ? 'rgba(37,99,235,.12)' : 'rgba(255,45,85,.10)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = color; ctx.lineWidth = 3.5;
      if (s.kind === 'element' && color === BLUE) ctx.setLineDash([7, 5]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      if (s.n) badge(r.x, r.y, s.n, color);
    } else if (s.kind === 'note' && s.n) {
      badge(s.ax + 18, s.ay + 18, s.n, color);
    }
    label(s);
    ctx.restore();
  }

  function drawHoverTip(s) {
    const r = norm(s);
    const t = `${s.info.tag}  ${Math.round(r.w)}×${Math.round(r.h)}  ${s.info.selector}`;
    ctx.font = '12px ui-monospace,Consolas,monospace';
    const txt = t.length > 90 ? t.slice(0, 90) + '…' : t;
    const w = ctx.measureText(txt).width + 14;
    let x = Math.max(scrollX + 4, Math.min(scrollX + innerWidth - w - 4, r.x));
    let y = r.y - 28;
    if (y < scrollY + 4) y = r.y + r.h + 6;
    if (y > scrollY + innerHeight - 26) y = scrollY + innerHeight - 30;
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.roundRect(x, y, w, 22, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x + 7, y + 15);
  }

  // пометки хранятся в координатах страницы, а не окна: при прокрутке они едут вместе с контентом
  function syncEl(s) {
    if (!s.el || !s.el.isConnected) return;
    const r = s.el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    s.x1 = r.left + scrollX; s.y1 = r.top + scrollY; s.x2 = r.right + scrollX; s.y2 = r.bottom + scrollY;
  }
  function redraw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.translate(-scrollX, -scrollY);
    [...shapes, hover, pending].forEach((s) => s && syncEl(s));
    if (!marksHidden) for (const s of shapes) drawShape(s);
    if (hover && !pending) { drawShape(hover, BLUE); drawHoverTip(hover); }
    if (drawing) drawShape(drawing);
    if (pending) drawShape(pending);
  }

  // ---------- режимы ----------
  const HINTS = {
    element: 'Наведите на элемент с багом и кликните · колесо мыши прокручивает страницу · Esc — отмена',
    arrow: 'Тяните мышью от свободного места к проблеме — стрелка укажет туда, где отпустите · Esc — отмена',
    rect: 'Выделите мышью область с проблемой · Esc — отмена',
  };
  function setMode(m) {
    if (busy) return;
    if (pending) cancelNote();
    if (m === 'note') { exitMode(); openNote({ kind: 'note' }); return; }
    if (mode === m) { exitMode(); return; }
    mode = m;
    cv.classList.add('on');
    cv.classList.toggle('pick', m === 'element');
    hint.textContent = HINTS[m];
    hint.hidden = false;
    root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('act', b.dataset.tool === m));
  }
  function exitMode() {
    mode = null; drawing = null; hover = null;
    cv.classList.remove('on', 'pick');
    hint.hidden = true;
    root.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('act'));
    redraw();
  }

  const elementAt = (x, y) => {
    cv.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    cv.style.pointerEvents = '';
    return el && el !== host && el !== document.documentElement ? el : null;
  };

  cv.addEventListener('pointerdown', (e) => {
    if (!mode || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (mode === 'element') return;
    cv.setPointerCapture(e.pointerId);
    drawing = { kind: mode, x1: e.clientX + scrollX, y1: e.clientY + scrollY, x2: e.clientX + scrollX, y2: e.clientY + scrollY };
  });
  cv.addEventListener('pointermove', (e) => {
    if (mode === 'element') {
      const el = elementAt(e.clientX, e.clientY);
      if (!el) { hover = null; redraw(); return; }
      if (!hover || hover.el !== el) {
        const r = el.getBoundingClientRect();
        hover = { kind: 'element', el, info: { tag: el.tagName.toLowerCase(), selector: U.cssPath(el) }, x1: r.x + scrollX, y1: r.y + scrollY, x2: r.right + scrollX, y2: r.bottom + scrollY };
        redraw();
      }
      return;
    }
    if (drawing) { drawing.x2 = e.clientX + scrollX; drawing.y2 = e.clientY + scrollY; redraw(); }
  });
  cv.addEventListener('pointerup', (e) => {
    if (mode === 'element') {
      e.preventDefault();
      const el = (hover && hover.el) || elementAt(e.clientX, e.clientY);
      if (!el) return;
      const info = U.describe(el);
      const r = info.rect;
      exitMode();
      openNote({ kind: 'element', el, element: info, x1: r.x + scrollX, y1: r.y + scrollY, x2: r.x + r.w + scrollX, y2: r.y + r.h + scrollY });
      return;
    }
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 10) { redraw(); return; }
    exitMode();
    openNote(d);
  });
  cv.addEventListener('wheel', (e) => { if (mode) { window.scrollBy(e.deltaX, e.deltaY); hover = null; redraw(); } }, { passive: true });
  cv.addEventListener('click', (e) => { if (mode) { e.preventDefault(); e.stopPropagation(); } });

  // ---------- окно комментария ----------
  function openNote(shape) {
    pending = shape;
    pending.n = state.annotations + 1;
    $('.nn').textContent = pending.n;
    $('.sel').textContent = shape.element ? shape.element.selector : '';
    $('.vo').hidden = !state.voice;
    ta.value = '';
    note.hidden = false;
    const nw = 340, nh = note.offsetHeight || 190;
    let x, y;
    if (shape.kind === 'note') { shape.ax = scrollX; shape.ay = scrollY; x = (innerWidth - nw) / 2; y = innerHeight - nh - 90; }
    else {
      const rp = norm(shape);
      const r = { x: rp.x - scrollX, y: rp.y - scrollY, w: rp.w, h: rp.h };
      x = r.x + r.w + 16; y = r.y;
      if (x + nw > innerWidth - 8) x = r.x - nw - 16;
      if (x < 8) { x = Math.min(innerWidth - nw - 8, Math.max(8, r.x)); y = r.y + r.h + 16; }
      if (y + nh > innerHeight - 8) y = innerHeight - nh - 8;
      y = Math.max(8, y);
    }
    note.style.left = x + 'px';
    note.style.top = y + 'px';
    redraw();
    setTimeout(() => ta.focus(), 0);
  }
  function cancelNote() { pending = null; note.hidden = true; redraw(); }

  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  async function saveNote() {
    if (!pending || busy) return;
    const text = ta.value.trim();
    if (!text && pending.kind === 'note' && !state.voice) { ta.focus(); ta.placeholder = 'Напишите комментарий (или включите 🎤 голос)'; return; }
    busy = true;
    const s = pending;
    s.label = text;
    note.hidden = true; bar.hidden = true; hint.hidden = true; toastEl.hidden = true;
    const others = shapes;
    shapes = []; // на скриншоте только текущая пометка
    redraw();
    await raf(); await raf();
    await new Promise((r) => setTimeout(r, 60));
    const r = await send({
      type: 'annotation',
      kind: s.kind,
      comment: text,
      element: s.element || null,
      shape: s.kind === 'note' ? null : { x1: s.x1 - scrollX, y1: s.y1 - scrollY, x2: s.x2 - scrollX, y2: s.y2 - scrollY },
      viewport: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) },
    });
    bar.hidden = false;
    busy = false;
    pending = null;
    shapes = others;
    if (r && r.ok) {
      s.n = r.n;
      state.annotations = r.n;
      $('.cnt').textContent = r.n;
      shapes.push(s);
      showToast(`Пометка #${r.n} сохранена со скриншотом`, 'ok');
    } else {
      showToast((r && r.error) || 'Не удалось сохранить пометку', 'error');
    }
    redraw();
  }
  $('.save').addEventListener('click', saveNote);
  $('.cancel').addEventListener('click', cancelNote);
  const stopKeys = (e) => e.stopPropagation();
  ['keyup', 'keypress', 'input'].forEach((t) => ta.addEventListener(t, stopKeys));
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelNote(); }
  });
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (pending) { cancelNote(); e.stopPropagation(); }
    else if (mode) { exitMode(); e.stopPropagation(); }
  };
  window.addEventListener('keydown', onKey, true);

  // ---------- панель ----------
  function showToast(text, kind = 'info') {
    toastEl.textContent = text;
    toastEl.className = 'toast ' + kind;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 3000);
  }

  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.tool) { setMode(b.dataset.tool); return; }
    const act = b.dataset.act;
    if (act === 'finish') {
      b.textContent = '…';
      const r = await send({ type: 'finish' });
      if (!r || !r.ok) { b.textContent = '✓ Готово'; showToast((r && r.error) || 'Ошибка', 'error'); }
    } else if (act === 'cancel') {
      if (!cancelArmed) {
        b.classList.add('warn'); b.textContent = 'Удалить баг?';
        cancelArmed = setTimeout(() => { cancelArmed = null; b.classList.remove('warn'); b.textContent = '✕'; }, 3000);
      } else {
        clearTimeout(cancelArmed);
        await send({ type: 'cancel' });
      }
    } else if (act === 'marks') {
      marksHidden = !marksHidden;
      b.textContent = marksHidden ? '🙈' : '👁';
      b.title = marksHidden ? 'Показать пометки' : 'Скрыть пометки';
      redraw();
    } else if (act === 'voice' || act === 'video') {
      b.disabled = true;
      const r = await send({ type: act + '-toggle' });
      b.disabled = false;
      if (r && r.ok === false) showToast(r.error, 'error');
      else if (r) applyState(r);
    }
  });

  // перетаскивание панели
  $('.grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = bar.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const move = (ev) => {
      bar.style.left = Math.max(0, Math.min(innerWidth - rect.width, ev.clientX - dx)) + 'px';
      bar.style.top = Math.max(0, Math.min(innerHeight - rect.height, ev.clientY - dy)) + 'px';
      bar.style.right = 'auto'; bar.style.bottom = 'auto';
    };
    const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  });

  function applyState(st) {
    state = Object.assign(state, st);
    $('.cnt').textContent = state.annotations || 0;
    const vb = root.querySelector('[data-act=voice]');
    vb.classList.toggle('rec', !!state.voice);
    const db = root.querySelector('[data-act=video]');
    db.classList.toggle('rec', !!state.video);
    tick();
  }
  function tick() {
    $('.t').textContent = fmt(Date.now() - state.startTime);
    $('.vt').textContent = state.voice ? fmt(Date.now() - state.voiceStart) : 'Голос';
    $('.vdt').textContent = state.video ? '■ Стоп видео ' + fmt(Date.now() - state.videoStart) : '⏺ Записать видео';
    $('.vrec').classList.toggle('on', !!state.video);
  }
  const timer = setInterval(tick, 500);

  // ---------- связь с service worker ----------
  function destroy() {
    clearInterval(timer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('keydown', onKey, true);
    chrome.runtime.onMessage.removeListener(onMsg);
    host.remove();
    globalThis.__qaOverlay = null;
  }
  function onMsg(m) {
    if (!m || !m.type) return;
    if (m.type === 'qa-overlay-remove') destroy();
    else if (m.type === 'qa-overlay-state') applyState(m.state);
    else if (m.type === 'qa-overlay-toast') showToast(m.text, m.kind);
    else if (m.type === 'qa-overlay-tool') setMode(m.tool);
  }
  chrome.runtime.onMessage.addListener(onMsg);
  window.addEventListener('resize', resize);
  let rafScroll = 0;
  const onScroll = () => { if (!rafScroll) rafScroll = requestAnimationFrame(() => { rafScroll = 0; redraw(); }); };
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  resize();

  globalThis.__qaOverlay = {
    ping() { bar.hidden = false; showToast('Панель фиксации бага активна'); },
  };

  send({ type: 'overlay-hello' }).then((st) => {
    if (!st || !st.active || !st.mine) { destroy(); return; }
    applyState(st);
  });
})();
