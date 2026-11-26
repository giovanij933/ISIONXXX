'use strict';

// Tests for TODAY's sleep: the Sleep card, the night screen (check-out) and the wake screen (check-in) (index.html,
// isx.checkin.v1). Run with: SITE=… node checkin.test.js (CHROME=… for a specific browser). The page's clock is set by
// the test, so evenings, mornings and the hour after midnight are the same on every run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const SITE = path.resolve(process.env.SITE || path.join(__dirname, '../..'));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };
const KEY = 'isx.checkin.v1';
const ms = s => new Date(s).getTime();

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
  let failed = 0, passed = 0;
  const errs = [];
  const check = async (name, fn) => {
    const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/cdnjs|jsdelivr|youtube|ytimg|fonts\.g|gstatic/, r => r.abort());
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    try { await fn(p); passed++; console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n  ')); }
    await ctx.close();
  };
  // open TODAY at a given local time, with these check-ins saved before the page's own scripts run
  const open = async (p, time, store) => {
    await p.clock.install({ time: new Date(time) });
    if (store) await p.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(store)]);
    await p.goto(BASE + '#today');
    await p.evaluate(() => drawToday());
    await p.waitForTimeout(400);
  };
  const at = async (p, time) => { await p.clock.setSystemTime(new Date(time)); await p.evaluate(() => drawToday()); await p.waitForTimeout(300); };
  const store = p => p.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const card = p => p.evaluate(() => document.querySelector('#today .slpc')?.textContent.replace(/\s+/g, ' ').trim() || '');
  const tap = async (p, sel) => { await p.click(sel); await p.waitForTimeout(350); };
  const screen = p => p.evaluate(() => { const d = document.querySelector('dialog.slp[open]'); return d ? (d.classList.contains('slp-night') ? 'night' : 'wake') : null });

  await check('evening: Check out saves the bedtime in one tap and opens the night screen; the day\'s rating and Still up', async p => {
    await open(p, '2026-11-25T22:45:00');
    assert.ok(await p.$('#today .slpc [data-ci=out]'), 'Check out shows on the Sleep card at 10:45 PM');
    await tap(p, '#today [data-ci=out]');
    assert.equal(await screen(p), 'night');
    let s = await store(p);
    assert.equal(s.outs.length, 1); assert.equal(s.outs[0].night, '2026-11-25'); assert.equal(s.outs[0].id, 'co-2026-11-25'); assert.ok(Math.abs(s.outs[0].at - ms('2026-11-25T22:45:00')) < 60e3, 'bedtime is now');
    assert.match(await p.textContent('dialog.slp .slp-clock'), /10:45\s*PM/);
    const r = await p.$$('dialog.slp [role=radio]'); assert.equal(r.length, 5); await r[3].click(); await p.waitForTimeout(200);
    assert.equal((await store(p)).outs[0].day, 4, 'the day\'s rating is saved as you pick it');
    await tap(p, 'dialog.slp [data-slp=close]');
    assert.equal(await screen(p), null);
    assert.match(await card(p), /Sleeping since 10:45 PM/);
    await at(p, '2026-11-25T23:30:00'); await tap(p, '#today [data-ci=still]');
    s = await store(p);
    assert.equal(s.outs.length, 1, 'Still up moves the same night instead of adding one');
    assert.ok(Math.abs(s.outs[0].at - ms('2026-11-25T23:30:00')) < 60e3, 'bedtime moved to now'); assert.equal(s.outs[0].day, 4, 'and keeps the rating');
  });

  await check('Not yet on the night screen takes the check-out back (with Undo)', async p => {
    await open(p, '2026-11-25T22:45:00', { log: [], outs: [] });
    await tap(p, '#today [data-ci=out]');
    await tap(p, 'dialog.slp [data-slp=unout]');
    assert.equal((await store(p)).outs.length, 0);
    assert.ok(await p.$('#today [data-ci=out]'), 'Check out is back');
    await tap(p, '.ui-undo-b');
    assert.equal((await store(p)).outs.length, 1, 'Undo puts it back');
  });

  await check('morning after a check-out: the wake screen opens by itself, sleep from bedtime to now; a changed wake time counts', async p => {
    await open(p, '2026-11-26T07:10:00', { log: [], outs: [{ id: 'co-2026-11-25', night: '2026-11-25', at: ms('2026-11-25T23:30:00'), day: 4 }] });
    assert.equal(await screen(p), 'wake', 'opened by itself');
    const f = () => p.evaluate(() => ({ dur: document.querySelector('dialog.slp .slp-dur')?.textContent, bed: document.querySelector('[data-ci-t=bed]')?.value, wake: document.querySelector('[data-ci-t=wake]')?.value }));
    assert.deepEqual(await f(), { dur: '7 h 40 m', bed: '23:30', wake: '07:10' });
    await p.fill('[data-ci-t=wake]', '06:50'); await p.waitForTimeout(100);
    assert.equal((await f()).dur, '7 h 20 m');
    assert.match(await p.textContent('dialog.slp .slp-t-wake b'), /6:50\s*AM/);
    await tap(p, 'dialog.slp [data-slp=save]');
    assert.equal(await screen(p), null, 'Start my day closes it');
    const e = (await store(p)).log.find(x => x.day === '2026-11-26');
    assert.ok(e, 'saved');
    assert.equal(e.sleep, 7.3); assert.equal(e.bed, ms('2026-11-25T23:30:00')); assert.equal(e.wake, ms('2026-11-26T06:50:00'));
    // the shape every app that reads check-ins relies on
    for (const k of ['id', 'day', 'at', 'sleep', 'q', 'energy', 'w', 'u']) assert.ok(k in e, 'has ' + k);
    assert.match(await card(p), /7 h 20 m.*11:30 PM → 6:50 AM/);
    // only once a day: TODAY drawing again doesn't open it again (and it's saved anyway)
    await at(p, '2026-11-26T07:20:00'); assert.equal(await screen(p), null);
  });

  await check('without a check-out: Check in opens the wake screen with your usual bedtime, marked as a guess', async p => {
    const L = ['2026-11-22', '2026-11-23', '2026-11-24'].map(d => ({ id: 'ci-' + d, day: d, at: 0, sleep: 7.5, q: 3, energy: 3, w: null, u: 'lb',
      bed: ms(`${d}T00:00:00`) - 30 * 60e3, wake: ms(`${d}T07:00:00`) }));
    await open(p, '2026-11-26T07:10:00', { log: L, outs: [] });
    assert.equal(await screen(p), null, 'no check-out, so it waits to be asked');
    await tap(p, '#today [data-ci=wake]');
    assert.equal(await screen(p), 'wake');
    assert.equal(await p.inputValue('[data-ci-t=bed]'), '23:30', 'the usual bedtime');
    assert.match(await p.textContent('dialog.slp .slp-rv'), /bedtime guessed/);
  });

  await check('a bedtime after the wake time is refused, with nothing saved', async p => {
    await open(p, '2026-11-26T07:10:00', { log: [], outs: [{ id: 'co-2026-11-25', night: '2026-11-25', at: ms('2026-11-25T23:30:00') }] });
    await p.fill('[data-ci-t=bed]', '08:00'); await p.waitForTimeout(100);
    assert.equal(await p.textContent('dialog.slp .slp-dur'), 'Check the times');
    await tap(p, 'dialog.slp [data-slp=save]');
    assert.equal((await store(p)).log.length, 0);
    assert.equal(await screen(p), 'wake', 'the screen stays open to fix it');
  });

  await check('Clear on a saved check-in deletes it and Undo restores it', async p => {
    const e = { id: 'ci-2026-11-26', day: '2026-11-26', at: ms('2026-11-26T07:15:00'), sleep: 7.5, q: 4, energy: 4, w: 180, u: 'lb', bed: ms('2026-11-25T23:45:00'), wake: ms('2026-11-26T07:15:00') };
    await open(p, '2026-11-26T09:00:00', { log: [e] });
    await tap(p, '#today [data-ci=edit]');
    assert.equal(await screen(p), 'wake');
    await tap(p, 'dialog.slp [data-slp=clear]');
    assert.equal((await store(p)).log.length, 0, 'deleted');
    assert.ok(await p.$('#today [data-ci=wake]'), 'the card asks again');
    await tap(p, '.ui-undo-b');
    assert.deepEqual((await store(p)).log, [e], 'Undo puts it back as it was');
  });

  await check('after midnight a check-out belongs to the night before', async p => {
    await open(p, '2026-11-27T00:40:00', { log: [], outs: [] });
    await tap(p, '#today [data-ci=out]');
    assert.equal((await store(p)).outs[0].night, '2026-11-26');
    await tap(p, 'dialog.slp [data-slp=close]');
    await tap(p, '#today [data-ci=unout]');
    assert.equal((await store(p)).outs.length, 0, 'the card\'s Undo clears it');
  });

  await browser.close(); server.close();
  if (errs.length) { failed++; console.log('FAIL browser JavaScript errors\n  ' + errs.slice(0, 5).join('\n  ')); } else { passed++; console.log('PASS no browser JavaScript errors'); }
  console.log(failed ? `\nFAIL: ${failed} sleep check${failed === 1 ? '' : 's'} failed` : `\nPASS: ${passed} sleep checks`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
