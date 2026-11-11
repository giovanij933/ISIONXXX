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
- **Made from it**, in the same block: the `-text` form of each colour (below), `-soft` tints and `-line` edges,
  `--raised` (a field or a cell inside a card), and the layers that float (`--float`, `--bar`, `--scrim`, shadows).
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
- **The mark** in every header is the icon's monogram drawn in `--primary` through its own shape (a CSS mask), so
  it is black on a light page and white on a dark one.
- **Guarded.** The release check fails a page, `sync.js` or the personal site if it holds a colour outside the
  palette (white and black excepted: the browser's own chrome, a candle's core, the stage behind a video).
- **Not changed:** the app icons on the home screen keep their own colours.

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
