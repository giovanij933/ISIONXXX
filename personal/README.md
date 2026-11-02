# ISIONXXX personal homepage

A responsive, static homepage for the seven apps. The page includes an app map,
Body / Mind / Growth filters, and a daily intention saved locally in the browser.
It uses plain HTML, CSS, and JavaScript, with local SVG artwork and system fonts.
There is no build step, external asset dependency, or backend.

## Run locally

Serve the parent directory containing all seven checkouts, preserving their names:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace
```

The homepage is at `/ISIONXXX/personal/`. Its links open the existing Today shell
at `/ISIONXXX/#today`, `#mind`, `#training`, `#nutrition`, `#learn`, `#journal`, and
`#rewire`. The other apps must be available beside ISIONXXX on the same origin.
This matches the existing GitHub Pages layout. No deployment was performed as
part of building this page.

## Behavior

- All seven links work without JavaScript; JavaScript enables filtering and notes.
- The intention uses only `isx.personal.intention.v1` in localStorage. It is not
  synced to GitHub and does not read or change the apps' records.
- A note is shown only for the date it was saved, using the browser's local date.
- Corrupted storage is ignored. A failed save keeps the editor open with an error.
- Keyboard navigation, visible focus, modal focus management, reduced motion,
  and responsive layouts are supported.

## Validate

From `ISIONXXX/test`:

```sh
CHROME=/usr/bin/chromium node personal.test.js
```

The test starts and closes its own local server and uses the repository's pinned
Playwright and axe-core dependencies. Set `CHROME` to a different Chromium binary
if needed, or omit it when Playwright's bundled browser is installed.
