// Наложение макета поверх страницы (pixel perfect): картинка из Figma/PNG,
// прозрачность, режим «разница», сдвиг по пикселю, подгонка ширины окна.
// Внедряется по кнопке «🎨 Сравнить с макетом». Изолированный мир.
(() => {
  if (globalThis.__qaDesign) { globalThis.__qaDesign.show(); return; }
  const PANEL_TAG = 'qa-design-panel', LAYER_TAG = 'qa-design-layer';
  const origin = location.origin;
  const pathKey = () => location.pathname;
  const SKEY = 'qa_design_' + origin;
  let store = { items: [], byPath: {} }; // items: {id,name,img,w,h}; byPath[path]: состояние
  let st = null; // состояние для текущей страницы
  let item = null; // текущий макет
  let hidden = false;

  const defState = () => ({ id: null, x: 0, y: 0, op: 50, mode: 'normal', scale: 1, fixed: false, locked: true, min: false });
  const save = async () => { store.byPath[pathKey()] = st; try { await chrome.storage.local.set({ [SKEY]: store }); } catch (e) { toast('Не удалось сохранить: ' + e.message); } };

  // ---------- слой с макетом ----------
  const layer = document.createElement(LAYER_TAG);
  // mix-blend-mode должен стоять на самом хосте: иначе «разница» смешивается только внутри теневого DOM
  layer.style.cssText = 'all:initial;position:absolute;left:0;top:0;z-index:2147483646;pointer-events:none;display:block;';
  const lsh = layer.attachShadow({ mode: 'closed' });
  lsh.innerHTML = '<style>img{display:block;user-select:none;-webkit-user-drag:none;max-width:none}:host(.drag) img{cursor:move}</style><img alt="">';
  const img = lsh.querySelector('img');

  // ---------- панель ----------
  const host = document.createElement(PANEL_TAG);
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = `<style>
    :host{all:initial}
    .p{font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 32px rgba(17,24,39,.18);width:300px;overflow:hidden}
    .h{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f5f3ff;border-bottom:1px solid #ede9fe;cursor:move;user-select:none}
    .h b{flex:1;font-size:13px}
    .h button{border:0;background:transparent;cursor:pointer;font-size:14px;padding:2px 5px;border-radius:6px}
    .h button:hover{background:#ede9fe}
    .b{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
    .min .b{display:none}
    .drop{border:1.5px dashed #c4b5fd;border-radius:10px;padding:12px;text-align:center;color:#5b21b6;cursor:pointer;background:#faf5ff}
    .drop.over{background:#ede9fe}
    .drop small{display:block;color:#6b7280;margin-top:3px}
    .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .row label{display:flex;align-items:center;gap:4px}
    select,input[type=number]{font:inherit;font-size:12.5px;border:1px solid #d1d5db;border-radius:7px;padding:3px 5px;background:#fff;color:#111827}
    input[type=number]{width:58px}
    input[type=range]{flex:1;accent-color:#7c3aed}
    button.btn{font:inherit;font-size:12.5px;border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:4px 9px;cursor:pointer;color:#111827}
    button.btn:hover{background:#f9fafb}
    button.btn.on{background:#ede9fe;border-color:#a78bfa;color:#5b21b6}
    button.pri{background:#7c3aed;border-color:#7c3aed;color:#fff}
    button.pri:hover{background:#6d28d9}
    .meta{color:#6b7280;font-size:12px}
    .hint{color:#6b7280;font-size:11.5px}
    .sep{height:1px;background:#f3f4f6;margin:2px 0}
    .warn{color:#b45309;font-size:12px}
    .t{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:10px;font:13px system-ui,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none}
    .t.v{opacity:1}
  </style>
  <div class="p">
    <div class="h" id="h"><b>🎨 Сравнение с макетом</b><button id="eye" title="Скрыть/показать макет (Alt+H)">👁</button><button id="min" title="Свернуть">▁</button><button id="x" title="Закрыть">✕</button></div>
    <div class="b">
      <div class="row" id="pick-row"><select id="pick" style="flex:1"></select></div>
      <label class="drop" id="drop"><input type="file" id="file" accept="image/*" hidden><b>🖼 Загрузить макет</b><small>Экспортированный из Figma PNG или JPG: перетащите сюда или вставьте Ctrl+V</small></label>
      <div id="ctl">
        <div class="meta" id="meta"></div>
        <div class="row" style="margin-top:6px"><label>Масштаб макета <select id="scale"><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option></select></label><button class="btn" id="fit" title="Поменять ширину окна так, чтобы страница была шириной с макет"></button></div>
        <div class="warn" id="wwarn"></div>
        <div class="sep"></div>
        <div class="row"><span>Прозрачность</span><input type="range" id="op" min="0" max="100"><span id="opv" style="width:34px;text-align:right"></span></div>
        <div class="row"><label>Режим <select id="mode"><option value="normal">Поверх</option><option value="difference">Разница</option></select></label><span class="hint" id="mhint"></span></div>
        <div class="row"><label>X <input type="number" id="dx"></label><label>Y <input type="number" id="dy"></label><button class="btn" id="zero" title="Сбросить сдвиг">⟲</button></div>
        <div class="row"><button class="btn" id="lock"></button><button class="btn" id="fixed"></button></div>
        <div class="hint">Стрелки — сдвиг на 1 px, Shift+стрелка — 10 px. Alt+H — скрыть или показать макет.</div>
        <div class="sep"></div>
        <div class="row"><button class="btn pri" id="report">🐞 В отчёт</button><button class="btn" id="del" title="Удалить этот макет">🗑</button></div>
      </div>
    </div>
  </div><div class="t" id="t"></div>`;
  const $ = (id) => sh.getElementById(id);
  if (globalThis.QAI18N) QAI18N.ready.then(() => QAI18N.watch(sh));

  let tt;
  function toast(s) { const t = $('t'); t.textContent = s; t.classList.add('v'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('v'), 2600); }

  // ---------- «разница»: фон страницы ----------
  // Фон холста (когда у html/body нет своего фона) не участвует в смешивании —
  // пустые места остаются белыми. На время режима задаём странице явный фон.
  let bgSaved = null;
  const transp = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  function pageBg(on) {
    const H = document.documentElement, B = document.body;
    if (on && !bgSaved && B) {
      bgSaved = { h: H.style.backgroundColor, b: B.style.backgroundColor, m: B.style.minHeight };
      const hc = getComputedStyle(H).backgroundColor, bc = getComputedStyle(B).backgroundColor;
      const c = !transp(bc) ? bc : !transp(hc) ? hc : '#ffffff';
      H.style.setProperty('background-color', c, 'important');
      B.style.setProperty('background-color', c, 'important');
      if (!B.style.minHeight) B.style.minHeight = '100vh';
    } else if (!on && bgSaved && B) {
      H.style.backgroundColor = bgSaved.h; B.style.backgroundColor = bgSaved.b; B.style.minHeight = bgSaved.m;
      bgSaved = null;
    }
  }

  // ---------- отрисовка ----------
  function apply() {
    const show = item && !hidden;
    pageBg(!!(show && st.mode === 'difference'));
    if (!show) { layer.remove(); }
    else {
      if (!layer.isConnected) document.documentElement.appendChild(layer);
      if (img.dataset.id !== item.id) { img.src = item.img; img.dataset.id = item.id; }
      const w = Math.round(item.w / (st.scale || 1));
      img.style.width = w + 'px';
      layer.style.position = st.fixed ? 'fixed' : 'absolute';
      layer.style.left = st.x + 'px';
      layer.style.top = st.y + 'px';
      layer.style.opacity = String(st.mode === 'difference' ? 1 : st.op / 100);
      layer.style.mixBlendMode = st.mode === 'difference' ? 'difference' : 'normal';
      layer.style.pointerEvents = st.locked ? 'none' : 'auto';
      layer.classList.toggle('drag', !st.locked);
    }
    renderPanel();
  }
  function renderPanel() {
    sh.querySelector('.p').classList.toggle('min', !!(st && st.min));
    $('pick-row').hidden = store.items.length < 2;
    $('pick').innerHTML = store.items.map((x) => `<option value="${x.id}" ${item && x.id === item.id ? 'selected' : ''}></option>`).join('');
    [...$('pick').options].forEach((o, i) => (o.textContent = `${store.items[i].name} · ${store.items[i].w}×${store.items[i].h}`));
    $('ctl').hidden = !item;
    $('drop').querySelector('b').textContent = item ? '🖼 Другой макет' : '🖼 Загрузить макет';
    $('eye').textContent = hidden ? '🙈' : '👁';
    if (!item) return;
    const w = Math.round(item.w / (st.scale || 1));
    $('meta').textContent = `${item.name} · ${item.w}×${item.h} px → ${w} px на странице`;
    $('scale').value = String(st.scale || 1);
    $('fit').textContent = innerWidth === w ? `✓ Окно ${w} px` : `↔ Окно под ${w} px`;
    $('fit').classList.toggle('on', innerWidth === w);
    $('wwarn').textContent = innerWidth !== w ? `Ширина страницы сейчас ${innerWidth} px, а макета — ${w} px: вёрстка может отличаться только из-за ширины.` : '';
    $('op').value = st.op; $('opv').textContent = st.op + '%';
    $('op').disabled = st.mode === 'difference';
    $('mode').value = st.mode;
    $('mhint').textContent = st.mode === 'difference' ? 'совпадает — чёрное, расхождения светятся' : '';
    $('dx').value = st.x; $('dy').value = st.y;
    $('lock').textContent = st.locked ? '🔒 Страница кликабельна' : '✋ Двигать макет мышкой';
    $('lock').classList.toggle('on', !st.locked);
    $('fixed').textContent = st.fixed ? '📌 Закреплён на экране' : '📜 Прокручивается со страницей';
    $('fixed').classList.toggle('on', st.fixed);
  }

  // ---------- загрузка макета ----------
  function guessScale(w) {
    // типичные ширины экспорта @2x/@3x: 2880 (1440), 2560 (1280), 750/780/828 (375–414), 1125/1170/1179/1242/1284/1290 (@3x)
    if ([1125, 1170, 1179, 1242, 1284, 1290, 1206, 1320].includes(w)) return 3;
    if (w >= 2400 || [720, 750, 780, 786, 828, 860].includes(w)) return 2;
    return 1;
  }
  function readFile(f) {
    if (!f || !/^image\//.test(f.type)) { toast('Нужна картинка: PNG или JPG'); return; }
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = async () => {
        const it = { id: 'd' + Date.now().toString(36), name: (f.name || 'Макет из буфера').replace(/\.(png|jpe?g|webp)$/i, ''), img: r.result, w: im.naturalWidth, h: im.naturalHeight };
        store.items.unshift(it);
        store.items = store.items.slice(0, 12); // не копим бесконечно
        item = it;
        st = { ...defState(), id: it.id, scale: guessScale(it.w) };
        hidden = false;
        await save();
        apply();
        const w = Math.round(it.w / st.scale);
        toast(innerWidth !== w ? `Макет ${w} px, страница ${innerWidth} px — нажмите «↔ Окно под ${w} px»` : '✓ Макет наложен');
      };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  }
  $('file').onchange = (e) => { readFile(e.target.files[0]); e.target.value = ''; };
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    if (!host.isConnected) return;
    const f = [...(e.clipboardData || {}).items || []].find((x) => x.kind === 'file' && /^image\//.test(x.type));
    if (!f) return;
    const a = document.activeElement;
    if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName))) return;
    e.preventDefault();
    readFile(f.getAsFile());
  }, true);

  // ---------- управление ----------
  const set = async (k, v) => { st[k] = v; await save(); apply(); };
  $('pick').onchange = async (e) => { item = store.items.find((x) => x.id === e.target.value); st = { ...(store.byPath[pathKey()] && store.byPath[pathKey()].id === item.id ? store.byPath[pathKey()] : { ...defState(), scale: guessScale(item.w) }), id: item.id }; await save(); apply(); };
  $('scale').onchange = (e) => set('scale', +e.target.value);
  $('op').oninput = (e) => { st.op = +e.target.value; apply(); };
  $('op').onchange = () => save();
  $('mode').onchange = (e) => set('mode', e.target.value);
  $('dx').onchange = (e) => set('x', Math.round(+e.target.value || 0));
  $('dy').onchange = (e) => set('y', Math.round(+e.target.value || 0));
  $('zero').onclick = async () => { st.x = 0; st.y = 0; await save(); apply(); };
  $('lock').onclick = () => set('locked', !st.locked);
  $('fixed').onclick = () => {
    // при переключении сохраняем положение на экране
    st.y = st.fixed ? st.y + Math.round(scrollY) : st.y - Math.round(scrollY);
    set('fixed', !st.fixed);
  };
  $('eye').onclick = () => { hidden = !hidden; apply(); };
  $('min').onclick = () => set('min', !st.min);
  $('x').onclick = () => close();
  $('del').onclick = async () => {
    if (!confirm(`Удалить макет «${item.name}»?`)) return;
    store.items = store.items.filter((x) => x !== item);
    for (const [p, s] of Object.entries(store.byPath)) if (s.id === item.id) delete store.byPath[p];
    item = store.items[0] || null;
    st = { ...defState(), id: item && item.id, scale: item ? guessScale(item.w) : 1 };
    await save();
    apply();
  };
  $('fit').onclick = async () => {
    const w = Math.round(item.w / (st.scale || 1));
    const r = await chrome.runtime.sendMessage({ type: 'design-fit', width: w, inner: innerWidth, outer: outerWidth }).catch(() => null);
    if (!r || r.ok === false) toast((r && r.error) || 'Не удалось поменять размер окна');
    else if (r.note) toast(r.note);
    setTimeout(renderPanel, 400);
    setTimeout(renderPanel, 1200);
  };
  $('report').onclick = async () => {
    $('report').disabled = true;
    host.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const w = Math.round(item.w / (st.scale || 1));
    const comment = `Расхождение с макетом «${item.name}» (${w} px${st.mode === 'difference' ? ', режим «разница»' : `, прозрачность ${st.op}%`}${st.x || st.y ? `, сдвиг ${st.x}, ${st.y}` : ''}). Опишите, что не совпадает: `;
    const r = await chrome.runtime.sendMessage({ type: 'design-report', comment, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) } }).catch((e) => ({ ok: false, error: e.message }));
    host.style.visibility = '';
    $('report').disabled = false;
    toast(r && r.ok ? `✓ Скриншот с наложением — в отчёт (пометка #${r.n}). Комментарий можно дописать в отчёте.` : (r && r.error) || 'Не получилось');
  };

  // перетаскивание панели
  (() => {
    let sx, sy, ox, oy, dragging = false;
    $('h').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = host.getBoundingClientRect(); ox = r.left; oy = r.top;
      $('h').setPointerCapture(e.pointerId);
    });
    $('h').addEventListener('pointermove', (e) => {
      if (!dragging) return;
      host.style.left = Math.max(0, Math.min(innerWidth - 60, ox + e.clientX - sx)) + 'px';
      host.style.top = Math.max(0, Math.min(innerHeight - 40, oy + e.clientY - sy)) + 'px';
      host.style.right = 'auto'; host.style.bottom = 'auto';
    });
    $('h').addEventListener('pointerup', () => { dragging = false; });
  })();
  // перетаскивание макета мышкой (когда не заблокирован)
  (() => {
    let sx, sy, ox, oy, on = false;
    img.addEventListener('pointerdown', (e) => { if (st.locked) return; on = true; sx = e.clientX; sy = e.clientY; ox = st.x; oy = st.y; img.setPointerCapture(e.pointerId); e.preventDefault(); });
    img.addEventListener('pointermove', (e) => { if (!on) return; st.x = ox + Math.round(e.clientX - sx); st.y = oy + Math.round(e.clientY - sy); apply(); });
    img.addEventListener('pointerup', () => { if (on) { on = false; save(); } });
  })();
  // клавиши: стрелки — сдвиг, Alt+H — скрыть
  const onKey = (e) => {
    if (!host.isConnected || !item) return;
    const a = e.composedPath()[0];
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (e.altKey && (e.code === 'KeyH')) { e.preventDefault(); hidden = !hidden; apply(); return; }
    if (hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const d = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!mv) return;
    e.preventDefault();
    e.stopPropagation();
    st.x += mv[0]; st.y += mv[1];
    apply();
    clearTimeout(onKey.t); onKey.t = setTimeout(save, 400);
  };
  window.addEventListener('keydown', onKey, true);
  addEventListener('resize', () => { clearTimeout(renderPanel.t); renderPanel.t = setTimeout(renderPanel, 150); });

  function close() { pageBg(false); layer.remove(); host.remove(); }
  async function show() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    try { store = (await chrome.storage.local.get(SKEY))[SKEY] || { items: [], byPath: {} }; } catch (_) {}
    st = store.byPath[pathKey()] || null;
    item = (st && store.items.find((x) => x.id === st.id)) || store.items[0] || null;
    if (!st || !item || st.id !== item.id) st = { ...defState(), id: item && item.id, scale: item ? guessScale(item.w) : 1 };
    hidden = false;
    apply();
  }
  globalThis.__qaDesign = { show };
  show();
})();
