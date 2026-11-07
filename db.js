/* ISIONXXX // db — every app's data in IndexedDB, the browser's own database for a site.
   Shared, identical file in every app. Load it first, and mark the app's own script so it can wait for the database:
     <script src="db.js"></script>
     <script src="sync.js" data-keys="isx.mind.v1"></script>
     <script src="ui.js"></script>
     <script type="isx/app">…the app…</script>

   How it works
   - Every key the apps save is kept in IndexedDB (database 'isx', store 'kv'). It has room for hundreds of MB, where
     localStorage holds about 5 M characters shared by all seven apps.
   - localStorage keeps a copy of each key while it fits. The apps read that copy, because it is instant, and it is
     written at once, so a change made just before the page closes is never lost (the database write lands a moment
     later). It also lets a copy of an app that hasn't updated yet keep reading and writing the same data.
   - On open, the two are compared: a key whose localStorage copy differs from the database was written by such an
     app, or after the database write was cut short, so the copy is taken into the database. A key the copy no longer
     has was deleted the same way.
   - A key that no longer fits in localStorage lives in the database alone (listed in isx.db.only): its copy is
     removed to free the space, the save succeeds instead of failing, and on the next open the app's script waits the
     few milliseconds it takes to read it back.
   - The apps keep calling localStorage.getItem / setItem / removeItem: this file routes them. Other open tabs and the
     apps inside TODAY hear about changes as before (a 'storage' event, sent over a BroadcastChannel for keys that live
     in the database alone).
   - Without IndexedDB (rare: some private modes) everything stays in localStorage, as before this file existed.
   ISXDB.ready resolves once the database has been read; ISXDB.started once the app's script has run; ISXDB.info()
   reports what is stored. */
(() => {
  const ls = window.localStorage, P = Storage.prototype;
  const raw = { get: P.getItem, set: P.setItem, del: P.removeItem };
  const ONLYK = 'isx.db.only';
  const list = t => { try { const a = JSON.parse(t); return Array.isArray(a) ? a.filter(k => typeof k === 'string') : [] } catch (e) { return [] } };
  const readOnly = () => new Set(list(raw.get.call(ls, ONLYK)));
  const ONLY = readOnly();            // keys that live in the database alone
  const MEM = new Map();              // their values, once read
  let db = null, hydrated = false, broken = false;
  const idb = (() => { try { return window.indexedDB || null } catch (e) { return null } })();
  let ok, fail; const ready = new Promise(r => { ok = r });
  let go; const started = new Promise(r => { go = r });
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('isx.db') : null;

  /* ---------- the database ---------- */
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
  function openDB() {
    return new Promise((res, rej) => {
      const r = idb.open('isx', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => d.close(); res(d) };
      r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
    });
  }
  // writes are gathered and sent in one transaction a moment later; a page that is going away sends them at once
  const pend = new Map(); let flushT = 0;
  function flush() {
    clearTimeout(flushT); flushT = 0;
    if (!db || !pend.size) return;
    const t = db.transaction('kv', 'readwrite'), s = t.objectStore('kv');
    pend.forEach((v, k) => v == null ? s.delete(k) : s.put(v, k)); pend.clear();
  }
  const queue = (k, v) => { pend.set(k, v); if (db && !flushT) flushT = setTimeout(flush, 0) };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush() });

  // the list is kept in both places: localStorage, so a page knows at once whether to wait for the database, and the
  // database, so a lost copy of the list can't make a key that lives there alone look deleted
  const saveOnly = () => { const t = JSON.stringify([...ONLY]); try { raw.set.call(ls, ONLYK, t) } catch (e) {} queue(ONLYK, t) };
  const tellOthers = (k, v) => { try { chan?.postMessage({ k, v }) } catch (e) {} };
  // a change other pages can't see as a 'storage' event (the key lives in the database alone): send one ourselves
  function fire(k, oldValue, newValue) {
    try { dispatchEvent(new StorageEvent('storage', { key: k, oldValue, newValue, storageArea: ls, url: location.href })) } catch (e) {}
  }

  /* ---------- localStorage, routed ---------- */
  const mine = s => s === ls;
  P.getItem = function (k) {
    if (!mine(this)) return raw.get.call(this, k);
    k = String(k);
    if (ONLY.has(k)) return MEM.has(k) ? MEM.get(k) : null;
    return raw.get.call(this, k);
  };
  P.setItem = function (k, v) {
    if (!mine(this)) return raw.set.call(this, k, v);
    k = String(k); v = String(v);
    if (k === ONLYK) return raw.set.call(this, k, v);
    // before the database has been read, a key that lives in it alone can't be written: that would replace data
    // this page hasn't seen yet
    if (ONLY.has(k) && !hydrated) throw new Error('The database is still opening; try again in a moment');
    if (!ONLY.has(k)) {
      try { raw.set.call(this, k, v); queue(k, v); return }
      catch (e) {
        // full: the key moves into the database alone (only with a database to hold it; otherwise the error stands)
        if (!db || broken) throw e;
        // the copy goes first, which frees the space the list needs
        ONLY.add(k); try { raw.del.call(ls, k) } catch (x) {} saveOnly();
      }
    }
    MEM.set(k, v); queue(k, v); tellOthers(k, v);
  };
  P.removeItem = function (k) {
    if (!mine(this)) return raw.del.call(this, k);
    k = String(k);
    raw.del.call(this, k);
    if (ONLY.has(k)) { ONLY.delete(k); MEM.delete(k); saveOnly(); tellOthers(k, null) }
    queue(k, null);
  };

  // another page changed a key that lives in the database alone (or moved one there)
  chan && (chan.onmessage = e => {
    const { k, v } = e.data || {}; if (typeof k !== 'string') return;
    const old = MEM.get(k) ?? null;
    const now = readOnly(); ONLY.clear(); now.forEach(x => ONLY.add(x));
    if (v == null) MEM.delete(k); else MEM.set(k, v);
    fire(k, old, v);
  });
  // another page moved a key into the database alone: its localStorage copy disappears, which reaches this page as a
  // deletion, maybe before the message above. Registered before the app's own listener, this makes the key read as
  // what it was until the new value arrives, so the app never sees its data vanish
  addEventListener('storage', e => {
    if (e.storageArea !== ls || !e.isTrusted || e.key == null || e.newValue != null) return;
    if (!ONLY.has(e.key) && readOnly().has(e.key)) { ONLY.add(e.key); if (!MEM.has(e.key) && e.oldValue != null) MEM.set(e.key, e.oldValue) }
  }, true);

  /* ---------- open: read the database, compare it with localStorage ---------- */
  async function hydrate() {
    db = await openDB();
    const t = db.transaction('kv', 'readonly'), s = t.objectStore('kv');
    const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    const D = new Map(keys.map((k, i) => [k, vals[i]]));
    list(D.get(ONLYK)).forEach(k => ONLY.add(k));
    const L = new Map(); for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k !== ONLYK) L.set(k, raw.get.call(ls, k)) }
    L.forEach((v, k) => {
      if (ONLY.has(k)) {
        // an app that hasn't updated wrote a key that lives in the database alone: keep the database's (it holds
        // everything this device saved), park the other next to it, and free the space
        if (D.has(k) && D.get(k) !== v) queue('isx.db.parked.' + k + '.' + Date.now(), v);
        try { raw.del.call(ls, k) } catch (e) {}
      } else if (D.get(k) !== v) queue(k, v);
    });
    D.forEach((v, k) => {
      if (ONLY.has(k)) MEM.set(k, v);
      else if (!L.has(k) && !k.startsWith('isx.db.')) queue(k, null);
    });
    // listed but missing from the database (it was cleared): nothing to read, so it is no longer "database only"
    [...ONLY].forEach(k => { if (!D.has(k)) ONLY.delete(k) }); saveOnly();
    hydrated = true; flush();
    // ask the browser, once, to keep this site's data under storage pressure (installed apps usually get it; Firefox
    // asks the person, so not on every open)
    try { if (!raw.get.call(ls, 'isx.db.asked')) { raw.set.call(ls, 'isx.db.asked', '1'); navigator.storage?.persist?.() } } catch (e) {}
  }
  const opened = idb ? hydrate().catch(() => { broken = true; db = null }) : Promise.resolve(broken = true);
  // keys that live in the database alone can't be read without it: refuse to write them, so an empty page can't
  // replace them, and let the app run on what localStorage has
  opened.then(() => { if (broken) hydrated = false; ok() });

  /* ---------- the app's own script runs once its data can be read ---------- */
  function run() {
    document.querySelectorAll('script[type="isx/app"]').forEach(old => {
      const s = document.createElement('script');
      for (const a of old.attributes) if (a.name !== 'type') s.setAttribute(a.name, a.value);
      s.text = old.text; old.replaceWith(s);
    });
    go();
  }
  const parsed = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r());
  // nothing lives in the database alone: start as soon as the page is parsed, as before; otherwise wait for it to be
  // read (a few ms), but never more than 8 s
  Promise.all([parsed, ONLY.size ? Promise.race([ready, new Promise(r => setTimeout(r, 8000))]) : null]).then(run);

  async function info() {
    await ready;
    const sz = v => v == null ? 0 : v.length;
    let n = 0, chars = 0;
    if (db) { const s = db.transaction('kv', 'readonly').objectStore('kv'); const vals = await req(s.getAll()); n = vals.length; chars = vals.reduce((a, v) => a + sz(v), 0) }
    const persisted = await navigator.storage?.persisted?.().catch(() => false) ?? false;
    return { on: !!db && !broken, keys: n, chars, only: [...ONLY], persisted };
  }
  window.ISXDB = { ready, started, info, flush, get on() { return !!db && !broken } };
})();
