'use strict';
// The Content Security Policy every page carries (ARCHITECTURE.md 2v): a <meta> before its first script that lets the
// browser run only the site's own files and the page's own inline scripts, each named by its SHA-256. A script that
// gets into a page some other way (an onerror=… or a <script> in saved data, an href="javascript:…") is refused.
//
// The fingerprints change whenever an inline script does (an app's own code is one), so after editing one:
//   node csp.js --fix ../../MEDITATE      (an app's checkout; ISIONXXX's has four pages; no folder: the shell)
// ship.js runs the same check on every app and fails on a stale or missing policy.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

// each app's pages, by its folder in the site
const PAGES = {
  ISIONXXX: ['index.html', 'personal/index.html', 'personal/affirmation/index.html', 'ui.html'],
  JOURNAL: ['index.html'], MEDITATE: ['index.html'], TRAINING: ['index.html'], nutrition: ['index.html'],
  'data-analytics': ['index.html'], rewire: ['index.html'],
};
// the policy a page starts with; csp.js only ever changes its fingerprints, so anything a page adds by hand stays
// (LEARN adds its runtimes' CDN folders and 'wasm-unsafe-eval' for their WebAssembly)
const BASE = "script-src 'self' HASHES; object-src 'none'; base-uri 'self'";
const META = /([ \t]*)<meta http-equiv="Content-Security-Policy" content="([^"]*)">\n?/;

// the scripts the browser runs from the page itself: no src, and JavaScript (an app's own code is type="isx/app",
// which db.js runs as an inline script once the data is ready, with the same text)
const inline = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([, a]) => !/\bsrc\s*=/.test(a) && (!/\btype\s*=/.test(a) || /\btype\s*=\s*["']?(text\/javascript|module|isx\/app)\b/.test(a)))
  .map(m => m[2]);
const hash = t => `'sha256-${crypto.createHash('sha256').update(t, 'utf8').digest('base64')}'`;

// what's wrong with a page's policy ([] = nothing); fix: write the right one
function page(file, fix) {
  let html = fs.readFileSync(file, 'utf8');
  const want = [...new Set(inline(html).map(hash))];
  const m = html.match(META), first = html.search(/<script\b/);
  if (!m) {
    if (!fix) return ['no Content-Security-Policy <meta>'];
    const cs = html.match(/^([ \t]*)<meta charset=["']?utf-8["']?>\n/im);
    if (!cs) return ['no <meta charset="utf-8"> to put the policy after'];
    const tag = `${cs[1]}<meta http-equiv="Content-Security-Policy" content="${BASE.replace('HASHES', want.join(' '))}">\n`;
    html = html.replace(cs[0], cs[0] + tag);
    fs.writeFileSync(file, html); return [];
  }
  const out = [], pol = m[2], dirs = Object.fromEntries(pol.split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v]));
  if (html.indexOf(m[0]) > first && first >= 0) out.push('the policy comes after a script, which runs unchecked');
  const ss = dirs['script-src'] || [];
  if (!dirs['script-src']) out.push('no script-src');
  if (ss.some(v => /unsafe-inline|unsafe-hashes|\*|^https?:$|^data:$|^blob:$/.test(v))) out.push(`script-src allows too much: ${ss.filter(v => /unsafe-inline|unsafe-hashes|\*|^https?:$|^data:$|^blob:$/.test(v)).join(' ')}`);
  if ((dirs['object-src'] || []).join(' ') !== "'none'") out.push("object-src isn't 'none'");
  if (!dirs['base-uri']) out.push('no base-uri');
  const have = ss.filter(v => v.startsWith("'sha256-"));
  const stale = have.filter(h => !want.includes(h)), missing = want.filter(h => !have.includes(h));
  if (stale.length || missing.length) {
    if (fix) {
      const keep = ss.filter(v => !v.startsWith("'sha256-")), at = keep.indexOf("'self'") + 1;
      keep.splice(at > 0 ? at : keep.length, 0, ...want);
      dirs['script-src'] = keep;
      const tag = `${m[1]}<meta http-equiv="Content-Security-Policy" content="${Object.entries(dirs).map(([k, v]) => [k, ...v].join(' ')).join('; ')}">\n`;
      fs.writeFileSync(file, html.replace(m[0], tag));
    } else out.push(`inline script fingerprints are out of date (${missing.length} new, ${stale.length} gone): run node test/csp.js --fix on this app`);
  }
  return fix ? out.filter(x => !/fingerprints/.test(x)) : out;
}
// every page of an app: [[page, problem], ...]
function app(dir, name, fix = false) {
  const pages = PAGES[name] || ['index.html'];
  return pages.flatMap(f => { const p = path.join(dir, f); return fs.existsSync(p) ? page(p, fix).map(x => [f, x]) : [] });
}
module.exports = { app, page, PAGES };

if (require.main === module) {
  const fix = process.argv.includes('--fix'), dirs = process.argv.slice(2).filter(a => a !== '--fix');
  const targets = (dirs.length ? dirs : [path.join(__dirname, '..')]).map(d => path.resolve(d));
  let bad = 0;
  for (const d of targets) {
    // the app's name: its folder in the site, or for a checkout, from its manifest's short name
    const name = Object.keys(PAGES).find(k => path.basename(d) === k) || (fs.existsSync(path.join(d, 'personal')) ? 'ISIONXXX' : path.basename(d));
    const r = app(d, name, fix);
    for (const [f, x] of r) { bad++; console.log(`${path.basename(d)}/${f}: ${x}`) }
    if (!r.length) console.log(`${path.basename(d)}: ${fix ? 'policy written' : 'policy up to date'} (${(PAGES[name] || ['index.html']).filter(f => fs.existsSync(path.join(d, f))).length} pages)`);
  }
  process.exit(bad ? 1 : 0);
}
