const $ = (q) => document.querySelector(q);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (m) => chrome.runtime.sendMessage(m).catch(() => ({}));
const params = new URLSearchParams(location.search);
const srcTab = +params.get('tab') || null;
const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? ms + ' мс' : (ms / 1000).toFixed(1).replace('.0', '') + ' с');
const fmtDate = (t) => new Date(t).toLocaleString((globalThis.QAI18N ? QAI18N.locale() : 'ru-RU'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const plural = (n, a, b, c) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c}`;
const slug = (s) => String(s || 'test').toLowerCase().replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya' }[c] || '')).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'test';
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function lightbox(src) {
  const d = document.createElement('div');
  d.className = 'lb';
  d.innerHTML = `<img src="${src}">`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

// ================= вкладки =================
function showTab() {
  const t = (location.hash || '#tests').slice(1);
  document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.id !== t));
  document.querySelectorAll('.tabs a[data-t]').forEach((a) => a.classList.toggle('on', a.dataset.t === t));
}
window.addEventListener('hashchange', showTab);
showTab();

// ================= 🤖 автотесты =================
const STEP_RU = { click: 'Клик', fill: 'Ввод', select: 'Выбор', check: 'Отметка', press: 'Клавиша', goto: 'Переход', assertVisible: '✓ Виден', assertText: '✓ Текст', assertValue: '✓ Значение', assertUrl: '✓ Адрес', assertHidden: '✓ Скрыт' };
const EDITABLE = { fill: 'value', select: 'value', assertText: 'value', assertValue: 'value', assertUrl: 'value', goto: 'url' };
let tests = [], runs = [], RUN = null, openIds = new Set(), shownRun = null;
const getTests = async () => ((await chrome.storage.local.get('qa_tests')).qa_tests || []);
async function saveTests() { await chrome.storage.local.set({ qa_tests: tests }); }
async function loadAll() {
  const st = await chrome.storage.local.get(['qa_tests', 'qa_test_runs', 'qa_test_opts']);
  tests = st.qa_tests || [];
  runs = st.qa_test_runs || [];
  const o = st.qa_test_opts || {};
  $('#opt-errors').checked = o.failOnErrors !== false;
  $('#opt-timeout').value = String(o.timeout || 10);
  const r = await send({ type: 'tests-state' });
  RUN = r && r.run;
  renderTests();
  renderRun();
  renderHist();
}
const saveOpts = () => chrome.storage.local.set({ qa_test_opts: { failOnErrors: $('#opt-errors').checked, timeout: +$('#opt-timeout').value } });
$('#opt-errors').onchange = saveOpts;
$('#opt-timeout').onchange = saveOpts;

function lastBadge(t) {
  if (RUN && RUN.status === 'running') {
    const r = RUN.results.find((x) => x.sid === t.id);
    if (r && (r.status === 'running' || r.status === 'queued')) return `<span class="badge b-${r.status}">${r.status === 'running' ? '⏳ идёт' : 'в очереди'}</span>`;
  }
  if (!t.last) return '<span class="badge b-none">не запускался</span>';
  return t.last.status === 'passed'
    ? `<span class="badge b-passed" title="${fmtDate(t.last.ts)}">✓ прошёл · ${fmtMs(t.last.ms)}</span>`
    : `<span class="badge b-failed" title="${fmtDate(t.last.ts)}">✗ упал${t.last.failedStep ? ' на шаге ' + t.last.failedStep : ''}</span>`;
}
function stepDesc(s) {
  if (s.type === 'goto') return '';
  if (s.type === 'press') return `${s.key} в ${s.desc || ''}`;
  if (s.type === 'check') return `${s.desc || ''} → ${s.value ? 'включить' : 'выключить'}`;
  return s.desc || '';
}
function renderTests() {
  const box = $('#tests-list');
  if (!tests.length) {
    box.innerHTML = '<div class="empty">Сценариев пока нет. Запишите первый: укажите начальную страницу выше и нажмите «● Записать новый сценарий».</div>';
    return;
  }
  box.innerHTML = tests.map((t) => `<div class="tc" data-id="${t.id}">
    <div class="tc-h"><input type="checkbox" class="sel" ${t.sel === false ? '' : 'checked'}>
      <span class="nm" title="${esc(t.startUrl)}">${esc(t.name)}</span>
      <span class="meta">${plural(t.steps.length, 'шаг', 'шага', 'шагов')} · ${plural(t.steps.filter((s) => /^assert/.test(s.type)).length, 'проверка', 'проверки', 'проверок')}</span>
      ${lastBadge(t)}
      <span class="acts"><button data-a="run" title="Запустить">▶</button><button data-a="edit" title="Шаги и редактирование">${openIds.has(t.id) ? '▴ Шаги' : '▾ Шаги'}</button><button data-a="dup" title="Дублировать">⧉</button><button data-a="pw" title="Скачать тест Playwright">⬇ .spec</button><button data-a="del" title="Удалить">🗑</button></span></div>
    ${openIds.has(t.id) ? `<div class="steps">
      <label style="margin:0 0 8px">Название<input class="name-in" value="${esc(t.name)}"></label>
      <div class="st-r"><span class="i">0</span><span class="k">Открыть</span><span class="d" title="${esc(t.startUrl)}">${esc(t.startUrl)}</span><input data-start value="${esc(t.startUrl)}"><span></span></div>
      ${t.steps.map((s, i) => `<div class="st-r ${s.off ? 'off' : ''}" data-i="${i}"><span class="i">${i + 1}</span><span class="k ${/^assert/.test(s.type) ? 'as' : ''}">${STEP_RU[s.type] || s.type}</span>
        <span class="d" title="${esc((s.loc || []).map((l) => l.css || 'текст: ' + l.text).join('\n'))}">${esc(stepDesc(s))}${s.loc && s.loc[0] ? `<br><span class="loc">${esc(s.loc[0].css || 'текст «' + s.loc[0].text + '»')}</span>` : ''}</span>
        ${EDITABLE[s.type] ? `<input data-v="${EDITABLE[s.type]}" type="${s.secret ? 'password' : 'text'}" value="${esc(s[EDITABLE[s.type]])}">` : '<span></span>'}
        <span class="x"><button data-s="up" title="Выше">↑</button><button data-s="down" title="Ниже">↓</button><button data-s="off" title="${s.off ? 'Включить шаг' : 'Пропускать шаг'}">${s.off ? '▶' : '⏸'}</button><button data-s="del" title="Удалить шаг">✕</button></span></div>`).join('')}
    </div>` : ''}
  </div>`).join('');
}
$('#tests-list').addEventListener('click', async (e) => {
  const tc = e.target.closest('.tc');
  if (!tc) return;
  const t = tests.find((x) => x.id === tc.dataset.id);
  const a = e.target.closest('[data-a]');
  const sb = e.target.closest('[data-s]');
  if (a) {
    const act = a.dataset.a;
    if (act === 'run') return run([t.id]);
    if (act === 'edit') { openIds.has(t.id) ? openIds.delete(t.id) : openIds.add(t.id); return renderTests(); }
    if (act === 'dup') { tests.splice(tests.indexOf(t) + 1, 0, { ...JSON.parse(JSON.stringify(t)), id: 't' + Date.now().toString(36), name: t.name + ' (копия)', last: null }); await saveTests(); return renderTests(); }
    if (act === 'pw') return download(new Blob([toPlaywright(t)], { type: 'text/plain' }), slug(t.name) + '.spec.ts');
    if (act === 'del') { if (!confirm(`Удалить сценарий «${t.name}»?`)) return; tests = tests.filter((x) => x !== t); await saveTests(); return renderTests(); }
  }
  if (sb) {
    const i = +sb.closest('.st-r').dataset.i;
    const s = t.steps[i];
    if (sb.dataset.s === 'del') t.steps.splice(i, 1);
    if (sb.dataset.s === 'off') s.off = !s.off;
    if (sb.dataset.s === 'up' && i > 0) [t.steps[i - 1], t.steps[i]] = [t.steps[i], t.steps[i - 1]];
    if (sb.dataset.s === 'down' && i < t.steps.length - 1) [t.steps[i + 1], t.steps[i]] = [t.steps[i], t.steps[i + 1]];
    t.updated = Date.now();
    await saveTests();
    renderTests();
  }
});
$('#tests-list').addEventListener('change', async (e) => {
  const tc = e.target.closest('.tc');
  if (!tc) return;
  const t = tests.find((x) => x.id === tc.dataset.id);
  if (e.target.classList.contains('sel')) t.sel = e.target.checked;
  else if (e.target.classList.contains('name-in')) t.name = e.target.value.trim() || t.name;
  else if (e.target.hasAttribute('data-start')) t.startUrl = e.target.value.trim() || t.startUrl;
  else if (e.target.dataset.v) t.steps[+e.target.closest('.st-r').dataset.i][e.target.dataset.v] = e.target.value;
  t.updated = Date.now();
  await saveTests();
  if (e.target.classList.contains('name-in')) renderTests();
});

$('#rec-go').onclick = async () => {
  let u = $('#rec-url').value.trim();
  if (!u) { $('#rec-url').focus(); $('#rec-url').placeholder = 'Укажите адрес страницы, с которой начинается сценарий'; return; }
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  await chrome.storage.local.set({ qa_last_rec_url: u });
  const r = await send({ type: 'rec-start-url', url: u });
  if (r && r.ok === false) alert(r.error);
};
chrome.storage.local.get('qa_last_rec_url').then((o) => { if (o.qa_last_rec_url) $('#rec-url').value = o.qa_last_rec_url; });

async function run(ids) {
  if (RUN && RUN.status === 'running') return;
  shownRun = null;
  await send({ type: 'tests-run', ids });
}
$('#run-sel').onclick = () => { const ids = tests.filter((t) => t.sel !== false).map((t) => t.id); if (!ids.length) return alert('Отметьте сценарии галочками'); run(ids); };
$('#run-all').onclick = () => run(tests.map((t) => t.id));
$('#run-stop').onclick = () => send({ type: 'tests-stop' });

chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === 'qa-test-progress') {
    RUN = m.run;
    if (RUN.status !== 'running') loadAll();
    else { renderRun(); renderTests(); }
  }
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.qa_tests && !(RUN && RUN.status === 'running')) { tests = ch.qa_tests.newValue || []; renderTests(); }
});

const ICON = { passed: '✓', failed: '✗', skipped: '–', off: '⏸', queued: '·', running: '⏳' };
async function runHTML(r, forExport) {
  const tl = await getTests();
  const parts = [];
  for (const res of r.results) {
    const t = tl.find((x) => x.id === res.sid);
    const steps = [];
    for (let i = 0; i < res.steps.length; i++) {
      const sr = res.steps[i], s = t && t.steps[i];
      let img = '';
      if (sr.shotKey) { const d = await QADB.get('blobs', sr.shotKey).catch(() => null); if (d) img = `<img src="${d}" alt="Скриншот при падении">`; }
      steps.push(`<div class="rs ${sr.status}"><span class="ic">${ICON[sr.status] || ''}</span><span>${i + 1}. ${s ? `${STEP_RU[s.type] || s.type}${stepDesc(s) || s.url ? ': ' + esc(stepDesc(s) || s.url) : ''}${EDITABLE[s.type] && !s.secret && s.type !== 'goto' && !(stepDesc(s) || '').includes(String(s[EDITABLE[s.type]])) ? ' — «' + esc(String(s[EDITABLE[s.type]]).slice(0, 80)) + '»' : ''}` : ''}${sr.ms != null && sr.status !== 'queued' ? ` <span style="color:#9ca3af">${fmtMs(sr.ms)}</span>` : ''}${sr.error ? `<span class="err">${esc(sr.error)}${sr.url ? '<br>Страница: ' + esc(sr.url) : ''}</span>` : ''}</span></div>${img}`);
    }
    const open = forExport || res.status === 'failed' || res.status === 'running';
    parts.push(`<div class="rr"><details ${open ? 'open' : ''}><summary class="rr-h"><span class="badge b-${res.status}">${{ passed: '✓ прошёл', failed: '✗ упал', running: '⏳ идёт', queued: 'в очереди', stopped: 'остановлен' }[res.status] || res.status}</span><b>${esc(res.name)}</b><span style="color:#6b7280">${fmtMs(res.ms)}</span></summary>
      ${res.reason ? `<div class="rs failed"><span class="ic">!</span><span>${esc(res.reason)}</span></div>` : ''}
      <div class="rr-steps">${steps.join('')}</div>
      ${res.errors && res.errors.length ? `<div class="errs"><b>Ошибки во время сценария (${res.errors.length}):</b>${res.errors.map((x) => `<div title="${esc(x.text)}">${x.kind === 'net' ? '🌐' : '⚠️'} ${esc(x.text)}</div>`).join('')}</div>` : ''}</details></div>`);
  }
  return parts.join('');
}
async function renderRun() {
  const box = $('#run-box');
  const r = shownRun || RUN;
  const running = RUN && RUN.status === 'running';
  $('#run-stop').hidden = !running;
  $('#run-sel').disabled = $('#run-all').disabled = running;
  if (!r) { box.innerHTML = ''; return; }
  const done = r.results.filter((x) => !['queued', 'running'].includes(x.status)).length;
  const passed = r.results.filter((x) => x.status === 'passed').length, failed = r.results.filter((x) => x.status === 'failed').length;
  box.innerHTML = `<div class="runbox"><h3>${running && r === RUN ? `⏳ Идёт прогон: ${done} из ${r.results.length}` : `Прогон ${fmtDate(r.ts)}: ${failed ? `<span style="color:#b91c1c">✗ упало ${failed}</span>, ` : ''}<span style="color:#166534">✓ прошло ${passed}</span> из ${r.results.length}${r.end ? ' · ' + fmtMs(r.end - r.ts) : ''}`}</h3>
    ${running && r === RUN ? `<div class="bar-p"><i style="width:${Math.round((done / r.results.length) * 100)}%"></i></div><p class="muted" style="margin:0">Сценарии выполняются в отдельной вкладке — не закрывайте её. Можно смотреть, как идут шаги.</p>` : `<div class="toolbar" style="margin:4px 0 6px"><button data-rh="html">⬇ Отчёт о прогоне (HTML)</button>${shownRun ? '<button data-rh="close">Скрыть</button>' : ''}</div>`}
    ${await runHTML(r)}</div>`;
  box.querySelectorAll('.rr img').forEach((i) => (i.onclick = () => lightbox(i.src)));
  const h = box.querySelector('[data-rh=html]');
  if (h) h.onclick = () => exportRun(r);
  const c = box.querySelector('[data-rh=close]');
  if (c) c.onclick = () => { shownRun = null; renderRun(); };
}
function renderHist() {
  const box = $('#hist');
  box.innerHTML = runs.length ? runs.map((r, i) => `<div class="hrow"><span>${fmtDate(r.ts)}</span><span class="badge b-${r.failed ? 'failed' : 'passed'}">${r.failed ? `✗ упало ${r.failed}` : '✓ все прошли'}</span><span>${r.passed} из ${r.results.length} прошли · ${fmtMs((r.end || r.ts) - r.ts)}</span><span class="sp"></span><button data-h="${i}">Открыть</button><button data-hx="${i}">⬇ HTML</button></div>`).join('') : '<p class="muted">Прогонов ещё не было.</p>';
  box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { shownRun = runs[+b.dataset.h]; renderRun(); window.scrollTo({ top: $('#run-box').offsetTop - 20, behavior: 'smooth' }); }));
  box.querySelectorAll('[data-hx]').forEach((b) => (b.onclick = () => exportRun(runs[+b.dataset.hx])));
}
async function exportRun(r) {
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((x) => x.cssText).join('\n'); } catch (_) { return ''; } }).join('\n');
  const passed = r.results.filter((x) => x.status === 'passed').length;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Прогон автотестов ${fmtDate(r.ts)}</title><style>${css}\nbody{padding:24px}</style></head><body><main class="wide">
    <h1>Прогон автотестов</h1><p>${fmtDate(r.ts)} · прошло ${passed} из ${r.results.length}${r.end ? ' · ' + fmtMs(r.end - r.ts) : ''} · QA Bug Recorder</p>
    <div class="runbox">${await runHTML(r, true)}</div></main></body></html>`;
  download(new Blob([html], { type: 'text/html' }), `autotests_${new Date(r.ts).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.html`);
}

// ---------- экспорт Playwright ----------
function pwLoc(s) {
  const l = (s.loc || [])[0];
  if (!l) return 'page.locator("body")';
  if (l.text) return `page.getByText(${JSON.stringify(l.text)}, { exact: true }).first()`;
  const m = l.css.match(/^\[data-testid="(.+)"\]$/);
  if (m) return `page.getByTestId(${JSON.stringify(m[1])})`;
  return `page.locator(${JSON.stringify(l.css)}).first()`;
}
function toPlaywright(t) {
  const L = [];
  t.steps.forEach((s, i) => {
    if (s.off) return;
    const loc = pwLoc(s);
    const c = `  // ${i + 1}. ${STEP_RU[s.type] || s.type}${s.desc ? ': ' + s.desc.replace(/\n/g, ' ') : ''}`;
    L.push(c);
    if (s.type === 'goto') L.push(`  await page.goto(${JSON.stringify(s.url)});`);
    else if (s.type === 'click') L.push(`  await ${loc}.click();`);
    else if (s.type === 'fill') L.push(s.secret ? `  await ${loc}.fill(process.env.SECRET_${i + 1} ?? ${JSON.stringify(s.value)}); // секрет: лучше передать через переменную окружения` : `  await ${loc}.fill(${JSON.stringify(s.value)});`);
    else if (s.type === 'select') L.push(`  await ${loc}.selectOption(${JSON.stringify(s.value)});`);
    else if (s.type === 'check') L.push(`  await ${loc}.setChecked(${!!s.value});`);
    else if (s.type === 'press') L.push(`  await ${loc}.press(${JSON.stringify(s.key)});`);
    else if (s.type === 'assertVisible') L.push(`  await expect(${loc}).toBeVisible();`);
    else if (s.type === 'assertText') L.push(s.loc && s.loc.length ? `  await expect(${loc}).toContainText(${JSON.stringify(s.value)});` : `  await expect(page.getByText(${JSON.stringify(s.value)}).first()).toBeVisible();`);
    else if (s.type === 'assertValue') L.push(`  await expect(${loc}).toHaveValue(${JSON.stringify(s.value)});`);
    else if (s.type === 'assertUrl') L.push(`  await expect(page).toHaveURL(new RegExp(${JSON.stringify(s.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}));`);
  });
  return `// Сценарий «${t.name}» — записан в QA Bug Recorder ${fmtDate(t.created || Date.now())}
// Запуск: npx playwright test ${slug(t.name)}.spec.ts
import { test, expect } from '@playwright/test';

test(${JSON.stringify(t.name)}, async ({ page }) => {
  // ошибки консоли считаем падением теста — как в расширении
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(${JSON.stringify(t.startUrl)});
${L.join('\n')}

  expect(errors, 'Ошибки в консоли во время сценария').toEqual([]);
});
`;
}
$('#exp-pw').onclick = () => {
  const list = tests.filter((t) => t.sel !== false);
  if (!list.length) return alert('Нет выбранных сценариев');
  const files = list.map((t) => ({ name: 'tests/' + slug(t.name) + '.spec.ts', data: toPlaywright(t) }));
  files.push({ name: 'playwright.config.ts', data: `import { defineConfig } from '@playwright/test';\n\nexport default defineConfig({\n  testDir: './tests',\n  timeout: 60_000,\n  expect: { timeout: 10_000 },\n  use: { headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },\n  reporter: [['html', { open: 'never' }], ['list']],\n});\n` });
  files.push({ name: 'README.md', data: `# Автотесты из QA Bug Recorder\n\n\`\`\`bash\nnpm init -y\nnpm i -D @playwright/test\nnpx playwright install chromium\nnpx playwright test\nnpx playwright show-report\n\`\`\`\n\nТесты можно запускать в любом CI — см. https://playwright.dev/docs/ci\n` });
  download(QAZip.makeZip(files), 'playwright-tests.zip');
};
$('#exp-json').onclick = () => download(new Blob([JSON.stringify({ app: 'qa-bug-recorder', version: 1, tests: tests.map(({ last, sel, ...t }) => t) }, null, 2)], { type: 'application/json' }), 'qa-scenarios.json');
$('#imp-json').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const add = (j.tests || []).map((t) => ({ ...t, id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }));
    if (!add.length) throw new Error('в файле нет сценариев');
    tests = tests.concat(add);
    await saveTests();
    renderTests();
    alert(`Импортировано сценариев: ${add.length}`);
  } catch (err) { alert('Не удалось импортировать: ' + err.message); }
  e.target.value = '';
};

// ================= 🧪 подмена ответов =================
let mocks = [], editing = null;
async function loadMocks() {
  const st = await chrome.storage.local.get(['qa_mocks', 'qa_mocks_on']);
  mocks = st.qa_mocks || [];
  $('#mk-master').checked = st.qa_mocks_on !== false;
  renderMocks();
}
const saveMocks = () => chrome.storage.local.set({ qa_mocks: mocks });
$('#mk-master').onchange = () => chrome.storage.local.set({ qa_mocks_on: $('#mk-master').checked });
const actLabel = (m) => m.action === 'network' ? 'ошибка сети' : m.action === 'delay' ? `задержка ${m.delay} мс` : `ответ ${m.status}${m.delay ? ` через ${m.delay} мс` : ''}`;
function renderMocks() {
  $('#mk-list').innerHTML = mocks.length ? mocks.map((m, i) => `<div class="mk ${m.on ? '' : 'off'}"><label class="switch"><input type="checkbox" data-on="${i}" ${m.on ? 'checked' : ''}><span></span></label>
    <b>${esc(m.method || 'ANY')}</b><span class="u" title="${esc(m.match)}">${esc(m.match)}</span><span class="a">→ ${esc(actLabel(m))}</span><span class="h">${m.host ? esc(m.host) : 'все сайты'}</span>
    <button data-ed="${i}">✎</button><button data-dl="${i}">🗑</button></div>`).join('') : '<div class="empty">Правил пока нет. Выберите запрос справа или заполните форму.</div>';
}
$('#mk-list').addEventListener('change', async (e) => { const i = e.target.dataset.on; if (i != null) { mocks[+i].on = e.target.checked; await saveMocks(); renderMocks(); } });
$('#mk-list').addEventListener('click', async (e) => {
  const ed = e.target.dataset.ed, dl = e.target.dataset.dl;
  if (dl != null) { mocks.splice(+dl, 1); await saveMocks(); renderMocks(); }
  if (ed != null) { fillForm(mocks[+ed]); editing = mocks[+ed].id; $('#mk-form-h').textContent = 'Изменить правило'; $('#mk-save').textContent = 'Сохранить'; window.scrollTo({ top: 0, behavior: 'smooth' }); }
});
function syncForm() {
  $('#mk-respond').hidden = $('#mk-action').value !== 'respond';
  const b = $('#mk-body').value.trim();
  const isJson = /json/.test($('#mk-ct').value);
  let st = '';
  if (isJson && b) { try { JSON.parse(b); st = '✓ корректный JSON'; } catch (err) { st = '⚠ не похоже на корректный JSON: ' + err.message; } }
  $('#mk-json-st').textContent = st;
  $('#mk-json-st').style.color = /⚠/.test(st) ? '#b45309' : '#047857';
}
['mk-action', 'mk-ct'].forEach((id) => ($('#' + id).onchange = syncForm));
$('#mk-body').oninput = syncForm;
function fillForm(m) {
  $('#mk-match').value = m.match || '';
  $('#mk-method').value = m.method || 'ANY';
  $('#mk-action').value = m.action || 'respond';
  $('#mk-delay').value = m.delay || 0;
  $('#mk-status').value = String(m.status || 200);
  $('#mk-ct').value = m.contentType || 'application/json; charset=utf-8';
  $('#mk-host').value = m.host || '';
  $('#mk-body').value = m.body || '';
  syncForm();
}
const PRESETS = {
  500: { action: 'respond', status: 500, body: '{"error": "Internal Server Error"}' },
  401: { action: 'respond', status: 401, body: '{"error": "Unauthorized"}' },
  404: { action: 'respond', status: 404, body: '{"error": "Not Found"}' },
  empty: { action: 'respond', status: 200, body: '[]' },
  slow: { action: 'delay', delay: 5000 },
  net: { action: 'network' },
};
document.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { const p = PRESETS[b.dataset.p]; fillForm({ match: $('#mk-match').value, method: $('#mk-method').value, host: $('#mk-host').value, ...p }); }));
$('#mk-reset').onclick = () => { editing = null; fillForm({}); $('#mk-form-h').textContent = 'Новое правило'; $('#mk-save').textContent = 'Добавить правило'; $('#mk-st').textContent = ''; };
$('#mk-save').onclick = async () => {
  const match = $('#mk-match').value.trim();
  if (!match) { $('#mk-match').focus(); return; }
  const r = {
    id: editing || 'm' + Date.now().toString(36), on: true, match, method: $('#mk-method').value, action: $('#mk-action').value,
    delay: Math.max(0, +$('#mk-delay').value || 0), status: +$('#mk-status').value, contentType: $('#mk-ct').value,
    host: $('#mk-host').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), body: $('#mk-body').value,
  };
  if (r.action === 'delay' && !r.delay) r.delay = 3000;
  const i = mocks.findIndex((m) => m.id === r.id);
  if (i >= 0) mocks[i] = { ...mocks[i], ...r, on: mocks[i].on }; else mocks.unshift(r);
  await saveMocks();
  if (!$('#mk-master').checked) { $('#mk-master').checked = true; await chrome.storage.local.set({ qa_mocks_on: true }); }
  renderMocks();
  $('#mk-st').textContent = '✓ Сохранено. Обновите страницу сайта или повторите действие.';
  $('#mk-st').className = 'st ok';
  $('#mk-reset').onclick();
  $('#mk-st').textContent = '✓ Сохранено. Повторите действие на сайте.';
};
async function loadRequests() {
  if (!srcTab) return;
  const r = await send({ type: 'tab-requests', tabId: srcTab });
  if (!r || !r.list) return;
  let host = '';
  try { host = new URL(r.url).hostname; } catch (_) {}
  $('#req-note').textContent = r.list.length ? `Вкладка: ${r.url}. Нажмите на запрос, чтобы подставить его в форму вместе с настоящим ответом.` : `На вкладке ${r.url} пока не было запросов fetch/XHR. Выполните действие на сайте и нажмите «Обновить».`;
  $('#req-list').innerHTML = r.list.map((q, i) => `<div class="rq" data-i="${i}"><span class="m">${esc(q.method)}</span><span class="s ${q.failed || q.status >= 400 ? 'e' : ''}">${q.mocked ? '🧪' : ''}${q.failed ? 'ош.' : q.status || '…'}</span><span class="u" title="${esc(q.url)}">${esc(q.url.replace(/^https?:\/\/[^/]+/, ''))}</span></div>`).join('') + '<div style="margin-top:8px"><button id="req-refresh">↻ Обновить</button></div>';
  $('#req-list').querySelectorAll('.rq').forEach((el) => (el.onclick = () => {
    const q = r.list[+el.dataset.i];
    let path = q.url;
    try { const u = new URL(q.url); path = u.pathname; } catch (_) {}
    let body = q.body || '';
    try { body = JSON.stringify(JSON.parse(body), null, 2); } catch (_) {}
    editing = null;
    $('#mk-form-h').textContent = 'Новое правило';
    $('#mk-save').textContent = 'Добавить правило';
    fillForm({ match: path, method: q.method, action: 'respond', status: q.status && !q.failed ? q.status : 200, contentType: /json/.test(q.mime || '') || /^[[{]/.test(body.trim()) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', body, host });
    $('#mk-body').focus();
  }));
  const rb = $('#req-refresh');
  if (rb) rb.onclick = loadRequests;
}
syncForm();

loadAll();
loadMocks();
loadRequests();
