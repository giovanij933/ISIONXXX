# Release check

Automated checks for the seven ISIONXXX apps. They run on every pull request in each app's repo
(`.github/workflows/release-check.yml`) and fail the PR on any **high**-severity issue.

## What it checks

For each app, in Chromium at 390 px and 1440 px:

1. **Empty device, then sample data.** No page errors, no failed requests, no horizontal overflow, no near-empty
   page, and an axe accessibility pass.
2. **PWA files.** The manifest, its icons, the apple-touch-icon and every file in `sw.js`'s precache list exist.
3. **Offline.** The service worker installs, and the app starts again with the network off.
4. **Corrupted data.** Each saved `localStorage` key is set to broken JSON (`{"broken`) and then to a wrong-typed
   value (`42`). The app must still start.

Two checks run once per run:
- **Shared files.** `ui.js`, `ui.css` and `sync.js` must be byte-identical in all seven apps.
- **ui.js unit tests.** The shell's run executes `test/ui.test.html`.

The CDN, fonts and video hosts are blocked in every run, so results don't depend on the network. The apps must
start without them anyway.

| Severity | Meaning | Fails the run |
|---|---|---|
| high | A crash, a missing file, offline start-up broken, shared files drifted, layout overflow | yes |
| medium | Serious accessibility issues, manifest gaps | no, shown as warnings |
| low | Minor accessibility issues, polish | no, listed in the log |

Zoom is turned off on purpose, so axe's `meta-viewport` rule is ignored (`ACCEPTED` in `ship.js`).

## What runs where

- **An app's PR** checks that app plus the TODAY shell, because the shell reads every app's data.
- **A PR in this repo** checks all seven apps, because the harness and the shared files live here.

Each run serves the apps side by side from one local origin, the way GitHub Pages does:
- The repo under test is used as checked out.
- Every other app comes from `main`. If that repo has a branch with the same name as the PR's branch, that branch
  is merged in first. A change made across repos on one branch (a shared-file update, say) is then tested together.

A full run of all seven apps takes about 4 minutes.

## Run it locally

```sh
cd test && npm ci
BRANCH=main bash site.sh nutrition ../../nutrition   # site/ with every app; nutrition from your checkout
SITE=$PWD/site node ship.js nutrition ISIONXXX        # or no app names for all seven
```

- `site.sh` clones the other apps from GitHub.
- To test local checkouts of every app, point `SITE` at a folder with one folder per app instead: `ISIONXXX`,
  `JOURNAL`, `MEDITATE`, `TRAINING`, `nutrition`, `data-analytics`, `rewire`. Symlinks are fine.
- The results are also written to `test/out/<APP>.json`.

## Adding to it

- A new app needs:
  - an entry in `APPS` in `ship.js`, with the expression that loads its sample data;
  - a line in `site.sh`;
  - the workflow file in its repo.
- A check that only matters for one app belongs in that app's section of `ship.js`, keyed on `app`.
