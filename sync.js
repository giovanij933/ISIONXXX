/* ISIONXXX // sync — keeps an app's data the same on every device.
   Shared, identical file in every app. Load it before the app's main script:
     <script src="sync.js" data-keys="isx.mind.v1"></script>
   data-keys = the localStorage keys holding that app's data (space separated).

   How it works
   - The app keeps saving to localStorage exactly as before; it works offline.
   - Each key is mirrored to one private GitHub gist, one file per key, encrypted on the device
     (AES-GCM, key from your passphrase), so the gist holds nothing readable.
   - Sync is a merge, not an overwrite: records with an `id` are merged one by one, deletions
     travel as tombstones, and anything else is a three-way merge against the last synced copy.
     Entries made on two devices while offline both survive.
   - Runs on open, after every save (debounced), when the app comes back to the foreground and
     every few minutes. When another device changed something, the page reloads to show it, but
     never while a dialog is open.
   - Setup is shared by every app on the same site: set it up once per browser.

   Storage budget
   - Every app on the site shares one localStorage quota (about 5 M characters). Every write goes through here, so
     this file tracks usage per key, warns when it passes 80% and, if a write does not fit, says so plainly
     (instead of the change vanishing) and fires an 'isx-storage' event: {used, budget, ratio, failed, key}.
     The error is still thrown, so an app's own catch keeps working. ISXSync.storage() reports usage per app. */
(() => {
  const KEYS = (document.currentScript?.dataset.keys || '').split(/\s+/).filter(Boolean);
  // data-noreload: the page re-reads its data itself (the ISIONXXX shell, whose reload would restart every app in it),
  // so a change from another device fires an 'isx-sync' event instead of reloading
  const NORELOAD = document.currentScript?.dataset.noreload != null;
  const CFG = 'isx.sync.cfg', BASE = k => 'isx.sync.base.' + k, DEL = k => 'isx.sync.del.' + k;
  const API = 'https://api.github.com/gists', EVERY = 5 * 60e3, DEBOUNCE = 2500;
  const ls = window.localStorage, setRaw = Storage.prototype.setItem;
  const get = (k, d = null) => { try { const v = ls.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } };
  /* ---------- storage budget ---------- */
  // lengths per key, measured once and then kept current by our own writes and other pages' 'storage' events,
  // so a save never has to re-read everything to know how full storage is
  const QUOTA = 'isx.quota', WARN = .8, LEN = new Map(); let used = 0, warned = false;
  const track = (k, v) => { const n = v == null ? 0 : k.length + v.length; used += n - (LEN.get(k) || 0); if (n) LEN.set(k, n); else LEN.delete(k) };
  const scan = () => { LEN.clear(); used = 0; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); track(k, ls.getItem(k)) } };
  try { scan() } catch (e) {}
  // ~5 M characters in Safari and Chrome; once a write fails here, the size it failed at is this device's real limit
  const DEF = 5 * 1024 * 1024, budget = () => { const q = +ls.getItem(QUOTA); return q > 1e5 ? q : DEF };
  const learn = n => { const v = String(n); try { setRaw.call(ls, QUOTA, v); track(QUOTA, v) } catch (e) {} };
  const isFull = e => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  const APPS = [['isx.mind', 'MIND'], ['isx.training', 'TRAINING'], ['nj.', 'NUTRITION'], ['xl.', 'LEARN'], ['isx.journal', 'JOURNAL'],
    ['isx.rewire', 'REWIRE'], ['isx.checkin', 'Check-in'], ['isx.sync', 'Sync']];
  function storage() {
    const by = {};
    LEN.forEach((n, k) => { const a = (APPS.find(([p]) => k.startsWith(p)) || [, 'Other'])[1]; by[a] = (by[a] || 0) + n });
    const b = budget();
    return { used, budget: b, ratio: used / b, apps: Object.entries(by).map(([app, chars]) => ({ app, chars })).sort((x, y) => y.chars - x.chars) };
  }
  // sizes in characters, the unit browsers count this quota in ("5 MB" = 5 M characters)
  const kb = n => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  function tell(failed, key) {
    const s = storage();
    dispatchEvent(new CustomEvent('isx-storage', { detail: { used: s.used, budget: s.budget, ratio: s.ratio, failed, key } }));
    // the banner speaks for the user's own changes; background caches failing only raise the event
    if (!failed || !document.body || (KEYS.length && !KEYS.includes(key))) return;
    let n = document.getElementById('isx-full');
    if (!n) {
      n = document.createElement('div'); n.id = 'isx-full'; n.setAttribute('role', 'alert');
      n.addEventListener('click', e => { if (e.target.closest('button')) n.remove() });
      document.body.appendChild(n);
    }
    const top = s.apps.find(a => a.app !== 'Other' && a.app !== 'Sync' && a.chars >= s.used * .05);
    n.innerHTML = `<b>Storage is full: that change was not saved.</b> All ISIONXXX apps share this space${top ? `; ${esc(top.app)} uses the most (${kb(top.chars)})` : ''}.
      Take a backup, then delete old or sample data to make room.<button type="button" aria-label="Dismiss">✕</button>`;
  }
  function wrote(k, v) {
    track(k, v);
    // a write that fit past the learned limit proves it wrong (e.g. the disk had room again): forget it and go back
    // to the default; a device that really has less room learns it again on its next failed write
    const q = +ls.getItem(QUOTA); if (q > 1e5 && used > q) { try { rm.call(ls, QUOTA); track(QUOTA, null) } catch (e) {} }
    const r = used / budget();
    if (r >= WARN && !warned) { warned = true; tell(false, k) } else if (r < WARN - .05) warned = false;
  }
  function failed(k, v) {
    // remember where this device's limit is, so the warning level matches it from now on. The size that failed is an
    // upper bound on the limit, so keep the lowest one seen
    // capped at the default: one oversized import must not move the warnings past the real limit
    const at = Math.min(DEF, used - (LEN.get(k) || 0) + k.length + String(v).length), q = +ls.getItem(QUOTA);
    if (!(q > 1e5 && q <= at)) learn(Math.max(1e5, at));
    tell(true, k);
  }
  addEventListener('storage', e => { if (e.storageArea !== ls) return; if (e.key == null) { try { scan() } catch (x) {} } else track(e.key, e.newValue) });
  const rm = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (k) { rm.call(this, k); if (this === ls) track(String(k), null) };
  const clr = Storage.prototype.clear;
  Storage.prototype.clear = function () { clr.call(this); if (this === ls) { LEN.clear(); used = 0 } };

  const put = (k, v) => { const s = JSON.stringify(v); try { setRaw.call(ls, k, s); wrote(k, s) } catch (e) { if (isFull(e)) failed(k, s) } };
  let cfg = get(CFG), state = cfg ? 'idle' : 'off', msg = '', last = 0, timer = 0, busy = false, again = false, pending = false;
  // after a sync changed a key, the app's in-memory copy is stale until the page reloads: pre[k] is what it last knew
  const pre = {};

  /* ---------- merge ---------- */
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const isRec = x => isObj(x) && typeof x.id === 'string';
  const isRecArr = a => Array.isArray(a) && a.length > 0 && a.every(isRec);
  const recLike = a => Array.isArray(a) && (a.length === 0 || a.every(isRec));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function ids(x, out = new Set()) {
    if (Array.isArray(x)) x.forEach(v => { if (isRec(v)) out.add(v.id); ids(v, out) });
    else if (isObj(x)) for (const k in x) ids(x[k], out);
    return out;
  }
  // b = last synced copy, l = this device, r = the gist; del = ids deleted anywhere
  function merge(b, l, r, del) {
    if (recLike(l) && recLike(r) && (isRecArr(l) || isRecArr(r))) {
      // records: union by id minus deletions; a record on both sides is merged field by field
      const bm = new Map((Array.isArray(b) ? b : []).filter(isRec).map(x => [x.id, x]));
      const rm = new Map(r.map(x => [x.id, x])), seen = new Set(), out = [];
      l.forEach(x => { if (del.has(x.id)) return; seen.add(x.id); out.push(rm.has(x.id) ? merge(bm.get(x.id), x, rm.get(x.id), del) : x) });
      r.forEach(x => { if (!seen.has(x.id) && !del.has(x.id)) out.push(x) });
      return out;
    }
    if (eq(l, r)) return l;
    // objects always merge key by key: "unchanged here, so take the gist" would drop records the gist lost
    // when two devices uploaded at the same moment
    if (isObj(l) && isObj(r)) {
      const o = {};
      new Set([...Object.keys(l), ...Object.keys(r)]).forEach(k => {
        const v = merge(isObj(b) ? b[k] : undefined, l[k], r[k], del);
        if (v !== undefined) o[k] = v;
      });
      return o;
    }
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
    return l === undefined ? r : l;   // a real conflict on one value: this device wins
  }

  // the same entry made on two devices (a CSV imported twice, a sample loaded on both) gets two ids:
  // records equal in everything but id and note collapse into one. The lowest id wins everywhere, keeps
  // any note the other copy had, and the other id is deleted on every device.
  const SOFT = new Set(['id', 'note', 'notes', 'comment']);
  const fp = r => JSON.stringify(r, (k, v) => SOFT.has(k) ? undefined : v);
  function dedupe(x, del) {
    if (Array.isArray(x)) {
      const a = x.map(v => dedupe(v, del));
      if (!isRecArr(a)) return a;
      const win = new Map(), drop = new Set();
      a.forEach(r => {
        const k = fp(r), w = win.get(k);
        if (!w) return win.set(k, r);
        const [keep, lose] = w.id <= r.id ? [w, r] : [r, w];
        SOFT.forEach(f => { if (f !== 'id' && !keep[f] && lose[f]) keep[f] = lose[f] });
        drop.add(lose.id); del.add(lose.id); win.set(k, keep);
      });
      return drop.size ? a.filter(r => !drop.has(r.id)) : a;
    }
    if (isObj(x)) { const o = {}; for (const k in x) o[k] = dedupe(x[k], del); return o }
    return x;
  }

  /* ---------- crypto ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  let ck = null, ckFor = '';
  async function key() {
    const f = cfg.gist + '|' + cfg.pass;
    if (ck && ckFor === f) return ck;
    const raw = await crypto.subtle.importKey('raw', enc.encode(cfg.pass), 'PBKDF2', false, ['deriveKey']);
    ck = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('isx-sync:' + cfg.gist), iterations: 150000, hash: 'SHA-256' },
      raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    ckFor = f; return ck;
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
  }
  async function open(text) {
    const o = JSON.parse(text);
    try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, await key(), unb64(o.ct)))) }
    catch (e) { throw new Error('Wrong passphrase for this gist') }
  }

  /* ---------- gist ---------- */
  async function gh(url, opt = {}) {
    const res = await fetch(url, { cache: 'no-store', ...opt, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + cfg.token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (res.status === 401) throw new Error('GitHub token rejected');
    if (res.status === 404) throw new Error('Gist not found (check the sync code)');
    if (!res.ok) throw new Error('GitHub ' + res.status);
    return res.json();
  }
  const fname = k => k.replace(/[^\w.-]/g, '_') + '.enc';
  async function fileText(f) {
    if (!f) return null;
    if (!f.truncated) return f.content;
    const r = await fetch(f.raw_url, { cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return r.text();
  }

  /* ---------- last synced copy ----------
     The three-way merge needs the last synced copy of each key. It is as big as the data itself, and every app on this
     site shares one ~5 MB localStorage: the data plus these copies outgrew it after about two years of heavy use, and
     then every save failed. So the copies live in IndexedDB; ones still in localStorage move over the first time they
     are read. Without IndexedDB (rare) they stay in localStorage as before. */
  const idb = (() => { let p; return () => p ??= new Promise((res, rej) => { const r = indexedDB.open('isx-sync', 1); r.onupgradeneeded = () => r.result.createObjectStore('base'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) })();
  const tx = (mode, f) => idb().then(db => new Promise((res, rej) => { const t = db.transaction('base', mode), q = f(t.objectStore('base')); t.oncomplete = () => res(q.result); t.onerror = t.onabort = () => rej(t.error) }));
  const baseSet = (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => put(BASE(k), v));
  const baseRm = k => tx('readwrite', s => s.delete(k)).catch(() => {});
  async function baseGet(k) {
    const old = get(BASE(k));
    if (old != null) { try { await tx('readwrite', s => s.put(old, k)); ls.removeItem(BASE(k)) } catch (e) {} return old }
    try { return (await tx('readonly', s => s.get(k))) ?? null } catch (e) { return null }
  }

  /* ---------- sync ---------- */
  function setState(s, m = '') { state = s; msg = m; paint() }
  async function sync() {
    if (!cfg || !KEYS.length) return;
    if (busy) { again = true; return }
    if (!navigator.onLine) return setState('offline');
    busy = true; setState('busy');
    try {
      const g = await gh(`${API}/${cfg.gist}`), files = {};
      let changedHere = false;
      for (const k of KEYS) {
        const remoteText = await fileText(g.files[fname(k)]);
        const remote = remoteText ? await open(remoteText) : null;
        const base = await baseGet(k), local = get(k), baseDel = new Set(get(DEL(k), []));
        // ids that were in the last synced copy and are gone here were deleted on this device
        const gone = [...ids(base)].filter(i => !ids(local).has(i));
        const del = new Set([...baseDel, ...gone, ...(remote?.del || [])]);
        const rData = remote ? remote.data : null;
        const merged = dedupe(local == null ? rData : rData == null ? local : merge(base, local, rData, del), del);
        if (merged == null) continue;
        if (!eq(merged, local)) { if (!(k in pre)) pre[k] = local; put(k, merged); changedHere = true }
        const doc = { data: merged, del: [...del] };
        if (!remote || !eq(doc.data, remote.data) || doc.del.length !== (remote.del || []).length) files[fname(k)] = { content: await seal(doc) };
        await baseSet(k, merged); put(DEL(k), [...del]);
      }
      if (Object.keys(files).length) await gh(`${API}/${cfg.gist}`, { method: 'PATCH', body: JSON.stringify({ files }) });
      last = Date.now(); setState('ok');
      if (changedHere) { pending = true; reloadWhenIdle() }
    } catch (e) {
      setState('error', e.message || String(e));
    } finally {
      busy = false;
      if (again) { again = false; schedule(500) }
    }
  }
  function schedule(ms = DEBOUNCE) { clearTimeout(timer); timer = setTimeout(sync, ms) }
  // another device changed the data: reload to show it, but not under an open dialog or mid-typing
  function reloadWhenIdle() {
    if (!pending) return;
    if (NORELOAD) { pending = false; dispatchEvent(new Event('isx-sync')); return }
    const busyUI = document.querySelector('dialog[open], .modal:not(.hidden), .po:not(.hidden)') ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (busyUI || document.hidden) return setTimeout(reloadWhenIdle, 2000);
    sessionStorage.setItem('isx.sync.reloaded', '1'); location.reload();
  }
  // any save to a synced key queues a sync. While a reload is pending the app saves from a stale copy, so the save
  // is merged into what is stored instead of replacing it (otherwise the other device's entries would look deleted)
  Storage.prototype.setItem = function (k, v) {
    if (this === ls && cfg && KEYS.includes(k) && k in pre) {
      try {
        const w = JSON.parse(v), old = pre[k], del = new Set(get(DEL(k), []));
        const known = ids(w); ids(old).forEach(i => { if (!known.has(i)) del.add(i) });   // deleted in the app just now
        v = JSON.stringify(merge(old, w, get(k), del));
        put(DEL(k), [...del]); pre[k] = w;
      } catch (e) {}
    }
    if (this !== ls) return setRaw.call(this, k, v);
    k = String(k); v = String(v);
    try { setRaw.call(this, k, v) } catch (e) { if (isFull(e)) failed(k, v); throw e }
    wrote(k, v);
    if (cfg && KEYS.includes(k)) schedule();
  };

  /* ---------- setup ---------- */
  const code = c => btoa(JSON.stringify({ t: c.token, g: c.gist, p: c.pass }));
  const uncode = s => { const o = JSON.parse(atob(s.trim())); if (!o.t || !o.g || !o.p) throw 0; return { token: o.t, gist: o.g, pass: o.p } };
  async function connect(c) {
    cfg = c; ck = null;
    if (!cfg.gist) {
      const g = await gh(API, { method: 'POST', body: JSON.stringify({ public: false, description: 'ISIONXXX sync (encrypted)', files: { 'README.md': { content: 'Encrypted data for the ISIONXXX apps. Do not edit.' } } }) });
      cfg.gist = g.id;
    } else await gh(`${API}/${cfg.gist}`);
    put(CFG, cfg);
    // a fresh connection starts from "nothing synced yet": everything here is merged in, nothing is deleted
    await Promise.all(KEYS.map(k => { ls.removeItem(BASE(k)); ls.removeItem(DEL(k)); return baseRm(k) }));
    await sync();
    if (state === 'error') throw new Error(msg);
  }
  function disconnect() {
    cfg = null; put(CFG, null); ls.removeItem(CFG);
    Object.keys(ls).filter(k => k.startsWith('isx.sync.base.') || k.startsWith('isx.sync.del.')).forEach(k => ls.removeItem(k));
    setState('off');
  }

  /* ---------- ui: a small badge, and a dialog ---------- */
  const css = document.createElement('style');
  /* the sync status is one dot, top right: green synced · amber pulsing syncing · red error · hollow grey off or offline.
     The button around it is a full-size tap target, and its label says the status in words. */
  css.textContent = `#isx-sync{position:fixed;top:calc(8px + env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));z-index:8;
    width:36px;height:36px;display:grid;place-items:center;padding:0;margin:0;background:none;border:0;border-radius:50%;cursor:pointer;flex:none}
  #isx-sync.inl{position:static;margin:-4px -8px -4px 2px;order:9}header.top>.acts{margin-left:auto}
  #isx-sync i{width:10px;height:10px;border-radius:50%;box-sizing:border-box;border:1.5px solid #8f8a7e;background:none;transition:background-color .3s,border-color .3s}
  #isx-sync:hover i{box-shadow:0 0 0 4px rgba(255,176,0,.18)}#isx-sync:focus-visible{outline:2px solid #ffb000;outline-offset:-2px}
  #isx-sync.ok i{background:#33ff66;border-color:#33ff66;box-shadow:0 0 8px rgba(51,255,102,.45)}
  #isx-sync.busy i{background:#ffb000;border-color:#ffb000;animation:isx-pulse 1s ease-in-out infinite alternate}
  #isx-sync.error i{background:#ff4545;border-color:#ff4545;box-shadow:0 0 8px rgba(255,69,69,.5)}
  @keyframes isx-pulse{from{opacity:1;transform:scale(1)}to{opacity:.35;transform:scale(.7)}}
  @media(prefers-reduced-motion:reduce){#isx-sync.busy i{animation:none}}
  /* phones: the app's buttons wrap to their own row, so the dot sits at the end of the name row (top right) */
  @media(max-width:640px){header.top:not(.th) #isx-sync.inl{order:0;margin-left:auto}}
  #isx-sd{margin:auto;max-height:calc(100% - 24px);overflow:auto;background:#0c0c0c;color:#d9d5c8;border:1px solid #ffb000;padding:20px;width:min(520px,calc(100vw - 24px));font:13px/1.5 'IBM Plex Mono',ui-monospace,monospace;border-radius:0}
  #isx-sd::backdrop{background:rgba(0,0,0,.78)}#isx-sd h3{margin:0 0 12px;font-size:13px;letter-spacing:.14em;color:#ffb000;font-weight:500}
  #isx-sd p{margin:0 0 10px;color:#8f8a7e}#isx-sd b{color:#d9d5c8;font-weight:500}#isx-sd a{color:#ffb000}
  #isx-sd label{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8f8a7e;margin:10px 0 4px}
  #isx-sd input,#isx-sd textarea{width:100%;box-sizing:border-box;background:#070707;color:#d9d5c8;border:1px solid #2c2c2c;padding:8px 10px;font:inherit;border-radius:0}
  #isx-sd input:focus,#isx-sd textarea:focus{border-color:#ffb000;outline:0}
  #isx-sd .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
  #isx-sd button{background:#070707;color:#d9d5c8;border:1px solid #2c2c2c;padding:7px 10px;font:12px 'IBM Plex Mono',monospace;letter-spacing:.06em;cursor:pointer;border-radius:0}
  #isx-sd button:hover{border-color:#ffb000;color:#ffb000}#isx-sd .pri{background:#ffb000;border-color:#ffb000;color:#000;font-weight:600}
  #isx-sd .tabs{display:flex;gap:6px;margin-bottom:6px}#isx-sd .tabs .on{background:#ffb000;border-color:#ffb000;color:#000}
  #isx-sd .err{color:#ff4545}#isx-sd .ok{color:#33ff66}
  #isx-full{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483647;background:#1a0b0b;border:1px solid #ff4545;color:#f1ece0;
    padding:12px 40px 12px 14px;font:12px/1.5 'IBM Plex Mono',monospace;box-shadow:0 10px 30px rgba(0,0,0,.6)}
  #isx-full b{color:#ff6b6b;display:block;margin-bottom:2px}
  #isx-full button{position:absolute;top:6px;right:6px;width:32px;height:32px;background:none;border:0;color:#f1ece0;font-size:14px;cursor:pointer}`;
  const badge = document.createElement('button');
  badge.id = 'isx-sync'; badge.type = 'button'; badge.setAttribute('aria-label', 'Sync settings');
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h' };
  function paint() {
    badge.className = (state === 'ok' ? 'ok' : state === 'busy' ? 'busy' : state === 'error' ? 'error' : '') + (badge.parentNode?.matches?.('header.top, .acts') ? ' inl' : '');
    if (!badge.firstChild) badge.innerHTML = '<i aria-hidden="true"></i>';
    const said = { off: 'Sync is off', busy: 'Syncing', ok: ago(last) === 'now' ? 'Synced just now' : 'Synced ' + ago(last) + ' ago', error: 'Sync error', offline: 'Offline, will sync when back online', idle: 'Sync' }[state] || 'Sync';
    badge.setAttribute('aria-label', said + (msg ? ': ' + msg : '') + '. Sync settings');
    badge.title = said + (msg ? ': ' + msg : '');
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function dialog() {
    let d = document.getElementById('isx-sd');
    if (!d) { d = document.createElement('dialog'); d.id = 'isx-sd'; document.body.appendChild(d) }
    const draw = (mode, note = '') => {
      if (cfg) {
        d.innerHTML = `<h3>SYNC</h3><p>Status: <b class="${state === 'error' ? 'err' : 'ok'}">${state === 'error' ? esc(msg) : state === 'ok' ? (ago(last) === 'now' ? 'synced just now' : 'synced ' + ago(last) + ' ago') : esc(state)}</b></p>
          <p>All ISIONXXX apps on this site share this setup. Your data is encrypted before it leaves this device.</p>
          <label>Sync code for your other devices</label><textarea rows="3" readonly>${esc(code(cfg))}</textarea>
          <p>Paste it on another device to connect it. Treat it like a password: it opens your data.</p>
          <div class="row"><button type="button" data-x="off">DISCONNECT</button><button type="button" data-x="copy">COPY CODE</button><button type="button" data-x="now">SYNC NOW</button><button type="button" class="pri" data-x="close">DONE</button></div>`;
      } else {
        d.innerHTML = `<h3>SYNC ACROSS DEVICES</h3>
          <div class="tabs"><button type="button" data-m="new" class="${mode === 'new' ? 'on' : ''}">FIRST DEVICE</button><button type="button" data-m="code" class="${mode === 'code' ? 'on' : ''}">I HAVE A SYNC CODE</button></div>
          ${mode === 'new' ? `<p>Your data goes to a private, encrypted gist on your GitHub. You need a GitHub token that can only touch gists:
            <a href="https://github.com/settings/tokens/new?scopes=gist&description=ISIONXXX%20sync" target="_blank" rel="noopener">create one here</a> (classic token, scope <b>gist</b>, no expiry or a long one).</p>
            <label>GitHub token</label><input name="token" autocomplete="off" spellcheck="false" placeholder="ghp_…">
            <label>Passphrase (encrypts your data; write it down)</label><input name="pass" type="password" autocomplete="new-password">
            <label>Existing gist id (optional, leave blank to create one)</label><input name="gist" autocomplete="off" spellcheck="false">`
          : `<label>Sync code from your other device</label><textarea name="code" rows="4" spellcheck="false"></textarea>`}
          <p class="err">${esc(note)}</p>
          <div class="row"><button type="button" data-x="close">CANCEL</button><button type="button" class="pri" data-x="go">CONNECT</button></div>`;
      }
      d.querySelectorAll('[data-m]').forEach(b => b.onclick = () => draw(b.dataset.m));
      d.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
        const x = b.dataset.x, v = n => (d.querySelector(`[name=${n}]`)?.value || '').trim();
        if (x === 'close') return d.close();
        if (x === 'now') { await sync(); return draw() }
        if (x === 'copy') { try { await navigator.clipboard.writeText(code(cfg)); b.textContent = 'COPIED' } catch (e) { d.querySelector('textarea').select() } return }
        if (x === 'off') { if (confirm('Stop syncing on this device? Your data stays here and in the gist.')) { disconnect(); draw('new') } return }
        if (x === 'go') {
          let c;
          try { c = mode === 'code' ? uncode(v('code')) : { token: v('token'), pass: v('pass'), gist: v('gist') } } catch (e) { return draw(mode, 'That sync code is not valid') }
          if (!c.token || !c.pass) return draw(mode, 'Token and passphrase are both needed');
          if (c.pass.length < 8) return draw(mode, 'Use a passphrase of at least 8 characters');
          b.textContent = 'CONNECTING…'; b.disabled = true;
          try { await connect(c); draw() } catch (e) { cfg = null; ls.removeItem(CFG); setState('off'); draw(mode, e.message || 'Could not connect') }
        }
      });
    };
    draw('new'); if (!d.open) d.showModal();
  }
  badge.onclick = dialog;

  // the badge sits in the app's header; floating bottom-left only if there is no header
  function place() {
    // next to the app's name, just before its buttons, so sync status stays visible when the buttons scroll
    const acts = document.querySelector('header.top .acts');
    if (acts) { badge.classList.add('inl'); acts.before(badge) } else { badge.classList.remove('inl'); document.body.appendChild(badge) }
  }
  function start() {
    document.head.appendChild(css); place(); paint();
    // keep it there if the app re-renders its header
    new MutationObserver(() => { if (!badge.isConnected) place() }).observe(document.body, { childList: true, subtree: true });
    if (sessionStorage.getItem('isx.sync.reloaded')) { sessionStorage.removeItem('isx.sync.reloaded'); last = Date.now(); setState('ok', 'Updated from another device') }
    if (cfg) { sync(); setInterval(() => { if (!document.hidden) sync() }, EVERY) }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg && Date.now() - last > 15e3) sync() });
    addEventListener('online', () => cfg && sync());
    setInterval(paint, 30e3);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.ISXSync = { sync, merge, dedupe, storage, get state() { return state } };   // for debugging and tests
})();
