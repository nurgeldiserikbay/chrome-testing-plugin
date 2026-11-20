const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = globalThis.QAApi;
const SEV_RU = { critical: '🟠 Критично', major: '🟡 Значительно', minor: '🔵 Незначительно', trivial: '⚪ Мелочь' };
const V_RU = { pass: '✓ ок', warn: '⚠ замечания', fail: '✗ ошибка', skip: '– пропущено' };
const fmtDate = (t) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
let projects = [], cur = null, sub = 'env', lastRun = null, running = null, openEp = new Set();

async function load() {
  const { qa_api } = await chrome.storage.local.get('qa_api');
  projects = (qa_api && qa_api.projects) || [];
}
const save = () => chrome.storage.local.set({ qa_api: { projects } });
const P = () => projects.find((p) => p.id === cur);

// ================= список проектов =================
function renderProjects() {
  $('#projects').innerHTML = projects.map((p) => `<button class="pj ${p.id === cur ? 'on' : ''}" data-p="${p.id}"><b>${esc(p.name)}</b><small>${p.spec.kind === 'postman' ? 'Postman' : 'OpenAPI'} · ${p.spec.endpoints.length} эндп.${p.last ? ' · ' + (p.last.fail ? `✗ ${p.last.fail}` : '✓') : ''}</small></button>`).join('');
  $$('#projects [data-p]').forEach((b) => (b.onclick = () => openProject(b.dataset.p)));
}
function showPane(which) {
  $('#imp').hidden = which !== 'imp';
  $('#proj').hidden = which !== 'proj';
  $('#empty').hidden = which !== 'empty';
}
async function openProject(id) {
  cur = id;
  renderProjects();
  showPane('proj');
  lastRun = (await QADB.get('blobs', 'apirun_' + id).catch(() => null)) || null;
  renderHead();
  renderEnv();
  renderEps();
  renderChains();
  renderRes();
  setSub(lastRun && sub === 'res' ? 'res' : sub === 'res' ? 'env' : sub);
  chrome.storage.local.set({ qa_api_last: id });
}
function setSub(s) {
  sub = s;
  $$('nav.sub a').forEach((a) => a.classList.toggle('on', a.dataset.s === s));
  ['env', 'eps', 'chains', 'res'].forEach((k) => ($('#s-' + k).hidden = k !== s));
}
$$('nav.sub a').forEach((a) => (a.onclick = () => setSub(a.dataset.s)));
function renderHead() {
  const p = P();
  $('#p-title').textContent = p.name;
  $('#p-meta').textContent = `${p.spec.kind === 'postman' ? 'Коллекция Postman' : 'OpenAPI'}${p.spec.version ? ' ' + p.spec.version : ''} · ${p.spec.endpoints.length} эндпоинтов · импортирован ${fmtDate(p.created)}`;
  $('#p-mode').textContent = p.env.testStand ? '🧪 Тестовый стенд: все запросы' : '👁 Только чтение (GET)';
  $('#p-mode').className = 'mode' + (p.env.testStand ? '' : ' ro');
  $('#n-eps').textContent = p.spec.endpoints.length;
  $('#n-ch').textContent = (p.chains || []).length;
  $('#n-res').textContent = lastRun ? (A.issues(lastRun).length || '✓') : '';
}

// ================= импорт =================
const openImport = () => { showPane('imp'); $('#imp-st').textContent = ''; };
$('#imp-open').onclick = openImport;
$('#empty-imp').onclick = openImport;
let reimportFor = null;
async function doImport(text, src) {
  const st = $('#imp-st');
  try {
    const spec = A.importSpec(text);
    if (!spec.endpoints.length) throw new Error('В спецификации нет эндпоинтов');
    if (reimportFor) {
      const p = projects.find((x) => x.id === reimportFor);
      p.spec = spec;
      p.chains = (p.chains || []).filter((c) => !c.auto).concat(A.crudChains(spec), A.postmanChain(spec));
      p.updated = Date.now();
      reimportFor = null;
      await save();
      return openProject(p.id);
    }
    const p = {
      id: 'p' + Date.now().toString(36), name: spec.title, created: Date.now(), src: src || '',
      spec, chains: A.crudChains(spec).concat(A.postmanChain(spec)), unsel: [], overrides: {},
      env: { baseUrl: spec.base && /^https?:/.test(spec.base) ? spec.base : '', testStand: false, timeout: 15, delay: 0, auth: { type: 'none' }, headers: [], vars: Object.entries(spec.vars || {}).filter(([k]) => k !== spec.baseVar).map(([key, value]) => ({ key, value })) },
    };
    if (spec.kind === 'postman' && spec.auth && spec.auth.type === 'bearer') { const t = (spec.auth.bearer || []).find((x) => x.key === 'token'); p.env.auth = { type: 'bearer', token: t ? t.value : '' }; }
    projects.unshift(p);
    await save();
    st.textContent = '';
    await openProject(p.id);
    setSub('env');
  } catch (e) {
    st.textContent = '✗ ' + e.message;
    st.className = 'st bad';
  }
}
$('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (f) await doImport(await f.text(), f.name); e.target.value = ''; };
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) await doImport(await f.text(), f.name); };
$('#imp-go').onclick = () => doImport($('#imp-text').value, 'вставлено');
$('#imp-url-go').onclick = async () => {
  const u = $('#imp-url').value.trim();
  if (!u) return;
  $('#imp-st').textContent = 'Загружаю…';
  try { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); await doImport(await r.text(), u); }
  catch (e) { $('#imp-st').textContent = '✗ Не удалось загрузить: ' + e.message; $('#imp-st').className = 'st bad'; }
};
$('#p-reimport').onclick = () => { reimportFor = cur; openImport(); $('#imp-st').textContent = 'Загрузите новую версию спецификации — окружение и ваши цепочки сохранятся.'; };
$('#p-dup').onclick = async () => { const p = JSON.parse(JSON.stringify(P())); p.id = 'p' + Date.now().toString(36); p.name += ' (копия)'; p.last = null; projects.unshift(p); await save(); openProject(p.id); };
$('#p-del').onclick = async () => { if (!confirm(`Удалить проект «${P().name}»?`)) return; await QADB.del('blobs', 'apirun_' + cur).catch(() => {}); projects = projects.filter((p) => p.id !== cur); await save(); cur = null; renderProjects(); showPane(projects.length ? 'imp' : 'empty'); if (projects[0]) openProject(projects[0].id); };

// ================= окружение =================
const linesToKV = (t, sep) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return i > 0 ? { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : null; }).filter(Boolean);
function renderEnv() {
  const e = P().env;
  $('#e-base').value = e.baseUrl || '';
  $('#e-servers').innerHTML = (P().spec.servers || []).map((s) => `<option value="${esc(s)}">`).join('');
  $('#e-stand').checked = !!e.testStand;
  $('#e-timeout').value = e.timeout || 15;
  $('#e-delay').value = e.delay || 0;
  const a = e.auth || { type: 'none' };
  $('#a-type').value = a.type;
  $('#a-token').value = a.token || '';
  $('#a-user').value = a.user || '';
  $('#a-pass').value = a.pass || '';
  $('#a-name').value = a.name || '';
  $('#a-key').value = a.key || '';
  $('#a-where').value = a.where || 'header';
  $('#e-headers').value = (e.headers || []).map((h) => `${h.key}: ${h.value}`).join('\n');
  $('#e-vars').value = (e.vars || []).map((v) => `${v.key}=${v.value}`).join('\n');
  syncAuth();
}
function syncAuth() { $$('[data-a]').forEach((el) => (el.hidden = el.dataset.a !== $('#a-type').value)); }
async function saveEnv() {
  const e = P().env;
  e.baseUrl = $('#e-base').value.trim();
  e.timeout = Math.max(1, +$('#e-timeout').value || 15);
  e.delay = Math.max(0, +$('#e-delay').value || 0);
  e.auth = { type: $('#a-type').value, token: $('#a-token').value.trim(), user: $('#a-user').value, pass: $('#a-pass').value, name: $('#a-name').value.trim(), key: $('#a-key').value.trim(), where: $('#a-where').value };
  e.headers = linesToKV($('#e-headers').value, ':');
  e.vars = linesToKV($('#e-vars').value, '=');
  syncAuth();
  await save();
  renderHead();
  renderEps();
}
['e-base', 'e-timeout', 'e-delay', 'a-token', 'a-user', 'a-pass', 'a-name', 'a-key', 'e-headers', 'e-vars'].forEach((id) => ($('#' + id).onchange = saveEnv));
['a-type', 'a-where'].forEach((id) => ($('#' + id).onchange = saveEnv));
$('#e-stand').onchange = async () => {
  if ($('#e-stand').checked && !confirm(`Включить изменяющие запросы для ${$('#e-base').value || 'этого адреса'}?\n\nРасширение будет создавать, изменять и удалять данные через POST, PUT, PATCH и DELETE. Делайте это только на тестовом стенде, не на проде.`)) { $('#e-stand').checked = false; return; }
  P().env.testStand = $('#e-stand').checked;
  await save();
  renderHead();
  renderEps();
};
$('#a-tab').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: 'tab-auth', baseUrl: $('#e-base').value.trim() }).catch(() => null);
  const st = $('#a-st');
  if (!r || !r.ok) { st.textContent = '✗ ' + ((r && r.error) || 'Не получилось'); st.className = 'st bad'; return; }
  const a = r.auth;
  $('#a-type').value = a.type;
  if (a.token) $('#a-token').value = a.token;
  if (a.user) { $('#a-user').value = a.user; $('#a-pass').value = a.pass || ''; }
  if (a.name) { $('#a-name').value = a.name; $('#a-key').value = a.key; $('#a-where').value = 'header'; }
  await saveEnv();
  st.textContent = `✓ ${r.note || 'Найдено'} — из запроса ${r.from.slice(0, 80)}`;
  st.className = 'st ok';
};

// ================= эндпоинты =================
const authOn = () => P().env.auth && P().env.auth.type !== 'none';
function effSpec(p) {
  const s = JSON.parse(JSON.stringify(p.spec));
  for (const [id, ex] of Object.entries(p.overrides || {})) { const e = s.endpoints.find((x) => x.id === id); if (e && e.body) e.body.example = ex; }
  return s;
}
function renderEps() {
  const p = P();
  const q = ($('#ep-filter').value || '').toLowerCase();
  const eps = effSpec(p).endpoints.filter((e) => !q || `${e.method} ${e.path} ${e.summary} ${e.tag}`.toLowerCase().includes(q));
  const unsel = new Set(p.unsel || []);
  const opts = { authOn: authOn(), canBadAuth: ['bearer', 'basic', 'apikey'].includes((p.env.auth || {}).type) };
  const groups = new Map();
  eps.forEach((e) => (groups.get(e.tag) || groups.set(e.tag, []).get(e.tag)).push(e));
  let total = 0, runnable = 0;
  $('#eps').innerHTML = [...groups.entries()].map(([tag, list]) => `<div class="tag-h">${esc(tag)}</div>` + list.map((e) => {
    const cs = A.casesFor(e, opts);
    const ok = cs.filter((c) => !c.chainOnly && (!c.destructive || p.env.testStand)).length;
    if (!unsel.has(e.id)) { total += cs.length; runnable += ok; }
    const open = openEp.has(e.id);
    return `<div class="ep" data-id="${esc(e.id)}"><div class="ep-h"><input type="checkbox" ${unsel.has(e.id) ? '' : 'checked'}><span class="mth m-${e.method}">${e.method}</span><span class="pth">${esc(e.path)}</span>${e.secured ? '<span title="Требует авторизации">🔒</span>' : ''}<span class="sm">${esc(e.summary)}${e.deprecated ? ' · устарел' : ''}</span><span class="cnt">${ok} из ${cs.length} проверок</span></div>
      ${open ? `<div class="ep-b"><ul class="cases">${cs.map((c) => `<li class="${c.chainOnly || (c.destructive && !p.env.testStand) ? 'w' : ''}">${esc(c.title)} → <b>${esc(c.expect)}</b>${c.chainOnly ? ' (в цепочке)' : c.destructive && !p.env.testStand ? ' (нужен стенд)' : ''}</li>`).join('')}</ul>
        ${e.body ? `<label>Тело правильного запроса <small>можно поправить — используется во всех проверках этого эндпоинта, {{переменные}} подставляются</small><textarea data-body spellcheck="false">${esc(JSON.stringify(e.body.example != null ? e.body.example : A.sample(e.body.schema || {}), null, 2))}</textarea></label><div class="row"><button data-save-body>Сохранить тело</button><button data-reset-body class="link">Вернуть из спецификации</button><span class="st" data-bst></span></div>` : ''}
        <div class="row"><button data-run-one class="primary">▶ Проверить только этот</button></div></div>` : ''}</div>`;
  }).join('')).join('') || '<div class="empty">Ничего не найдено</div>';
  $('#ep-sum').textContent = `Выбрано проверок: ${runnable}${total > runnable ? ` (ещё ${total - runnable} — только на тестовом стенде или в цепочках)` : ''}`;
}
$('#ep-filter').oninput = renderEps;
$('#eps').addEventListener('click', async (ev) => {
  const box = ev.target.closest('.ep');
  if (!box) return;
  const id = box.dataset.id, p = P();
  if (ev.target.matches('input[type=checkbox]')) {
    const u = new Set(p.unsel || []);
    ev.target.checked ? u.delete(id) : u.add(id);
    p.unsel = [...u];
    await save();
    return renderEps();
  }
  if (ev.target.closest('.ep-h')) { openEp.has(id) ? openEp.delete(id) : openEp.add(id); return renderEps(); }
  if (ev.target.matches('[data-save-body]')) {
    try { p.overrides = p.overrides || {}; p.overrides[id] = JSON.parse(box.querySelector('[data-body]').value); await save(); box.querySelector('[data-bst]').textContent = '✓ Сохранено'; }
    catch (e) { box.querySelector('[data-bst]').textContent = '✗ Не JSON: ' + e.message; }
  }
  if (ev.target.matches('[data-reset-body]')) { if (p.overrides) delete p.overrides[id]; await save(); renderEps(); }
  if (ev.target.matches('[data-run-one]')) start({ endpoints: [id], chains: false });
});
$('#ep-all').onclick = async () => { P().unsel = []; await save(); renderEps(); };
$('#ep-none').onclick = async () => { P().unsel = P().spec.endpoints.map((e) => e.id); await save(); renderEps(); };

// ================= цепочки =================
function epLabel(id) { const e = P().spec.endpoints.find((x) => x.id === id); return e ? `${e.method} ${e.path}` : id; }
function renderChains() {
  const p = P();
  const ch = p.chains || [];
  $('#chains').innerHTML = ch.length ? ch.map((c, ci) => `<div class="ch" data-ci="${ci}">
    <div class="ch-h"><input type="checkbox" data-on ${c.on === false ? '' : 'checked'} title="Запускать"><input class="nm" value="${esc(c.name)}"><button data-ch-del title="Удалить цепочку">🗑</button></div>
    <div class="cs cs-h"><span></span><span>Запрос</span><span>Шаг</span><span>Ожидается</span><span>Извлечь / параметры пути</span><span></span></div>
    ${c.steps.map((s, si) => `<div class="cs" data-si="${si}"><span class="i">${si + 1}</span><span title="${esc(epLabel(s.ep))}"><span class="mth m-${esc(epLabel(s.ep).split(' ')[0])}">${esc(epLabel(s.ep).split(' ')[0])}</span> ${esc(epLabel(s.ep).split(' ').slice(1).join(' '))}</span>
      <input data-f="title" value="${esc(s.title || '')}">
      <select data-f="expect">${['2xx', '200', '201', '204', '4xx', '400', '401/403', '404', '409', '422'].map((x) => `<option ${x === s.expect ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <input data-f="extra" placeholder="id=$.id; {userId}={{users_id}}" value="${esc([(s.extract || []).filter((x) => x.path).map((x) => `${x.var}=${x.path}`).join('; '), Object.entries(s.pathParams || {}).map(([k, v]) => `{${k}}=${v}`).join('; ')].filter(Boolean).join('; '))}">
      <span class="x"><button data-st="up">↑</button><button data-st="down">↓</button><button data-st="del">✕</button></span></div>`).join('')}
    <div class="addstep"><select data-add><option value="">＋ Добавить шаг…</option>${p.spec.endpoints.map((e) => `<option value="${esc(e.id)}">${esc(e.method + ' ' + e.path + (e.summary ? ' — ' + e.summary : ''))}</option>`).join('')}</select></div>
  </div>`).join('') : '<div class="empty">Цепочек нет. Для OpenAPI они создаются автоматически, если есть пара «POST /items» и «GET/PUT/DELETE /items/{id}». Можно собрать свою: «＋ Новая цепочка».</div>';
}
function parseExtra(t) {
  const extract = [], pathParams = {};
  t.split(';').map((x) => x.trim()).filter(Boolean).forEach((x) => {
    const i = x.indexOf('=');
    if (i < 1) return;
    const k = x.slice(0, i).trim(), v = x.slice(i + 1).trim();
    if (/^\{.+\}$/.test(k)) pathParams[k.slice(1, -1)] = v; else extract.push({ var: k, path: v.startsWith('$') ? v : '$.' + v });
  });
  return { extract, pathParams };
}
$('#chains').addEventListener('change', async (ev) => {
  const c = P().chains[+ev.target.closest('.ch').dataset.ci];
  if (ev.target.matches('[data-on]')) c.on = ev.target.checked;
  else if (ev.target.matches('.nm')) c.name = ev.target.value;
  else if (ev.target.matches('[data-add]')) { if (ev.target.value) c.steps.push({ ep: ev.target.value, title: '', expect: '2xx', extract: [] }); }
  else if (ev.target.dataset.f) {
    const s = c.steps[+ev.target.closest('.cs').dataset.si];
    if (ev.target.dataset.f === 'extra') { const r = parseExtra(ev.target.value); s.extract = r.extract.concat((s.extract || []).filter((x) => x.header)); s.pathParams = r.pathParams; }
    else s[ev.target.dataset.f] = ev.target.value;
    if (ev.target.dataset.f === 'expect') s.order = ['404', '409'].includes(ev.target.value) || s.order;
  }
  c.auto = false;
  await save();
  renderChains();
  renderHead();
});
$('#chains').addEventListener('click', async (ev) => {
  const box = ev.target.closest('.ch');
  if (!box) return;
  const p = P(), ci = +box.dataset.ci, c = p.chains[ci];
  if (ev.target.matches('[data-ch-del]')) { if (!confirm(`Удалить цепочку «${c.name}»?`)) return; p.chains.splice(ci, 1); }
  else if (ev.target.dataset.st) {
    const si = +ev.target.closest('.cs').dataset.si, st = ev.target.dataset.st;
    if (st === 'del') c.steps.splice(si, 1);
    if (st === 'up' && si > 0) [c.steps[si - 1], c.steps[si]] = [c.steps[si], c.steps[si - 1]];
    if (st === 'down' && si < c.steps.length - 1) [c.steps[si + 1], c.steps[si]] = [c.steps[si], c.steps[si + 1]];
    c.auto = false;
  } else return;
  await save();
  renderChains();
  renderHead();
});
$('#ch-new').onclick = async () => { P().chains = P().chains || []; P().chains.push({ id: 'c' + Date.now().toString(36), name: 'Моя цепочка', steps: [] }); await save(); renderChains(); renderHead(); };
$('#ch-auto').onclick = async () => { const p = P(); p.chains = (p.chains || []).filter((c) => !c.auto).concat(A.crudChains(p.spec), A.postmanChain(p.spec)); await save(); renderChains(); renderHead(); };

// ================= прогон =================
let ctrl = null;
async function start(o = {}) {
  const p = P();
  if (!p.env.baseUrl && p.spec.kind === 'openapi') { setSub('env'); $('#e-base').focus(); alert('Укажите базовый адрес API'); return; }
  ctrl = new AbortController();
  const proj = { ...p, spec: effSpec(p) };
  const endpoints = o.endpoints || p.spec.endpoints.map((e) => e.id).filter((id) => !(p.unsel || []).includes(id));
  $('#run').disabled = true;
  $('#stop').hidden = false;
  $('#prog').hidden = false;
  setSub('res');
  const tick = (R) => {
    running = R;
    $('#prog i').style.width = Math.round((R.done / Math.max(1, R.total)) * 100) + '%';
    if (R.status === 'running') $('#res').innerHTML = `<div class="card"><b>⏳ Идёт проверка: ${R.done} из ${R.total}</b><p class="muted">Запросы уходят на ${esc(p.env.baseUrl || 'адреса из коллекции')}${p.env.testStand ? ' — включая изменяющие (тестовый стенд)' : ' — только чтение'}.</p></div>`;
  };
  try {
    const R = await A.run(proj, { endpoints, chains: o.chains, signal: ctrl.signal }, tick);
    R.project = { name: p.name, base: p.env.baseUrl, kind: p.spec.kind };
    lastRun = R;
    const s = A.stats(R);
    p.last = { ts: R.ts, fail: s.fail, warn: s.warn, pass: s.pass };
    await save();
    await QADB.put('blobs', 'apirun_' + p.id, R).catch(() => {});
  } finally {
    running = null;
    $('#run').disabled = false;
    $('#stop').hidden = true;
    $('#prog').hidden = true;
    renderProjects();
    renderHead();
    renderRes();
  }
}
$('#run').onclick = () => start();
$('#stop').onclick = () => ctrl && ctrl.abort();

// ================= результаты =================
function reqBlock(x) {
  if (!x.req) return x.reason ? `<div class="rc-b muted">${esc(x.reason)}</div>` : '';
  const pretty = (t) => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch (_) { return t || ''; } };
  return `<div class="rc-b">${(x.problems || []).map((p) => `<div class="pr"><b>${SEV_RU[p.sev] || p.sev}:</b> ${esc(p.text)}${p.detail ? `<pre>${esc(p.detail)}</pre>` : ''}</div>`).join('')}
    <div class="two"><div><b>Запрос</b><pre>${esc(`${x.req.method} ${x.req.url}\n${Object.entries(x.req.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}${x.req.body ? '\n\n' + pretty(x.req.body) : ''}`)}</pre></div>
    <div><b>Ответ</b> ${x.res.status || 'нет'} · ${x.res.ms} мс<pre>${esc(pretty(x.res.body))}</pre></div></div></div>`;
}
function renderRes() {
  const box = $('#res');
  const R = lastRun;
  if (!R) { box.innerHTML = '<div class="empty">Проверок ещё не было. Настройте окружение и нажмите «▶ Запустить проверки».</div>'; return; }
  const s = A.stats(R);
  const iss = A.issues(R);
  const byEp = new Map();
  R.results.forEach((r) => (byEp.get(r.ep) || byEp.set(r.ep, []).get(r.ep)).push(r));
  const worst = (list) => (list.some((x) => x.verdict === 'fail') ? 'fail' : list.some((x) => x.verdict === 'warn') ? 'warn' : list.every((x) => x.verdict === 'skip') ? 'skip' : 'pass');
  box.innerHTML = `<div class="res-h"><h3>Прогон ${fmtDate(R.ts)}${R.status === 'stopped' ? ' (остановлен)' : ''} · ${esc(R.project ? R.project.base || '' : '')} · ${R.writes ? 'тестовый стенд' : 'только чтение'}</h3>
      <button id="ai-api">🤖 Разбор AI</button><button id="exp-html">⬇ HTML</button><button id="exp-md">⬇ Markdown</button></div>
    <div class="kpi"><div class="p"><b>${s.pass}</b><span>прошли</span></div><div class="w"><b>${s.warn}</b><span>с замечаниями</span></div><div class="f"><b>${s.fail}</b><span>с ошибками</span></div><div><b>${s.skip}</b><span>пропущено${R.writes ? '' : ' (нужен стенд)'}</span></div><div><b>${iss.length}</b><span>проблем в API</span></div></div>
    <div id="ai-out"></div>
    <h3>Что не так с API</h3>
    ${iss.length ? iss.map((g) => `<details class="iss"><summary><span class="sv sv-${g.sev}">${SEV_RU[g.sev]}</span><b>${esc(g.title)}</b><span class="n">${g.items.length} ${g.items.length === 1 ? 'случай' : 'случаев'}</span></summary>
      <div class="iss-b"><p><b>Почему это плохо:</b> ${esc(g.why)}</p><p><b>Как исправить:</b> ${esc(g.fix)}</p>
      <ul>${g.items.slice(0, 30).map((it) => `<li><b>${esc(it.ep.replace(/ #\d+$/, ''))}</b> — ${esc(it.where)}: ${esc(it.text)}${it.detail ? `<pre>${esc(it.detail)}</pre>` : ''}</li>`).join('')}${g.items.length > 30 ? `<li>…и ещё ${g.items.length - 30}</li>` : ''}</ul></div></details>`).join('') : '<div class="card">✓ Проблем не найдено.</div>'}
    ${R.chains.length ? `<h3>Цепочки</h3>${R.chains.map((c) => `<details class="rgrp" ${c.verdict === 'fail' ? 'open' : ''}><summary><span class="vv v-${c.verdict}">${V_RU[c.verdict]}</span><span class="pth">${esc(c.name)}</span></summary>
      ${c.steps.map((x, i) => `<details class="rc"><summary><span class="vv v-${x.verdict}">${V_RU[x.verdict]}</span><span class="t">${i + 1}. ${esc(x.title)} <span class="muted">${esc((x.ep || '').replace(/ #\d+$/, ''))}</span></span><span class="muted">${x.res ? `${x.res.status} · ${x.res.ms} мс` : ''}</span></summary>${reqBlock(x)}</details>`).join('')}</details>`).join('')}` : ''}
    <h3>Эндпоинты</h3>
    ${[...byEp.entries()].map(([ep, list]) => `<details class="rgrp"><summary><span class="vv v-${worst(list)}">${V_RU[worst(list)]}</span><span class="pth">${esc(ep.replace(/ #\d+$/, ''))}</span><span class="muted">${list.filter((x) => x.verdict === 'pass').length}/${list.length}</span></summary>
      ${list.map((x) => `<details class="rc"><summary><span class="vv v-${x.verdict}">${V_RU[x.verdict]}</span><span class="t">${esc(x.case)} <span class="muted">→ ${esc(x.expect || '')}</span></span><span class="muted">${x.res ? `${x.res.status || '—'} · ${x.res.ms} мс` : ''}</span></summary>${reqBlock(x)}</details>`).join('')}</details>`).join('')}`;
  $('#exp-html').onclick = () => exportRun('html');
  $('#exp-md').onclick = () => exportRun('md');
  $('#ai-api').onclick = aiSummary;
  if (R.ai) $('#ai-out').innerHTML = aiBox(R.ai);
}
function aiBox(ai) { return `<div class="card aisum" style="background:#faf9ff;border-color:#e4defc"><b style="color:#5b21b6">🤖 Разбор AI</b> <span class="muted">${esc(ai.model)}</span><div>${globalThis.QAExport ? QAExport.mdLite(ai.text) : esc(ai.text).replace(/\n/g, '<br>')}</div></div>`; }
function issuesText(R) {
  const iss = A.issues(R), s = A.stats(R);
  return `API: ${R.project ? R.project.name + ' — ' + R.project.base : ''}\nПроверок: ${s.total}, ок ${s.pass}, с замечаниями ${s.warn}, с ошибками ${s.fail}, пропущено ${s.skip}\n\n` +
    iss.map((g) => `## ${SEV_RU[g.sev]} ${g.title} (${g.items.length})\n${g.items.slice(0, 8).map((it) => `- ${it.ep.replace(/ #\d+$/, '')} — ${it.where}: ${it.text}${it.detail ? ' | ' + it.detail.split('\n')[0] : ''}`).join('\n')}`).join('\n\n');
}
async function aiSummary() {
  const text = issuesText(lastRun);
  const sys = 'Ты — опытный бэкенд-разработчик и QA. Тебе дают итоги автоматической проверки REST API по спецификации. Напиши по-русски, в Markdown, до 300 слов: **Итог** (1–2 предложения о качестве API), **Исправить в первую очередь** (нумерованный список, самое опасное сверху: безопасность, падения 500, приём неверных данных), **Общие причины** (если несколько проблем — следствие одной, например нет валидации на уровне фреймворка), **Рекомендации** (2–4 пункта). Не выдумывай того, чего нет в данных.';
  const s = await QAInt.getAI();
  if (!QAInt.aiReady(s)) { await navigator.clipboard.writeText(sys + '\n\nДанные:\n' + text); alert('AI не подключён (⚙ Интеграции). Запрос скопирован — вставьте его в Claude или ChatGPT.'); return; }
  $('#ai-api').disabled = true;
  $('#ai-api').textContent = '🤖 Думаю…';
  try {
    const r = await QAInt.callAI({ system: sys, text, maxTokens: 1600 });
    lastRun.ai = { text: r.text, model: r.model };
    await QADB.put('blobs', 'apirun_' + cur, lastRun).catch(() => {});
    $('#ai-out').innerHTML = aiBox(lastRun.ai);
  } catch (e) { alert('AI: ' + e.message); }
  finally { $('#ai-api').disabled = false; $('#ai-api').textContent = '🤖 Разбор AI'; }
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function exportRun(kind) {
  const R = lastRun, s = A.stats(R), iss = A.issues(R);
  const nm = `api-check_${new Date(R.ts).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
  if (kind === 'md') {
    let md = `# Проверка API: ${R.project ? R.project.name : ''}\n\n${fmtDate(R.ts)} · ${R.project ? R.project.base : ''} · ${R.writes ? 'тестовый стенд' : 'только чтение'}\n\nПроверок: ${s.total} · ок ${s.pass} · с замечаниями ${s.warn} · с ошибками ${s.fail} · пропущено ${s.skip}\n\n`;
    if (R.ai) md += `## 🤖 Разбор AI\n\n${R.ai.text}\n\n`;
    md += `## Что не так с API\n\n` + (iss.map((g) => `### ${SEV_RU[g.sev]} — ${g.title} (${g.items.length})\n\n**Почему это плохо:** ${g.why}\n\n**Как исправить:** ${g.fix}\n\n${g.items.map((it) => `- \`${it.ep.replace(/ #\d+$/, '')}\` — ${it.where}: ${it.text}${it.detail ? '\n  ```\n  ' + it.detail.replace(/\n/g, '\n  ') + '\n  ```' : ''}`).join('\n')}\n`).join('\n') || 'Проблем не найдено.\n');
    return download(new Blob([md], { type: 'text/markdown' }), nm + '.md');
  }
  const css = [...document.styleSheets].map((x) => { try { return [...x.cssRules].map((r) => r.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
  const tmp = document.createElement('div');
  tmp.innerHTML = $('#res').innerHTML;
  tmp.querySelectorAll('button').forEach((b) => b.remove());
  tmp.querySelectorAll('details.iss').forEach((d) => (d.open = true));
  download(new Blob([`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Проверка API ${esc(R.project ? R.project.name : '')}</title><style>${css}\nbody{padding:24px}</style></head><body><main class="wide"><h1>Проверка API: ${esc(R.project ? R.project.name : '')}</h1>${tmp.innerHTML}<p class="muted">QA Bug Recorder</p></main></body></html>`], { type: 'text/html' }), nm + '.html');
}

// ================= старт =================
(async () => {
  await load();
  renderProjects();
  if (!projects.length) return showPane('empty');
  const { qa_api_last } = await chrome.storage.local.get('qa_api_last');
  openProject(projects.some((p) => p.id === qa_api_last) ? qa_api_last : projects[0].id);
})();
