const $ = (id) => document.getElementById(id);
const DEF = { bufferMin: 2, videoOnStart: false, tabAudio: false, cdp: false, reactRenders: true, autoErrors: true, ownOnly: true, autoAudit: true };
let st = null;

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const send = (m) => chrome.runtime.sendMessage(m);
function showErr(t) { $('err').textContent = t; $('err').hidden = !t; }

async function loadSettings() {
  const { qa_settings } = await chrome.storage.local.get('qa_settings');
  const s = Object.assign({}, DEF, qa_settings);
  ['videoOnStart', 'tabAudio', 'cdp', 'reactRenders', 'autoErrors', 'ownOnly', 'autoAudit'].forEach((k) => {
    $('s-' + k).checked = !!s[k];
    $('s-' + k).onchange = save;
  });
  $('s-bufferMin').value = String(s.bufferMin);
  $('s-bufferMin').onchange = save;
}
async function save() {
  await chrome.storage.local.set({
    qa_settings: {
      videoOnStart: $('s-videoOnStart').checked,
      tabAudio: $('s-tabAudio').checked,
      cdp: $('s-cdp').checked,
      reactRenders: $('s-reactRenders').checked,
      autoErrors: $('s-autoErrors').checked,
      ownOnly: $('s-ownOnly').checked,
      autoAudit: $('s-autoAudit').checked,
      bufferMin: +$('s-bufferMin').value,
    },
  });
}

async function refresh() {
  st = await send({ type: 'status' });
  $('idle').hidden = st.active;
  $('active').hidden = !st.active;
  if (st.active) {
    $('timer').textContent = fmt(Date.now() - st.startTime);
    $('c-ann').textContent = st.annotations;
    $('c-act').textContent = st.actions;
    $('c-net').textContent = st.network;
    $('c-err').textContent = st.autoErrors;
    $('voice').classList.toggle('rec', st.voice);
    $('voice').textContent = st.voice ? '■ Голос ' + fmt(Date.now() - st.voiceStart) : '🎤 Голос';
    $('video').classList.toggle('rec', st.video);
    $('video').textContent = st.video ? '■ Стоп видео ' + fmt(Date.now() - st.videoStart) : '⏺ Записать видео';
    $('vstate').className = 'vstate' + (st.video ? ' rec' : '');
    $('vstate').textContent = st.video ? '● Идёт запись видео вкладки' : 'Видео не записывается — включите кнопкой «⏺ Записать видео», если нужно';
  }
}

async function bufferInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const { qa_buf } = await chrome.storage.session.get('qa_buf');
    const b = qa_buf && qa_buf[tab.id];
    if (!b) { $('buf').innerHTML = '<span>Буфер пуст — обновите страницу, чтобы начать сбор</span>'; return; }
    const errs = b.console.filter((c) => c.level === 'error').length;
    const netErr = b.network.filter((n) => n.failed || n.status >= 400).length;
    $('buf').innerHTML = `<span>${b.actions.length} действий</span><span>${b.network.length} запросов</span><span>${b.console.length} логов</span>` +
      (errs + netErr ? `<span class="bad">${errs + netErr} ошибок</span>` : '');
  } catch (_) {}
}

$('found').onclick = async () => {
  showErr('');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('found').disabled = true;
  const r = await send({ type: 'start-bug', tabId: tab.id });
  $('found').disabled = false;
  if (r && r.ok === false) { showErr(r.error); return; }
  window.close();
};

document.querySelectorAll('[data-tool]').forEach((b) => {
  b.onclick = async () => { await send({ type: 'tool', tool: b.dataset.tool }); window.close(); };
});

$('voice').onclick = async () => {
  showErr('');
  const r = await send({ type: 'voice-toggle' });
  if (r && r.ok === false) showErr(r.error);
  refresh();
};
$('video').onclick = async () => {
  showErr('');
  let streamId;
  if (!st.video) {
    try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: st.tabId }); } catch (e) { showErr('Не удалось получить доступ к вкладке: ' + e.message); return; }
  }
  const r = await send({ type: 'video-toggle', streamId });
  if (r && r.ok === false) showErr(r.error);
  refresh();
};
$('finish').onclick = async () => { $('finish').disabled = true; await send({ type: 'finish' }); window.close(); };
$('cancel').onclick = async () => {
  if ($('cancel').dataset.armed) { await send({ type: 'cancel' }); refresh(); return; }
  $('cancel').dataset.armed = '1';
  $('cancel').textContent = 'Нажмите ещё раз, чтобы удалить';
};
$('reports').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('report.html') }); window.close(); };
$('intg').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

async function showShortcut() {
  try {
    const c = (await chrome.commands.getAll()).find((x) => x.name === 'found-bug');
    const k = $('keys');
    if (c && c.shortcut) { k.textContent = `${c.shortcut} — начать проверку`; k.classList.remove('warn'); }
    else { k.textContent = '⚠ Горячая клавиша не назначена — настроить'; k.classList.add('warn'); }
  } catch (_) {}
}
$('keys').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

async function showIgnore() {
  const { qa_ignore: list = [] } = await chrome.storage.local.get('qa_ignore');
  const el = $('ign');
  if (!list.length) { el.innerHTML = '<span class="muted2">Игнорируемых ошибок нет. Добавить: ⚠ на панели → 🙈</span>'; return; }
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `<details><summary>🙈 Игнорируется ошибок: ${list.length}</summary><ul>${list.map((x, i) => `<li><span>${escH(x.title)}</span><button data-i="${i}" title="Снова сохранять">✕</button></li>`).join('')}</ul><button class="link" id="ign-clear">Очистить список</button></details>`;
  el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = async () => { list.splice(+b.dataset.i, 1); await chrome.storage.local.set({ qa_ignore: list }); showIgnore(); }));
  $('ign-clear').onclick = async () => { await chrome.storage.local.set({ qa_ignore: [] }); showIgnore(); };
}

// ---------- инструменты ----------
const curTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
$('tests').onclick = async () => { const t = await curTab(); await send({ type: 'open-tools', hash: 'tests', tabId: t && t.id }); window.close(); };
$('apitests').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('api.html') }); window.close(); };
$('mocks').onclick = async () => { const t = await curTab(); await send({ type: 'open-tools', hash: 'mocks', tabId: t && t.id }); window.close(); };
$('rec').onclick = async () => {
  showErr('');
  const t = await curTab();
  const r = await send({ type: 'rec-start', tabId: t.id });
  if (r && r.ok === false) { showErr(r.error); return; }
  window.close();
};
$('rec-cancel').onclick = async () => { const t = await curTab(); await send({ type: 'rec-cancel', tabId: t.id }); recState(); };
async function recState() {
  const t = await curTab();
  if (!t) return;
  const r = await send({ type: 'rec-status', tabId: t.id });
  $('rec-on').hidden = !(r && r.rec);
  $('rec').disabled = !!(r && r.rec);
  if (r && r.rec) $('rec-n').textContent = r.steps + ' шаг.';
}
$('screens').onclick = async () => {
  showErr('');
  const t = await curTab();
  $('screens').disabled = true;
  $('screens').textContent = '📐 Снимаю…';
  const r = await send({ type: 'screens-shot', tabId: t.id });
  $('screens').disabled = false;
  $('screens').textContent = '📐 Экраны';
  if (r && r.ok === false) showErr(r.error);
  else window.close();
};
async function condInit() {
  const t = await curTab();
  if (!t) return;
  const r = await send({ type: 'emu-get', tabId: t.id });
  if (!r || !r.ok) return;
  const fill = (id, obj, val) => { $(id).innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''); $(id).value = String(val); };
  fill('cn-net', r.nets, r.emu.net);
  fill('cn-cpu', r.cpus, r.emu.cpu);
  fill('cn-dev', r.devices, r.emu.device);
  $('cond-l').textContent = r.label ? 'изменены' : 'обычные';
  if (r.label) $('cond').open = true;
  const apply = async () => {
    showErr('');
    const res = await send({ type: 'emu-set', tabId: t.id, conf: { net: $('cn-net').value, cpu: +$('cn-cpu').value, device: $('cn-dev').value } });
    if (res && res.ok === false) showErr(res.error);
    $('cond-l').textContent = res && res.label ? 'изменены' : 'обычные';
  };
  ['cn-net', 'cn-cpu', 'cn-dev'].forEach((id) => ($(id).onchange = apply));
  $('c-reset').onclick = async () => { await send({ type: 'emu-clear', tabId: t.id }); condInit(); };
}
recState();
condInit();

chrome.storage.local.get('qa_lang').then((o) => { $('s-lang').value = o.qa_lang || 'auto'; });
$('s-lang').onchange = async () => { await chrome.storage.local.set({ qa_lang: $('s-lang').value }); location.reload(); };

showIgnore();
showShortcut();
loadSettings();
bufferInfo();
refresh();
setInterval(refresh, 1000);
