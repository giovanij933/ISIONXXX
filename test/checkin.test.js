'use strict';

// Tests for TODAY's morning check-in and evening check-out (index.html, isx.checkin.v1). Run with: SITE=… node checkin.test.js
// (CHROME=… for a specific browser). The page's clock is set by the test, so evenings, mornings and the hour after
// midnight are the same on every run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const SITE = path.resolve(process.env.SITE || path.join(__dirname, '../..'));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };
const KEY = 'isx.checkin.v1';

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
  const BASE = `http://127.0.0.1:${server.address().port}/ISIONXXX/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  let failed = 0;
  const errs = [];
  const check = async (name, fn) => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/cdnjs|jsdelivr|youtube|ytimg|fonts\.g|gstatic/, r => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    try { await fn(p); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')); }
    await ctx.close();
  };
  // open TODAY at a given local time, with these check-ins already saved
  const open = async (p, time, store) => {
    await p.clock.install({ time: new Date(time) });
    // in place before the page's own scripts run, as if saved on an earlier visit
    if (store) await p.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(store)]);
    await p.goto(BASE + '#today');
    await p.evaluate(() => drawToday());
    await p.waitForTimeout(300);
  };
  const at = async (p, time) => { await p.clock.setSystemTime(new Date(time)); await p.evaluate(() => drawToday()); await p.waitForTimeout(200); };
  const store = p => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const hero = p => p.evaluate(() => [...document.querySelectorAll('#today .hero-ci')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  const tap = async (p, sel) => { await p.click(sel); await p.waitForTimeout(250); };

  await check('evening: the check-out stamps the bedtime with the day\'s rating; Still up moves it; it shows in the hero', async p => {
    await open(p, '2026-11-25T22:45:00');
    assert.ok(await p.$('#today .co'), 'the check-out card shows at 10:45 PM');
    assert.equal(await p.$('#today .ci:not(.co)'), null, 'the morning check-in form does not show in the evening');
    const r = await p.$$('#today .co [role=radio]'); assert.equal(r.length, 5); await r[3].click(); await p.waitForTimeout(200);
    await tap(p, '#today [data-ci=out]');
    let s = await store(p);
    assert.equal(s.outs.length, 1); assert.equal(s.outs[0].night, '2026-11-25'); assert.equal(s.outs[0].day, 4); assert.equal(s.outs[0].id, 'co-2026-11-25');
    assert.equal(await p.$('#today .co'), null, 'the card folds away once checked out');
    assert.match(await hero(p), /Checked out · 10:45 PM · today: good/);
    await at(p, '2026-11-25T23:30:00'); await tap(p, '#today [data-ci=out]');
    s = await store(p);
    assert.equal(s.outs.length, 1, 'Still up updates the same night instead of adding one');
    assert.equal(new Date(s.outs[0].at).getHours() * 60 + new Date(s.outs[0].at).getMinutes(), 23 * 60 + 30); assert.equal(s.outs[0].day, 4, 'and keeps the rating');
  });

  await check('morning: sleep runs from last night\'s check-out to now; a changed wake time counts; saved with both times', async p => {
    await open(p, '2026-11-26T07:10:00', { log: [], outs: [{ id: 'co-2026-11-25', night: '2026-11-25', at: new Date('2026-11-25T23:30:00').getTime(), day: 4 }] });
    const f = () => p.evaluate(() => ({ dur: document.querySelector('#today .ci-dur')?.textContent, bed: document.querySelector('[data-ci-t=bed]')?.value, wake: document.querySelector('[data-ci-t=wake]')?.value }));
    assert.deepEqual(await f(), { dur: '7 h 40 m', bed: '23:30', wake: '07:10' });
    assert.equal(await p.$('#today .ci .ui-stepper'), null, 'no hours stepper when the times are known');
    await p.fill('[data-ci-t=wake]', '06:50'); await p.waitForTimeout(100);
    assert.equal((await f()).dur, '7 h 20 m');
    await tap(p, '#today [data-ci=save]');
    const e = (await store(p)).log.find(x => x.day === '2026-11-26');
    assert.ok(e, 'saved');
    assert.equal(e.sleep, 7.3); assert.equal(e.bed, new Date('2026-11-25T23:30:00').getTime()); assert.equal(e.wake, new Date('2026-11-26T06:50:00').getTime());
    // the shape every app that reads check-ins relies on
    for (const k of ['id', 'day', 'at', 'sleep', 'q', 'energy', 'w', 'u']) assert.ok(k in e, 'has ' + k);
    assert.match(await hero(p), /Check-in · 7 h 20 m sleep \(bed 11:30 PM\)/);
  });

  await check('a bedtime after the wake time is refused, with nothing saved', async p => {
    await open(p, '2026-11-26T07:10:00', { log: [], outs: [{ id: 'co-2026-11-25', night: '2026-11-25', at: new Date('2026-11-25T23:30:00').getTime() }] });
    await p.fill('[data-ci-t=bed]', '08:00'); await p.waitForTimeout(100);
    assert.equal(await p.textContent('#today .ci-dur'), 'Check the times');
    await tap(p, '#today [data-ci=save]');
    assert.equal((await store(p)).log.length, 0);
  });

  await check('Clear deletes today\'s check-in and brings the form back; Undo restores it', async p => {
    const e = { id: 'ci-2026-11-26', day: '2026-11-26', at: Date.parse('2026-11-26T07:15:00'), sleep: 7.5, q: 4, energy: 4, w: 180, u: 'lb' };
    await open(p, '2026-11-26T09:00:00', { log: [e] });
    await tap(p, '#today [data-ci=edit]');
    await tap(p, '#today [data-ci=clear]');
    assert.equal((await store(p)).log.length, 0, 'deleted');
    assert.ok(await p.$('#today .ci'), 'the form is back');
    await tap(p, '.ui-undo-b');
    assert.deepEqual((await store(p)).log, [e], 'Undo puts it back as it was');
  });

  await check('after midnight a check-out belongs to the night before; its Clear removes it', async p => {
    await open(p, '2026-11-27T00:40:00', { log: [], outs: [] });
    assert.match(await p.textContent('#today .co h2'), /Good night/);
    await tap(p, '#today [data-ci=out]');
    assert.equal((await store(p)).outs[0].night, '2026-11-26');
    await tap(p, '#today [data-ci=unout]');
    assert.equal((await store(p)).outs.length, 0);
    assert.ok(await p.$('#today .co'), 'the check-out card is back');
  });

  await check('without a check-out the morning check-in keeps the hours stepper', async p => {
    await open(p, '2026-11-26T07:10:00', { log: [], outs: [] });
    assert.ok(await p.$('#today .ci .ui-stepper'));
    assert.equal(await p.$('[data-ci-t]'), null);
  });

  await browser.close(); server.close();
  if (errs.length) { failed++; console.log('FAIL browser JavaScript errors\n  ' + errs.slice(0, 5).join('\n  ')); } else console.log('PASS no browser JavaScript errors');
  console.log(failed ? `\nFAIL: ${failed} check-in check${failed === 1 ? '' : 's'} failed` : '\nPASS: 7 check-in checks');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
