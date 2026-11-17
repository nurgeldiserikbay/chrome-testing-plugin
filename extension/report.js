const X = window.QAExport;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };

let R = null; // текущий отчёт
let shots = {}; // n -> dataURL
let mediaBlobs = {}; // key -> Blob
let tab = 'actions';
let filters = { console: 'all', network: 'all' };

// ================= загрузка =================
async function init() {
  const all = (await QADB.all('reports')).sort((a, b) => b.startTime - a.startTime);
  renderList(all);
  const id = new URLSearchParams(location.search).get('id') || (all[0] && all[0].id);
  if (!id) { $('#empty').hidden = false; return; }
  R = await QADB.get('reports', id);
  if (!R) { $('#empty').hidden = false; return; }
  for (const a of R.annotations) shots[a.n] = await QADB.get('blobs', a.shotKey);
  for (const v of [...R.videos, ...R.voice]) {
    const b = await QADB.get('blobs', v.key);
    if (b) mediaBlobs[v.key] = b;
  }
  if (!R.fields) {
    R.fields = { title: '', severity: 'Значительный', priority: '', steps: autoSteps(), expected: '', actual: '', notes: '' };
    saveR();
  }
  $('#report').hidden = false;
  renderAll();
}

function renderList(all) {
  const cur = new URLSearchParams(location.search).get('id') || (all[0] && all[0].id);
  $('#list').innerHTML = all.length
    ? all
        .map((r) => {
          const t = (r.fields && r.fields.title) || (r.annotations[0] && r.annotations[0].comment) || r.meta.title || 'Без названия';
          const d = new Date(r.startTime).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `<a class="item ${r.id === cur ? 'on' : ''}" href="?id=${r.id}"><b>${esc(short(t, 60))}</b><small>${r.active ? '<span class="live">● идёт · </span>' : ''}${d} · ${r.annotations.length} пом.</small><button class="del" data-id="${r.id}" title="Удалить">×</button></a>`;
        })
        .join('')
    : '<div class="muted" style="padding:0 8px">Пусто</div>';
  $('#list').onclick = async (e) => {
    const b = e.target.closest('.del');
    if (!b) return;
    e.preventDefault();
    if (!confirm('Удалить этот баг-репорт вместе со скриншотами и видео?')) return;
    await QADB.del('reports', b.dataset.id);
    await QADB.delPrefix('blobs', b.dataset.id + '_');
    location.href = 'report.html';
  };
}

let saveT = null;
function saveR() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    // не перетираем данные, пока фиксация ещё идёт в service worker
    if (R.active) {
      const fresh = await QADB.get('reports', R.id);
      if (fresh) { fresh.fields = R.fields; fresh.annotations.forEach((a) => { const m = R.annotations.find((x) => x.n === a.n); if (m) a.comment = m.comment; }); await QADB.put('reports', R.id, fresh); return; }
    }
    await QADB.put('reports', R.id, R);
  }, 400);
}

// ================= шаги =================
function timeline() {
  const ev = [...R.nav.filter((n) => /^(https?|file):/.test(n.url)).map((n) => ({ ...n, kind: 'nav' })), ...R.actions].sort((a, b) => a.ts - b.ts);
  return ev;
}
function autoSteps() {
  const ev = timeline();
  const lines = [];
  let lastUrl = null, last = '';
  const start = ev.find((e) => e.kind === 'nav');
  const firstUrl = (start && start.url) || R.meta.startUrl;
  lines.push(`Открыть ${firstUrl}`);
  lastUrl = firstUrl;
  const items = [...ev.map((e) => ({ ts: e.ts, e })), ...R.annotations.map((a) => ({ ts: a.ts, a }))].sort((x, y) => x.ts - y.ts);
  for (const it of items) {
    let s;
    if (it.a) s = `Наблюдаем: ${it.a.comment || 'см. пометку'} (пометка #${it.a.n})`;
    else if (it.e.kind === 'nav') {
      if (it.e.url === lastUrl) continue;
      lastUrl = it.e.url;
      s = `Перейти на ${it.e.url}`;
    } else s = X.describeAction(it.e);
    if (s === last) continue;
    last = s;
    lines.push(s);
  }
  const keep = lines.length > 30 ? [lines[0], '…', ...lines.slice(-28)] : lines;
  let i = 0;
  return keep.map((l) => (l === '…' ? '…' : `${++i}. ${l}`)).join('\n');
}

// ================= окружение =================
function parseUA(ua) {
  let browser = 'Chrome';
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Microsoft Edge ' + m[1];
  else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = 'Opera ' + m[1];
  else if ((m = ua.match(/YaBrowser\/([\d.]+)/))) browser = 'Яндекс Браузер ' + m[1];
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1];
  let os = 'Неизвестно';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if ((m = ua.match(/Windows NT ([\d.]+)/))) os = 'Windows NT ' + m[1];
  else if ((m = ua.match(/Mac OS X ([\d_]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}
function env() {
  const { browser, os } = parseUA(R.meta.userAgent || '');
  const vp = R.meta.viewport;
  const rows = [
    ['Страница', R.meta.startUrl],
    ['Заголовок страницы', R.meta.title || ''],
  ];
  if (R.meta.endUrl && R.meta.endUrl !== R.meta.startUrl) rows.push(['Страница в конце', R.meta.endUrl]);
  rows.push(
    ['Браузер', browser],
    ['ОС', os + (R.meta.platform ? ` (${R.meta.platform})` : '')],
    ['Размер окна', vp ? `${vp.w}×${vp.h}, масштаб ${vp.dpr}x` : '—'],
    ['Язык браузера', R.meta.language || ''],
    ['Баг зафиксирован', new Date(R.startTime).toLocaleString('ru-RU')],
    ['Длительность фиксации', X.fmtDur((R.endTime || Date.now()) - R.startTime)],
    ['User-Agent', R.meta.userAgent || '']
  );
  return rows;
}

// ================= маскирование =================
const SECRET_H = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-amz-security-token)$/i;
const SECRET_K = 'password|passwd|pwd|pass|token|access_token|refresh_token|id_token|secret|client_secret|api_key|apikey|session|sessionid|otp|pin|cvv|card_number';
const reJson = new RegExp(`("(?:${SECRET_K})"\\s*:\\s*)"[^"]*"`, 'gi');
const reForm = new RegExp(`([?&;\\s]|^)((?:${SECRET_K})=)[^&\\s#]*`, 'gi');
const maskH = (h) => (h ? Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SECRET_H.test(k) ? '••• скрыто •••' : v])) : h);
const maskS = (s) => (s ? String(s).replace(reJson, '$1"•••"').replace(reForm, '$1$2•••') : s);

// ================= модель для экспорта =================
function opts() {
  return {
    console: $('#o-console').value,
    network: $('#o-network').value,
    before: $('#o-before').checked,
    details: $('#o-details').checked,
    mask: $('#o-mask').checked,
    embed: $('#o-embed').checked,
  };
}
const netErr = (e) => e.failed || e.status >= 400;
function filterConsole(list, mode) {
  if (mode === 'none') return [];
  if (mode === 'warn') return list.filter((c) => c.level === 'error' || c.level === 'warn');
  if (mode === 'error') return list.filter((c) => c.level === 'error');
  return list;
}
function filterNet(list, mode) {
  if (mode === 'none') return [];
  if (mode === 'api') return list.filter((e) => ['XHR', 'Fetch', 'EventSource', 'WebSocket'].includes(e.type) || netErr(e));
  if (mode === 'errors') return list.filter(netErr);
  return list;
}
const b64bytes = (dataUrl) => {
  const b = atob(dataUrl.split(',')[1]);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};
const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 0, h: 0 }); i.src = src; });

async function buildModel(o) {
  const st = R.startTime;
  const keep = (e) => o.before || e.ts >= st;
  const anns = [];
  for (const a of R.annotations) {
    const dataUrl = shots[a.n];
    const item = { ...a, rel: a.ts - st, dataUrl, file: `screenshots/pometka-${String(a.n).padStart(2, '0')}.png` };
    if (dataUrl) { item.bytes = b64bytes(dataUrl); Object.assign(item, await imgSize(dataUrl)); }
    anns.push(item);
  }
  const net = filterNet(R.network.filter(keep), o.network).map((e) => {
    const x = { ...e, rel: e.ts - st };
    if (o.mask) { x.reqHeaders = maskH(e.reqHeaders); x.resHeaders = maskH(e.resHeaders); x.url = maskS(e.url); x.postData = maskS(e.postData); x.body = maskS(e.body); }
    if (!o.details) { delete x.reqHeaders; delete x.resHeaders; delete x.postData; delete x.body; }
    return x;
  });
  const media = (arr, kind) => arr.filter((v) => mediaBlobs[v.key]).map((v) => ({ ...v, rel: v.start - st, durationMs: (v.end || Date.now()) - v.start, size: mediaBlobs[v.key].size, file: `media/${kind}-${v.n}.webm` }));
  const f = R.fields;
  return {
    title: f.title || 'Баг-репорт',
    severity: f.severity, priority: f.priority, steps: f.steps, expected: f.expected, actual: f.actual, notes: f.notes,
    createdAt: new Date(st).toLocaleString('ru-RU'),
    generatedAt: new Date().toLocaleString('ru-RU'),
    env: env(),
    annotations: anns,
    actions: timeline().filter(keep).map((a) => ({ rel: a.ts - st, text: a.kind === 'nav' ? 'Переход: ' + (o.mask ? maskS(a.url) : a.url) : X.describeAction(a), page: a.page || a.url || '' })),
    console: filterConsole(R.console.filter(keep), o.console).map((c) => ({ ...c, rel: c.ts - st, text: o.mask ? maskS(c.text) : c.text })),
    network: net,
    videos: media(R.videos, 'video'),
    voice: media(R.voice, 'voice'),
    details: o.details,
  };
}

// ================= экспорт =================
const baseName = () => {
  const d = new Date(R.startTime);
  const p = (n) => String(n).padStart(2, '0');
  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i' };
  const slug = (R.fields.title || '')
    .toLowerCase()
    .replace(/./g, (c) => (c in TR ? TR[c] : c))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `bug_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}${slug ? '_' + slug : ''}`;
};
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());

function consoleTxt(m) {
  return m.console.map((c) => `[${X.fmtRel(c.rel)}] ${c.level.toUpperCase()} ${c.text}${c.loc ? '  @ ' + c.loc : ''}`).join('\n');
}
async function mediaFiles(m) {
  const files = [];
  for (const v of [...m.videos, ...m.voice]) files.push({ name: v.file, data: await blobBytes(mediaBlobs[v.key]) });
  return files;
}

async function doExport(kind) {
  const st = $('#ex-status');
  const btns = document.querySelectorAll('[data-ex]');
  btns.forEach((b) => (b.disabled = true));
  st.textContent = 'Готовлю файл…';
  try {
    const o = opts();
    const m = await buildModel(o);
    const base = baseName();
    if (kind === 'docx') {
      download(X.exportDOCX(m), base + '.docx');
      if (m.videos.length || m.voice.length) st.textContent = 'Word сохранён. Видео и голос в .docx не встраиваются — используйте «Всё одним архивом» или скачайте их под плеером.';
      else st.textContent = 'Готово: ' + base + '.docx';
    } else if (kind === 'md') {
      const files = [{ name: 'report.md', data: X.exportMarkdown(m) }];
      m.annotations.forEach((a) => a.bytes && files.push({ name: a.file, data: a.bytes }));
      files.push(...(await mediaFiles(m)));
      if (m.network.length) files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(m), null, 2) });
      if (m.console.length) files.push({ name: 'console.log', data: consoleTxt(m) });
      download(QAZip.makeZip(files), base + '_markdown.zip');
      st.textContent = 'Готово: report.md + скриншоты, медиа и HAR в архиве';
    } else if (kind === 'html') {
      const media = {};
      if (o.embed) for (const v of [...m.videos, ...m.voice]) media[v.file] = await blobToDataUrl(mediaBlobs[v.key]);
      download(new Blob([X.exportHTML(m, media)], { type: 'text/html' }), base + '.html');
      st.textContent = 'Готово: один HTML-файл' + (o.embed && Object.keys(media).length ? ' со встроенным видео/голосом' : '');
    } else if (kind === 'har') {
      download(new Blob([JSON.stringify(X.exportHAR(m), null, 2)], { type: 'application/json' }), base + '.har');
      st.textContent = 'Готово: HAR открывается в DevTools → Network → Import';
    } else if (kind === 'all') {
      const files = [
        { name: 'report.docx', data: await blobBytes(X.exportDOCX(m)) },
        { name: 'report.html', data: X.exportHTML(m, {}) },
        { name: 'report.md', data: X.exportMarkdown(m) },
      ];
      m.annotations.forEach((a) => a.bytes && files.push({ name: a.file, data: a.bytes }));
      files.push(...(await mediaFiles(m)));
      files.push({ name: 'network.har', data: JSON.stringify(X.exportHAR(m), null, 2) });
      files.push({ name: 'console.log', data: consoleTxt(m) });
      download(QAZip.makeZip(files), base + '.zip');
      st.textContent = 'Готово: Word + HTML + Markdown + скриншоты + медиа + HAR';
    }
  } catch (e) {
    console.error(e);
    st.textContent = 'Ошибка экспорта: ' + e.message;
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ================= отрисовка =================
function renderAll() {
  const f = R.fields;
  $('#f-title').value = f.title;
  $('#f-severity').value = f.severity;
  $('#f-priority').value = f.priority || '';
  $('#f-steps').value = f.steps;
  $('#f-expected').value = f.expected;
  $('#f-actual').value = f.actual;
  $('#f-notes').value = f.notes || '';
  $('#created').textContent = 'Зафиксирован ' + new Date(R.startTime).toLocaleString('ru-RU') + ' · ' + short(R.meta.startUrl, 80);
  document.title = (f.title || 'Баг-репорт') + ' — QA Bug Recorder';

  const warns = [];
  if (R.active) warns.push('Фиксация этого бага ещё идёт. Нажмите «✓ Готово» на панели на странице, затем обновите отчёт.');
  if (R.meta.truncated) warns.push('Часть записей не сохранена: превышен лимит объёма.');
  if (R.meta.cdpError) warns.push('Полный захват сети не включился: ' + R.meta.cdpError);
  [...R.videos, ...R.voice].filter((v) => v.error).forEach((v) => warns.push('Ошибка записи: ' + v.error));
  $('#banner').hidden = !warns.length;
  $('#banner').innerHTML = warns.map(esc).join('<br>');

  renderMedia();
  renderAnns();
  renderTab();
  ['actions', 'console', 'network'].forEach((k) => {
    const n = k === 'actions' ? timeline().length : R[k].length;
    const bad = k === 'console' ? R.console.filter((c) => c.level === 'error').length : k === 'network' ? R.network.filter(netErr).length : 0;
    $('#t-' + k).textContent = bad ? `${n} · ${bad} ош.` : n;
    $('#t-' + k).className = 'pill' + (bad ? ' bad' : '');
  });
}

function renderMedia() {
  const items = [];
  for (const v of R.videos) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
    items.push(`<div class="card"><div class="lbl">Видео ${v.n} · ${X.fmtDur((v.end || Date.now()) - v.start)} · ${X.fmtSize(b.size)} <button class="link" data-dl="${v.key}" data-name="video-${v.n}.webm">⬇ скачать</button></div><video controls preload="metadata" data-key="${v.key}" data-start="${v.start}"></video></div>`);
  }
  for (const v of R.voice) {
    const b = mediaBlobs[v.key];
    if (!b) continue;
    items.push(`<div class="card"><div class="lbl">🎤 Голос ${v.n} · ${X.fmtRel(v.start - R.startTime)} · ${X.fmtDur((v.end || Date.now()) - v.start)} <button class="link" data-dl="${v.key}" data-name="voice-${v.n}.webm">⬇ скачать</button></div><audio controls data-key="${v.key}"></audio></div>`);
  }
  $('#media-sec').hidden = !items.length;
  $('#media').innerHTML = items.join('');
  $('#media').querySelectorAll('video,audio').forEach((el) => {
    el.src = URL.createObjectURL(mediaBlobs[el.dataset.key]);
    // у WebM из MediaRecorder нет длительности — «прокручиваем» один раз, чтобы работала перемотка
    el.addEventListener('loadedmetadata', function fix() {
      el.removeEventListener('loadedmetadata', fix);
      if (el.duration === Infinity) {
        el.currentTime = 1e101;
        el.addEventListener('timeupdate', function back() { el.removeEventListener('timeupdate', back); el.currentTime = 0; });
      }
    });
  });
  $('#media').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => download(mediaBlobs[b.dataset.dl], baseName() + '_' + b.dataset.name)));
}

function seekTo(ts) {
  const vids = [...document.querySelectorAll('video[data-start]')];
  const v = vids.find((el) => {
    const rec = R.videos.find((x) => x.key === el.dataset.key);
    return rec && ts >= rec.start && ts <= (rec.end || Infinity);
  });
  if (!v) return false;
  v.currentTime = Math.max(0, (ts - +v.dataset.start) / 1000 - 2);
  v.scrollIntoView({ behavior: 'smooth', block: 'center' });
  v.play().catch(() => {});
  return true;
}

function renderAnns() {
  $('#ann-count').textContent = R.annotations.length;
  if (!R.annotations.length) {
    $('#anns').innerHTML = '<div class="muted">Пометок нет. На странице используйте 🎯 Элемент, ➚ Стрелка, ▭ Область или 💬 Заметка.</div>';
    return;
  }
  $('#anns').innerHTML = R.annotations
    .map((a) => `<div class="ann">
      ${shots[a.n] ? `<img src="${shots[a.n]}" data-n="${a.n}" alt="">` : ''}
      <div class="ab">
        <div class="ah"><span class="num">${a.n}</span><span class="chip">${X.KIND_RU[a.kind] || a.kind}</span>
          <span class="chip time" data-ts="${a.ts}" title="Перейти к моменту в видео">${X.fmtRel(a.ts - R.startTime)}</span>
          <button class="rm" data-rm="${a.n}" title="Удалить пометку">🗑</button></div>
        <textarea rows="2" data-c="${a.n}" placeholder="Комментарий">${esc(a.comment)}</textarea>
        ${a.element ? `<div class="sel" title="CSS-селектор элемента">${esc(a.element.selector)}<br>&lt;${esc(a.element.tag)}&gt; ${Math.round(a.element.rect.w)}×${Math.round(a.element.rect.h)}${a.element.text ? ' · «' + esc(short(a.element.text, 80)) + '»' : ''}</div>` : ''}
        <div class="url">${esc(a.url)}</div>
      </div></div>`)
    .join('');
  $('#anns').querySelectorAll('img').forEach((i) => (i.onclick = () => { $('#lightbox img').src = i.src; $('#lightbox').hidden = false; }));
  $('#anns').querySelectorAll('[data-c]').forEach((t) => (t.oninput = () => { R.annotations.find((a) => a.n === +t.dataset.c).comment = t.value; saveR(); }));
  $('#anns').querySelectorAll('.time').forEach((c) => (c.onclick = () => { if (!seekTo(+c.dataset.ts)) c.title = 'Видео на этот момент нет'; }));
  $('#anns').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Удалить пометку #' + b.dataset.rm + '?')) return;
    const a = R.annotations.find((x) => x.n === +b.dataset.rm);
    R.annotations = R.annotations.filter((x) => x !== a);
    await QADB.del('blobs', a.shotKey);
    saveR();
    renderAnns();
  }));
}

function relCell(ts) { return `<td class="mono">${X.fmtRel(ts - R.startTime)}</td>`; }
function dividerRow(cols) { return `<tr class="divider"><td colspan="${cols}">▼ нажато «Нашёл баг»</td></tr>`; }

function withDivider(list, cols, rowFn) {
  let out = '', placed = false;
  for (const e of list) {
    if (!placed && e.ts >= R.startTime) { out += dividerRow(cols); placed = true; }
    out += rowFn(e);
  }
  if (!placed && list.length) out += dividerRow(cols);
  return out;
}

function renderTab() {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const q = $('#search').value.trim().toLowerCase();
  const match = (...parts) => !q || parts.some((p) => String(p || '').toLowerCase().includes(q));
  const body = $('#tabbody');

  if (tab === 'actions') {
    const list = timeline().filter((a) => match(a.url, a.text, a.label, a.value, a.selector));
    body.innerHTML = `<div class="tf"><span class="muted">Клики, ввод и переходы. «−» — до нажатия «Нашёл баг». Пароли не сохраняются.</span></div>` + (list.length
      ? `<table><tr><th style="width:80px">Время</th><th>Действие</th><th style="width:34%">Элемент / страница</th></tr>${withDivider(list, 3, (a) =>
          `<tr class="${a.ts < R.startTime ? 'before' : ''}">${relCell(a.ts)}<td>${esc(a.kind === 'nav' ? 'Переход: ' + a.url : X.describeAction(a))}</td><td class="u mono">${esc(a.kind === 'nav' ? a.title || '' : a.selector || '')}</td></tr>`)}</table>`
      : '<div class="zero">Действий нет. Сбор идёт с момента загрузки страницы после установки расширения.</div>');
  } else if (tab === 'console') {
    const lv = filters.console;
    const list = R.console.filter((c) => (lv === 'all' || (lv === 'warn' ? ['warn', 'error'].includes(c.level) : c.level === lv)) && match(c.text, c.loc, c.source));
    body.innerHTML =
      `<div class="tf">${[['all', 'Все'], ['error', 'Ошибки'], ['warn', 'Предупр. и ошибки'], ['log', 'Лог'], ['info', 'Инфо']].map(([k, t]) => `<button data-f="${k}" class="${lv === k ? 'on' : ''}">${t}</button>`).join('')}</div>` +
      (list.length
        ? `<table><tr><th style="width:80px">Время</th><th style="width:90px">Уровень</th><th>Сообщение</th><th style="width:24%">Источник</th></tr>${withDivider(list, 4, (c) =>
            `<tr class="${c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : ''} ${c.ts < R.startTime ? 'before' : ''}">${relCell(c.ts)}<td>${X.LEVEL_RU[c.level] || c.level}</td><td class="mono msg">${esc(short(c.text, 4000))}</td><td class="u mono">${esc(c.loc || c.source || '')}</td></tr>`)}</table>`
        : '<div class="zero">Нет записей</div>');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filters.console = b.dataset.f; renderTab(); }));
  } else if (tab === 'network') {
    const fm = filters.network;
    const list = R.network.filter((e) => (fm === 'all' || (fm === 'api' ? ['XHR', 'Fetch'].includes(e.type) : netErr(e))) && match(e.url, e.method, e.status, e.body));
    body.innerHTML =
      `<div class="tf">${[['all', 'Все'], ['api', 'XHR / Fetch'], ['errors', 'Ошибки 4xx/5xx/сбои']].map(([k, t]) => `<button data-f="${k}" class="${fm === k ? 'on' : ''}">${t}</button>`).join('')}<span class="muted" style="margin-left:auto">Клик по строке — заголовки и тело</span></div>` +
      (list.length
        ? `<table><tr><th style="width:80px">Время</th><th style="width:60px">Метод</th><th style="width:64px">Статус</th><th style="width:60px">Тип</th><th>URL</th><th style="width:80px">Время отв.</th><th style="width:70px">Размер</th></tr>${withDivider(list, 7, (e) =>
            `<tr class="click ${netErr(e) ? 'err' : ''} ${e.ts < R.startTime ? 'before' : ''}" data-id="${esc(e.id)}">${relCell(e.ts)}<td>${esc(e.method)}</td><td><b>${esc(X.statusLabel(e))}</b></td><td>${esc(e.type || '')}</td><td class="u mono">${esc(short(e.url, 260))}${e.error ? '<br>' + esc(e.error) : ''}</td><td>${X.fmtDur(e.duration)}</td><td>${X.fmtSize(e.size)}</td></tr>`)}</table>`
        : '<div class="zero">Нет запросов</div>');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filters.network = b.dataset.f; renderTab(); }));
    body.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => {
      if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('det')) { tr.nextElementSibling.remove(); return; }
      const e = R.network.find((x) => x.id === tr.dataset.id);
      const h = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
      const d = document.createElement('tr');
      d.className = 'det';
      d.innerHTML = `<td colspan="7"><div class="dlbl">URL</div><pre>${esc(e.url)}</pre>
        ${e.reqHeaders ? `<div class="dlbl">Заголовки запроса</div><pre>${esc(h(e.reqHeaders))}</pre>` : ''}
        ${e.postData ? `<div class="dlbl">Тело запроса</div><pre>${esc(e.postData)}</pre>` : ''}
        ${e.resHeaders ? `<div class="dlbl">Заголовки ответа</div><pre>${esc(h(e.resHeaders))}</pre>` : ''}
        ${e.body ? `<div class="dlbl">Ответ</div><pre>${esc(e.body)}</pre>` : ''}</td>`;
      tr.after(d);
    }));
  } else {
    body.innerHTML = `<div class="tf"><span class="muted">Окружение определено автоматически</span></div><table>${env().map(([k, v]) => `<tr><th style="width:230px;position:static">${esc(k)}</th><td class="u">${esc(v)}</td></tr>`).join('')}</table>`;
  }
}

// ================= события =================
const bindField = (id, key) => ($(id).oninput = () => {
  R.fields[key] = $(id).value;
  if (key === 'title') document.title = ($(id).value || 'Баг-репорт') + ' — QA Bug Recorder';
  saveR();
});
bindField('#f-title', 'title');
bindField('#f-steps', 'steps');
bindField('#f-expected', 'expected');
bindField('#f-actual', 'actual');
bindField('#f-notes', 'notes');
$('#f-severity').onchange = () => { R.fields.severity = $('#f-severity').value; saveR(); };
$('#f-priority').onchange = () => { R.fields.priority = $('#f-priority').value; saveR(); };
$('#regen').onclick = () => {
  if ($('#f-steps').value.trim() && !confirm('Заменить текущие шаги автоматически собранными?')) return;
  $('#f-steps').value = R.fields.steps = autoSteps();
  saveR();
};
document.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => doExport(b.dataset.ex)));
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTab(); }));
$('#search').oninput = () => renderTab();
$('#lightbox').onclick = () => ($('#lightbox').hidden = true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true; });

// сохраняем выбор опций экспорта
const OPT_IDS = ['o-console', 'o-network', 'o-before', 'o-details', 'o-mask', 'o-embed'];
chrome.storage.local.get('qa_export_opts').then(({ qa_export_opts: s }) => {
  if (s) OPT_IDS.forEach((id) => { const el = document.getElementById(id); if (id in s) el.type === 'checkbox' ? (el.checked = s[id]) : (el.value = s[id]); });
});
OPT_IDS.forEach((id) => (document.getElementById(id).onchange = () => {
  const s = {};
  OPT_IDS.forEach((i) => { const el = document.getElementById(i); s[i] = el.type === 'checkbox' ? el.checked : el.value; });
  chrome.storage.local.set({ qa_export_opts: s });
}));

init();
