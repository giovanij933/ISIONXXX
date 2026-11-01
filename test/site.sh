#!/usr/bin/env bash
# Lays out the seven apps the way GitHub Pages serves them, one folder each under $SITE (default ./site):
#   bash site.sh <APP> <checkout>
# <APP> (ISIONXXX, JOURNAL, ...) is the app under test, served from <checkout> as it is. Every other app is cloned
# from GitHub: main, with $BRANCH merged in when that repo has a branch of that name. A change made across repos on
# one branch (the shared files, a new contract between the shell and an app) is then tested as it will be merged.
set -euo pipefail
APP=$1 SELF=$(cd "$2" && pwd) SITE=${SITE:-$PWD/site} BRANCH=${BRANCH:-main}
if [ -e "$SITE" ]; then echo "$SITE already exists: remove it or set SITE" >&2; exit 1; fi
mkdir -p "$SITE"
found=
while read -r app repo; do
  if [ "$app" = "$APP" ]; then ln -s "$SELF" "$SITE/$app"; echo "$app: this checkout"; found=1; continue; fi
  d=$SITE/$app
  git clone -q "https://github.com/giovanij933/$repo" "$d"
  if [ "$BRANCH" != main ] && git -C "$d" fetch -q origin "refs/heads/$BRANCH" 2>/dev/null; then
    if git -C "$d" -c user.name=ci -c user.email=ci@localhost merge -q --no-edit FETCH_HEAD >/dev/null 2>&1; then echo "$app: main + $BRANCH"
    else git -C "$d" merge --abort; git -C "$d" checkout -q FETCH_HEAD; echo "$app: $BRANCH (it doesn't merge cleanly into main)"; fi
  else echo "$app: main"; fi
done <<'APPS'
ISIONXXX ISIONXXX
JOURNAL JOURNAL
MEDITATE MEDITATE
TRAINING TRAINING
nutrition nutrition
data-analytics data-analytics
rewire rewire
APPS
if [ -z "$found" ]; then echo "unknown app: $APP" >&2; exit 1; fi
