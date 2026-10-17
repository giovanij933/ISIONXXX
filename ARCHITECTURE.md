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

         ┌──────────────── one origin = one localStorage, one quota ────────────────┐
 shell   │ TODAY reads every app's keys (read-only, memoized by raw string)         │
 iframes │ each app reads/writes only its own keys; 'storage' events keep frames    │
         │ in step; sync.js mirrors each app's keys to one encrypted gist          │
         └─────────────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | File | Owns |
|---|---|---|
| App | `index.html` (one per repo) | its data model, `render()`, its own dialogs |
| UI kit | `ui.js` + `ui.css` | stateless components, `UI.animate`, dialog motion, swipe to dismiss |
| Data | `sync.js` | the `localStorage` write path (`Storage.prototype.setItem`), the storage budget, gist sync |
| Offline | `sw.js` | precache + revalidate, one cache name per app (`isx-<app>-vN`) |

`ui.js`, `ui.css` and `sync.js` are **shared files**: byte-identical in all seven repos and copied there on every
change. A copy that drifts is a bug.

## Contracts

**Storage keys.** An app writes only its own keys, which it lists in `<script src="sync.js" data-keys="…">`.

| App | Keys |
|---|---|
| MIND | `isx.mind.v1` |
| TRAINING | `isx.training.v1` |
| NUTRITION | `nj.meals.v1` `nj.settings.v1` (`nj.daily.v1` local only) |
| LEARN | `xl.progress.v1` `xl.events.v1` `xl.sessions.v1` `xl.drafts.v1` `xl.settings.v1` `xl.videos.v1` |
| JOURNAL | `isx.journal.v1` |
| REWIRE | `isx.rewire.v1` |
| Shell | `isx.checkin.v1` (also read by the apps) |

Records with a string `id` merge one by one during sync; deletes travel as tombstones (`isx.sync.del.<key>`).

**Messages.** These are same-origin `postMessage` messages; anything else is ignored.
- shell → app: `{isx:'do', act}`. `act` is one of the app's quick actions (`go`, `add`, `quick`, …).
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

*Not done, on purpose:* moving app data to IndexedDB. It is the real long-term fix (quota in the hundreds of MB),
but every app reads its state synchronously at start-up. A migration means an in-memory cache with async write-through
in all six apps and in `sync.js`. That is a project of its own, and the warning above buys the time to do it with
care.

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

**3. Shared files stay copied, not linked.**
Apps could load `/ISIONXXX/ui.js` directly. But each app's service worker precaches its own files, so a shared URL
would tie every app's offline start-up and update timing to the shell's deploy. That would also break the
standalone installs. Copies, plus a drift check in the test suite, are cheaper than that coupling.

## Testing

Playwright drives Chromium against a local `python3 -m http.server`, with every repo checked out side by side.
- `ui.js` has unit tests in `test/ui.test.html`.
- The rest is covered by behaviour scripts (TODAY, check-in, quick actions, motion, swipe), an axe pass per app at
  390 px, and A/B performance scripts that run old and new code side by side.
