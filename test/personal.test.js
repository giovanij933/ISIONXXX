'use strict';

// Run with: CHROME=/usr/bin/chromium node personal.test.js
// Uses the seven sibling checkouts without touching their application data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
// The folder holding all seven checkouts by their Pages names: $SITE (ci.sh sets it), else this checkout's parent.
const SITE = path.resolve(process.env.SITE || path.join(__dirname, '../..'));
const KEY = 'isx.personal.intention.v1';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

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
  let browser;
  let checks = 0;
  const pass = name => { checks++; console.log('PASS', name); };
  try {
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const context = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1440, height: 1000 } });
    await context.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const home = origin + '/ISIONXXX/personal/';
    await page.clock.install({ time: new Date('2026-11-02T12:00:00Z') });
    await page.goto(home);
    assert.equal(await page.title(), 'ISIONXXX — A little more intentional');
    assert.equal(await page.locator('.app-card').count(), 7);
    pass('homepage loads all seven tools');

    for (const [filter, count] of [['body', 2], ['mind', 2], ['growth', 2], ['all', 7]]) {
      await page.locator(`[data-filter="${filter}"]`).click();
      assert.equal(await page.locator('.app-card:visible').count(), count);
      assert.equal(await page.locator('[data-filter][aria-pressed="true"]').count(), 1);
      assert.equal(await page.locator(`[data-filter="${filter}"]`).getAttribute('aria-pressed'), 'true');
    }
    pass('filters show the correct categories and pressed states');

    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    }
    pass('no horizontal overflow at 320–1920px');
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.locator('#edit-focus').click();
    await page.locator('#focus-form button[type="submit"]').click();
    assert.match(await page.locator('#focus-error').textContent(), /Add a few words/);
    await page.locator('#focus-input').fill('Make room for curiosity.');
    await page.locator('#focus-form button[type="submit"]').click();
    assert.equal(await page.locator('#focus-dialog').isVisible(), false);
    assert.equal(await page.locator('#intention-text').textContent(), 'Make room for curiosity.');
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY), { date: '2026-11-02', text: 'Make room for curiosity.' });
    await page.reload();
    assert.equal(await page.locator('#intention-text').textContent(), 'Make room for curiosity.');
    await page.locator('#edit-focus').click();
    assert.equal(await page.locator('#focus-input').inputValue(), 'Make room for curiosity.');
    await page.locator('#focus-input').fill('<img src=x onerror=alert(1)>');
    await page.locator('#focus-form button[type="submit"]').click();
    assert.equal(await page.locator('#intention-text').textContent(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#intention-text img').count(), 0);
    await page.locator('#edit-focus').click();
    await page.locator('#clear-focus').click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
    assert.match(await page.locator('#intention-text').textContent(), /What deserves/);
    pass('intention validation, save, persistence, edit, literal text and clear');

    for (const value of ['{broken', '42', '[]', '{"date":"2026-11-02","text":42}', '{"date":"2026-11-01","text":"Yesterday"}']) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, value]);
      await page.reload();
      assert.match(await page.locator('#intention-text').textContent(), /What deserves/);
    }
    pass('corrupted, wrong-type and previous-day notes show the empty state');

    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ date: '2026-11-02', text: 'Current day' })), KEY);
    await page.reload();
    await page.clock.fastForward(13 * 60 * 60 * 1000);
    assert.match(await page.locator('#intention-text').textContent(), /What deserves/);
    assert.equal(await page.locator('#today-date').getAttribute('datetime'), '2026-11-03');
    pass('an open page clears yesterday’s note across midnight');

    await page.locator('#edit-focus').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#focus-dialog').isVisible(), false);
    assert.equal(await page.locator('#edit-focus').evaluate(el => document.activeElement === el), true);
    pass('Escape closes the editor and restores focus');

    const axe = await fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
    await page.addScriptTag({ content: axe });
    let violations = await page.evaluate(async () => (await axe.run()).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`));
    assert.deepEqual(violations, [], 'homepage accessibility');
    await page.locator('#edit-focus').click();
    violations = await page.evaluate(async () => (await axe.run()).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`));
    assert.deepEqual(violations, [], 'editor accessibility');
    await page.locator('#close-focus').click();
    pass('axe accessibility passes for page and open editor');

    // Phones: the apps' floor of 11 px text and 44 px targets, and the editor sheet closes with a swipe down (ui.js).
    const phone = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await phone.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(home);
    // measured once the cards' entrance animations have landed (the cursor blink never ends, so it's left out)
    await mobile.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getComputedTiming().endTime < Infinity).map(a => a.finished)));
    const cramped = await mobile.evaluate(() => {
      const shown = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'; };
      const small = [...document.querySelectorAll('a,button,textarea')].filter(shown).map(el => [el, el.getBoundingClientRect()])
        .filter(([, r]) => Math.min(r.width, r.height) < 44).map(([el, r]) => `target ${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      const tiny = [...document.querySelectorAll('body *')].filter(shown)
        .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11)
        .map(el => `text ${el.className || el.tagName}: ${el.textContent.trim().slice(0, 24)}`);
      return small.concat(tiny);
    });
    assert.deepEqual(cramped, [], 'phone text and touch targets');
    await mobile.locator('#edit-focus').tap();
    const box = await mobile.locator('#focus-dialog h2').boundingBox();
    const cdp = await phone.newCDPSession(mobile);
    const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + 20, y }] });
    await touch('touchStart', box.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', box.y + i * 30); await mobile.waitForTimeout(16); }
    await touch('touchEnd');
    await mobile.locator('#focus-dialog').waitFor({ state: 'hidden' });
    await phone.close();
    pass('phones: 11 px text, 44 px targets, and the editor swipes closed');

    for (const [hash, app] of [['today', null], ['mind', 'MEDITATE'], ['training', 'TRAINING'], ['nutrition', 'nutrition'], ['learn', 'data-analytics'], ['journal', 'JOURNAL'], ['rewire', 'rewire']]) {
      await page.goto(home);
      await page.locator(`.app-card[href="../#${hash}"]`).click();
      await page.locator(`#tabs [data-t="${hash}"].on`).waitFor();
      assert.equal(new URL(page.url()).hash, '#' + hash);
      if (app) {
        const frame = page.frameLocator(`#f-${hash}`);
        await frame.locator('h1.brand').waitFor();
        assert.match(await page.locator(`#f-${hash}`).getAttribute('src'), new RegExp(app));
      } else await page.locator('#today.on').waitFor();
    }
    pass('all seven card links open their matching shell tabs and app content');
    assert.deepEqual(errors, [], 'browser page errors');
    pass('no browser JavaScript errors');
    console.log(`PASS: ${checks} personal-site checks`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
