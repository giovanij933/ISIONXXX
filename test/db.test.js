'use strict';

// Tests for db.js, the shared layer that keeps every app's data in IndexedDB. Run with: SITE=… node db.test.js
// (CHROME=… for a specific browser). Each check uses a fresh browser context, so a fresh localStorage and database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const SITE = path.resolve(process.env.SITE || path.join(__dirname, '../..'));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };
// the browser's own localStorage methods, kept before db.js routes them: the way an app that hasn't updated (no db.js)
// reads and writes
const RAW = `window.__raw = { set: Storage.prototype.setItem, get: Storage.prototype.getItem, del: Storage.prototype.removeItem }`;
const sample = { MEDITATE: 'sample()', rewire: 'sample()', TRAINING: 'sample()' };   // the apps' own loaders (the button only shows on an empty app)
// everything in the database, as {key: value}
const dump = `new Promise((res, rej) => { const r = indexedDB.open('isx', 1); r.onsuccess = () => { const s = r.result.transaction('kv').objectStore('kv'), out = {};
  const c = s.openCursor(); c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue() } else { r.result.close(); res(out) } }; c.onerror = () => rej(c.error) }; r.onerror = () => rej(r.error) })`;

async function main() {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = path.resolve(SITE, '.' + pathname);
      if (!file.startsWith(SITE + path.sep)) { res.writeHead(403).end(); return; }
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  let checks = 0;
  const pass = name => { checks++; console.log('PASS', name); };
  const errors = [];
  const fresh = async (init = '') => {
    const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    await c.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg|googleapis/, r => r.abort());
    await c.addInitScript(RAW + ';' + init);
    return c;
  };
  const open = async (c, app) => {
    const p = await c.newPage(); p.on('pageerror', e => errors.push(`${app}: ${e.message}`)); p.on('dialog', d => d.accept());
    await p.goto(BASE + app + '/'); await p.waitForFunction(() => window.ISXDB && document.documentElement.classList.contains('ui-ready'));
    await p.evaluate(() => ISXDB.ready); return p;
  };
  const settle = p => p.evaluate(() => new Promise(r => setTimeout(() => { ISXDB.flush(); setTimeout(r, 150) }, 50)));
  // fill localStorage until only `room` characters are left, written the old way so db.js doesn't manage the filler
  const fill = (p, room) => p.evaluate(room => {
    let lo = 0, hi = 6e6;
    while (hi - lo > 4) { const m = (lo + hi) >> 1; try { __raw.set.call(localStorage, 'zz.fill', 'x'.repeat(m)); lo = m } catch (e) { hi = m } }
    __raw.set.call(localStorage, 'zz.fill', 'x'.repeat(Math.max(0, lo - room)));
  }, room);
  try {
    {
      // 1. existing data moves into the database the first time an app opens with db.js
      const c = await fresh(`if (!sessionStorage.seeded) { sessionStorage.seeded = 1;
        __raw.set.call(localStorage, 'isx.mind.v1', JSON.stringify({ log: [{ id: 'a1', at: Date.now() - 864e5, kind: 'M', tech: 'Breath counting', mins: 10, pre: 5, post: 6, depth: 6, note: '' }], notes: {}, goal: 70 })) }`);
      const p = await open(c, 'MEDITATE'); await settle(p);
      const d = await p.evaluate(dump), ls = await p.evaluate(() => __raw.get.call(localStorage, 'isx.mind.v1'));
      assert.equal(d['isx.mind.v1'], ls, 'the database holds what localStorage held');
      assert.equal(await p.evaluate(() => S.log.length), 1);
      pass('existing data moves into the database on first open');
      // 2. saves land in both
      await p.evaluate(sample.MEDITATE); await settle(p);
      const d2 = await p.evaluate(dump), ls2 = await p.evaluate(() => __raw.get.call(localStorage, 'isx.mind.v1'));
      assert.equal(d2['isx.mind.v1'], ls2); assert.ok(JSON.parse(ls2).log.length > 300);
      pass('every save lands in the database and in the localStorage copy');
      // 3. an app without db.js writes and deletes directly in localStorage: the next open takes both into the database
      await p.evaluate(() => { const s = JSON.parse(__raw.get.call(localStorage, 'isx.mind.v1')); s.log.push({ id: 'old-app', at: Date.now() - 6e4, kind: 'J', tech: 'Free write', mins: 5, pre: null, post: null, depth: null, note: 'written by an old copy' });
        __raw.set.call(localStorage, 'isx.mind.v1', JSON.stringify(s)); __raw.set.call(localStorage, 'isx.mind.run', '{"x":1}') });
      await settle(p); await p.evaluate(() => __raw.del.call(localStorage, 'isx.mind.run'));
      await p.reload(); await p.waitForFunction(() => window.ISXDB); await p.evaluate(() => ISXDB.ready); await settle(p);
      const d3 = await p.evaluate(dump);
      assert.ok(JSON.parse(d3['isx.mind.v1']).log.some(e => e.id === 'old-app'), 'the old copy\'s write reached the database');
      assert.ok(!('isx.mind.run' in d3), 'the old copy\'s deletion reached the database');
      assert.ok(await p.evaluate(() => S.log.some(e => e.id === 'old-app')));
      pass('writes and deletions by an app without db.js are taken into the database on the next open');
      await c.close();
    }
    {
      // 4. full localStorage: the key lives in the database alone, the save succeeds, and the data is all there after a
      // reload (the app waits for the database) and in the other apps that read it
      const c = await fresh();
      const p = await open(c, 'rewire'); await fill(p, 60000);
      await p.evaluate(sample.rewire); await settle(p);
      const st = await p.evaluate(() => ({ n: S.log.length, only: JSON.parse(__raw.get.call(localStorage, 'isx.db.only') || '[]'), copy: __raw.get.call(localStorage, 'isx.rewire.v1'), full: !!document.getElementById('isx-full') }));
      assert.ok(st.n > 2000, 'the sample loaded'); assert.deepEqual(st.only, ['isx.rewire.v1']); assert.equal(st.copy, null, 'the copy was removed to free the space');
      assert.equal(st.full, false, 'no "storage is full" banner: nothing was lost');
      const d = await p.evaluate(dump); assert.equal(JSON.parse(d['isx.rewire.v1']).log.length, st.n);
      await p.reload(); await p.waitForFunction(() => document.documentElement.classList.contains('ui-ready'));
      assert.equal(await p.evaluate(() => S.log.length), st.n, 'after a reload the app reads it from the database');
      pass('past the localStorage limit a key lives in the database alone, and the app reads it back on open');
      // the shell and LEARN read REWIRE's data too
      const l = await open(c, 'data-analytics');
      assert.ok(await l.evaluate(() => DATA.src.habits === 'REWIRE' && DATA.tab.habits.length > 2000), 'LEARN reads REWIRE from the database');
      pass('other apps read a key that lives in the database alone');
      // 5. a save to it keeps it there; another open tab of the app sees the change
      const q = await open(c, 'rewire');
      await p.evaluate(() => { S.log.push({ id: 'live', at: Date.now() - 6e4, t: 'done', g: 'Drink water', note: '' }); save() }); await settle(p);
      await q.waitForFunction(() => S.log.some(e => e.id === 'live'), null, { timeout: 5000 });
      pass('another open tab of the app hears about the change');
      await c.close();
    }
    {
      // 6. a key moving into the database in one tab never reads as empty in another (the 'storage' deletion may arrive
      // before the new value)
      const c = await fresh();
      const a = await open(c, 'TRAINING'); await a.evaluate(sample.TRAINING); await settle(a);
      const b = await open(c, 'TRAINING'), n0 = await b.evaluate(() => S.log.length);
      await b.evaluate(() => { window.__min = Infinity; addEventListener('storage', () => { __min = Math.min(__min, S.log.length) }) });
      await fill(a, 0);   // no room left: even the one entry this save adds doesn't fit
      await a.evaluate(() => { S.log.push({ id: 'moved', at: Date.now() - 6e4, ex: 'Plank', type: 'S', sets: 2, reps: 45, load: 0, dist: 0, mins: 0, rpe: null, note: '' }); save() });
      await settle(a); await b.waitForFunction(() => S.log.some(e => e.id === 'moved'), null, { timeout: 5000 });
      assert.ok(await b.evaluate(() => __min) >= n0, 'the other tab never saw its data vanish');
      assert.deepEqual(await a.evaluate(() => JSON.parse(__raw.get.call(localStorage, 'isx.db.only'))), ['isx.training.v1']);
      pass('a key moving into the database never reads as empty in another tab');
      await c.close();
    }
    {
      // 6b. the same move, reaching a tab whose copy of the list is behind: another browser process gets the deletion,
      // the list and the new value one by one, in any order. __behind() freezes this page's view of isx.db.only until
      // the list's own 'storage' event arrives (a capture listener registered before db.js's)
      const c = await fresh(`{ const g = Storage.prototype.getItem; let frozen;
        window.__behind = () => { frozen = { v: g.call(localStorage, 'isx.db.only') } };
        addEventListener('storage', e => { if (e.key === 'isx.db.only') frozen = undefined }, true);
        Storage.prototype.getItem = function (k) { return frozen && this === localStorage && k === 'isx.db.only' ? frozen.v : g.call(this, k) } }`);
      const a = await open(c, 'TRAINING'); await a.evaluate(sample.TRAINING); await settle(a);
      const b = await open(c, 'TRAINING'), n0 = await b.evaluate(() => S.log.length);
      await b.evaluate(() => { window.__min = Infinity; addEventListener('storage', () => { __min = Math.min(__min, S.log.length) }); __behind() });
      await fill(a, 0);
      await a.evaluate(() => { S.log.push({ id: 'moved', at: Date.now() - 6e4, ex: 'Plank', type: 'S', sets: 2, reps: 45, load: 0, dist: 0, mins: 0, rpe: null, note: '' }); save() });
      await settle(a); await b.waitForFunction(() => S.log.some(e => e.id === 'moved'), null, { timeout: 5000 });
      assert.ok(await b.evaluate(() => __min) >= n0, 'the other tab never saw its data vanish, though its list was behind');
      assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('isx.training.v1')).log.length), n0 + 1);
      pass('a key moving into the database never reads as empty in a tab whose list is behind');
      // a real deletion still reaches the other tab
      await a.evaluate(() => __raw.set.call(localStorage, 'zz.fill', 'x'));   // room again
      await a.evaluate(() => localStorage.setItem('isx.t', '1'));
      await b.waitForFunction(() => localStorage.getItem('isx.t') === '1', null, { timeout: 5000 });
      await b.evaluate(() => { window.__gone = 0; addEventListener('storage', e => { if (e.key === 'isx.t' && e.newValue == null && localStorage.getItem('isx.t') == null) __gone++ }) });
      await a.evaluate(() => localStorage.removeItem('isx.t'));
      await b.waitForFunction(() => __gone === 1, null, { timeout: 5000 });
      pass('a real deletion still reaches the other tab');
      await c.close();
    }
    {
      // 7. no IndexedDB: everything works on localStorage, as before db.js
      const c = await fresh(`Object.defineProperty(window, 'indexedDB', { value: undefined })`);
      const p = await open(c, 'MEDITATE'); await p.evaluate(sample.MEDITATE); await settle(p);
      assert.equal(await p.evaluate(() => ISXDB.on), false);
      assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('isx.mind.v1')).log.length > 300));
      await p.reload(); await p.waitForFunction(() => document.documentElement.classList.contains('ui-ready'));
      assert.ok(await p.evaluate(() => S.log.length > 300));
      pass('without IndexedDB everything stays in localStorage');
      await c.close();
    }
    assert.deepEqual(errors, [], 'no page errors');
    pass('no browser JavaScript errors');
    console.log(`PASS: ${checks} database checks`);
  } finally {
    await browser.close(); server.close();
  }
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
