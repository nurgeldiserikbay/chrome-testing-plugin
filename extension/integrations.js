// Интеграции: AI-разбор по ключу пользователя и выгрузка в Google Docs.
// Подключается в report.html и settings.html.
(function (g) {
  // ================= настройки =================
  const PROVIDERS = {
    anthropic: { name: 'Claude (Anthropic)', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
    openai: { name: 'OpenAI (ChatGPT)', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
    compat: { name: 'Другой, совместимый с OpenAI API (OpenRouter, Groq, локальная модель…)', model: '', baseUrl: '' },
  };
  const AI_DEF = { provider: 'anthropic', key: '', model: '', baseUrl: '', images: true };
  const GD_DEF = { clientId: '', folderId: '' };

  async function getAI() {
    const { qa_ai } = await chrome.storage.local.get('qa_ai');
    return Object.assign({}, AI_DEF, qa_ai);
  }
  async function setAI(v) { await chrome.storage.local.set({ qa_ai: Object.assign(await getAI(), v) }); }
  async function getGD() {
    const { qa_gdocs } = await chrome.storage.local.get('qa_gdocs');
    return Object.assign({}, GD_DEF, qa_gdocs);
  }
  async function setGD(v) { await chrome.storage.local.set({ qa_gdocs: Object.assign(await getGD(), v) }); }
  const aiReady = (s) => !!(s.key && (s.provider !== 'compat' || (s.baseUrl && s.model)));

  // ================= AI =================
  /** уменьшает скриншот: дешевле и не упирается в лимиты API */
  function shrink(dataUrl, max = 1568) {
    return new Promise((res) => {
      const i = new Image();
      i.onload = () => {
        const k = Math.min(1, max / Math.max(i.naturalWidth, i.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(i.naturalWidth * k); c.height = Math.round(i.naturalHeight * k);
        c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      i.onerror = () => res(null);
      i.src = dataUrl;
    });
  }

  async function callAI({ system, text, image, maxTokens = 2000 }) {
    if (g.QAI18N && QAI18N.lang !== 'ru') { system = QAI18N.T(system) + `\nAlways answer in ${QAI18N.aiLang()}.`; text = QAI18N.T(text); }
    const s = await getAI();
    if (!aiReady(s)) throw new Error('AI не настроен: укажите ключ в «🔌 Интеграции».');
    const p = PROVIDERS[s.provider] || PROVIDERS.anthropic;
    const model = s.model || p.model;
    const img = image && s.images ? await shrink(image) : null;
    let r, j;
    try {
      if (s.provider === 'anthropic') {
        const content = [];
        if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.split(',')[1] } });
        content.push({ type: 'text', text });
        r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': s.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
        });
        j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
        return { text: (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'), model };
      }
      const base = (s.provider === 'openai' ? p.baseUrl : s.baseUrl).replace(/\/+$/, '');
      const content = [{ type: 'text', text }];
      if (img) content.push({ type: 'image_url', image_url: { url: img } });
      r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.key },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
      });
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || 'HTTP ' + r.status);
      return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', model };
    } catch (e) {
      if (/Failed to fetch|NetworkError/i.test(e.message)) throw new Error('нет связи с сервисом AI. Проверьте интернет и адрес API.');
      if (r && r.status === 401) throw new Error('ключ не подошёл (401). Проверьте его в «🔌 Интеграции».');
      throw e;
    }
  }

  const ITEM_SYSTEM = `Ты — опытный QA-инженер и веб-разработчик. Тебе дают данные одного пункта из отчёта о ручном тестировании сайта: замечание тестировщика, автоматически пойманную ошибку консоли/запроса или запись экрана с событиями. Иногда — скриншот страницы.
Оформи из этого баг-репорт и подскажи разработчику, куда смотреть.
Ответь ТОЛЬКО JSON без пояснений и без markdown-обёртки:
{"title": "короткий заголовок бага", "steps": ["шаг 1", "шаг 2"], "expected": "что должно быть", "actual": "что происходит", "cause": "вероятная причина, 1–3 предложения", "side": "frontend | backend | both | unknown", "severity": "blocker | critical | major | minor | trivial", "fix": "что проверить или исправить, 1–3 пункта через перенос строки", "questions": ["что стоит уточнить у тестировщика"]}
Правила: пиши по-русски, коротко и конкретно. Опирайся только на данные. Не выдумывай того, чего нет: если данных мало, так и напиши в cause и задай вопрос в questions. Шаги — по действиям пользователя из данных. severity: blocker — нельзя продолжить работу или потеря данных; critical — ключевая функция сломана; major — функция работает неправильно, но есть обход; minor — неудобство, визуальный дефект; trivial — опечатка, косметика.`;

  const SUMMARY_SYSTEM = `Ты — QA-лид. Тебе дают список пунктов из отчёта о ручном тестировании сайта и итоги автопроверки. Напиши краткое резюме для команды на русском, в Markdown, не длиннее 250 слов:
**Итог** — 1–2 предложения: в каком состоянии проверенная часть.
**Исправить в первую очередь** — нумерованный список, самое серьёзное сверху, с номерами пунктов (например, «Ошибка 2», «Замечание 5»).
**Общие причины** — если несколько пунктов похожи на одну проблему, скажи об этом.
**Остальное** — одной-двумя строками.
Не выдумывай того, чего нет в данных.`;

  function parseJSON(t) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('AI ответил не в том формате. Попробуйте ещё раз.');
    return JSON.parse(t.slice(a, b + 1));
  }

  async function analyzeItem(text, image) {
    const r = await callAI({ system: ITEM_SYSTEM, text, image });
    const j = parseJSON(r.text);
    const SEVS = ['blocker', 'critical', 'major', 'minor', 'trivial'];
    return {
      title: String(j.title || ''),
      steps: Array.isArray(j.steps) ? j.steps.map(String) : [],
      expected: String(j.expected || ''),
      actual: String(j.actual || ''),
      cause: String(j.cause || ''),
      side: ['frontend', 'backend', 'both', 'unknown'].includes(j.side) ? j.side : 'unknown',
      severity: SEVS.includes(j.severity) ? j.severity : '',
      fix: String(j.fix || ''),
      questions: Array.isArray(j.questions) ? j.questions.map(String).filter(Boolean) : [],
      model: r.model,
      at: Date.now(),
    };
  }
  async function summarize(text) {
    const r = await callAI({ system: SUMMARY_SYSTEM, text, maxTokens: 1500 });
    return { text: r.text.trim(), model: r.model, at: Date.now() };
  }
  /** запрос для ручной вставки в Claude/ChatGPT, если ключа нет */
  const promptForChat = (text) => `${ITEM_SYSTEM.replace(/Ответь ТОЛЬКО JSON[\s\S]*?\n\{[\s\S]*?\}\n/, 'Ответь по пунктам: заголовок, шаги воспроизведения, ожидалось, фактически, вероятная причина (фронт или бэк), что исправить, что уточнить.\n')}\n\nДанные:\n\n${text}`;

  const SIDE_RU = { frontend: 'фронтенд', backend: 'бэкенд', both: 'фронтенд и бэкенд', unknown: 'не ясно' };

  // ================= Google Docs =================
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const redirectUrl = () => chrome.identity.getRedirectURL();

  async function googleToken(interactive = true) {
    const { qa_gtoken: t } = await chrome.storage.session.get('qa_gtoken');
    if (t && t.exp > Date.now() + 60000) return t.token;
    const s = await getGD();
    if (!s.clientId) throw new Error('не указан Client ID Google. Настройте в «🔌 Интеграции».');
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: s.clientId, response_type: 'token', redirect_uri: redirectUrl(), scope: SCOPE, include_granted_scopes: 'true', prompt: 'select_account',
    });
    let back;
    try { back = await chrome.identity.launchWebAuthFlow({ url, interactive }); }
    catch (e) { throw new Error('вход в Google не завершён: ' + e.message); }
    const h = new URLSearchParams(new URL(back).hash.slice(1));
    if (h.get('error')) throw new Error('Google: ' + h.get('error'));
    const token = h.get('access_token');
    if (!token) throw new Error('Google не вернул токен доступа');
    await chrome.storage.session.set({ qa_gtoken: { token, exp: Date.now() + (+h.get('expires_in') || 3600) * 1000 } });
    return token;
  }
  async function gfetch(url, init, retry = true) {
    const token = await googleToken();
    const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + token } });
    if (r.status === 401 && retry) { await chrome.storage.session.remove('qa_gtoken'); return gfetch(url, init, false); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Google Drive: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
    return j;
  }
  async function folderId() {
    const s = await getGD();
    if (s.folderId) {
      try { const f = await gfetch(`https://www.googleapis.com/drive/v3/files/${s.folderId}?fields=id,trashed`, {}); if (!f.trashed) return f.id; } catch (_) {}
    }
    const f = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'QA Bug Recorder', mimeType: 'application/vnd.google-apps.folder' }),
    });
    await setGD({ folderId: f.id });
    return f.id;
  }
  /** загружает файл в папку «QA Bug Recorder»; convert: в Google-документ */
  async function upload(blob, name, { convert = false, parent } = {}) {
    const meta = { name, parents: [parent || (await folderId())] };
    if (convert) meta.mimeType = 'application/vnd.google-apps.document';
    const boundary = 'qa' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`,
    ]);
    return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name', {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
    });
  }

  g.QAInt = { PROVIDERS, getAI, setAI, getGD, setGD, aiReady, callAI, analyzeItem, summarize, promptForChat, SIDE_RU, googleToken, upload, folderId, redirectUrl };
})(globalThis);
