// Панель проверки поверх страницы: выбор элемента, стрелка, область, заметка, голос, видео.
// Пометки привязаны к элементам страницы, в покое полупрозрачные, их можно изменить и удалить.
(() => {
  if (globalThis.__qaOverlay) { globalThis.__qaOverlay.ping(); return; }
  const U = globalThis.__qaUtil;
  const RED = '#ff2d55';
  const BLUE = '#2563eb';
  const DIM = 0.3; // прозрачность пометки, когда на неё не смотрят
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

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
       box-shadow:0 10px 30px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.06);font:500 13px/1 ${FONT};pointer-events:auto;user-select:none}
  .bar button{appearance:none;border:0;background:transparent;font:inherit;cursor:pointer;padding:8px 9px;border-radius:8px;color:#e5e7eb;white-space:nowrap;display:flex;align-items:center;gap:5px}
  .bar button:hover{background:#374151}
  .bar button.act{background:${BLUE};color:#fff}
  .bar button.rec{background:${RED};color:#fff;animation:pl 1.4s infinite}
  .bar .done{background:#059669;color:#fff;font-weight:600}
  .bar .done:hover{background:#047857}
  .bar .x{color:#9ca3af}
  .bar .done.warn{background:#b45309}
  .mini{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:6px;padding:8px 12px;background:#111827;color:#f9fafb;border-radius:999px;
        box-shadow:0 8px 24px rgba(0,0,0,.35);font:600 13px/1 ${FONT};pointer-events:auto;cursor:pointer;user-select:none;opacity:.85}
  .mini:hover{opacity:1}
  .mini .me{background:#7c2d12;color:#fed7aa;border-radius:8px;padding:2px 6px;font-size:11px}
  .mini .mr{background:${RED};border-radius:6px;padding:2px 6px;font-size:11px;animation:pl 1.4s infinite}
  .bar .x.warn{background:#7f1d1d;color:#fff}
  .bar .cnt{background:#374151;font-size:12px;padding:6px 9px}
  .bar .cnt.open{background:${BLUE};color:#fff}
  .bar .errs{background:#7c2d12;color:#fed7aa}
  .li .n.e{background:#c2410c}
  .li h5{margin:0;padding:10px 14px 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
  .bar .type{background:#1f2937;border:1px solid #374151}
  .bar .type.open{background:${BLUE};border-color:${BLUE};color:#fff}
  .types{position:fixed;right:16px;bottom:72px;width:400px;max-height:70vh;overflow:auto;background:#fff;color:#111827;border-radius:12px;
         box-shadow:0 16px 48px rgba(0,0,0,.3);pointer-events:auto;font:13px/1.35 ${FONT};padding:6px}
  .types h4{margin:6px 8px 8px;font-size:14px}
  .types h4 small{display:block;font-weight:400;color:#6b7280;font-size:12px;margin-top:2px}
  .ty{display:flex;gap:10px;width:100%;text-align:left;appearance:none;border:0;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;font:inherit;color:inherit;align-items:flex-start}
  .ty:hover{background:#f3f4f6}
  .ty.on{background:#eff6ff;box-shadow:inset 0 0 0 1.5px ${BLUE}}
  .ty i{font-style:normal;font-size:18px;line-height:1.2}
  .ty b{display:block;font-weight:600}
  .ty small{color:#6b7280}
  .sep{width:1px;height:22px;background:#374151;margin:0 3px}
  .grip{cursor:move;padding:0 5px;color:#6b7280;font-size:14px;letter-spacing:-3px}
  .title{display:flex;align-items:center;gap:6px;padding:0 8px 0 2px;font-weight:600;font-variant-numeric:tabular-nums}
  .title i{font-style:normal;font-size:14px}
  .vrec{display:none;color:#fff;background:${RED};border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700;animation:pl 1.4s infinite}
  .vrec.on{display:inline-block}
  @keyframes pl{50%{background:#be123c}}
  .hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:9px 16px;border-radius:10px;
        font:500 13px ${FONT};pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:80vw;text-align:center}
  .toast{position:fixed;bottom:76px;right:16px;max-width:380px;background:#111827;color:#fff;padding:11px 14px;border-radius:10px;
         font:13px/1.45 ${FONT};box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:auto;border-left:4px solid ${BLUE}}
  .toast.error{border-left-color:${RED}} .toast.warn{border-left-color:#f59e0b} .toast.ok{border-left-color:#10b981}
  .note{position:fixed;width:340px;background:#fff;color:#111827;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);padding:12px;
        pointer-events:auto;font:14px/1.4 ${FONT};border-top:4px solid ${RED}}
  .nt{font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between;gap:8px}
  .nt small{font-weight:400;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;font-family:ui-monospace,Consolas,monospace;font-size:11px;padding-top:2px}
  textarea{display:block;width:100%;min-height:84px;max-height:220px;resize:vertical;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;
           font:14px/1.4 ${FONT};color:#111827;background:#fff;outline:none;margin:0}
  textarea:focus{border-color:${BLUE};box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .row{display:flex;gap:8px;align-items:center;margin-top:10px}
  .row button{appearance:none;border:0;font:600 13px ${FONT};padding:8px 14px;border-radius:8px;cursor:pointer}
  .save{background:${RED};color:#fff} .save:hover{background:#e11d48}
  .cancel{background:#f3f4f6;color:#374151} .cancel:hover{background:#e5e7eb}
  .k{margin-left:auto;color:#9ca3af;font-size:11px}
  .vo{font-size:12px;color:#b91c1c;margin-top:6px}
  .sevrow{margin-top:8px;font-size:12px;color:#6b7280;display:flex;gap:6px;align-items:center}
  .sevrow select{font:12px ${FONT};border:1px solid #d1d5db;border-radius:6px;padding:3px 6px;background:#fff;color:#111827}
  /* значки пометок с действиями */
  .chips{position:fixed;inset:0;pointer-events:none}
  .chip{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;pointer-events:auto;cursor:pointer}
  .chip .acts{display:none;position:absolute;left:24px;top:-2px;background:#111827;border-radius:9px;padding:3px;gap:2px;box-shadow:0 6px 18px rgba(0,0,0,.3);white-space:nowrap}
  .chip:hover .acts,.chip.open .acts{display:flex}
  .chip button{appearance:none;border:0;background:transparent;color:#f3f4f6;font:600 12px ${FONT};padding:6px 9px;border-radius:7px;cursor:pointer}
  .chip button:hover{background:#374151}
  .chip button.del:hover,.chip button.yes{background:#7f1d1d;color:#fff}
  /* список пометок */
  .list{position:fixed;right:16px;bottom:72px;width:380px;max-height:60vh;overflow:auto;background:#fff;color:#111827;border-radius:12px;
        box-shadow:0 16px 48px rgba(0,0,0,.3);pointer-events:auto;font:13px/1.4 ${FONT}}
  .list h4{margin:0;padding:12px 14px;font-size:14px;border-bottom:1px solid #f3f4f6;position:sticky;top:0;background:#fff;display:flex;flex-direction:column;gap:2px}
  .list h4 small{font-weight:400;color:#9ca3af;font-size:12px}
  .li{display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid #f3f4f6;align-items:flex-start}
  .li .n{flex:none;width:22px;height:22px;border-radius:50%;background:${RED};color:#fff;font-weight:700;font-size:12px;display:grid;place-items:center}
  .li .tx{flex:1;min-width:0}
  .li .tx b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .li .tx small{color:#9ca3af}
  .li .bt{display:flex;gap:2px;flex:none}
  .li button{appearance:none;border:0;background:#f3f4f6;border-radius:7px;padding:5px 7px;cursor:pointer;font-size:13px}
  .li button:hover{background:#e5e7eb}
  .li button.yes{background:#fee2e2;color:#991b1b;font:600 12px ${FONT}}
  .empty{padding:18px 14px;color:#6b7280}
  [hidden]{display:none!important}
</style>
<canvas class="cv"></canvas>
<div class="chips"></div>
<div class="hint" hidden></div>
<div class="toast" hidden></div>
<div class="list" hidden></div>
<div class="types" hidden></div>
<div class="note" hidden>
  <div class="nt"><span class="ntt">Пометка #<span class="nn">1</span></span><small class="sel"></small></div>
  <textarea placeholder="Что здесь не так? Опишите проблему…"></textarea>
  <div class="vo" hidden>🎤 Идёт запись голоса — можно просто рассказать</div>
  <div class="sevrow">Серьёзность <select class="sev">
    <option value="blocker">🔴 Блокирующий</option><option value="critical">🟠 Критический</option><option value="major">🟡 Значительный</option>
    <option value="minor" selected>🔵 Незначительный</option><option value="trivial">⚪ Тривиальный</option></select></div>
  <div class="row"><button class="save">Сохранить</button><button class="cancel">Отмена</button><span class="k">Ctrl+Enter · Esc</span></div>
</div>
<div class="mini" hidden title="Развернуть панель проверки">🐞 <span class="mt2">00:00</span><span class="me" hidden></span><span class="mr" hidden>● REC</span></div>
<div class="bar">
  <span class="grip" title="Перетащить панель">⋮⋮</span>
  <span class="title" title="Идёт проверка. Ошибки консоли и запросов сохраняются автоматически. Видео пишется, только если нажать «Записать видео»"><i>🐞</i>Проверка <b class="t">00:00</b><span class="vrec">● REC</span></span>
  <span class="sep"></span>
  <button data-tool="element" title="Выбрать элемент с багом">🎯 Элемент</button>
  <button data-tool="arrow" title="Нарисовать стрелку">➚ Стрелка</button>
  <button data-tool="rect" title="Выделить область">▭ Область</button>
  <button data-tool="note" title="Комментарий со скриншотом без выделения">💬 Заметка</button>
  <span class="sep"></span>
  <button data-act="voice" title="Голосовой комментарий с микрофона">🎤 <span class="vt">Голос</span></button>
  <button data-act="video" title="Начать или остановить запись видео вкладки"><span class="vdt">⏺ Записать видео</span></button>
  <span class="sep"></span>
  <button data-act="audit" title="Автопроверка этой страницы: доступность, изображения, DOM">🩺</button>
  <button data-act="eye" title="Скрыть пометки на странице">👁</button>
  <button data-act="list" class="cnt" title="Список замечаний: показать, изменить, удалить">📋 <span class="cn">0</span></button>
  <button data-act="errs" class="cnt errs" title="Автоматически пойманные ошибки консоли и запросов" hidden>⚠ <span class="en">0</span></button>
  <button class="done" data-act="finish" title="Завершить и открыть отчёт">✓ Готово</button>
  <button data-act="min" title="Свернуть панель — не будет мешать кликать по сайту">▁</button>
  <button class="x" data-act="cancel" title="Отменить проверку и удалить данные">✕</button>
</div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const cv = $('.cv'), ctx = cv.getContext('2d'), bar = $('.bar'), note = $('.note'), ta = $('textarea'),
    hint = $('.hint'), toastEl = $('.toast'), chipsEl = $('.chips'), listEl = $('.list'), typesEl = $('.types');
  const BT = globalThis.QA_BUG_TYPES;

  let state = { startTime: Date.now(), annotations: 0 };
  let dpr = 1, mode = null, drawing = null, hover = null, pending = null, editing = null, busy = false;
  let shapes = []; // пометки, нарисованные на этой странице
  // одностраничные приложения (React, Vue…) меняют адрес без перезагрузки:
  // пометка принадлежит адресу, на котором её сделали, и видна только там
  const pageKey = (u) => String(u).replace(/\/+(?=$|[?#])/, '');
  let curPage = pageKey(location.href);
  const visible = () => shapes.filter((x) => x.page === curPage);
  let hot = null; // пометка под курсором
  let toastTimer = null, cancelArmed = null, finishArmed = null, marksHidden = false, capturing = false;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: e.message }));
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (s) => ({ x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) });

  // ================= привязка к странице =================
  // Координаты пометок хранятся в координатах страницы. Стрелка и область дополнительно
  // привязываются к элементу под ними: если он прокручивается внутри блока или сдвигается — пометка едет вместе с ним.
  const elementAt = (x, y) => {
    const prev = cv.style.pointerEvents;
    cv.style.pointerEvents = 'none';
    chipsEl.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    cv.style.pointerEvents = prev;
    chipsEl.style.display = '';
    return el && el !== host && el !== document.documentElement && el !== document.body ? el : null;
  };
  function attachAnchor(s) {
    const px = s.kind === 'arrow' ? s.x2 : (s.x1 + s.x2) / 2;
    const py = s.kind === 'arrow' ? s.y2 : (s.y1 + s.y2) / 2;
    const el = elementAt(px - scrollX, py - scrollY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bx = r.left + scrollX, by = r.top + scrollY;
    s.anchor = el;
    s.off = { x1: s.x1 - bx, y1: s.y1 - by, x2: s.x2 - bx, y2: s.y2 - by };
  }
  function sync(s) {
    const el = s.el || s.anchor;
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const bx = r.left + scrollX, by = r.top + scrollY;
    if (s.el) { s.x1 = bx; s.y1 = by; s.x2 = r.right + scrollX; s.y2 = r.bottom + scrollY; }
    else { s.x1 = bx + s.off.x1; s.y1 = by + s.off.y1; s.x2 = bx + s.off.x2; s.y2 = by + s.off.y2; }
  }

  // ================= рисование =================
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
  function badgePos(s) {
    if (s.kind === 'arrow') return { x: s.x1, y: s.y1 };
    if (s.kind === 'note') return { x: s.ax + 18, y: s.ay + 18 };
    const r = norm(s);
    return { x: r.x, y: r.y };
  }
  function badge(x, y, n, color) {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 12px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x, y + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function label(s) {
    s.lb = null;
    if (!s.label) return;
    ctx.font = `600 14px ${FONT}`;
    const lines = wrap(s.label, 280);
    const lh = 19, pad = 9;
    const w = Math.min(300, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = lines.length * lh + pad * 2 - 4;
    let x, y;
    if (s.kind === 'arrow') { x = s.x2 > s.x1 ? s.x1 - w - 10 : s.x1 + 10; y = s.y1 - h / 2; }
    else if (s.kind === 'note') { x = s.ax + 40; y = s.ay + 8; }
    else {
      const r = norm(s);
      x = r.x; y = r.y + r.h + 10;
      if (y + h > scrollY + innerHeight - 8) y = r.y - h - 10;
    }
    x = Math.max(scrollX + 8, Math.min(scrollX + innerWidth - w - 8, x));
    y = Math.max(8, y);
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = RED;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + 13 + i * lh));
    s.lb = { x, y, w, h };
  }
  function drawShape(s, color = RED, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.kind === 'arrow') {
      arrowPath(s.x1, s.y1, s.x2, s.y2, 9, '#fff');
      arrowPath(s.x1, s.y1, s.x2, s.y2, 4.5, color);
    } else if (s.kind === 'rect' || s.kind === 'element') {
      const r = norm(s);
      ctx.fillStyle = color === BLUE ? 'rgba(37,99,235,.12)' : 'rgba(255,45,85,.10)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = color; ctx.lineWidth = 3.5;
      if (s.kind === 'element' && color === BLUE) ctx.setLineDash([7, 5]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }
    if (s.n) { const b = badgePos(s); badge(b.x, b.y, s.n, color); }
    label(s);
    ctx.restore();
  }
  function drawHoverTip(s) {
    const r = norm(s);
    const t = `${s.info.tag}  ${Math.round(r.w)}×${Math.round(r.h)}  ${s.info.selector}`;
    ctx.font = '12px ui-monospace,Consolas,monospace';
    const txt = t.length > 90 ? t.slice(0, 90) + '…' : t;
    const w = ctx.measureText(txt).width + 14;
    const x = Math.max(scrollX + 4, Math.min(scrollX + innerWidth - w - 4, r.x));
    let y = r.y - 28;
    if (y < scrollY + 4) y = r.y + r.h + 6;
    if (y > scrollY + innerHeight - 26) y = scrollY + innerHeight - 30;
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.roundRect(x, y, w, 22, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x + 7, y + 15);
  }
  const alphaOf = (s) => (capturing || s === hot || s.fresh || s === editing ? 1 : DIM);

  function redraw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.translate(-scrollX, -scrollY);
    [...shapes, hover, pending].forEach((s) => s && sync(s));
    if (!marksHidden) for (const s of visible()) drawShape(s, RED, alphaOf(s));
    if (hover && !pending) { drawShape(hover, BLUE); drawHoverTip(hover); }
    if (drawing) drawShape(drawing);
    if (pending && !shapes.includes(pending)) drawShape(pending);
    placeChips();
  }

  // ---------- значки с действиями ----------
  function placeChips() {
    if (marksHidden || capturing) { chipsEl.innerHTML = ''; return; }
    const have = new Map([...chipsEl.children].map((c) => [+c.dataset.n, c]));
    for (const s of visible()) {
      const b = badgePos(s);
      let c = have.get(s.n);
      if (!c) {
        c = document.createElement('div');
        c.className = 'chip';
        c.dataset.n = s.n;
        c.innerHTML = '<div class="acts"><button class="ed">✎ Изменить</button><button class="del">🗑 Удалить</button></div>';
        c.addEventListener('mouseenter', () => { hot = s; redraw(); });
        c.addEventListener('mouseleave', () => { if (!c.classList.contains('open')) { hot = null; redraw(); } });
        c.querySelector('.ed').onclick = (e) => { e.stopPropagation(); editMark(s); };
        c.querySelector('.del').onclick = (e) => {
          e.stopPropagation();
          const d = e.currentTarget;
          if (!d.classList.contains('yes')) {
            d.classList.add('yes'); d.textContent = 'Точно удалить?'; c.classList.add('open');
            setTimeout(() => { d.classList.remove('yes'); d.textContent = '🗑 Удалить'; c.classList.remove('open'); }, 3000);
          } else deleteMark(s.n);
        };
        chipsEl.appendChild(c);
      }
      have.delete(s.n);
      c.style.left = b.x - scrollX + 'px';
      c.style.top = b.y - scrollY + 'px';
    }
    have.forEach((c) => c.remove());
  }

  // подсветка пометки под курсором
  const inBox = (x, y, b, pad = 6) => b && x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  function hitTest(px, py) {
    const vis = visible();
    for (let i = vis.length - 1; i >= 0; i--) {
      const s = vis[i];
      if (inBox(px, py, s.lb)) return s;
      if (s.kind === 'rect' || s.kind === 'element') { if (inBox(px, py, norm(s), 4)) return s; }
      else if (s.kind === 'arrow') {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
        if (Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)) < 14) return s;
      }
    }
    return null;
  }
  let moveRaf = 0;
  const onMove = (e) => {
    if (mode || moveRaf || marksHidden || !visible().length) return;
    const x = e.clientX + scrollX, y = e.clientY + scrollY;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      if (chipsEl.querySelector('.chip:hover, .chip.open')) return;
      const h = hitTest(x, y);
      if (h !== hot) { hot = h; redraw(); }
    });
  };
  window.addEventListener('pointermove', onMove, { passive: true, capture: true });

  // ================= режимы =================
  const HINTS = {
    element: 'Наведите на элемент с багом и кликните · колесо мыши прокручивает страницу · Esc — отмена',
    arrow: 'Тяните мышью от свободного места к проблеме — стрелка укажет туда, где отпустите · Esc — отмена',
    rect: 'Выделите мышью область с проблемой · Esc — отмена',
  };
  function setMode(m) {
    if (busy) return;
    if (pending) cancelNote();
    closeList();
    if (m === 'type') { exitMode(); openTypes(); return; }
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

  cv.addEventListener('pointerdown', (e) => {
    if (!mode || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (mode === 'element') return;
    cv.setPointerCapture(e.pointerId);
    const x = e.clientX + scrollX, y = e.clientY + scrollY;
    drawing = { kind: mode, x1: x, y1: y, x2: x, y2: y };
  });
  cv.addEventListener('pointermove', (e) => {
    if (mode === 'element') {
      const el = elementAt(e.clientX, e.clientY);
      if (!el) { hover = null; redraw(); return; }
      if (!hover || hover.el !== el) {
        hover = { kind: 'element', el, info: { tag: el.tagName.toLowerCase(), selector: U.cssPath(el) }, x1: 0, y1: 0, x2: 0, y2: 0 };
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
      exitMode();
      const s = { kind: 'element', el, element: info, x1: 0, y1: 0, x2: 0, y2: 0 };
      sync(s);
      openNote(s);
      return;
    }
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 10) { redraw(); return; }
    exitMode();
    attachAnchor(d);
    openNote(d);
  });
  cv.addEventListener('wheel', (e) => { if (mode) { window.scrollBy(e.deltaX, e.deltaY); hover = null; redraw(); } }, { passive: true });
  cv.addEventListener('click', (e) => { if (mode) { e.preventDefault(); e.stopPropagation(); } });

  // ================= окно комментария =================
  function openNote(shape, edit) {
    pending = shape;
    editing = edit ? shape : null;
    if (!edit) pending.n = null;
    $('.ntt').innerHTML = edit ? `Изменить пометку #<span class="nn">${shape.n}</span>` : 'Новая пометка';
    $('.sel').textContent = shape.element ? shape.element.selector : '';
    $('.vo').hidden = !state.voice;
    $('.save').textContent = edit ? 'Сохранить изменения' : 'Сохранить';
    const tp = BT && (BT.byId(state.bugType) || BT.auto);
    ta.placeholder = tp ? tp.placeholder : 'Что здесь не так? Опишите проблему…';
    ta.value = edit ? shape.label || '' : '';
    $('.sev').value = (edit && shape.severity) || 'minor';
    note.hidden = false;
    const nw = 340, nh = note.offsetHeight || 190;
    let x, y;
    if (shape.kind === 'note') {
      if (!edit) { shape.ax = scrollX; shape.ay = scrollY; }
      x = (innerWidth - nw) / 2; y = innerHeight - nh - 90;
    } else {
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
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  }
  function cancelNote() { pending = null; editing = null; note.hidden = true; redraw(); }

  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  // скриншот: на нём только одна пометка, без панели и прочих пометок
  async function withCapture(s, fn) {
    capturing = true;
    note.hidden = true; bar.hidden = true; miniEl.hidden = true; hint.hidden = true; toastEl.hidden = true; listEl.hidden = true; typesEl.hidden = true;
    const others = shapes;
    shapes = [];
    pending = s;
    redraw();
    await raf(); await raf();
    await new Promise((r) => setTimeout(r, 60));
    let res;
    try { res = await fn(); } finally {
      capturing = false;
      shapes = others;
      pending = null;
      bar.hidden = isMini;
      miniEl.hidden = !isMini;
    }
    return res;
  }
  const payload = (s, text) => ({
    kind: s.kind,
    comment: text,
    severity: s.severity || 'minor',
    element: s.element || null,
    shape: s.kind === 'note' ? null : { x1: s.x1 - scrollX, y1: s.y1 - scrollY, x2: s.x2 - scrollX, y2: s.y2 - scrollY },
    viewport: { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) },
  });

  async function saveNote() {
    if (!pending || busy) return;
    const text = ta.value.trim();
    if (!text && pending.kind === 'note' && !state.voice) { ta.focus(); ta.placeholder = 'Напишите комментарий (или включите 🎤 голос)'; return; }
    busy = true;
    const s = pending;
    const isEdit = !!editing;
    editing = null;
    const oldLabel = s.label;
    s.label = text;
    s.severity = $('.sev').value;
    if (!isEdit) s.n = state.annotations + 1; // предварительный номер для скриншота
    const r = await withCapture(s, () =>
      send(isEdit ? { type: 'annotation-update', n: s.n, recapture: true, ...payload(s, text) } : { type: 'annotation', ...payload(s, text) })
    );
    busy = false;
    if (r && r.ok) {
      if (!isEdit) { s.n = r.n; s.page = curPage; shapes.push(s); }
      flash(s);
      showToast(isEdit ? `Пометка #${s.n} изменена, скриншот обновлён` : `Пометка #${s.n} сохранена со скриншотом`, 'ok');
      if (r.count != null) setCount(r.count);
      if (!listEl.hidden) openList();
    } else {
      if (isEdit) s.label = oldLabel;
      showToast((r && r.error) || 'Не удалось сохранить пометку', 'error');
    }
    redraw();
  }
  function flash(s) {
    s.fresh = true;
    redraw();
    clearTimeout(s.freshT);
    s.freshT = setTimeout(() => { s.fresh = false; redraw(); }, 2500);
  }

  function editMark(s) {
    closeList();
    const r = norm(s);
    if (s.kind !== 'note' && (r.y < scrollY || r.y + r.h > scrollY + innerHeight)) {
      window.scrollTo({ top: Math.max(0, r.y - innerHeight / 3), behavior: 'instant' });
    }
    if (s.kind === 'note') window.scrollTo({ top: s.ay, left: s.ax, behavior: 'instant' });
    redraw();
    openNote(s, true);
  }
  async function deleteMark(n) {
    const r = await send({ type: 'annotation-delete', n });
    if (!r || !r.ok) { showToast((r && r.error) || 'Не удалось удалить', 'error'); return; }
    shapes = shapes.filter((x) => x.n !== n);
    if (hot && hot.n === n) hot = null;
    setCount(r.count);
    showToast(`Пометка #${n} удалена`, 'ok');
    redraw();
    if (!listEl.hidden) openList();
  }

  // ================= список пометок =================
  const KIND = { element: '🎯', arrow: '➚', rect: '▭', note: '💬' };
  async function openList() {
    closeTypes();
    const r = await send({ type: 'annotations-list' });
    const items = (r && r.items) || [];
    const errs = (r && r.errors) || [];
    $('[data-act=list]').classList.add('open');
    listEl.hidden = false;
    listEl.innerHTML = `<h4>Замечания (${items.length}) <small>наведите на пометку на странице — она станет яркой</small></h4>` +
      (items.length
        ? items.map((a) => {
            const here = visible().find((s) => s.n === a.n);
            const other = !here && a.url !== location.href;
            return `<div class="li" data-n="${a.n}"><span class="n">${a.n}</span><div class="tx"><b>${KIND[a.kind] || ''} ${escH(a.comment || '(без комментария)')}</b>` +
              `<small>${other ? 'на другой странице' : here ? 'на этой странице' : 'нарисована до перезагрузки'}</small></div><div class="bt">` +
              `${here ? '<button data-a="show" title="Показать на странице">👁</button>' : ''}<button data-a="edit" title="Изменить текст">✎</button><button data-a="del" title="Удалить">🗑</button></div></div>`;
          }).join('')
        : '<div class="empty">Пока нет замечаний. Используйте 🎯 Элемент, ➚ Стрелка, ▭ Область или 💬 Заметка.</div>') +
      (errs.length
        ? `<h5>⚠ Пойманные ошибки (${errs.length})</h5>` + errs.map((x) => `<div class="li" data-e="${x.n}"><span class="n e">!</span><div class="tx"><b>${escH(x.title)}</b><small>${x.count > 1 ? 'повторялась ' + x.count + ' раз · ' : ''}сохранена со скриншотом и контекстом</small></div><div class="bt"><button data-a="eign" title="Удалить и больше не сохранять такие ошибки">🙈</button><button data-a="edel" title="Удалить">🗑</button></div></div>`).join('')
        : '');
    listEl.querySelectorAll('[data-a=eign]').forEach((b) => (b.onclick = async () => {
      if (!b.classList.contains('yes')) { b.classList.add('yes'); b.textContent = 'Игнорировать такие?'; return; }
      const n = +b.closest('.li').dataset.e;
      const rr = await send({ type: 'error-ignore', n });
      if (rr && rr.ok) { showToast('Такие ошибки больше не будут сохраняться. Список — в настройках расширения', 'ok'); openList(); }
    }));
    listEl.querySelectorAll('[data-a=edel]').forEach((b) => (b.onclick = async () => {
      if (!b.classList.contains('yes')) { b.classList.add('yes'); b.textContent = 'Удалить?'; return; }
      const n = +b.closest('.li').dataset.e;
      const rr = await send({ type: 'error-delete', n });
      if (rr && rr.ok) { showToast('Пункт с ошибкой удалён', 'ok'); openList(); }
    }));
    listEl.querySelectorAll('.li[data-n]').forEach((row) => {
      const n = +row.dataset.n;
      const a = items.find((x) => x.n === n);
      row.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
        const s = visible().find((x) => x.n === n);
        if (b.dataset.a === 'show' && s) {
          const r2 = norm(s);
          if (s.kind === 'note') window.scrollTo({ top: s.ay, behavior: 'smooth' });
          else window.scrollTo({ top: Math.max(0, r2.y - innerHeight / 3), behavior: 'smooth' });
          setTimeout(() => flash(s), 350);
        } else if (b.dataset.a === 'edit') {
          if (s) editMark(s);
          else {
            const t = prompt('Комментарий к пометке #' + n, a.comment || '');
            if (t != null) { await send({ type: 'annotation-update', n, comment: t.trim(), recapture: false }); openList(); }
          }
        } else if (b.dataset.a === 'del') {
          if (!b.classList.contains('yes')) { b.classList.add('yes'); b.textContent = 'Удалить?'; }
          else deleteMark(n);
        }
      }));
    });
  }
  function closeList() { listEl.hidden = true; $('[data-act=list]').classList.remove('open'); }

  // скрыть панель на время автоматического скриншота ошибки
  let prepSaved = null;
  async function capturePrep() {
    if (prepSaved) return true;
    prepSaved = { bar: bar.hidden, note: note.hidden, list: listEl.hidden, marks: marksHidden, mini: miniEl.hidden };
    bar.hidden = true; miniEl.hidden = true; toastEl.hidden = true; note.hidden = true; listEl.hidden = true; typesEl.hidden = true; hint.hidden = true;
    marksHidden = true; redraw();
    await raf(); await raf();
    return true;
  }
  function captureDone() {
    if (!prepSaved) return;
    bar.hidden = prepSaved.bar; miniEl.hidden = prepSaved.mini; note.hidden = prepSaved.note; listEl.hidden = prepSaved.list; marksHidden = prepSaved.marks;
    if (mode) hint.hidden = false;
    prepSaved = null; redraw();
  }

  // ================= тип бага =================
  function showType() {
    if (!BT) return;
    const t = BT.byId(state.bugType) || BT.auto;
    const b = $('[data-act=type]');
    b.textContent = `${t.icon} ${t.id === 'auto' ? 'Тип: авто' : t.name.split(' — ')[0]}`;
  }
  function openTypes() {
    if (!BT) return;
    closeList();
    $('[data-act=type]').classList.add('open');
    const cur = state.bugType || 'auto';
    typesEl.hidden = false;
    typesEl.innerHTML = `<h4>Тип бага<small>От типа зависит, какие данные покажет отчёт. Остальное не потеряется — его можно включить в отчёте.</small></h4>` +
      [BT.auto, ...BT.list].map((t) => `<button class="ty ${t.id === cur ? 'on' : ''}" data-id="${t.id}"><i>${t.icon}</i><span><b>${escH(t.name)}</b><small>${escH(t.hint)}</small></span></button>`).join('');
    typesEl.querySelectorAll('.ty').forEach((b) => (b.onclick = async () => {
      const r = await send({ type: 'set-type', bugType: b.dataset.id });
      if (r && r.ok) { state.bugType = r.bugType; showType(); }
      closeTypes();
      const t = BT.byId(state.bugType) || BT.auto;
      showToast(`Тип бага: ${t.icon} ${t.name}`, 'ok');
    }));
  }
  function closeTypes() { typesEl.hidden = true; $('[data-act=type]').classList.remove('open'); }

  // ================= клавиатура и сохранение =================
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
    else if (!listEl.hidden) { closeList(); e.stopPropagation(); }
    else if (!typesEl.hidden) { closeTypes(); e.stopPropagation(); }
  };
  window.addEventListener('keydown', onKey, true);

  // ================= панель =================
  function showToast(text, kind = 'info') {
    toastEl.textContent = text;
    toastEl.className = 'toast ' + kind;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 3000);
  }
  function setCount(n) { state.annotations = n; $('.cn').textContent = n; }

  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.tool) { setMode(b.dataset.tool); return; }
    const act = b.dataset.act;
    if (act === 'finish') {
      // защита от случайного клика: завершить можно только вторым нажатием
      if (!finishArmed) {
        b.classList.add('warn'); b.textContent = 'Завершить проверку?';
        finishArmed = setTimeout(() => { finishArmed = null; b.classList.remove('warn'); b.textContent = '✓ Готово'; }, 3000);
        return;
      }
      clearTimeout(finishArmed); finishArmed = null;
      b.textContent = '…';
      const r = await send({ type: 'finish' });
      if (!r || !r.ok) { b.classList.remove('warn'); b.textContent = '✓ Готово'; showToast((r && r.error) || 'Ошибка', 'error'); }
    } else if (act === 'min') {
      setMini(true);
    } else if (act === 'cancel') {
      if (!cancelArmed) {
        b.classList.add('warn'); b.textContent = 'Удалить баг?';
        cancelArmed = setTimeout(() => { cancelArmed = null; b.classList.remove('warn'); b.textContent = '✕'; }, 3000);
      } else {
        clearTimeout(cancelArmed);
        await send({ type: 'cancel' });
      }
    } else if (act === 'audit') {
      b.disabled = true; b.textContent = '⏳';
      showToast('Проверяю страницу: доступность, изображения, DOM…', 'info');
      const r = await send({ type: 'audit-page' });
      b.disabled = false; b.textContent = '🩺';
      if (r && r.ok) showToast(r.a11y || r.images ? `🩺 Найдено: доступность — ${r.a11y} правил (${r.nodes} элементов), изображения — ${r.images}. Подробности в отчёте` : '🩺 Проблем доступности и изображений не найдено', r.a11y ? 'warn' : 'ok');
      else showToast('Автопроверка не удалась: ' + ((r && r.error) || 'ошибка'), 'error');
    } else if (act === 'eye') {
      marksHidden = !marksHidden;
      b.textContent = marksHidden ? '🙈' : '👁';
      b.title = marksHidden ? 'Показать пометки' : 'Скрыть пометки на странице';
      hot = null;
      redraw();
    } else if (act === 'type') {
      if (typesEl.hidden) openTypes(); else closeTypes();
    } else if (act === 'list' || act === 'errs') {
      if (listEl.hidden) openList(); else closeList();
    } else if (act === 'voice' || act === 'video') {
      b.disabled = true;
      const r = await send({ type: act + '-toggle' });
      b.disabled = false;
      if (r && r.ok === false) showToast(r.error, 'error');
      else if (r) applyState(r);
    }
  });

  $('.grip').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = bar.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const move = (ev) => {
      bar.style.left = Math.max(0, Math.min(innerWidth - rect.width, ev.clientX - dx)) + 'px';
      bar.style.top = Math.max(0, Math.min(innerHeight - rect.height, ev.clientY - dy)) + 'px';
      bar.style.right = 'auto'; bar.style.bottom = 'auto';
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      savePos();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  });

  // ---------- свёрнутая панель и запоминание положения ----------
  const miniEl = $('.mini');
  let barPos = null, isMini = false;
  function savePos() {
    const r = bar.getBoundingClientRect();
    barPos = bar.style.left ? { left: r.left, top: r.top } : null;
    chrome.storage.local.set({ qa_bar: { pos: barPos, mini: isMini } }).catch(() => {});
  }
  function applyPos() {
    if (!barPos) return;
    const r = bar.getBoundingClientRect();
    bar.style.left = Math.max(0, Math.min(innerWidth - r.width, barPos.left)) + 'px';
    bar.style.top = Math.max(0, Math.min(innerHeight - r.height, barPos.top)) + 'px';
    bar.style.right = 'auto'; bar.style.bottom = 'auto';
  }
  function setMini(on) {
    isMini = on;
    bar.hidden = on || !!prepSaved;
    miniEl.hidden = !on || !!prepSaved;
    if (on) { closeList(); typesEl.hidden = true; if (mode) exitMode(); }
    if (!on) applyPos();
    savePos();
  }
  miniEl.addEventListener('click', () => setMini(false));
  chrome.storage.local.get('qa_bar').then(({ qa_bar }) => {
    if (!qa_bar) return;
    barPos = qa_bar.pos || null;
    applyPos();
    if (qa_bar.mini) setMini(true);
  }).catch(() => {});

  function applyState(st) {
    state = Object.assign(state, st);
    setCount(state.annotations || 0);
    const ec = state.autoErrors || 0;
    $('.en').textContent = ec;
    $('[data-act=errs]').hidden = !ec;
    root.querySelector('[data-act=voice]').classList.toggle('rec', !!state.voice);
    root.querySelector('[data-act=video]').classList.toggle('rec', !!state.video);
    tick();
  }
  function tick() {
    $('.t').textContent = fmt(Date.now() - state.startTime);
    $('.vt').textContent = state.voice ? fmt(Date.now() - state.voiceStart) : 'Голос';
    $('.vdt').textContent = state.video ? '■ Стоп видео ' + fmt(Date.now() - state.videoStart) : '⏺ Записать видео';
    $('.vrec').classList.toggle('on', !!state.video);
    $('.mt2').textContent = fmt(Date.now() - state.startTime);
    const me = $('.me'); me.hidden = !state.autoErrors; me.textContent = '⚠ ' + (state.autoErrors || 0);
    $('.mr').hidden = !state.video;
  }
  const timer = setInterval(() => { tick(); checkUrl(); }, 400);
  function checkUrl() {
    const k = pageKey(location.href);
    if (k === curPage) return;
    curPage = k;
    hot = null;
    if (pending && !editing) cancelNote(); // недописанная пометка относилась к прошлой странице
    if (mode) exitMode();
    redraw();
    const n = visible().length;
    if (n) showToast(`На этой странице ваших пометок: ${n}`, 'info');
  }
  window.addEventListener('popstate', () => setTimeout(checkUrl, 0));
  window.addEventListener('hashchange', checkUrl);

  // ================= связь с service worker =================
  let rafScroll = 0;
  const onScroll = () => { if (!rafScroll) rafScroll = requestAnimationFrame(() => { rafScroll = 0; redraw(); }); };
  // перерисовка при изменениях вёрстки, чтобы пометки следовали за элементами
  const ro = new ResizeObserver(onScroll);
  ro.observe(document.documentElement);

  function destroy() {
    clearInterval(timer);
    ro.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointermove', onMove, true);
    chrome.runtime.onMessage.removeListener(onMsg);
    host.remove();
    globalThis.__qaOverlay = null;
  }
  function onMsg(m, _sender, sendResponse) {
    if (!m || !m.type) return;
    if (m.type === 'qa-capture-prep') { capturePrep().then(() => sendResponse(true)); return true; }
    if (m.type === 'qa-capture-done') { captureDone(); return; }
    if (m.type === 'qa-overlay-remove') destroy();
    else if (m.type === 'qa-overlay-state') applyState(m.state);
    else if (m.type === 'qa-overlay-toast') showToast(m.text, m.kind);
    else if (m.type === 'qa-overlay-tool') { if (isMini) setMini(false); setMode(m.tool); }
  }
  chrome.runtime.onMessage.addListener(onMsg);
  window.addEventListener('resize', resize);
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
