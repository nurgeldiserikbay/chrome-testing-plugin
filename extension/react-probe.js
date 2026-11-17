// MAIN world: подсчёт перерисовок компонентов React через стандартный хук DevTools.
// Подключается, только если в настройках включено «Перерисовки React».
(() => {
  if (window.__qaBugReact) return;
  window.__qaBugReact = true;

  const TAG = '__qa_bug_recorder__';
  const KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
  const post = (data) => {
    try { document.dispatchEvent(new CustomEvent(TAG, { detail: JSON.stringify({ kind: 'event', data }) })); } catch (_) {}
  };

  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // Function, Class, ForwardRef, Memo, SimpleMemo
  const PERFORMED_WORK = 1;
  const MAX_FIBERS = 6000;

  function nameOf(f) {
    const t = f.type;
    if (!t) return 'Anonymous';
    if (typeof t === 'string') return t;
    return (
      t.displayName || t.name ||
      (t.render && (t.render.displayName || t.render.name)) ||
      (t.type && (t.type.displayName || t.type.name)) ||
      'Anonymous'
    );
  }

  let stats = new Map(); // name -> [renders, mounts]
  let commits = 0;
  let slowest = 0;

  function onCommit(root) {
    const t0 = performance.now();
    commits++;
    const current = root && root.current;
    if (!current) return;
    const stack = [current.child];
    let budget = MAX_FIBERS;
    while (stack.length && budget-- > 0) {
      const f = stack.pop();
      if (!f) continue;
      if (COMPONENT_TAGS.has(f.tag)) {
        const alt = f.alternate;
        const kind = !alt ? 1 : (f.flags & PERFORMED_WORK) === PERFORMED_WORK ? 0 : -1;
        if (kind >= 0) {
          const n = nameOf(f);
          const s = stats.get(n) || [0, 0];
          s[kind]++;
          stats.set(n, s);
        }
      }
      if (f.sibling) stack.push(f.sibling);
      const alt = f.alternate;
      // если поддерево не обрабатывалось в этом коммите — дочерние узлы те же, их не обходим
      if (f.child && (!alt || f.child !== alt.child)) stack.push(f.child);
    }
    slowest = Math.max(slowest, performance.now() - t0);
  }

  setInterval(() => {
    if (!commits) return;
    const list = [...stats.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1]));
    const total = list.reduce((s, [, v]) => s + v[0] + v[1], 0);
    const top = list.slice(0, 4).map(([n, v]) => `${n} ×${v[0] + v[1]}`).join(', ');
    post({
      ts: Date.now(), cat: 'render', kind: 'react', level: commits >= 20 ? 'warn' : 'info', value: total,
      text: `React: ${commits} ${commits === 1 ? 'обновление' : 'обновлений'}, перерисовано компонентов: ${total}${top ? ' — ' + top : ''}` + (commits >= 20 ? ' (частые перерисовки)' : ''),
      detail: { commits, components: Object.fromEntries(list.slice(0, 40)) },
    });
    stats = new Map();
    commits = 0;
  }, 1000);

  function wrap(hook) {
    if (!hook || hook.__qaWrapped) return hook;
    const orig = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (id, root) {
      try { onCommit(root); } catch (_) {}
      return typeof orig === 'function' ? orig.apply(this, arguments) : undefined;
    };
    hook.__qaWrapped = true;
    return hook;
  }

  if (window[KEY]) {
    wrap(window[KEY]);
    return;
  }
  let hook = wrap({
    renderers: new Map(),
    supportsFiber: true,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    setStrictMode() {},
    checkDCE() {},
    isDisabled: false,
  });
  try {
    Object.defineProperty(window, KEY, {
      configurable: true,
      enumerable: false,
      get() { return hook; },
      set(v) { hook = wrap(v); },
    });
  } catch (_) {}
})();
