# ISIONXXX personal homepage

A responsive, static homepage for the seven apps. The page includes an app map,
Body / Mind / Growth filters, and a daily intention saved locally in the browser.
It uses plain HTML, CSS, and JavaScript. The homepage shares `../ui.css`, the
shell's icon, and the apps' IBM Plex Mono typography, dark glass panels, amber
controls, and app accent colors. The optional Google Fonts stylesheet falls back
to system monospace when unavailable. There is no build step or backend.

## Run locally

Serve the parent directory containing all seven checkouts, preserving their names:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace
```

The homepage is at `/ISIONXXX/personal/`. Its links open the existing Today shell
at `/ISIONXXX/#today`, `#mind`, `#training`, `#nutrition`, `#learn`, `#journal`, and
`#rewire`. The other apps must be available beside ISIONXXX on the same origin.
This matches the existing GitHub Pages layout. The site uses the repository's
`main` branch at `/ISIONXXX/personal/`.

## Behavior

- All seven links work without JavaScript; JavaScript enables filtering and notes.
- The installed app opens here. Launched from the home screen, the shell (`../`)
  sends its first page of the launch to this one, unless the address names a tab
  (`#today`), so "Open my day" doesn't bounce back. A browser tab on `../` still
  opens the shell. The shell's service worker keeps this page, so it opens with no
  signal too. The page also links the app's manifest and icons, so installing
  from here installs the same app.
- The way back: every app's name in its header links here. It shows the ISIONXXX
  mark (the app icon's monogram, from `../ui.css`) then the app's name: "// MIND"
  on wider screens, "MIND" on phones. `../ui.js` adds the link, so all seven apps get it. Inside the
  TODAY shell it opens this page in the whole window, not inside the app's frame.
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
if needed, or omit it when Playwright's bundled browser is installed. It serves
the folder above this checkout; set `SITE` to serve a different folder that
holds all seven apps.

Every repo's release check runs it too (`test/ci.sh`). On phones it holds the page
to the apps' standard: no text under 11 px, no control under 44 px, and the
intention editor closes with a swipe down. The swipe comes from `../ui.js`.
