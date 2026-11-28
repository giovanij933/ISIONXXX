'use strict';

// Saved data is never markup. Every app's sample year, then a marker planted in each saved value: every text (MODE
// strings) or every number that isn't a time (MODE numbers), the way a restored backup file or a synced copy could
// hold anything there. The marker " data-xss '><i data-xss></i><img src=x onerror=…> becomes a data-xss attribute (in
// an attribute: the player's address in LEARN's video frame was one) or a real <i data-xss> element (in text) if a page
// puts the value into its markup as it is, and calls __x() if it runs. Each app is opened, then its header's
// sheets and the views that once let one in (JOURNAL's weekly review, NUTRITION's cook mode, REWIRE's habits, a LEARN
// lesson with a pinned video), and TODAY with every app's frame. A value that gets in fails the run, with where it
// was saved and what showed it. Run with: SITE=… node stored.test.js (CHROME=… for a specific browser).
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const SITE = path.resolve(process.env.SITE || path.join(__dirname, '../..'));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };
const S = "document.querySelector('[data-a=sample]').click()";
// each app: how its sample is loaded, and the views beyond its header's actions that show saved values
const APPS = {
  JOURNAL: { sample: S, more: ['week', 'review', 'edit'] },
  MEDITATE: { sample: S, more: ['review', 'edit'] },
  TRAINING: { sample: S, more: ['review', 'edit'] },
  nutrition: { sample: "doAct('demo')", more: ['cook', 'review', 'data'] },
  rewire: { sample: S, more: ['habits', 'review', 'edit'] },
  'data-analytics': { sample: 'sample()', more: ['catalog', 'data', "js:openLesson('sql1')"] },
};
// header actions that change or send data, or leave the page: not tapped
const SKIP = /sample|demo|imp|exp|csv|sync|del|clear|reset|restore|backup|go|startnext|cook$|urge|x$/i;

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
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  let failed = 0, passed = 0;
  const report = [];
  const once = async () => { failed = 0; passed = 0; report.length = 0; for (const MODE of ['strings', 'numbers']) await run(MODE) };
  const run = async MODE => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/cdnjs|jsdelivr|youtube|ytimg|fonts\.g|gstatic/, r => r.abort());
    await ctx.addInitScript(() => { window.__x = n => { try { (top.__X = top.__X || []).push(n) } catch (e) { } } });
    const p = await ctx.newPage();
    p.on('dialog', d => d.dismiss().catch(() => { }));
    // every app's sample year, then what the samples don't have: JOURNAL's daily plans, LEARN's pinned videos and
    // drafts, a REWIRE tick with an amount, a feeling and the app it came from, and a week of check-ins
    for (const [a, c] of Object.entries(APPS)) { await p.goto(BASE + a + '/'); await p.waitForTimeout(500); await p.evaluate(c.sample).catch(() => { }); await p.waitForTimeout(1500) }
    await p.evaluate(() => {
      const now = Date.now(), day = k => new Date(now - k * 864e5).toISOString().slice(0, 10), get = k => JSON.parse(localStorage.getItem(k)), put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
      const J = get('isx.journal.v1'); J.plans = {}; for (let k = 0; k < 6; k++) J.plans[day(k)] = { focus: 'patience', rule: 'Wait for the setup', short: 'Be patient', why: 'Chasing costs me', loss: 500, ticks: { ml: true } }; J.maxLoss = 400; put('isx.journal.v1', J);
      put('xl.videos.v1', { sql1: { id: 'dQw4w9WgXcQ', start: 30 } }); put('xl.drafts.v1', { sql1: 'SELECT 1' });
      const R = get('isx.rewire.v1'); R.log.push({ id: 'xtra1', at: now - 36e5, t: 'done', g: R.good[0].name, amt: 10, unit: 'min', feel: 7, src: 'MIND', det: '10 min walk' }); put('isx.rewire.v1', R);
      const L = []; for (let i = 0; i < 7; i++) { const k = day(i); L.push({ id: 'ci-' + k, day: k, at: now - i * 864e5, sleep: 7.5, q: 4, energy: 3, w: 175, u: 'lb', bed: '23:00', wake: '06:30' }) } put('isx.checkin.v1', { log: L, outs: [] });
    });
    // the markers: one per saved value (the same value gets the same one, so ids still match each other)
    const table = await p.evaluate(MODE => {
      const T = [], idx = new Map(), mk = n => `" data-xss=${n} '><i data-xss=${n}></i><img src=x onerror=__x(${n})>`;
      const id = (v, at) => { if (!idx.has(v)) { idx.set(v, T.length); T.push(at) } return idx.get(v) };
      const walk = (x, at) => {
        // a row's kind stays (MIND's kind, TRAINING's type, REWIRE's t): the app drops a row of a kind it doesn't know, and
        // the row's other values are what's being tested
        if (typeof x === 'string') return MODE === 'strings' && !x.startsWith('<') && !/^isx\.(mind|training|rewire)\.v1\.log\[\d+\]\.(kind|type|t)$/.test(at) ? x + mk(id(x, at)) : x;
        if (typeof x === 'number') return MODE === 'numbers' && Math.abs(x) < 1e11 ? x + mk(id('#' + at, at)) : x;
        if (Array.isArray(x)) return x.map((y, i) => walk(y, at + '[' + i + ']'));
        if (x && typeof x === 'object') { const o = {}; for (const [k, y] of Object.entries(x)) o[k] = walk(y, at + '.' + k); return o }
        return x;
      };
      const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const k of keys) {
        if (/^isx\.plan\./.test(k)) { localStorage.removeItem(k); continue }   // rebuilt by each app from what it reads
        if (/^isx\.(sync|db\.|theme)/.test(k)) continue;
        let j; try { j = JSON.parse(localStorage.getItem(k)) } catch (e) { continue }
        if (j && typeof j === 'object') localStorage.setItem(k, JSON.stringify(walk(j, k)));
      }
      return T;
    }, MODE);
    const got = new Map();
    const look = async where => {
      const r = await p.evaluate(() => {
        const s = new Set(); const scan = d => { try { d.querySelectorAll('[data-xss]').forEach(e => s.add(+e.getAttribute('data-xss'))); d.querySelectorAll('iframe').forEach(f => { try { scan(f.contentDocument) } catch (e) { } }) } catch (e) { } };
        scan(document); return [...s, ...(window.__X || []).splice(0)];
      }).catch(() => []);
      for (const n of r) if (!got.has(n)) got.set(n, where);
    };
    const shut = () => p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => { try { d.close() } catch (e) { } }); document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden')) }).catch(() => { });
    for (const [a, c] of Object.entries(APPS)) {
      await p.goto(BASE + a + '/'); await p.waitForTimeout(1800); await look(a);
      const acts = await p.evaluate(SKIP => [...document.querySelectorAll('header [data-a],header [data-act]')].map(b => b.dataset.a || b.dataset.act).filter(x => !new RegExp(SKIP, 'i').test(x)), SKIP.source);
      for (const act of [...new Set([...acts, ...c.more])]) {
        // a view with no button of its own is opened by the app's own function (js:…)
        const ok = act.startsWith('js:') ? await p.evaluate(act.slice(3)).then(() => true, () => false)
          : await p.evaluate(act => { const b = document.querySelector(`[data-a="${act}"],[data-act="${act}"]`); if (!b) return false; b.click(); return true }, act).catch(() => false);
        if (!ok) continue;
        await p.waitForTimeout(500); await look(`${a} › ${act}`); await shut(); await p.waitForTimeout(150);
      }
    }
    await p.goto(BASE + 'ISIONXXX/#today'); await p.waitForTimeout(2500); await look('TODAY');
    for (const t of ['mind', 'training', 'nutrition', 'learn', 'journal', 'rewire']) { await p.evaluate(t => { try { show(t) } catch (e) { } }, t); await p.waitForTimeout(1800); await look('TODAY › ' + t) }
    const name = `saved ${MODE} stay text in every app and TODAY (${table.length} values marked)`;
    const log = l => report.push(l);
    if (got.size) {
      failed++; log('FAIL ' + name);
      // one line per field (trades[651].id and trades[650].id are the same hole), with the first view that showed it
      const by = new Map();
      for (const [n, where] of got) { const f = String(table[n] || '?').replace(/\[\d+\]/g, '[]').replace(/\.\d{4}-\d\d-\d\d\b/g, '.<day>').replace(/\.(sql|py|tab|sas)\d+\./g, '.<lesson>.'); if (!by.has(f)) by.set(f, where) }
      for (const [f, where] of by) log(`  ${f} got into the page (${where})`);
    } else { passed++; log('PASS ' + name) }
    await ctx.close();
  };
  await once();
  // on main, a fix lands as several merges a minute or so apart, and this run can find an app not merged yet: there the
  // other apps' main is fetched again every 2 minutes, up to twice, before a failure counts (as ship.js does for drift)
  if (failed && process.env.BRANCH === 'main') {
    const wait = +(process.env.DRIFT_WAIT || 120), { execSync } = require('node:child_process'), fss = require('node:fs');
    for (let i = 1; i <= 2 && failed; i++) {
      console.log(`saved data got into a page on main: fetching the other apps' main again in ${wait} s (${i} of 2)`);
      await new Promise(r => setTimeout(r, wait * 1000));
      for (const a of Object.keys(APPS).concat('ISIONXXX')) {
        const dir = path.join(SITE, a);
        try { if (fss.lstatSync(dir).isSymbolicLink() || !fss.existsSync(path.join(dir, '.git'))) continue; execSync(`git -C "${dir}" fetch -q origin main && git -C "${dir}" reset -q --hard FETCH_HEAD`, { stdio: 'ignore' }) } catch (e) { }
      }
      await once();
    }
  }
  report.forEach(l => console.log(l));
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1) });
