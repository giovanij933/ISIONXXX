# ISIONXXX architecture

Seven static, single-file PWAs on one origin (`giovanij933.github.io`). No server, no build step:
each repo is served as-is by GitHub Pages.

```
giovanij933.github.io
├── /ISIONXXX/        shell: tab bar + TODAY, hosts the apps in iframes
├── /MEDITATE/        MIND        ─┐
├── /TRAINING/        TRAINING     │  each one also works on its own
├── /nutrition/       NUTRITION    │  (installable, offline)
├── /data-analytics/  LEARN        │
├── /JOURNAL/         JOURNAL      │
└── /rewire/          REWIRE      ─┘

         ┌──────── one origin = one IndexedDB database + one localStorage ──────────┐
 shell   │ TODAY reads every app's keys (read-only, memoized by raw string)         │
 iframes │ each app reads/writes only its own keys; 'storage' events keep frames    │
         │ in step; db.js keeps every key in IndexedDB (localStorage holds a copy   │
         │ while it fits); sync.js mirrors each app's keys to one encrypted gist    │
         └─────────────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | File | Owns |
|---|---|---|
| App | `index.html` (one per repo) | its data model, `render()`, its own dialogs |
| UI kit | `ui.js` + `ui.css` | stateless components, `UI.paint`, `UI.animate`, dialog motion, swipe to dismiss |
| Database | `db.js` | where data lives: IndexedDB, with a localStorage copy while it fits; routes `localStorage.getItem/setItem/removeItem`; starts the app's script once its data can be read |
| Data | `sync.js` | the `localStorage` write path (`Storage.prototype.setItem`), the storage budget, gist sync |
| Offline | `sw.js` | precache + revalidate, one cache name per app (`isx-<app>-vN`) |

`ui.js`, `ui.css`, `sync.js` and `db.js` are **shared files**: byte-identical in all seven repos and copied there on every
change. A copy that drifts is a bug.

## Contracts

**Storage keys.** An app writes only its own keys, which it lists in `<script src="sync.js" data-keys="…">`.

| App | Keys |
|---|---|
| MIND | `isx.mind.v1` |
| TRAINING | `isx.training.v1` |
| NUTRITION | `nj.meals.v1` `nj.settings.v1` (`nj.daily.v1` and `nj.mealnut.v1` local only) |
| LEARN | `xl.progress.v1` `xl.events.v1` `xl.sessions.v1` `xl.drafts.v1` `xl.settings.v1` `xl.videos.v1` |
| JOURNAL | `isx.journal.v1` |
| REWIRE | `isx.rewire.v1` |
| Shell | `isx.checkin.v1` (also read by the apps) |

Every app also writes `isx.plan.<app>` (local only, never synced) through `UI.planner` in ui.js: the session its START
would begin next, with a signature of the keys it was built from and the day, for TODAY's plan card.

Two readers look across apps, read-only:
- the shell's TODAY reads every app's keys and plan records;
- LEARN turns every app's log into the tables its lessons run on (trades, workouts, mind, meals, habits, checkins,
  study). NUTRITION writes `nj.mealnut.v1` (each meal with its nutrients worked out) for LEARN, because bowl
  nutrition can't be worked out outside NUTRITION.

Records with a string `id` merge one by one during sync; deletes travel as tombstones (`isx.sync.del.<key>`).

**Messages.** These are same-origin `postMessage` messages; anything else is ignored.
- shell → app: `{isx:'do', act}`. `act` is one of the app's quick actions (`go`, `add`, `quick`, …).
- shell → app: `{isx:'replan'}`. Rebuild the app's plan record now (ui.js handles it). TODAY sends it once per
  out-of-date signature to an app that's loaded; one that isn't is loaded in the background and rebuilds as it starts.
- app → shell: `{isx:'open', app, act}`. Opens another app's tab, optionally running an action.

**Events.**
- `isx-sync`: sent on window when a sync changed data, for pages with `data-noreload`.
- `isx-storage`: sent on window when a write did not fit, or when storage passes the warning level. `detail`:
  `{used, budget, ratio, failed, key}`.
- `ui-change`: sent by `UI.mount` controls.

## Decisions

**1. The storage budget is a shared, system-level resource.**
All seven apps share one origin's `localStorage`, which is about 5 M characters on Safari and Chrome. The sample
data alone uses about 2.6 M. A write that does not fit throws `QuotaExceededError`. Before this change, MIND,
TRAINING, JOURNAL and REWIRE showed a toast, and NUTRITION and LEARN threw from the middle of a click handler, so
the click seemed to do nothing and the change was lost.

The fix is to handle it at the one write path every app already goes through. `sync.js` wraps
`Storage.prototype.setItem`, so that wrapper now:
- measures usage;
- on a failed write, sends `isx-storage` and shows one clear, shared warning naming the biggest app. It still
  rethrows, so an app's own `catch` keeps working;
- sends a warning at 80% of the budget, which the shell's TODAY turns into a notice with the per-app breakdown.

The device limit is learned. A failed write stores the size that failed, capped at the 5 M default, so one huge
import can't push the warnings past the real limit. A later write that fits beyond the learned value proves it
wrong, and it is dropped; a device that really has less room learns it again on its next failed write. The banner
only speaks for the app's own data keys; a background cache that fails raises the event without a banner.

Apps also wrap their own `save()`, so a full disk never aborts a click handler half way.

*Later:* app data moved to IndexedDB (decision 1b), so the warning above now only appears on a browser without one.

**1b. Every app's data lives in IndexedDB; localStorage keeps a copy while it fits.**
IndexedDB is the browser's database for a site, with room for hundreds of MB. But every app reads its state
synchronously at start-up, and IndexedDB only answers asynchronously. `db.js` (shared, loaded first) bridges the two
without touching the apps' storage code:
- It routes `localStorage.getItem/setItem/removeItem`. Every write goes to the localStorage copy at once and to the
  database a moment later. Reads come from the copy, which is instant. The copy also protects a change made just
  before the page closes, and keeps an app that hasn't updated yet working on the same data.
- On open it compares the two. A copy that differs from the database was written by such an app, or after a database
  write was cut short, so it is taken in. A key missing from the copy was deleted that way.
- A key that doesn't fit in localStorage any more lives in the database alone. It is listed in `isx.db.only`, kept in
  both stores so a lost list can't make it look deleted. Its copy is removed, and the save succeeds instead of
  failing. On the next open the app's script, marked `<script type="isx/app">`, waits the few ms it takes to read it
  back. `ui.js` keeps the page hidden until it has run. Other tabs hear about such keys over a `BroadcastChannel`.
  A tab that sees the copy vanish keeps reading the old value until the new one arrives, so data never reads as empty.
- Without IndexedDB everything stays in localStorage, as before. `sync.js` waits for the database before its first sync.
- `test/db.test.js` covers the migration, write-through, older apps, the overflow, other tabs and the fallback.

**2. No polling in the shared UI kit.**
`ui.js` remembered the position of open `.modal` boxes with a 250 ms `setInterval`, so their exit animation could
start from where they were. That interval ran forever in all seven documents, about 28 wakeups a second with the
shell open, mostly in hidden frames.

It is replaced by a `ResizeObserver` and a `MutationObserver`:
- A `ResizeObserver` watches only the boxes that are open.
- The `MutationObserver` watches only the `.modal` elements themselves, not every class change in the document.

The same work now happens only when something actually opens, resizes or closes.

The rect is measured at open, when the entrance animation ends (a transform doesn't trigger `ResizeObserver`), on
resize and on scroll.

Measured with the shell open, all 6 apps loaded and 10 s of idle time:

| | Before | After |
|---|---|---|
| Timer wakeups | 354 | 74 |
| CPU | 41 ms | 8–11 ms |

The 74 that remain are three cheap polls:
- the shell checks every 300 ms whether the visible app has a dialog open, to hide the tab bar;
- NUTRITION's cooking timers and LEARN's study clock each check a few times a second whether one is running.

Together they cost about 1 ms of CPU a second, and browsers throttle them in the background. Making them
event-driven would need a new frame → shell message covering every kind of dialog. They are left as they are on
purpose.

**2b. A tap redoes only what changed, and only what you can see.**
Each app draws its whole page from its data on every tap (one function, one HTML string). With a year of data that
page is 1,100–1,750 elements and 6,000–7,000 px tall, and a tap took 190–390 ms to show on a phone-sized screen with
the CPU 4x slower. Three things cost that time, and none of them was the app's idea of what to draw:

- **The page background.** The glow behind the cards was a gradient sized to the whole document, so it was a
  different picture whenever the page changed length. A card that changed height made the browser draw every pixel
  of the page again: 150–380 ms, even with no CPU throttling. The page is now one flat colour (2c), and the release
  check fails a background picture sized to the document, so the cost can't come back with a new one.
- **Replacing everything.** `root.innerHTML = html` rebuilt, restyled and laid out every card, most of them off
  screen and many of them unchanged. The apps now call `UI.paint(root, html)`, which leaves the same result but
  keeps a card whose HTML is what it was, replaces a changed card at once if it is on screen or within half a screen,
  and replaces the rest between the next frames, nearest first. Scrolling towards one replaces it at once. A card
  above the screen that comes out a different height doesn't move the page (Chrome holds it by itself; for Safari
  `ui.js` corrects the scroll position). Only charts replaced on screen draw in, and numbers count up only on screen.
- **Slow sums.** Date formatters built on every call (LEARN's year chart asked for ~350 a redraw), dates read twice
  per comparison while sorting a year of meals, and "is this entry in this week" worked out from scratch for every
  entry on every pass. Each is now done once.

`UI.paint` needs the same data to give the same HTML: `UI.hero` took a running number for an id, which made the
Today card look changed on every draw. It now takes it from the hero's key.

Measured at 390 px with a year of sample data and the CPU 4x slower, from the finger lifting to the next frame,
over the taps that redraw the page (range tiles, cross-filters, calendar, paging):

| | Average before | Average after | Slowest before | Slowest after |
|---|---|---|---|---|
| JOURNAL | 192 ms | 119 ms | 328 ms | 152 ms |
| MIND | 274 ms | 108 ms | 416 ms | 168 ms |
| TRAINING | 228 ms | 121 ms | 336 ms | 152 ms |
| NUTRITION | 202 ms | 94 ms | 344 ms | 112 ms |
| REWIRE | 390 ms | 146 ms | 544 ms | 216 ms |
| LEARN | 265 ms | 94 ms | 376 ms | 112 ms |

Opening a dialog is unchanged (80–160 ms): `showModal()` makes the browser restyle every element of the page to
mark it inert, which the apps can't avoid without giving up real dialogs.

The pages themselves are the same: for 42–50 states of each app, at 390 and 1440 px, the HTML left by the old and
the new code is identical. The release check guards both halves (README, check 7).


**2c. One palette, in one place.**
Every colour in the seven apps, TODAY and the personal site comes from the tokens at the top of `ui.css`. No page
holds a colour of its own, so the palette changes in one file and every app follows.

- **The palette** is thirteen named colours: `--background`, `--surface`, `--border`, `--primary`, `--secondary`,
  `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--success`, `--error`, `--warning`, `--info`.
  Light is the palette as given. Dark is its counterpart and follows the device (`prefers-color-scheme`), because
  Apple's guidance is that every colour has a light and a dark form. With "Increase contrast" on
  (`prefers-contrast: more`), borders and secondary text get stronger.
- **Appearance: Auto, Light or Dark.** Every app's Settings has the row (`UI.appearance()`); Auto follows the device.
  It is one choice for TODAY, the six apps and the personal homepage on this device: they share an origin, so it is
  one localStorage key, `isx.theme` (`auto`, `light` or `dark`; per device, not synced). Light or Dark puts
  `data-theme` on `<html>`, and `ui.css` gives the dark colours to a dark device unless it says `light`, and to
  `data-theme="dark"` whatever the device: the same block twice, which the release check keeps identical. Each
  page's head sets `data-theme` in one line before the first paint, so a page set to Light or Dark never shows the
  device's appearance first; `ui.js` keeps it in step, moves the browser's bar colour (`theme-color`) with it, and
  hears a change made in another app, or in a frame inside TODAY, through the `storage` event. Auto is saved as
  `auto` rather than removed, because `db.js` holds a removed key back from the other pages for a second. The launch
  image (2e) is drawn in the page's own background, so it follows the choice too.
- **Made from it**, in the same block: the `-text` form of each colour (below), `-soft` tints and `-line` edges,
  `--raised` (a field or a cell inside a card), and the layers that float (`--float`, `--glass`, `--scrim`, shadows).
- **How they are used** follows Apple's Human Interface Guidelines on colour:
  - *One meaning each.* `--accent` is what you can tap and what is selected: never plain text, never a heading.
    `--success`, `--error`, `--warning` and `--info` are status only. Headings and figures are text colours. A
    chart's main series is the accent; a second series is `--info`; kinds that are neither good nor bad (macros,
    tracks, proteins) take the accent, `--info`, `--secondary` and `--primary`, never green or red.
  - *Never colour alone.* A gain or a loss carries its sign, a status its word or shape, today's date an underline.
  - *Readable.* Small coloured text uses the `-text` form: the palette's colour, darkened in light mode until it
    reaches 4.5:1 on a card. On a card the pure green is 2.0:1, the orange 1.9:1 and the light blue 1.7:1, so
    they are for fills, dots, bars and chart lines. `--text-muted` (3.3:1) is for placeholders and disabled text
    only; anything that must be read is `--text-secondary`.
  - *Backgrounds stack*: `--background` is the page, `--surface` a card, `--raised` what sits inside a card.
- **In a chart drawn from script**, a colour reaches the SVG as a style (`style="fill:var(--accent)"`): an
  attribute (`fill="…"`) can't hold a token.
- **Glass** is for what floats over the page: the app header, TODAY's tab bar, menus, sheets and dialogs, toasts.
  On a phone (640 pt and narrower) the header has no bar: like iOS 26's own apps, its pieces float as separate glass
  pills (the app's name, the main button, ⋮, the sync dot; TODAY's name, date and sync dot). They, and TODAY's tab
  bar, are clear glass (`--glass-clear`: a 24% light or 30% dark tint over a 10 px blur), so what scrolls beneath shows
  through, as iOS 26's floating controls do; Increase Contrast makes them nearly opaque, Reduce Transparency solid. The
  page fades only a little as it slides under them (`.ui-edge`, which `ui.js` adds to every app and TODAY draws with its
  page): enough to settle the pills, not so much that they sit on a solid band. Wider screens keep the one rounded bar.
  It is modelled on the menus iOS draws itself: the page shows through, blurred (`--glass-filter`, 26 px) with its
  colours kept, under a light or dark tint (`--glass`; `--float` is the heavier tint for a sheet full of text), with
  a light across it (`--glass-sheen`) and a bright rim (`--glass-rim`, carried by the shadows). Cards stay flat.
  Reduce Transparency makes the glass solid; Increase Contrast makes it more opaque with a stronger edge. Text on
  glass is not checked by the contrast audit (what is behind it changes as the page scrolls); the tint keeps it
  readable over the apps' own colours. Headless Chromium's default renderer draws a large blur wrongly near an
  element's edges (text there stays sharp and only dims): screenshots of the glass are taken with
  `--use-angle=swiftshader --enable-unsafe-swiftshader`, which renders it as a phone does.
- **The mark** in every header is the icon's monogram drawn in `--primary` through its own shape (a CSS mask), so
  it is black on a light page and white on a dark one.
- **Guarded.** The release check fails a page, `sync.js` or the personal site if it holds a colour outside the
  palette (white and black excepted: the browser's own chrome, a candle's core, the stage behind a video).
- **The app icons** are the accent: a blue tile (`#2E90FF` to `#005FC8`, the accent at the middle) with the tab bar's
  glyph in white, and TODAY's with the monogram. Each glyph sits inside the middle 68% of the tile, so the 512 px icon
  also serves as Android's "maskable" icon, which is cropped to a circle of 80%. iOS takes `apple-touch-icon.png`
  (180 px, opaque) and has no dark form for a web app's icon.

**2d. The device's own font.**
Every app, TODAY and the personal site use the system font (`--ui-f` in `ui.css`): SF Pro on an iPhone or a Mac,
Segoe UI on Windows, Roboto on Android. Nothing is downloaded, so the first paint never waits for a font and the
apps need no font files offline. Code (LEARN's editor and code samples, any `code` or `pre`) uses the system
monospace (`--ui-mono`). The terminal details that suited the old monospace (the `>` before headings, the blinking
cursor after the app's name, `//` as a separator) are gone: a heading is just its words, and a separator is ` · `.
Nothing is set in capitals (2l), and text has no added tracking.

**2e. The launch screen is the app's first frame.**
An iPhone opens a home-screen web app on a launch image, and without one it shows a white screen: a flash in dark
mode. iOS uses an image only if it is the screen's exact size, takes it when the app is added to the home screen, and
keeps it. So `ui.js` draws it on the phone itself: in Safari on an iPhone or iPad (`navigator.standalone` false, a
touch screen, not inside TODAY's frames), a moment after the page loads, it fills a canvas the size of the screen in
the page's own background and adds it as `apple-touch-startup-image`, portrait and landscape. That covers every
iPhone and iPad, the ones still to come too, with no image files and no list of devices to keep up. It is plain, as
Apple's guidelines ask: the page then fades in over the same colour. Every page also says
`<meta name="color-scheme" content="light dark">`, so the browser knows the page is dark before `ui.css` arrives.
- **Light or dark is fixed when the app is added.** iOS keeps the launch image it took then (WebKit bug 259328): add
  the apps with the phone in the appearance it is usually in. Changing the image means removing the app from the
  home screen and adding it again. The installed app draws nothing.
- **Not testable here.** No headless browser shows a launch screen; the test checks the images each page offers (their
  size, colour and orientations, light and dark) and that the installed app, a frame and a Mac offer none.

**2f. The installed app is as tall as the page iOS gives it.**
TODAY is one full-screen box: the tab bar and every app's frame hang from its bottom. Installed on an iPhone, iOS 26
gets one of two heights wrong, depending on the status bar style. With the solid bar (this app's, `default`), the page
starts below the bar but `100vh` and `100lvh` are the whole screen (WebKit 316008): sized to them, the tab bar and the
bottom of every app sat 62 pt off the screen. With a see-through bar, the page is a bar short (WebKit 301108), a strip
under the tab bar. `min(100lvh, 100% + env(safe-area-inset-top))` is right in both, because the solid bar's safe-area
top is 0. Don't size to `screen.height` or branch on the safe-area top: both were tried, and both failed on the phone.
Headless Chromium can't reproduce these iOS heights: they were found with a size readout on TODAY (screen, page,
`vh`/`lvh`/`dvh`/`svh`, safe areas, the tab bar) shown on a real iPhone, removed once the fix held.

**2g. Every sheet swipes down.**
`ui.js` lets a swipe down from a sheet's top close it, as on iOS: every `<dialog>`, NUTRITION's and LEARN's `.modal > .box`
sheets, and the session sheets (`.ss`: MIND's, TRAINING's and REWIRE's, NUTRITION's cook mode) too. A swipe does
what Escape does, so an app's own rule decides: a running session goes down to the bar (2j), and one waiting to be
saved refuses the `cancel`: the sheet springs back with "Finish or discard this first". A form with something typed asks "Discard
your changes?" before it closes (a session sheet's fields are its sets, saved as they're logged, so it doesn't ask).
The toast is a popover, so it shows above an open sheet (a `<dialog>` sits above any z-index). `personal.test.js`
swipes TRAINING's plan, a running workout and NUTRITION's food form.

**2h. TODAY's plan shows each app's picture.**
Each app draws a picture beside its items (TRAINING's muscles, MIND's breath or attention, NUTRITION's macro ring,
LEARN's before → after table, JOURNAL's focus rule, REWIRE's urge map), styled by its own CSS. TODAY has none of that
CSS, so a plan row (`UI.planner`, saved as `isx.plan.<app>`) can carry `art`: a small SVG in the plan-art classes,
which TODAY colours from the palette (light and dark follow the page). Fills: `pa-p` accent, `pa-s` light accent,
`pa-n` track, `pa-c` cell grey, `pa-x` faded, `pa-a` accent tint, `pa-i` info, `pa-g` secondary, `pa-e` error,
`pa-w` success; an unclassed polygon is the body's grey. Strokes (with `fill="none"` and their own widths):
`pa-sp` accent, `pa-si`, `pa-sg`, `pa-st` track, `pa-se`, `pa-sw`, `pa-sk` text, `pa-sm` secondary text, `pa-sb`
border. Each app's map file converts its own picture with `toArt` (its class → plan-art class). TODAY keeps only plain
shapes (svg, g, polygon, path, circle, rect, line, with geometry attributes and pa-* classes) before the picture goes in
the page, so a plan can't put anything else there. `personal.test.js` checks both.

**2i. An update takes over on the first reopen.**
Each service worker installs a new version as soon as the browser sees it, and takes over the open page (`skipWaiting`,
`clients.claim`), but the page keeps running the version it loaded, so an update used to need two launches. `ui.js`
reloads the page when the new version takes over (`controllerchange`), if nothing would be lost: no sheet open, no
field in use, no session on the bar (in the page or a frame inside it: TODAY's apps), and within 30 s of the page being
shown, so it never reloads mid-task. Otherwise a pill offers it ("Updated · tap to reload"), and the next return to the
app reloads by itself if it can. iOS keeps an installed app in memory, so reopening it is often a return, not a
launch: a return checks for a new version (`registration.update()`, at most once a minute). The first visit, which had
no service worker, doesn't reload when one takes over. `personal.test.js` serves TODAY a new version and checks both.

**2j. A running session goes down to a bar.**
A swipe down (or Escape) on a running session's sheet (MIND's session, TRAINING's workout, REWIRE's surf) puts it away
instead of refusing: the sheet closes and `UI.runBar` shows a bar at the bottom with the session and its clock, above
TODAY's tab bar inside the shell. A tap brings the session back where it was. The session runs on underneath (the
timers, the bells): MIND's bell at the end and the end of REWIRE's surf bring the sheet back to save it; TRAINING's rest
and hold timers chime but leave it on the bar, which says where the workout is. START (or the app's own button) also
brings it back. A session waiting to be saved still refuses (2g). The bar is centred with auto margins, not a
transform, because a pressed button's `:active` scale would replace the transform and move the bar from under the
finger. `personal.test.js` puts a workout on the bar and back; MIND and REWIRE are checked by hand.

**2k. TODAY shows what's under way, and can log in one tap.**
A plan row (2h) can also carry `run`: a session under way in the app (MIND's session, TRAINING's workout, REWIRE's surf),
with its start (`t0`), a set length to count down (`mins`) and `paused`, or `saved: false` once it's over and waiting to
be saved. TODAY shows it first, "Running", with its clock (filled in every second, not in the HTML, so a redraw with
nothing changed stays the same) and RETURN, which goes back into it, on the bar (2j) or not. Each app puts its run
key (`isx.<app>.run`) among the plan's sources and replans as the run is saved, so the row follows. A row can also name
its button (`btn`, a few plain words): NUTRITION's "Log it" logs the suggested meal in one tap (`eatnext`), with Undo
there. `personal.test.js` checks a session's row.

**2l. Liquid Glass: Apple's iOS 26 conventions, where the web can follow them.**
Apple's guidance (developer.apple.com, "Adopting Liquid Glass" and the HIG's Materials) asks for glass only on the
layer that floats over the content, flat content, and controls shaped like the hardware. The apps already had the first
two (2c's glass on the header pills, tab bar, menus, sheets and toasts; flat cards). This adds the rest:
- **No capitals.** Headers are title-style and buttons and labels sentence case ("Save check-in", "Today's plan", the
  tab bar's "Mind"): Apple's section headers "no longer render entirely in capital letters". No rule sets
  `text-transform: uppercase` (the release check fails one), and no label is typed in capitals. What stays in capitals
  is what is written that way: acronyms (JSON, CSV, SQL, RPE, NSDR), contract codes (NQZ6), SQL and SAS keywords in
  LEARN's lessons, an account name the person typed, and the app's name in its own header, the wordmark beside the
  mark. Internal keys stay as they are and are shown in words: TRAINING's days (PUSH → "Push day"), the breath cues
  (INHALE → "Inhale"), REWIRE's app names (MIND → "Mind"). Card headers are 15 px semibold, a sheet's title 17 px.
- **Capsules.** A button that is a line of text, every `.ui-btn` and every main button (`.pri`, `.go`) is a capsule.
  The main action keeps the accent fill; the others take a soft grey fill (`--fill`, `--fill-2` on hover) with the
  text colour instead of an outline, so colour stays for what matters (Apple: "be judicious with your use of color in
  controls"). Buttons holding more than text (stat tiles, rings, calendar days, list rows) keep their own shapes.
- **Segmented pickers** (`UI.segmented`, the 1–5 ratings, Appearance) are a grey track with a raised thumb
  (`--thumb`), not an accent fill.
- **Sheets stay edge to edge** on a phone, rounded at the top only. iOS 26 insets its half sheets from the screen's
  edges with rounder corners; that was tried here and the flush sheet was preferred, so it stays. Desktop dialogs are
  28 px. Settings rows sit on the sheet itself, divided by lines: an inset group (iOS's own Settings) was tried, and
  its second grey on the sheet's own read as two shades.
- **Rounder corners, concentric:** a card 22 px, what sits in it 14, fields 12.
- **What the web can't do:** the lensing that bends light at the glass's edge needs a filter Safari doesn't run on
  `backdrop-filter`, so the glass stays blur, sheen and rim (2c). The tab bar hides on scroll rather than shrinking to
  the current tab (iOS 26's behaviour), by choice.

**3. Shared files stay copied, not linked.**
Apps could load `/ISIONXXX/ui.js` directly. But each app's service worker precaches its own files, so a shared URL
would tie every app's offline start-up and update timing to the shell's deploy. That would also break the
standalone installs. Copies, plus a drift check in the test suite, are cheaper than that coupling.

## Testing

Every pull request in every repo runs the **release check** (`test/`, described in `test/README.md`, run by
`.github/workflows/release-check.yml`). Playwright drives Chromium through the app and the TODAY shell, served side
by side from one local origin the way GitHub Pages serves them:
- on an empty device and with sample data, at 390 px and 1440 px, with an axe pass;
- offline, after the service worker installs;
- with each saved key corrupted.

The run fails on any high-severity issue, including drift between the copies of the shared files. `ui.js`'s unit
tests (`test/ui.test.html`) run as part of the shell's check. Feature work is also checked with one-off behaviour
and A/B performance scripts. Those aren't kept.
