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
  const swapped = new Map();   // file → the content to serve instead (a check's new version of the shell)
  const server = http.createServer(async (req, res) => {
    if (offline) { req.socket.destroy(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = path.resolve(SITE, '.' + pathname);
      if (!file.startsWith(SITE + path.sep)) { res.writeHead(403).end(); return; }
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      if (swapped.has(file)) { res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(swapped.get(file)); return; }
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

    // swipe down (ui.js) on the apps' sheets: a session sheet before it starts closes (TRAINING's plan), a running one
    // goes down to the bar and a tap brings it back (a workout, ARCHITECTURE.md 2j), one waiting to be saved springs back
    // and says why (a finished workout), a form with something typed asks first (NUTRITION's food)
    {
      const sw = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 430, height: 878 }, hasTouch: true, isMobile: true });
      await sw.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
      const tab = await sw.newPage();
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('dialog', d => d.accept());
      const cdp = await sw.newCDPSession(tab);
      const swipe = async sel => {
        const y0 = (await tab.locator(sel).first().boundingBox()).y + 18;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 215, y: y0 }] });
        for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 215, y: y0 + i * 28 }] }); await tab.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await tab.waitForTimeout(600);
      };
      await tab.goto(origin + '/TRAINING/');
      await tab.locator('[data-a=sample]').click();
      await tab.locator('[data-a=go] >> visible=true').first().click();
      await tab.locator('#dlg[open]').waitFor();
      await swipe('#dlg');
      assert.equal(await tab.locator('#dlg[open]').count(), 0, "TRAINING's plan closes with a swipe down");
      await tab.locator('[data-a=go] >> visible=true').first().click();
      await tab.locator('#dlg[open] button:has-text("Begin")').click();
      await tab.locator('#ls').waitFor();
      await swipe('#dlg');
      assert.equal(await tab.locator('#dlg[open]').count(), 0, 'a running workout goes down');
      const bar = tab.locator('.ui-run');
      assert.match(await bar.textContent(), /day.*\d+:\d\d/, 'to the bar, with the workout and its clock');
      assert.ok((await bar.boundingBox()).height >= 44, 'a bar big enough to tap');
      await tab.waitForTimeout(1100);
      assert.notEqual(await bar.textContent(), await (async () => { await tab.waitForTimeout(1100); return bar.textContent() })(), 'its clock runs');
      await bar.click();
      await tab.locator('#dlg[open] #ls').waitFor();
      assert.equal(await tab.locator('.ui-run').count(), 0, 'a tap brings the workout back, and the bar goes');
      await tab.locator('#dlg[open] #fn').click();
      await tab.locator('#dlg[open] #ff').waitFor();
      await swipe('#dlg');
      assert.equal(await tab.locator('#dlg[open]').count(), 1, 'a finished workout waiting to be saved stays open');
      assert.match(await tab.locator('.ui-toast.ui-on').textContent(), /finish or discard/i, 'and says why');
      assert.ok(await tab.locator('.ui-toast').evaluate(t => !t.showPopover || t.matches(':popover-open')), 'the message shows above the sheet');
      await tab.goto(origin + '/nutrition/');
      await tab.evaluate(() => doAct('demo'));
      await tab.locator('[data-act=quick] >> visible=true').first().click();
      await tab.locator('#q_name').fill('Oats');
      await swipe('#mbox');
      await tab.locator('dialog.ui-cf[open]').waitFor();
      await tab.locator('dialog.ui-cf[open] button[type=submit]').click();
      await tab.waitForTimeout(500);
      assert.equal(await tab.locator('#modal:not(.hidden)').count(), 0, 'a typed food form closes once Discard is confirmed');
      await sw.close();
    }
    pass('swipe down closes a sheet, puts a running session on the bar (a tap brings it back), asks before discarding what was typed, and a session waiting to be saved springs back and says why');

    // an update takes over on the first reopen (ui.js, ARCHITECTURE.md 2i): the old version opens, the new one installs
    // and takes over, and the page reloads into it by itself; with a sheet open it waits and offers a reload instead
    {
      const up = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 430, height: 878 } });
      await up.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
      const tab = await up.newPage();
      tab.on('pageerror', error => errors.push(error.message));
      const shell = origin + '/ISIONXXX/', sw = path.join(SITE, 'ISIONXXX', 'sw.js'), ix = path.join(SITE, 'ISIONXXX', 'index.html');
      const version = async (v, mark) => {
        swapped.set(sw, (await fs.readFile(sw, 'utf8')).replace(/isx-shell-v\d+/, 'isx-shell-v' + v));
        swapped.set(ix, (await fs.readFile(ix, 'utf8')).replace('<head>', `<head><meta name="isx-test" content="${mark}">`));
      };
      const mark = () => tab.evaluate(() => document.querySelector('meta[name=isx-test]')?.content || 'old');
      // the first visit installs the service worker (and doesn't reload when it takes over), the next opens under it
      await tab.goto(shell);
      await tab.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })) });
      assert.equal(await mark(), 'old');
      await tab.reload();
      await tab.waitForFunction(() => !!navigator.serviceWorker.controller);
      // a new version is out: reopening (the update check) is enough
      await version(9001, 'new');
      await tab.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      await tab.waitForSelector('meta[name=isx-test][content=new]', { state: 'attached', timeout: 20000 });
      // another, while a sheet is open: no reload under it, a pill offers one, and a tap reloads into it
      await tab.waitForFunction(() => !!navigator.serviceWorker.controller);
      await tab.evaluate(() => { const d = document.createElement('dialog'); d.id = 'isx-t'; document.body.append(d); d.showModal() });
      await version(9002, 'newer');
      await tab.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      await tab.locator('.ui-upd').waitFor({ timeout: 20000 });
      assert.equal(await mark(), 'new', 'no reload while a sheet is open');
      await tab.evaluate(() => document.getElementById('isx-t').close());
      await tab.locator('.ui-upd').click();
      await tab.waitForSelector('meta[name=isx-test][content=newer]', { state: 'attached', timeout: 20000 });
      swapped.clear();
      await up.close();
    }
    pass('an update takes over on the first reopen, and waits with a reload button while a sheet is open');

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

    // TODAY's plan shows each app's picture (ARCHITECTURE.md, 2h), kept to plain shapes: no script, handler, link,
    // style or foreign element gets into the page, and a picture that doesn't parse shows nothing
    await page.goto(origin + '/ISIONXXX/#today');
    await page.locator('#today.on').waitFor();
    await page.evaluate(() => {
      const sig = UI.planSig([]), at = Date.now();
      const save = (app, art) => localStorage.setItem('isx.plan.' + app, JSON.stringify({ v: 1, app, sig, src: [], at, items: [{ title: 'Test ' + app, sub: 'a picture', act: 'plan', art }] }));
      save('training', '<svg viewBox="0 0 100 220"><polygon class="pa-p" points="0 0 10 0 10 10"/><polygon points="20 0 30 0 30 10"/></svg>');
      save('mind', '<svg viewBox="0 0 10 10" onload="window.__art=1"><script>window.__art=2</script><foreignObject><div>x</div></foreignObject>' +
        '<a href="javascript:void 0"><rect width="5" height="5"/></a><rect class="pa-p evil" width="4" height="4" style="fill:red" fill="url(#g)"/><path d="M0 0L9 9" class="pa-sp" fill="none" stroke-width="2"/></svg>');
      save('journal', '<svg><broken');
      // a workout under way: Running, its clock, RETURN (ARCHITECTURE.md 2k)
      localStorage.setItem('isx.plan.rewire', JSON.stringify({ v: 1, app: 'rewire', sig, src: [], at, items: [{ title: 'Surf · Test', act: 'urge', run: { t0: Date.now() - 65000, mins: 5 } }] }));
    });
    await page.reload();
    await page.locator('.pl-training .pl-art svg').waitFor();
    const art = await page.evaluate(() => {
      const at = id => document.querySelector(`.pl-${id} .pl-art`);
      return { n: at('training').querySelectorAll('polygon').length, cls: at('training').querySelector('polygon').getAttribute('class'),
        mind: at('mind')?.innerHTML || '', ran: window.__art, journal: !!at('journal')?.querySelector('svg') };
    });
    assert.equal(art.n, 2, 'both shapes of a plain picture');
    assert.equal(art.cls, 'pa-p');
    assert.ok(art.mind && !/script|onload|foreignObject|href|style|url|evil|<a[ >]/i.test(art.mind), art.mind);
    assert.match(art.mind, /<rect class="pa-p" width="4" height="4">/);
    assert.match(art.mind, /<path d="M0 0L9 9" class="pa-sp" fill="none" stroke-width="2">/);
    assert.equal(art.ran, undefined, 'nothing in a picture runs');
    assert.equal(art.journal, false, 'a broken picture shows nothing');
    const surf = async () => page.evaluate(() => { const r = document.querySelector('.pl-rewire'); return { em: r.querySelector('.pl-a em')?.textContent, clk: r.querySelector('.pl-clk')?.textContent, btn: r.querySelector('button')?.textContent.trim() } });
    const s1 = await surf();
    assert.match(s1.em, /Running/, 'a session under way says so');
    assert.match(s1.clk, /^3:5\d left$/, 'with its clock');
    assert.equal(s1.btn, 'Return', 'and a way back into it');
    await page.waitForTimeout(2100);
    assert.notEqual((await surf()).clk, s1.clk, 'the clock ticks');
    await page.evaluate(() => ['training', 'mind', 'journal', 'rewire'].forEach(a => localStorage.removeItem('isx.plan.' + a)));
    pass("TODAY's plan shows each app's picture, kept to plain shapes, and a session under way with its clock and Return");

    // the launch screen (ui.js): in Safari on an iPhone (navigator.standalone false), every page an app can be added from
    // carries a launch image for each orientation at the screen's exact size, plain, in the page's own background, light
    // and dark. TODAY's frames, the installed app (below) and a Mac don't draw one.
    const pages = [home, home + 'affirmation/', origin + '/ISIONXXX/', ...['MEDITATE', 'TRAINING', 'nutrition', 'data-analytics', 'JOURNAL', 'rewire'].map(a => `${origin}/${a}/`)];
    const startup = 'link[rel="apple-touch-startup-image"]';
    const safariOn = async (options) => {
      const ctx = await browser.newContext({ timezoneId: 'UTC', ...options });
      await ctx.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
      await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => false, configurable: true }));
      const tab = await ctx.newPage();
      tab.on('pageerror', error => errors.push(error.message));
      return [ctx, tab];
    };
    for (const colorScheme of ['light', 'dark']) {
      // an iPhone 17 Pro: 402 × 874 points at 3×
      const [ctx, tab] = await safariOn({ viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme });
      for (const url of pages) {
        await tab.goto(url);
        await tab.waitForFunction(s => document.querySelectorAll(s).length === 2, startup, { timeout: 10000 });
        const { bg, images } = await tab.evaluate(async s => ({
          bg: getComputedStyle(document.body).backgroundColor,
          images: await Promise.all([...document.querySelectorAll(s)].map(async link => {
            const img = new Image(); img.src = link.href; await img.decode();
            const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            // the corners and the middle: one colour, opaque
            const px = [[0, 0], [c.width - 1, c.height - 1], [c.width >> 1, c.height >> 1]].map(([i, j]) => [...x.getImageData(i, j, 1, 1).data].join(','));
            return { media: link.media, size: `${img.naturalWidth}x${img.naturalHeight}`, px: [...new Set(px)] };
          })),
        }), startup);
        const rgb = bg.match(/\d+/g).slice(0, 3).join(',') + ',255';
        assert.equal(bg, colorScheme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)', `${url}: the palette's ${colorScheme} background`);
        assert.deepEqual(images, [
          { media: 'screen and (orientation: portrait)', size: '1206x2622', px: [rgb] },
          { media: 'screen and (orientation: landscape)', size: '2622x1206', px: [rgb] },
        ], `${url} in ${colorScheme}: the launch images`);
      }
      // inside TODAY an app is a frame: only the page that is added to the home screen draws one
      await tab.goto(origin + '/ISIONXXX/#mind');
      await tab.frameLocator('#f-mind').locator('h1.brand').waitFor();
      await tab.waitForFunction(s => document.querySelectorAll(s).length === 2, startup);
      await tab.waitForTimeout(1500);
      assert.equal(await tab.frameLocator('#f-mind').locator(startup).count(), 0, 'no launch image inside a frame');
      await ctx.close();
    }
    // the phone switches between light and dark before the app is added: the launch image follows
    {
      const [ctx, tab] = await safariOn({ viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme: 'light' });
      await tab.goto(home);
      await tab.waitForFunction(s => document.querySelectorAll(s).length === 2, startup);
      const before = await tab.locator(startup).first().getAttribute('href');
      await tab.emulateMedia({ colorScheme: 'dark' });
      await tab.waitForFunction(([s, b]) => document.querySelectorAll(s).length === 2 && document.querySelector(s).href !== b, [startup, before]);
      await ctx.close();
    }
    // a Mac has no touch screen: no launch image
    {
      const [ctx, tab] = await safariOn({ viewport: { width: 1440, height: 900 } });
      await tab.goto(home);
      await tab.locator('html.ui-ready').waitFor();
      await tab.waitForTimeout(1500);
      assert.equal(await tab.locator(startup).count(), 0, 'no launch image on a Mac');
      await ctx.close();
    }
    pass('Safari on a phone: every page carries a plain launch image at the screen’s exact size in its own background, light and dark');

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
    await first.waitForTimeout(1500);
    assert.equal(await first.locator('link[rel="apple-touch-startup-image"]').count(), 0, 'the installed app draws no launch image');
    await app.close();
    pass('the installed app opens on the homepage once per launch, offline too, and the affirmation opens offline');

    // the installed app below the status bar (as iOS 26.1 draws it, the safe area's top 0): an iPhone Pro Max's
    // 956 pt screen leaves an 894 pt page. TODAY's tab bar, and the apps' frames, stay on it: sizing to the screen would
    // push them off the bottom by the status bar's height.
    const pro = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 440, height: 894 }, screen: { width: 440, height: 956 }, hasTouch: true, isMobile: true });
    await pro.route(/fonts\.g|gstatic|cdnjs|jsdelivr|youtube|ytimg/, route => route.abort());
    await pro.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); sessionStorage.setItem('isx.launched', '1'); });
    const shellTab = await pro.newPage();
    shellTab.on('pageerror', error => errors.push(error.message));
    await shellTab.goto(origin + '/ISIONXXX/#today');
    await shellTab.locator('#today.on').waitFor();
    const fits = await shellTab.evaluate(() => ({ tabs: Math.round(document.querySelector('#tabs').getBoundingClientRect().bottom), apps: Math.round(document.querySelector('#apps').getBoundingClientRect().bottom), page: innerHeight }));
    assert.ok(fits.tabs <= fits.page && fits.apps <= fits.page, `the tab bar (bottom ${fits.tabs}) and the apps (bottom ${fits.apps}) fit the ${fits.page} pt page`);
    await pro.close();
    pass('the installed app below the status bar keeps its tab bar and apps on the screen');
    assert.deepEqual(errors, [], 'browser page errors');
    pass('no browser JavaScript errors');
    console.log(`PASS: ${checks} personal-site checks`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
