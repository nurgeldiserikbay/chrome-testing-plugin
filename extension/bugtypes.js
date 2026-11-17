// Типы багов и какие данные нужны для каждого.
// Используется панелью на странице (overlay.js) и отчётом (report.js).
(function (g) {
  if (g.QA_BUG_TYPES) return;

  /*
   * view — что показывать в отчёте:
   *   tabs      — вкладки с данными
   *   timeline  — фильтр таймлайна по умолчанию
   *   network   — фильтр вкладки «Сеть» по умолчанию
   *   findings  — какие автоматические находки относятся к типу
   * export — настройки выгрузки по умолчанию (как в «⚙ Что включать в отчёт»)
   */
  const ALL_TABS = ['timeline', 'actions', 'console', 'network', 'perf', 'storage', 'env'];
  const T = [
    {
      id: 'visual', icon: '🎨', name: 'Визуальный / вёрстка',
      hint: 'съехало, перекрывается, обрезано, не тот цвет или шрифт, ломается на размере экрана',
      placeholder: 'Что не так с внешним видом? Как должно выглядеть?',
      view: { tabs: ['network', 'env'], timeline: 'important', network: 'errors', findings: ['resources', 'shifts'] },
      export: { console: 'none', network: 'errors', events: 'none', perf: false, storage: false, details: false },
    },
    {
      id: 'functional', icon: '⚙️', name: 'Не работает',
      hint: 'кнопка не реагирует, форма не отправляется, функция не выполняется',
      placeholder: 'Что вы сделали и что должно было произойти?',
      view: { tabs: ['timeline', 'actions', 'console', 'network', 'env'], timeline: 'important', network: 'api', findings: ['js', 'requests', 'appeared', 'dialogs', 'validation', 'ws', 'offline'] },
      export: { console: 'warn', network: 'api', events: 'important', perf: false, storage: false, details: true },
    },
    {
      id: 'logic', icon: '🧮', name: 'Неверные данные / расчёт',
      hint: 'неправильная сумма, статус, остаток; данные не сохраняются или чужие',
      placeholder: 'Какое значение видите и какое должно быть?',
      view: { tabs: ['actions', 'network', 'storage', 'console', 'timeline', 'env'], timeline: 'important', network: 'api', findings: ['js', 'requests', 'appeared'] },
      export: { console: 'error', network: 'api', events: 'important', perf: false, storage: true, details: true },
    },
    {
      id: 'api', icon: '🔌', name: 'Сервер / API',
      hint: 'ошибка 4xx/5xx, сервер вернул не то, запрос не ушёл или завис',
      placeholder: 'Какой запрос упал или вернул не то?',
      view: { tabs: ['network', 'console', 'timeline', 'storage', 'env'], timeline: 'net', network: 'api', findings: ['requests', 'js', 'appeared', 'ws', 'offline'] },
      export: { console: 'warn', network: 'api', events: 'important', perf: false, storage: true, details: true },
    },
    {
      id: 'form', icon: '📝', name: 'Форма / валидация',
      hint: 'поле принимает недопустимое или отклоняет правильное, непонятная ошибка ввода',
      placeholder: 'Что вводили и что ответила форма?',
      view: { tabs: ['actions', 'timeline', 'network', 'console', 'env'], timeline: 'important', network: 'api', findings: ['validation', 'requests', 'js', 'appeared', 'dialogs'] },
      export: { console: 'error', network: 'api', events: 'important', perf: false, storage: false, details: true },
    },
    {
      id: 'perf', icon: '🐢', name: 'Тормозит',
      hint: 'долго грузится, зависает при клике, дёргается при прокрутке, растёт память',
      placeholder: 'Что именно тормозит и как долго?',
      view: { tabs: ['perf', 'timeline', 'network', 'console', 'env'], timeline: 'perf', network: 'all', findings: ['slow', 'frames', 'fps', 'vitals', 'react', 'memory', 'dom', 'requests'] },
      export: { console: 'warn', network: 'all', events: 'all', perf: true, storage: false, details: false },
    },
    {
      id: 'content', icon: '📄', name: 'Тексты / контент',
      hint: 'опечатка, нет перевода, неверный текст или картинка, заглушка',
      placeholder: 'Какой текст сейчас и какой должен быть?',
      view: { tabs: ['env'], timeline: 'important', network: 'errors', findings: ['resources'] },
      export: { console: 'none', network: 'none', events: 'none', perf: false, storage: false, details: false },
    },
    {
      id: 'security', icon: '🔒', name: 'Доступ / безопасность',
      hint: 'видны чужие данные, доступ без прав, токены в адресе, нет ограничения попыток',
      placeholder: 'Что доступно, хотя не должно быть?',
      view: { tabs: ['network', 'storage', 'actions', 'console', 'timeline', 'env'], timeline: 'important', network: 'all', findings: ['requests', 'js'] },
      export: { console: 'warn', network: 'all', events: 'important', perf: false, storage: true, details: true },
    },
    {
      id: 'ux', icon: '🧭', name: 'Неудобно (UX)',
      hint: 'непонятно что делать, нет реакции на действие, слишком много шагов',
      placeholder: 'Что неудобно и как было бы лучше?',
      view: { tabs: ['actions', 'timeline', 'env'], timeline: 'action', network: 'api', findings: ['slow', 'dialogs'] },
      export: { console: 'none', network: 'none', events: 'important', perf: false, storage: false, details: false },
    },
    {
      id: 'other', icon: '🗂', name: 'Другое — все данные',
      hint: 'не подходит ни один тип или нужно всё',
      placeholder: 'Что здесь не так? Опишите проблему…',
      view: { tabs: ALL_TABS, timeline: 'important', network: 'all', findings: null },
      export: { console: 'warn', network: 'api', events: 'important', perf: true, storage: true, details: true },
    },
  ];
  const AUTO = { id: 'auto', icon: '✨', name: 'Определить автоматически', hint: 'тип подберётся по собранным данным', placeholder: 'Что здесь не так? Опишите проблему…' };

  const byId = (id) => T.find((t) => t.id === id) || null;

  /**
   * Подсказка типа по данным отчёта.
   * R — отчёт: annotations, console, network, resources, events.
   * Возвращает {id, reason}.
   */
  function suggest(R) {
    const ev = (k) => (R.events || []).filter((e) => e.kind === k);
    const netAll = [...(R.network || []), ...(R.resources || [])];
    const noise = (e) => /\/favicon\.ico(\?|$)/.test(e.url || '');
    const apiErr = netAll.filter((e) => !noise(e) && (e.failed || e.status >= 400) && ['XHR', 'Fetch'].includes(e.type));
    const resErr = netAll.filter((e) => !noise(e) && (e.failed || e.status >= 400) && !['XHR', 'Fetch'].includes(e.type));
    const jsErr = (R.console || []).filter((c) => c.level === 'error' && c.source !== 'resource');
    const after = (arr) => arr.filter((x) => !R.startTime || x.ts >= R.startTime - 60000); // ближе к моменту бага
    if (after(ev('invalid')).length) return { id: 'form', reason: 'есть ошибки валидации формы' };
    if (after(apiErr).length) {
      const e = after(apiErr).slice(-1)[0];
      let p = e.url; try { p = new URL(e.url).pathname; } catch (_) {}
      return { id: 'api', reason: `упал запрос ${e.method} ${e.status || 'ошибка'} ${p}` };
    }
    const perfBad = after(ev('long-frame')).filter((e) => e.value >= 250).length + after(ev('slow-interaction')).filter((e) => e.value >= 500).length + after(ev('fps')).length;
    if (perfBad >= 2) return { id: 'perf', reason: 'есть зависания и медленные отклики' };
    if (after(jsErr).length) return { id: 'functional', reason: 'есть ошибки JavaScript' };
    if (after(ev('appeared')).some((e) => e.level === 'error')) return { id: 'functional', reason: 'на странице появилось сообщение об ошибке' };
    if (resErr.length) return { id: 'visual', reason: 'не загрузились картинки, шрифты или стили' };
    if ((R.annotations || []).length) return { id: 'visual', reason: 'технических ошибок нет, есть пометки на странице' };
    return { id: 'other', reason: 'недостаточно данных' };
  }

  g.QA_BUG_TYPES = { list: T, auto: AUTO, byId, suggest, ALL_TABS };
})(typeof window !== 'undefined' ? window : globalThis);
