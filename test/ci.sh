#!/usr/bin/env bash
# What each repo's release-check workflow runs (see README.md):
#   bash ci.sh <APP> <checkout>
# Lays out the site, installs Chromium and WebKit and runs the release check: the app and the shell, which reads every app's
# data; the shell's own run checks all seven, since this harness and the shared files live here.
set -euo pipefail
APP=$1 SELF=$2 HERE=$(cd "$(dirname "$0")" && pwd)
export SITE=${SITE:-$PWD/site}
bash "$HERE/site.sh" "$APP" "$SELF"
# the harness as it will be merged: this PR's own in the shell's repo, else main with any same-named branch merged in
T=$SITE/ISIONXXX/test
npm ci --prefix "$T" --no-audit --no-fund
# in Playwright's image (the workflows run in it) the browsers and their system packages are already there; anywhere else
# they're installed, with the packages from Ubuntu's servers
if [ -d /ms-playwright ]; then "$T/node_modules/.bin/playwright" install chromium webkit
else "$T/node_modules/.bin/playwright" install --with-deps chromium webkit; fi
# both run, so one failing doesn't hide the other's result
rc=0
if [ "$APP" = ISIONXXX ]; then node "$T/ship.js" || rc=$?; else node "$T/ship.js" "$APP" ISIONXXX || rc=$?; fi
# the personal homepage (ISIONXXX/personal) links into every app, so each repo's run checks it too
node "$T/personal.test.js" || rc=$?
# db.js, the database layer every app loads first
node "$T/db.test.js" || rc=$?
# TODAY's check-in and check-out, on a clock the test sets
node "$T/checkin.test.js" || rc=$?
# the iPhone lane: the app and TODAY in WebKit, Safari's engine, on an iPhone-sized screen (webkit.test.js)
if [ "$APP" = ISIONXXX ]; then node "$T/webkit.test.js" || rc=$?; else node "$T/webkit.test.js" "$APP" ISIONXXX || rc=$?; fi
exit $rc
