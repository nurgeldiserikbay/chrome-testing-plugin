const $ = (id) => document.getElementById(id);
const I = globalThis.QAInt;
const status = (el, text, ok) => { $(el).textContent = text; $(el).className = 'st ' + (ok === true ? 'ok' : ok === false ? 'bad' : ''); };

async function initAI() {
  const s = await I.getAI();
  $('ai-provider').innerHTML = Object.entries(I.PROVIDERS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  $('ai-provider').value = s.provider;
  $('ai-key').value = s.key;
  $('ai-model').value = s.model;
  $('ai-base').value = s.baseUrl;
  $('ai-images').checked = s.images;
  const sync = () => {
    const p = I.PROVIDERS[$('ai-provider').value];
    $('ai-model').placeholder = p.model ? 'по умолчанию: ' + p.model : 'например, anthropic/claude-sonnet-5.5';
    $('ai-base-row').hidden = $('ai-provider').value !== 'compat';
    $('ai-keyurl').hidden = !p.keyUrl;
    if (p.keyUrl) $('ai-keyurl').href = p.keyUrl;
  };
  sync();
  const save = async () => {
    sync();
    await I.setAI({ provider: $('ai-provider').value, key: $('ai-key').value.trim(), model: $('ai-model').value.trim(), baseUrl: $('ai-base').value.trim(), images: $('ai-images').checked });
    status('ai-st', 'Сохранено');
  };
  ['ai-provider', 'ai-images'].forEach((id) => ($(id).onchange = save));
  ['ai-key', 'ai-model', 'ai-base'].forEach((id) => ($(id).oninput = save));
  $('ai-eye').onclick = () => { $('ai-key').type = $('ai-key').type === 'password' ? 'text' : 'password'; };
  $('ai-test').onclick = async () => {
    await save();
    $('ai-test').disabled = true;
    status('ai-st', 'Проверяю…');
    try {
      const r = await I.callAI({ system: 'Отвечай одним словом.', text: 'Скажи «работает».', maxTokens: 20 });
      status('ai-st', `✓ Работает (${r.model}): «${r.text.trim().slice(0, 40)}»`, true);
    } catch (e) {
      status('ai-st', '✗ ' + e.message, false);
    } finally {
      $('ai-test').disabled = false;
    }
  };
}

async function initGD() {
  const s = await I.getGD();
  $('gd-redirect').value = I.redirectUrl();
  $('gd-client').value = s.clientId;
  if (!s.clientId) $('howto').open = true;
  $('gd-copy').onclick = async () => { await navigator.clipboard.writeText($('gd-redirect').value); status('gd-st', 'Адрес скопирован', true); };
  $('gd-client').oninput = async () => {
    await I.setGD({ clientId: $('gd-client').value.trim(), folderId: '' });
    await chrome.storage.session.remove('qa_gtoken');
    status('gd-st', 'Сохранено');
  };
  $('gd-test').onclick = async () => {
    $('gd-test').disabled = true;
    status('gd-st', 'Открываю вход в Google…');
    try {
      await I.googleToken(true);
      await I.folderId();
      status('gd-st', '✓ Готово: папка «QA Bug Recorder» на Диске создана', true);
    } catch (e) {
      status('gd-st', '✗ ' + e.message + (/redirect_uri_mismatch/.test(e.message) ? ' — добавьте адрес выше в Authorized redirect URIs' : ''), false);
    } finally {
      $('gd-test').disabled = false;
    }
  };
  $('gd-out').onclick = async () => {
    const { qa_gtoken: t } = await chrome.storage.session.get('qa_gtoken');
    if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + t.token, { method: 'POST' }).catch(() => {});
    await chrome.storage.session.remove('qa_gtoken');
    status('gd-st', 'Вы вышли из Google');
  };
}

initAI();
initGD();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
