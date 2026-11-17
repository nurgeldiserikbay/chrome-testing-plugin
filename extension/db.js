// Простое хранилище IndexedDB: отчёты (JSON) и бинарные данные (скриншоты, видео, аудио).
globalThis.QADB = (() => {
  let dbp = null;
  const open = () =>
    dbp ||
    (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('qa-bug-recorder', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    }));

  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };

  return {
    put: (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key)),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
    async delPrefix(store, prefix) {
      const keys = await this.keys(store);
      for (const k of keys) if (String(k).startsWith(prefix)) await this.del(store, k);
    },
  };
})();
