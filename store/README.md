# Публикация в Chrome Web Store

Всё, что нужно вставить в форму магазина. Форма на английском, поэтому обоснования разрешений даны по-английски (с переводом).

## 1. Перед отправкой

1. Аккаунт разработчика: https://chrome.google.com/webstore/devconsole — разовый взнос $5.
2. Архив: содержимое папки `extension/` в zip (файл `manifest.json` должен лежать в корне архива). Тот же архив, что скачивается с лендинга.
3. Версия в `manifest.json` должна быть больше предыдущей загруженной.

## 2. Карточка (Store listing)

| Поле | Что вставить |
|---|---|
| Название | берётся из `_locales/*/messages.json` → `QA Bug Recorder` |
| Краткое описание | берётся из `_locales/*/messages.json` → `desc` (до 132 символов, по языкам) |
| Подробное описание | `listing/<язык>.md` — для каждого языка карточки отдельно |
| Категория | Developer Tools |
| Язык по умолчанию | English (в манифесте `default_locale: en`) |
| Иконка 128×128 | `extension/icons/128.png` |
| Скриншоты 1280×800 | `screenshots/en-*.png` для английской карточки, `screenshots/ru-*.png` для русской |
| Сайт | https://nurgeldiserikbay.github.io/chrome-testing-plugin/ |
| Политика конфиденциальности | https://nurgeldiserikbay.github.io/chrome-testing-plugin/privacy.html |

Казахского в списке языков магазина нет — для него используется английская или русская карточка, а интерфейс расширения на казахском включается сам по языку браузера или в настройках.

## 3. Privacy practices

### Single purpose

> QA Bug Recorder helps testers and developers capture, describe and report website bugs: it records the context of the page under test (screenshots, video, console, network, user actions) and turns it into a bug report, and provides related testing tools (site audit, autotests, API tests, response mocking).

(Одно назначение: фиксация и описание багов на сайте плюс связанные инструменты тестирования.)

### Permission justifications

| Permission | Justification |
|---|---|
| `tabs` | Needed to find the tab under test, open the report and tools pages, and attach the bug panel to the tab the user is testing. |
| `activeTab` | Takes a screenshot of the current tab when the user marks a bug or presses “Found a bug” from the toolbar icon or a hotkey. |
| `scripting` | Injects the bug-marking panel and the autotest recorder into the page under test only after the user starts a check or a recording. |
| `storage` | Stores settings, the user's consent, autotest scenarios, mocking rules and API test projects locally. |
| `unlimitedStorage` | Bug reports contain screenshots and tab video, which are stored locally in IndexedDB and can exceed the default quota. |
| `tabCapture` | Records video of the tab under test when the user clicks “Record video”. |
| `offscreen` | Runs the MediaRecorder for tab video and microphone voice comments, which is not available in the service worker. |
| `identity` | Optional Google sign-in, used only if the user connects Google Docs to export a report to their own Google Drive (drive.file scope — only files created by the extension). |
| Host permission `<all_urls>` | The user may test any website. After the user accepts the disclosure on the first-run page, the extension keeps a rolling 10-minute buffer of actions, network requests, console messages, a page replay and screenshots after actions on website tabs, so a bug can be reported retroactively with “Found a bug”. The buffer is stored locally only, erased when the tab is closed, and replay/screenshots can be turned off in settings. It also shows the marking panel and runs the site audit. |
| `debugger` | Attached to the tab under test only while the user has turned on network/CPU throttling, device emulation, multi-width screenshots or full network capture, and detached right after. Chrome does not allow this permission to be optional. |

### Remote code

> No, I am not using remote code. All JavaScript, including axe-core, is packaged in the extension. Requests to AI services (Anthropic/OpenAI/compatible) and Google Drive only send data and receive text/JSON; no code is downloaded or executed.

### Data usage (отметить в форме)

Собираемые данные (только на вкладке проверки, по действию пользователя):

- **Website content** — скриншоты, видео вкладки, текст и HTML отмеченных элементов.
- **Web history** — адреса страниц, которые открывались во время проверки.
- **User activity** — клики, ввод, переходы на страницах сайтов; последние 10 минут хранятся в браузере для «Нашёл баг» (значения паролей, карт и токенов не записываются).
- **Authentication information** — может попасть в записанные заголовки запросов; при экспорте скрывается по умолчанию. Если в форме требуется — отметить.

Подтвердить все три пункта:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Пояснение для проверяющих (поле «Notes» / при запросе):

> All data stays in the user's browser (IndexedDB / chrome.storage). The extension has no backend. The rolling 10-minute buffer (actions, requests, console, page replay, screenshots after actions) exists only so a tester can report a bug after noticing it; it is erased when the tab closes, secret fields are masked, and replay/screenshots can be disabled. Data leaves the browser only when the user explicitly downloads or copies a report, or presses the AI analysis / Google Docs button for a service they configured with their own key or account. A first-run page (welcome.html) discloses what is collected and requires consent before the first check.

## 4. Проверка перед отправкой

- [ ] Установить архив начисто в новый профиль Chrome: открывается страница приветствия, без согласия проверка не запускается.
- [ ] Эмуляция сети/устройств и скриншоты экранов работают, после выключения Chrome убирает плашку отладки.
- [ ] Вручную: видео вкладки, голос с микрофона, вход Google, AI с настоящим ключом.
