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
const APPS = ['today', 'mind', 'training', 'nutrition', 'learn', 'journal', 'rewire'];
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

async function main() {
  // no signal: the server drops every connection. (context.setOffline doesn't reach the service worker's own requests,
  // so it can't show whether the app really opens from its cache.)
  let offline = false;
  const server = http.createServer(async (req, res) => {
    if (offline) { req.socket.destroy(); return; }
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

    // the app map, the cards and the affirmation use the same seven icons as the TODAY shell's tab bar (TABS in
    // ISIONXXX/index.html)
    const shell = await fs.readFile(path.join(SITE, 'ISIONXXX/index.html'), 'utf8');
    for (const file of ['personal/index.html', 'personal/affirmation/index.html']) {
      const html = await fs.readFile(path.join(SITE, 'ISIONXXX', file), 'utf8');
      for (const id of APPS) {
        const tab = (shell.match(new RegExp(`\\{id:'${id}',[^}]*?icon:'([^']*)'\\}`)) || [])[1];
        const copy = (html.match(new RegExp(`<symbol id="i-${id}" viewBox="0 0 24 24"><g [^>]*>([\\s\\S]*?)</g></symbol>`)) || [])[1];
        assert.ok(tab, `no ${id} tab icon in ISIONXXX/index.html`);
        assert.equal(copy, tab, `${file}'s ${id} icon differs from the tab bar's: copy it over`);
      }
    }
    pass('the seven app icons match the tab bar');

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
    const violations = () => page.evaluate(async () => (await axe.run()).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`));
    await page.addScriptTag({ content: axe });
    assert.deepEqual(await violations(), [], 'homepage accessibility');
    await page.locator('#edit-focus').click();
    assert.deepEqual(await violations(), [], 'editor accessibility');
    await page.locator('#close-focus').click();
    pass('axe accessibility passes for page and open editor');

    // the header's button opens the affirmation: one statement for each app, in the apps' order, and each opens its app
    const affirmation = home + 'affirmation/';
    await page.goto(home);
    assert.equal((await page.locator('.header-cta').textContent()).trim(), 'My affirmation');
    await page.locator('.header-cta').click();
    await page.waitForURL(affirmation);
    assert.equal(await page.title(), 'ISIONXXX — My affirmation');
    // shown at once: ui.css keeps a page hidden until ui.js has started
    await page.locator('html.ui-ready #aff-title').waitFor();
    assert.deepEqual(await page.locator('.aff-line').evaluateAll(links => links.map(a => a.getAttribute('href'))), APPS.map(id => `../../#${id}`));
    for (const text of await page.locator('.aff-line p').allTextContents()) assert.match(text, /^\S.{30,}\.$/, `a full statement: ${text}`);
    assert.match(await page.locator('.aff-close').textContent(), /one day at a time/);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `affirmation overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // measured at rest: while the card is still fading in, its text is fainter than it will be
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getComputedTiming().endTime < Infinity).map(a => a.finished.catch(() => {}))));
    await page.addScriptTag({ content: axe });
    assert.deepEqual(await violations(), [], 'affirmation accessibility');
    await page.locator('.aff-line[href="../../#mind"]').click();
    await page.locator('#tabs [data-t="mind"].on').waitFor();
    await page.goto(affirmation);
    await page.locator('.aff-actions .button').click();
    await page.waitForURL(origin + '/ISIONXXX/#today');
    await page.locator('#today.on').waitFor();
    for (const back of ['.header .wordmark', '.header-cta', '.aff-actions .text-link']) {
      await page.goto(affirmation);
      await page.locator(back).click();
      await page.waitForURL(home);
      await page.locator('#hero-title').waitFor();
    }
    pass('the header opens the affirmation: a statement for each app, each opening its app, and a way back');

    // Phones: the apps' floor of 11 px text and 44 px targets, and the editor sheet closes with a swipe down (ui.js).
    const phone = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await phone.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
    const mobile = await phone.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    // the affirmation first, then the homepage, where the editor is
    for (const url of [home + 'affirmation/', home]) {
      await mobile.goto(url);
      // measured once the cards' entrance animations have landed (the cursor blink never ends, so it's left out)
      await mobile.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect.getComputedTiming().endTime < Infinity).map(a => a.finished.catch(() => {}))));
      const cramped = await mobile.evaluate(() => {
        const shown = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'; };
        const small = [...document.querySelectorAll('a,button,textarea')].filter(shown).map(el => [el, el.getBoundingClientRect()])
          .filter(([, r]) => Math.min(r.width, r.height) < 44).map(([el, r]) => `target ${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
        const tiny = [...document.querySelectorAll('body *')].filter(shown)
          .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11)
          .map(el => `text ${el.className || el.tagName}: ${el.textContent.trim().slice(0, 24)}`);
        return small.concat(tiny);
      });
      assert.deepEqual(cramped, [], `phone text and touch targets: ${url.slice(origin.length)}`);
    }
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

    // and back: every app's name in its header (ui.js) opens this page, taking the whole window when inside the shell
    for (const hash of ['today', 'mind', 'training', 'nutrition', 'learn', 'journal', 'rewire']) {
      await page.goto(origin + '/ISIONXXX/#' + hash);
      const scope = hash === 'today' ? page.locator('#today') : page.frameLocator(`#f-${hash}`);
      // the name shows as the ISIONXXX mark, still named for screen readers
      assert.equal(await scope.getByRole('img', { name: 'ISIONXXX' }).count(), 1, `${hash}: the ISIONXXX mark`);
      await scope.locator('header.top .brand a').click({ position: { x: 12, y: 14 } });
      await page.waitForURL(home);
      await page.locator('#hero-title').waitFor();
    }
    pass('every app’s header shows the ISIONXXX mark and opens the homepage, from inside the shell too');

    // the installed app (navigator.standalone, as on an iPhone's home screen) opens on this page, once per launch,
    // with no signal too: the shell's service worker keeps it
    const app = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await app.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
    await app.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }));
    const launch = async () => {
      const tab = await app.newPage();
      tab.on('pageerror', error => errors.push(error.message));
      await tab.goto(origin + '/ISIONXXX/');
      await tab.waitForURL(home);
      await tab.locator('#hero-title').waitFor();
      return tab;
    };
    const first = await launch();
    // with no signal, before the affirmation has ever been opened: the service worker has kept it all the same
    await first.evaluate(() => navigator.serviceWorker.ready);
    offline = true;
    const again = await launch();
    await again.locator('.header-cta').tap();
    await again.locator('html.ui-ready #aff-title').waitFor();
    await again.close();
    offline = false;
    // from the homepage to the affirmation, and from there into the day: the shell opens, it doesn't bounce back here
    await first.locator('.header-cta').tap();
    await first.locator('#aff-title').waitFor();
    await first.locator('.aff-actions .button').tap();
    await first.waitForURL(origin + '/ISIONXXX/#today');
    await first.locator('#today.on').waitFor();
    await first.goto(origin + '/ISIONXXX/');
    await first.locator('#today.on').waitFor();
    assert.ok(!first.url().includes('/personal/'), 'the shell, not the homepage, later in the same launch');
    await app.close();
    pass('the installed app opens on the homepage once per launch, offline too, and the affirmation opens offline');
    assert.deepEqual(errors, [], 'browser page errors');
    pass('no browser JavaScript errors');
    console.log(`PASS: ${checks} personal-site checks`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
