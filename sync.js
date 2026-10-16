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
   - Setup is shared by every app on the same site: set it up once per browser. */
(() => {
  const KEYS = (document.currentScript?.dataset.keys || '').split(/\s+/).filter(Boolean);
  // data-noreload: the page re-reads its data itself (the ISIONXXX shell, whose reload would restart every app in it),
  // so a change from another device fires an 'isx-sync' event instead of reloading
  const NORELOAD = document.currentScript?.dataset.noreload != null;
  const CFG = 'isx.sync.cfg', BASE = k => 'isx.sync.base.' + k, DEL = k => 'isx.sync.del.' + k;
  const API = 'https://api.github.com/gists', EVERY = 5 * 60e3, DEBOUNCE = 2500;
  const ls = window.localStorage, setRaw = Storage.prototype.setItem;
  const get = (k, d = null) => { try { const v = ls.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } };
  const put = (k, v) => { try { setRaw.call(ls, k, JSON.stringify(v)) } catch (e) {} };
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
    setRaw.call(this, k, v);
    if (this === ls && cfg && KEYS.includes(k)) schedule();
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
  css.textContent = `#isx-sync{position:fixed;left:max(10px,env(safe-area-inset-left));bottom:calc(10px + env(safe-area-inset-bottom));z-index:8;
    font:11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;background:#0c0c0c;color:#78746a;border:1px solid #2c2c2c;padding:6px 8px;cursor:pointer;border-radius:0}
  #isx-sync.inl{position:static;flex:none;font-size:12px;padding:7px 10px;background:#070707}
  #isx-sync:hover{border-color:#ffb000;color:#ffb000}#isx-sync i{display:inline-block;width:7px;height:7px;margin-right:6px;background:#3a3a3a;vertical-align:0}
  #isx-sync.ok i{background:#33ff66}#isx-sync.busy i{background:#ffb000}#isx-sync.error i{background:#ff4545}#isx-sync.error{color:#ff4545}
  #isx-sd{margin:auto;max-height:calc(100% - 24px);overflow:auto;background:#0c0c0c;color:#d9d5c8;border:1px solid #ffb000;padding:20px;width:min(520px,calc(100vw - 24px));font:13px/1.5 'IBM Plex Mono',ui-monospace,monospace;border-radius:0}
  #isx-sd::backdrop{background:rgba(0,0,0,.78)}#isx-sd h3{margin:0 0 12px;font-size:13px;letter-spacing:.14em;color:#ffb000;font-weight:500}
  #isx-sd p{margin:0 0 10px;color:#78746a}#isx-sd b{color:#d9d5c8;font-weight:500}#isx-sd a{color:#ffb000}
  #isx-sd label{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#78746a;margin:10px 0 4px}
  #isx-sd input,#isx-sd textarea{width:100%;box-sizing:border-box;background:#070707;color:#d9d5c8;border:1px solid #2c2c2c;padding:8px 10px;font:inherit;border-radius:0}
  #isx-sd input:focus,#isx-sd textarea:focus{border-color:#ffb000;outline:0}
  #isx-sd .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}
  #isx-sd button{background:#070707;color:#d9d5c8;border:1px solid #2c2c2c;padding:7px 10px;font:12px 'IBM Plex Mono',monospace;letter-spacing:.06em;cursor:pointer;border-radius:0}
  #isx-sd button:hover{border-color:#ffb000;color:#ffb000}#isx-sd .pri{background:#ffb000;border-color:#ffb000;color:#000;font-weight:600}
  #isx-sd .tabs{display:flex;gap:6px;margin-bottom:6px}#isx-sd .tabs .on{background:#ffb000;border-color:#ffb000;color:#000}
  #isx-sd .err{color:#ff4545}#isx-sd .ok{color:#33ff66}`;
  const badge = document.createElement('button');
  badge.id = 'isx-sync'; badge.type = 'button'; badge.setAttribute('aria-label', 'Sync settings');
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h' };
  function paint() {
    badge.className = (state === 'ok' ? 'ok' : state === 'busy' ? 'busy' : state === 'error' ? 'error' : '') + (badge.parentNode?.matches?.('.acts') ? ' inl' : '');
    badge.innerHTML = '<i></i>' + ({ off: 'SYNC OFF', busy: 'SYNCING', ok: 'SYNCED ' + ago(last), error: 'SYNC ERROR', offline: 'OFFLINE', idle: 'SYNC' }[state] || 'SYNC');
    badge.title = msg || '';
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

  // the badge sits in the app's header with its other buttons; floating bottom-left only if there is no header
  function place() {
    const acts = document.querySelector('header.top .acts');
    if (acts) { badge.classList.add('inl'); acts.appendChild(badge) } else { badge.classList.remove('inl'); document.body.appendChild(badge) }
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
  window.ISXSync = { sync, merge, dedupe, get state() { return state } };   // for debugging and tests
})();
