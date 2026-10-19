/* ISIONXXX // ui — shared, accessible UI components for the ISIONXXX apps.

   How it works
   - Every component is a function: props in, an HTML string out. Text is always escaped, so props can carry user
     data safely. Components hold no state: the app keeps it and renders again.
   - UI.mount(root) is called once per page. It handles clicks and keys for every component under root through
     delegation (so it survives innerHTML re-renders), keeps ARIA state in step, and fires one event:
       root.addEventListener('ui-change', e => { e.detail.name, e.detail.value })
   - Styles live in ui.css; tokens are --ui-* custom properties so an app can retheme without touching the file.

   Components: card, meter, week, status, segmented, rating, choiceList, stepper, button, emptyState, skeleton,
   plus UI.toast(message) for announcements. See ui.html for every component, its props and its states.
*/
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = o => Object.entries(o).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? k : `${k}="${esc(v)}"`).join(' ');
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  let seq = 0;
  const uid = p => `ui-${p}-${(++seq).toString(36)}`;
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sr = t => `<span class="ui-sr">${esc(t)}</span>`;   // read by screen readers, not shown

  /* ---------- status: a small labelled badge ----------
     { text, tone: 'ok' | 'bad' | 'live' | 'neutral' }                                                  */
  function status({ text, tone = 'neutral' } = {}) {
    if (!text) return '';
    return `<span class="ui-status ui-${esc(tone)}">${tone === 'live' ? '<i aria-hidden="true"></i>' : ''}${esc(text)}</span>`;
  }

  /* ---------- meter: progress toward a goal ----------
     { label, value, max, display?, tone? }  display = the text shown (defaults to "value / max").
     Edge cases: missing or non-numeric value or max shows "—" and an empty bar; values past max fill the
     bar and turn it 'done'; negatives count as 0.                                                         */
  function meter({ label = '', value, max, display, tone } = {}) {
    const v = num(value), m = num(max), ok = v != null && m != null && m > 0;
    const pct = ok ? Math.min(100, Math.max(0, v / m * 100)) : 0, done = ok && v >= m;
    const text = display ?? (ok ? `${v} / ${m}` : '—'), id = uid('m');
    return `<div class="ui-meter${done ? ' ui-done' : ''}${tone ? ' ui-' + esc(tone) : ''}">
      <div class="ui-meter-row"><span id="${id}">${esc(label)}</span><b aria-hidden="true">${esc(text)}</b></div>
      <div class="ui-meter-bar" ${attr({ role: 'progressbar', 'aria-labelledby': id, 'aria-valuemin': 0, 'aria-valuemax': ok ? m : 100, 'aria-valuenow': ok ? Math.max(0, Math.min(v, m)) : 0, 'aria-valuetext': ok ? text + (done ? ', goal met' : '') : 'no data' })}><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
  }

  /* ---------- week: the last N days as a strip ----------
     { days: [{ date: Date|'YYYY-MM-DD', state: ''|'on'|'pos'|'neg'|'half'|'live' }], label?, words? }
     words maps a state to what a screen reader hears (defaults below); the last day is marked as today.     */
  const WORDS = { '': 'nothing', on: 'done', pos: 'good', neg: 'missed', half: 'partly', live: 'in progress' };
  function week({ days = [], label = 'Last 7 days', words = {} } = {}) {
    if (!days.length) return '';
    const W = { ...WORDS, ...words };
    return `<ol class="ui-week" aria-label="${esc(label)}">${days.map((d, i) => {
      const dt = d.date instanceof Date ? d.date : new Date(String(d.date) + 'T12:00:00'), today = i === days.length - 1;
      const name = isNaN(dt) ? '' : DAY[dt.getDay()];
      return `<li class="${today ? 'ui-today' : ''}"><i class="ui-${esc(d.state || 'none')}" aria-hidden="true"></i><span aria-hidden="true">${name.charAt(0)}</span>${sr(`${today ? 'Today' : name}: ${W[d.state || ''] ?? d.state}`)}</li>`;
    }).join('')}</ol>`;
  }

  /* ---------- button ----------
     { label, act?, variant: 'primary'|'secondary'|'ghost', busy?, disabled?, attrs? }
     busy shows a spinner, keeps the width, sets aria-busy and blocks clicks (loading state).               */
  function button({ label, act, variant = 'secondary', busy = false, disabled = false, attrs = {} } = {}) {
    return `<button type="button" class="ui-btn ui-${esc(variant)}${busy ? ' ui-busy' : ''}" ${attr({ 'data-act': act, disabled: disabled || busy, 'aria-busy': busy ? 'true' : null, ...attrs })}><span>${esc(label)}</span></button>`;
  }

  /* ---------- card: one app's summary ----------
     { id, title, status?, big?, bigTone?, sub?: string[], rows?: [label, value][], meters?: meter props[],
       week?: week props, actions?: button props[], openLabel? }
     The whole card opens its app (one real button stretched over the card), while its action buttons stay
     separate controls; nested interactive elements would confuse screen readers.                         */
  function card({ id, title, status: st, big, bigTone, sub = [], rows = [], meters = [], week: wk, actions = [], openLabel } = {}) {
    const h = uid('h');
    return `<article class="ui-card" ${attr({ 'data-card': id, 'aria-labelledby': h })}>
      <div class="ui-card-head"><h3 id="${h}"><button type="button" class="ui-card-open" data-open="${esc(id)}" aria-label="${esc(openLabel || `Open ${title}`)}">${esc(title)}</button></h3>${status(st || {})}</div>
      ${big != null ? `<p class="ui-big${bigTone ? ' ui-' + esc(bigTone) : ''}">${esc(big)}</p>` : ''}
      ${sub.filter(Boolean).length ? `<p class="ui-sub">${sub.filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${rows.length ? `<dl class="ui-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${meters.filter(Boolean).map(meter).join('')}
      ${wk ? week(wk) : ''}
      ${actions.length ? `<div class="ui-actions">${actions.map(a => button({ ...a, attrs: { 'data-go': id, ...(a.attrs || {}) } })).join('')}</div>` : ''}
    </article>`;
  }

  /* ---------- segmented: pick one of a few (radio group) ----------
     { name, label, options: [{ value, label, hint? }], value, disabled? }
     Keyboard: arrows / Home / End move and select (standard radio-group behaviour); Tab leaves the group. */
  function segmented({ name, label, options = [], value, disabled = false, className = 'ui-seg' } = {}) {
    if (!options.length) return '';
    const sel = options.findIndex(o => o.value === value), tab = sel >= 0 ? sel : 0;
    return `<div class="${className}" role="radiogroup" ${attr({ 'aria-label': label, 'data-ui': 'radio', 'data-name': name, 'aria-disabled': disabled ? 'true' : null })}>${options.map((o, i) =>
      `<button type="button" role="radio" ${attr({ 'aria-checked': i === sel ? 'true' : 'false', tabindex: i === tab ? 0 : -1, 'data-value': JSON.stringify(o.value), 'aria-label': o.hint ? `${o.label}, ${o.hint}` : null, disabled, title: o.hint })}>${esc(o.label)}</button>`).join('')}</div>`;
  }

  /* ---------- rating: a 1–N scale, optionally with words ----------
     { name, label, min=1, max=5, value, words?: string[] (indexed by value) }                            */
  function rating({ name, label, min = 1, max = 5, value, words = [] } = {}) {
    const options = [];
    for (let v = min; v <= max; v++) options.push({ value: v, label: String(v), hint: words[v] });
    const w = words[value];
    return `<div class="ui-rating"><div class="ui-field-label"><span>${esc(label)}</span>${w ? `<em aria-hidden="true">${esc(w)}</em>` : ''}</div>${segmented({ name, label, options, value })}</div>`;
  }

  /* ---------- choiceList: a vertical list of choices ----------
     { name, label, options: [{ value, label, detail?, disabled? }], value, multiple? }
     One pick: a radio group (dot). Several (multiple: true, value = array): checkboxes (tick box).
     Keyboard: arrows / Home / End move; one-pick lists select as they move; Space toggles in multi lists.   */
  function choiceList({ name, label, options = [], value, multiple = false, empty = 'Nothing to choose from' } = {}) {
    if (!options.length) return `<p class="ui-empty-inline">${esc(empty)}</p>`;
    const on = o => multiple ? (Array.isArray(value) && value.includes(o.value)) : o.value === value;
    const first = Math.max(0, options.findIndex(o => on(o) && !o.disabled)), firstOk = options.findIndex(o => !o.disabled);
    const tab = on(options[first]) ? first : firstOk;
    return `<div class="ui-list${multiple ? ' ui-multi' : ''}" ${attr({ role: multiple ? 'group' : 'radiogroup', 'aria-label': label, 'data-ui': multiple ? 'check' : 'radio', 'data-name': name })}>${options.map((o, i) =>
      `<button type="button" ${attr({ role: multiple ? 'checkbox' : 'radio', 'aria-checked': on(o) ? 'true' : 'false', tabindex: i === tab ? 0 : -1, 'data-value': JSON.stringify(o.value), disabled: o.disabled })}><span class="ui-list-label">${esc(o.label)}</span>${o.detail ? `<em>${esc(o.detail)}</em>` : ''}</button>`).join('')}</div>`;
  }

  /* ---------- stepper: a number with − / + ----------
     { name, label, value, min, max, step=1, unit?, format?(v) }
     The value itself is a spinbutton: focus it and use Up / Down (Page Up / Down = 5 steps, Home / End =
     limits). The buttons do the same and disable at the limits.                                          */
  function stepper({ name, label, value, min = -Infinity, max = Infinity, step = 1, unit = '', format } = {}) {
    const v = num(value) ?? (isFinite(min) ? min : 0), txt = (format ? format(v) : String(v)) + (unit ? ' ' + unit : '');
    return `<div class="ui-stepper" role="group" ${attr({ 'aria-label': label, 'data-ui': 'step', 'data-name': name, 'data-min': isFinite(min) ? min : null, 'data-max': isFinite(max) ? max : null, 'data-step': step, 'data-unit': unit || null })}>
      <button type="button" data-d="-1" ${attr({ 'aria-label': `Decrease ${label}`, disabled: v - step < min - 1e-9 })}>−</button>
      <output role="spinbutton" tabindex="0" ${attr({ 'aria-label': label, 'aria-valuenow': v, 'aria-valuemin': isFinite(min) ? min : null, 'aria-valuemax': isFinite(max) ? max : null, 'aria-valuetext': txt })}>${esc(txt)}</output>
      <button type="button" data-d="1" ${attr({ 'aria-label': `Increase ${label}`, disabled: v + step > max + 1e-9 })}>+</button></div>`;
  }

  /* ---------- emptyState ----------
     { title, body?, action?: button props }                                                               */
  function emptyState({ title, body, action } = {}) {
    return `<div class="ui-empty"><p class="ui-empty-title">${esc(title)}</p>${body ? `<p class="ui-sub">${esc(body)}</p>` : ''}${action ? button({ variant: 'primary', ...action }) : ''}</div>`;
  }

  /* ---------- skeleton: loading placeholder ----------
     { label='Loading', lines=3 }  Announced once to screen readers; the shimmer stops under Reduce Motion.  */
  function skeleton({ label = 'Loading', lines = 3 } = {}) {
    return `<div class="ui-skeleton" role="status" aria-live="polite" aria-busy="true">${sr(label + '…')}${Array.from({ length: Math.max(1, lines) }, (_, i) => `<i aria-hidden="true" style="width:${[92, 70, 84, 60][i % 4]}%"></i>`).join('')}</div>`;
  }

  /* ---------- toast: a short announcement ----------
     UI.toast('Saved') — shown for 3 s and read by screen readers (polite).                                 */
  let toastEl, toastT;
  function toast(msg, { tone } = {}) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ui-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl) }
    toastEl.textContent = msg; toastEl.className = 'ui-toast ui-on' + (tone ? ' ui-' + tone : '');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('ui-on'), 3000);
  }

  /* ---------- behaviour ---------- */
  const fire = (el, name, value) => el.dispatchEvent(new CustomEvent('ui-change', { bubbles: true, detail: { name, value } }));
  const val = b => { try { return JSON.parse(b.dataset.value) } catch (e) { return b.dataset.value } };
  const items = g => [...g.querySelectorAll(':scope > [role=radio], :scope > [role=checkbox]')].filter(b => !b.disabled);
  function pick(g, b, focus) {
    if (!b || b.disabled || g.getAttribute('aria-disabled') === 'true') return;
    const multi = g.dataset.ui === 'check';
    if (multi) b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    else items(g).forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    roam(g, b, focus);
    fire(g, g.dataset.name, multi ? items(g).filter(x => x.getAttribute('aria-checked') === 'true').map(val) : val(b));
  }
  function roam(g, b, focus) { items(g).forEach(x => x.tabIndex = x === b ? 0 : -1); if (focus) b.focus() }
  function stepBy(g, dir, big) {
    const out = g.querySelector('output'), step = +g.dataset.step || 1, min = g.dataset.min != null ? +g.dataset.min : -Infinity, max = g.dataset.max != null ? +g.dataset.max : Infinity;
    const cur = +out.getAttribute('aria-valuenow'), dec = n => (String(n).split('.')[1] || '').length;
    // add exactly one step to whatever value is there (6.75 + 0.5 = 7.25, no snapping to the step grid), then round to
    // the decimals in play so 0.2 + 0.1 is 0.3, not 0.30000000000000004
    const next = dir === 'min' ? min : dir === 'max' ? max : +Math.min(max, Math.max(min, cur + dir * step * (big ? 5 : 1))).toFixed(Math.max(dec(step), dec(cur)));
    if (!isFinite(next) || next === cur) return;
    const txt = String(+next.toFixed(6)) + (g.dataset.unit ? ' ' + g.dataset.unit : '');
    out.setAttribute('aria-valuenow', next); out.setAttribute('aria-valuetext', txt); out.textContent = txt;
    g.querySelector('[data-d="-1"]').disabled = next - step < min - 1e-9; g.querySelector('[data-d="1"]').disabled = next + step > max + 1e-9;
    fire(g, g.dataset.name, next);
  }
  function mount(root = document) {
    if (root.__ui) return root; root.__ui = true;
    root.addEventListener('click', e => {
      const s = e.target.closest('[data-ui=step] [data-d]'); if (s) return stepBy(s.parentElement, +s.dataset.d);
      const b = e.target.closest('[data-ui=radio] > [role=radio], [data-ui=check] > [role=checkbox]'); if (b) pick(b.parentElement, b, false);
      const busy = e.target.closest('.ui-busy'); if (busy) { e.preventDefault(); e.stopImmediatePropagation() }
    }, true);
    root.addEventListener('keydown', e => {
      const out = e.target.closest('[data-ui=step] > output');
      if (out) {
        const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 1, PageDown: -1, Home: 'min', End: 'max' }[e.key];
        if (k != null) { e.preventDefault(); stepBy(out.parentElement, k, e.key.startsWith('Page')) }
        return;
      }
      const b = e.target.closest('[data-ui] > [role=radio], [data-ui] > [role=checkbox]'); if (!b) return;
      const g = b.parentElement, L = items(g), i = L.indexOf(b), multi = g.dataset.ui === 'check';
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: L.length - 1 }[e.key];
      if (to != null) { e.preventDefault(); const n = L[(to + L.length) % L.length]; multi ? roam(g, n, true) : pick(g, n, true); return }
      if (multi && e.key === ' ') { e.preventDefault(); pick(g, b, true) }
    });
    return root;
  }

  /* ---------- hero: an app's day at a glance ----------
     { key, title, sub?, big?: {value, label?, tone?: 'pos'|'neg'}, rings: [{ key, label, value, max, display?, done? }], action?: button props,
       stats?: [{ label, value, tone?, sub?, attrs? (makes it a button), on? (chosen) }] — tiles in place of rings, e.g. P&L by period,
       log?: today's entries, listed in the card in time order ({ at, tag?, text, tone? }, as in timeline) }
     Rings fill toward each goal (done = full + tick). key makes UI.animate fill them from where they were and notice a
     ring that just completed. Rings are read as "Calories: 1,420 of 2,000".                                    */
  // timeline rows, shared by hero's log and timeline()
  const tlRows = items => items.filter(x => x && isFinite(x.at)).sort((a, b) => a.at - b.at)
    .map(x => `<li${x.tone ? ` class="ui-${esc(x.tone)}"` : ''}><time>${TFMT.format(x.at)}</time><i aria-hidden="true"></i><span>${x.tag ? `<b>${esc(x.tag)}</b> ` : ''}${esc(x.text)}</span></li>`).join('');
  function hero({ key = 'hero', title, sub, big, rings = [], stats = [], action, log = [] } = {}) {
    const ring = r => {
      const v = num(r.value), m = num(r.max), f = r.done ? 1 : v != null && m > 0 ? Math.max(0, Math.min(1, v / m)) : 0, done = r.done ?? (v != null && m > 0 && v >= m);
      const said = r.display ?? (v != null && m != null ? `${v} of ${m}` : 'no data');
      return `<li class="ui-ring${done ? ' ui-done' : ''}" data-ring="${esc(key + ':' + r.key)}" data-done="${done ? 1 : 0}" data-label="${esc(r.label)}">
        <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="ui-rt" cx="22" cy="22" r="18"/><circle class="ui-rf" cx="22" cy="22" r="18" pathLength="100" stroke-dasharray="0 100" data-to="${(f * 100).toFixed(1)}"/>${done ? '<path class="ui-ck" d="M15.5 22.5l4.5 4.5 8.5-9"/>' : ''}</svg>
        <span class="ui-ring-l" aria-hidden="true">${esc(r.label)}</span><b aria-hidden="true">${esc(r.display ?? (v != null ? v : '—'))}</b>${sr(`${r.label}: ${said}${done ? ', done' : ''}`)}</li>`;
    };
    return `<section class="ui-hero" aria-label="${esc(title)}">
      <div class="ui-hero-top"><div><h2>${esc(title)}</h2>${sub ? `<p class="ui-sub">${esc(sub)}</p>` : ''}</div>
        ${big ? `<p class="ui-hero-big"><b data-count="${esc(key)}:big"${big.tone === 'pos' || big.tone === 'neg' ? ` class="ui-${big.tone}"` : ''}>${esc(big.value)}</b>${big.label ? `<span>${esc(big.label)}</span>` : ''}</p>` : ''}</div>
      ${rings.length ? `<ul class="ui-rings">${rings.map(ring).join('')}</ul>` : ''}
      ${stats.length ? `<div class="ui-stats">${stats.map(st => { const tag = st.attrs ? 'button' : 'div';
        return `<${tag} class="ui-stat${st.on ? ' ui-on' : ''}"${st.attrs ? ` type="button" ${attr(st.attrs)}${st.on != null ? ` aria-pressed="${!!st.on}"` : ''}` : ''}><span class="ui-stat-l">${esc(st.label)}</span><b${st.tone === 'pos' || st.tone === 'neg' ? ` class="ui-${st.tone}"` : ''}>${esc(st.value)}</b>${st.sub ? `<small>${esc(st.sub)}</small>` : ''}</${tag}>` }).join('')}</div>` : ''}
      ${action ? `<div class="ui-actions">${button({ variant: 'primary', ...action })}</div>` : ''}
      ${(() => {
        // today's entries, in a side panel on wide screens (header + count, or a placeholder until there are some)
        const n = log.filter(x => x && isFinite(x.at)).length, rows = tlRows(log), when = esc(String(title).toLowerCase()), hid = uid('hl');
        return `<div class="ui-hero-side${n ? '' : ' ui-empty'}"><div class="ui-hero-side-h"><span id="${hid}">Logged ${when}</span>${n ? `<span>${n} ${n === 1 ? 'entry' : 'entries'}</span>` : ''}</div>
          ${n ? `<ol class="ui-tl ui-hero-log" aria-labelledby="${hid}">${rows}</ol>` : `<p class="ui-hero-none">Nothing logged yet ${when}. It shows up here as you go.</p>`}</div>`;
      })()}</section>`;
  }

  /* ---------- timeline: what happened today, in order ----------
     { title='Today so far', items: [{ at (ms), tag?, text, tone?: 'pos'|'neg' }], empty, color? }            */
  const TFMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  function timeline({ title = 'Today so far', items = [], empty = 'Nothing logged yet today.' } = {}) {
    const L = items.filter(x => x && isFinite(x.at)), id = uid('tl');
    return `<section class="ui-tl-wrap" aria-labelledby="${id}"><div class="ui-card-head"><h2 id="${id}" class="ui-tl-h">${esc(title)}</h2>${status({ text: L.length ? `${L.length} ${L.length === 1 ? 'entry' : 'entries'}` : '—' })}</div>
      ${L.length ? `<ol class="ui-tl">${tlRows(L)}</ol>` : `<p class="ui-sub">${esc(empty)}</p>`}</section>`;
  }

  /* ---------- animate: motion after a render ----------
     UI.animate(root, { onDone(labels) }) — call after each render. Rings fill from where they were last time (from 0
     the first time), [data-count] numbers count up from their last value, and rings that turned done since the last
     render pop and are passed to onDone (not on the first render). Nothing moves under Reduce Motion.          */
  const MEM = { ring: new Map(), count: new Map(), done: new Map(), tl: new Set(), tlInit: false, chart: new Map() };
  function countUp(node, from, to) {
    const re = /-?\d[\d,]*(\.\d+)?/, m = to.match(re); if (!m) return;
    const end = +m[0].replace(/,/g, ''), fm = from && from.match(re), start = fm ? +fm[0].replace(/,/g, '') : 0, dp = m[1] ? m[1].length - 1 : 0;
    if (start === end) return;
    const fmt = v => { const s = Math.abs(v).toFixed(dp), [i, f] = s.split('.'); return (v < 0 ? '-' : '') + (m[0].includes(',') ? Number(i).toLocaleString('en-US') : i) + (f ? '.' + f : '') };
    const t0 = performance.now(), D = 650;
    const step = now => { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3); node.textContent = to.replace(re, fmt(start + (end - start) * e)); if (k < 1 && node.isConnected) requestAnimationFrame(step); else node.textContent = to };
    requestAnimationFrame(step);
  }
  function animate(root = document, { onDone } = {}) {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches, fresh = [];
    root.querySelectorAll('[data-ring]').forEach(li => {
      const k = li.dataset.ring, rf = li.querySelector('.ui-rf'), to = rf.dataset.to, from = MEM.ring.get(k), wasDone = MEM.done.get(k), done = li.dataset.done === '1';
      MEM.ring.set(k, to); MEM.done.set(k, done);
      if (calm) { rf.setAttribute('stroke-dasharray', `${to} 100`); return }
      rf.setAttribute('stroke-dasharray', `${from ?? 0} 100`);
      requestAnimationFrame(() => requestAnimationFrame(() => rf.setAttribute('stroke-dasharray', `${to} 100`)));
      if (done && wasDone === false) { li.classList.add('ui-pop'); fresh.push(li.dataset.label) }
    });
    // timeline entries that weren't there last render slide in with a glow (never on the first render)
    root.querySelectorAll('.ui-tl li, .tl li').forEach(li => {
      const k = li.textContent; if (MEM.tlInit && !MEM.tl.has(k) && !calm) li.classList.add('ui-new'); MEM.tl.add(k);
    }); MEM.tlInit = true;
    // charts draw themselves in when they first appear or their data changes: lines trace, bars grow, areas fade
    root.querySelectorAll('svg.chart').forEach((c, i) => {
      const sig = c.innerHTML.length + ':' + c.innerHTML.slice(0, 160), k = (root.id || 'r') + i;
      if (MEM.chart.get(k) === sig) return; MEM.chart.set(k, sig); if (calm) return;
      c.querySelectorAll('polyline, path').forEach(l => { const f = l.getAttribute('fill'); if (l.tagName === 'polyline' || f === 'none') l.classList.add('ui-trace') });
      const bars = c.querySelectorAll('rect'); bars.forEach((r, j) => { r.classList.add('ui-grow'); r.style.animationDelay = Math.min(j * 18, 400) + 'ms' });
      c.classList.remove('ui-draw'); void c.getBoundingClientRect(); c.classList.add('ui-draw');
    });
    root.querySelectorAll('[data-count]').forEach(n => { const k = n.dataset.count, now = n.textContent, was = MEM.count.get(k); MEM.count.set(k, now); if (!calm && was !== now) countUp(n, was ?? null, now) });
    if (fresh.length && onDone) onDone(fresh);
    return fresh;
  }

  /* ---------- fluid: installed once when ui.js loads, for every page that uses it ----------
     - Dialogs and the apps' .modal boxes animate out when they close instead of vanishing. The real element closes
       at once (so app code that reopens or checks .open keeps working) and a short-lived copy plays the exit.
     - Swipe down on a dialog to dismiss it, like an iOS sheet: only when it is scrolled to the top, never for session
       sheets (.ss: a live session), never once you've typed in it, and never if the app cancels it ('cancel' event).
     All of it is skipped under Reduce Motion.                                                                      */
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ghost(el, rect, { sheet, dy = 0, cls = '' } = {}) {
    if (calm() || !rect.width || !rect.height) return;
    const g = el.cloneNode(true), cs = getComputedStyle(el);
    g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id')); g.removeAttribute('id');
    g.setAttribute('aria-hidden', 'true'); g.inert = true;
    if (g.tagName === 'DIALOG') g.setAttribute('open', '');
    Object.assign(g.style, { position: 'fixed', inset: 'auto', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', margin: '0', maxHeight: 'none', maxWidth: 'none', zIndex: 2147483646, pointerEvents: 'none', background: cs.backgroundColor, overflow: 'hidden', transform: `translateY(${dy}px)`, animation: 'none' });
    g.classList.add('ui-ghost', sheet ? 'ui-ghost-sheet' : 'ui-ghost-box'); if (cls) g.classList.add(cls);
    const bd = document.createElement('div'); bd.className = 'ui-ghost-bd'; bd.setAttribute('aria-hidden', 'true');
    document.body.append(bd, g); g.scrollTop = el.scrollTop;
    setTimeout(() => { g.remove(); bd.remove() }, 320);
  }
  function installFluid() {
    if (window.__uiFluid || typeof HTMLDialogElement === 'undefined') return; window.__uiFluid = true;
    const close = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (v) {
      if (this.open) { const r = this.getBoundingClientRect(), dy = this.__dy || 0; this.__dy = 0; this.style.transform = ''; close.call(this, v); ghost(this, r, { sheet: this.classList.contains('ss'), dy }) }
      else close.call(this, v);
    };
    // the apps' .modal overlays (NUTRITION, LEARN) close by gaining .hidden. The exit copy needs the box's last
    // on-screen rect, and by the time the class changes it is display:none, so the rect is kept while it is open:
    // measured on open, then again only when the box resizes, the overlay scrolls or the window resizes. No polling.
    const RO = typeof ResizeObserver === 'function' ? new ResizeObserver(es => es.forEach(e => keep(e.target.parentElement))) : null;
    const keep = m => {
      const b = m && m.__box;
      if (!b || m.classList.contains('hidden')) return;
      const r = b.getBoundingClientRect(); if (r.width) { m.__rect = r; m.__sheet = b.classList.contains('ss') }
    };
    const watch = m => {
      const b = m.querySelector(':scope > .box'); if (b === m.__box) return;
      if (m.__box) RO?.unobserve(m.__box); m.__box = b; if (b) RO?.observe(b);
    };
    document.querySelectorAll('.modal').forEach(m => {
      watch(m); keep(m);
      m.addEventListener('scroll', () => keep(m), { passive: true });
      // the entrance animation moves the box without resizing it: measure again once it has landed
      m.addEventListener('animationend', () => keep(m)); m.addEventListener('transitionend', () => keep(m));
      new MutationObserver(ms => {
        for (const r of ms) {
          if (r.type === 'childList') { watch(m); continue }
          const was = /\bhidden\b/.test(r.oldValue || ''), now = m.classList.contains('hidden');
          if (!was && now && m.__box && m.__rect) { ghost(m.__box, m.__rect, { sheet: m.__sheet, cls: m.__sheet ? 'ss' : '' }); m.__rect = null }
          else if (was && !now) requestAnimationFrame(() => keep(m));
        }
      }).observe(m, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, childList: true });
    });
    addEventListener('resize', () => document.querySelectorAll('.modal:not(.hidden)').forEach(keep), { passive: true });
    // swipe down to dismiss
    let drag = null;
    document.addEventListener('input', e => { const d = e.target.closest && e.target.closest('dialog'); if (d) d.__dirty = true }, true);
    document.addEventListener('touchstart', e => {
      const d = e.target.closest && e.target.closest('dialog[open]');
      if (!d || d.classList.contains('ss') || d.__dirty || d.scrollTop > 0 || e.touches.length > 1) return;
      if (e.target.closest('input,textarea,select,[contenteditable],.tw,pre')) return;
      drag = { d, y0: e.touches[0].clientY, t0: Date.now(), dy: 0 };
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!drag) return; const dy = e.touches[0].clientY - drag.y0;
      if (dy < 0 || drag.d.scrollTop > 0) { drag.d.style.transform = ''; return }
      drag.dy = dy; drag.d.style.transition = 'none'; drag.d.style.transform = `translateY(${dy * .85}px)`;
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (!drag) return; const { d, dy, t0 } = drag; drag = null;
      const fast = dy > 60 && dy / (Date.now() - t0) > .6;
      if (dy > 140 || fast) {
        const ev = new Event('cancel', { cancelable: true });
        if (d.dispatchEvent(ev)) { d.__dy = dy * .85; d.close(); return }
      }
      d.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; d.style.transform = '';
      setTimeout(() => { d.style.transition = '' }, 260);
    });
    // a fresh open starts clean
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { this.__dirty = false; this.style.transform = ''; return show.call(this) };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installFluid); else installFluid();

  /* ---------- keepFocus: re-render without losing the keyboard user's place ----------
     UI.keepFocus(render) — apps re-render with innerHTML after a change, which drops focus to <body>. This puts it
     back on the same control (same group name and value, the same stepper part, or the same id).            */
  function keepFocus(render) {
    const a = document.activeElement, g = a && a.closest && a.closest('[data-name]');
    const key = a && a !== document.body ? { id: a.id, n: g && g.dataset.name, v: a.dataset && a.dataset.value, d: a.dataset && a.dataset.d, out: a.tagName === 'OUTPUT' } : null;
    render();
    if (!key) return;
    let t = key.id ? document.getElementById(key.id) : null;
    if (!t && key.n) {
      const g2 = [...document.querySelectorAll('[data-name]')].find(x => x.dataset.name === key.n);
      if (g2) t = key.out ? g2.querySelector('output') : key.d ? g2.querySelector(`[data-d="${key.d}"]`) : [...g2.children].find(x => x.dataset.value === key.v);
    }
    if (t && t.isConnected) t.focus({ preventScroll: true });
  }

  /* ---------- column filters: sort and filter a log's columns, like a spreadsheet ----------
     const F = UI.filter('log', cols, onChange)   cols[i] describes the table's i-th column: { label, get: row => value,
       type?: 'text' | 'num' | 'time' }, or null when it can't be filtered. get returns plain text or a number.
     rows = F.apply(rows)   filters and sorts. Call it before paging; unsorted rows keep the order they came in.
     (A number column can name its unit, unit: 'min', for its Min / Max boxes.)
     F.th(i)                the i-th header's contents: a button that opens that column's menu.
     F.clear()              a "Clear filters" button while any filter or sort is on, else ''.
     onChange() runs after every change: re-render, back on the first page. Filters last while the page is open.  */
  const FILT = new Map();
  let lfPop = null, lfAt = null;
  const lfKey = v => v == null || v === '' ? '' : String(v);
  const lfOn = (f, i) => { const b = f.by[i]; return !!b && (b.hide ? b.hide.size > 0 : b.min != null || b.max != null) };
  function lfRun(f, rows, skip) {
    let out = rows.filter(r => f.cols.every((c, i) => {
      const b = f.by[i]; if (!c || !b || i === skip) return true;
      const v = c.get(r);
      if (b.hide) return !b.hide.has(lfKey(v));
      return (b.min == null || (v != null && v >= b.min)) && (b.max == null || (v != null && v <= b.max));
    }));
    const s = f.s, c = s && f.cols[s.i];
    if (c) {
      const txt = (c.type || 'text') === 'text';
      out = out.map((r, k) => [c.get(r), k, r]).sort((a, b) => {
        if (a[0] == null || a[0] === '') return b[0] == null || b[0] === '' ? a[1] - b[1] : 1;   // empty cells last
        if (b[0] == null || b[0] === '') return -1;
        return (txt ? String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }) : a[0] - b[0]) * s.dir || a[1] - b[1];
      }).map(x => x[2]);
    }
    return out;
  }
  function filter(key, cols, onChange) {
    const f = FILT.get(key) || { s: null, by: {}, all: [] };
    Object.assign(f, { key, cols, onChange }); FILT.set(key, f);
    if (lfPop && lfAt && lfAt.key === key) requestAnimationFrame(lfPlace);
    return {
      apply(rows) { f.all = rows; return lfRun(f, rows) },
      th(i) {
        const c = cols[i], s = f.s && f.s.i === i ? f.s.dir : 0, on = lfOn(f, i);
        const state = [on && 'filtered', s && (s > 0 ? 'sorted ascending' : 'sorted descending')].filter(Boolean).join(', ');
        return `<button type="button" class="ui-lf${on || s ? ' ui-on' : ''}" data-lf="${esc(key)}" data-i="${i}" aria-haspopup="dialog" aria-expanded="${!!lfAt && lfAt.key === key && lfAt.i === i}" aria-label="${esc(c.label)}: sort and filter${state ? ' (' + state + ')' : ''}">${esc(c.label)}<i aria-hidden="true">${s ? (s > 0 ? '▲' : '▼') : on ? '◆' : '▾'}</i></button>`;
      },
      clear() { return f.s || cols.some((c, i) => c && lfOn(f, i)) ? `<button type="button" class="ui-lf-clear" data-lf-clear="${esc(key)}">Clear filters</button>` : '' },
    };
  }
  function lfClose(focus) {
    if (!lfPop) return; const at = lfAt; lfPop.remove(); lfPop = lfAt = null;
    const b = at && document.querySelector(`.ui-lf[data-lf="${CSS.escape(at.key)}"][data-i="${at.i}"]`);
    if (b) { b.setAttribute('aria-expanded', 'false'); if (focus) b.focus() }
  }
  function lfPlace() {
    if (!lfPop) return;
    const b = document.querySelector(`.ui-lf[data-lf="${CSS.escape(lfAt.key)}"][data-i="${lfAt.i}"]`); if (!b) return lfClose();
    b.setAttribute('aria-expanded', 'true');
    const r = b.getBoundingClientRect(), w = lfPop.offsetWidth, h = lfPop.offsetHeight, W = innerWidth, H = innerHeight;
    lfPop.style.left = Math.max(8, Math.min(r.left, W - w - 8)) + 'px';
    lfPop.style.top = (r.bottom + 4 + h > H - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : Math.min(r.bottom + 4, Math.max(8, H - h - 8))) + 'px';
  }
  function lfChanged(f) { f.onChange && f.onChange(); lfSync(f) }
  // refresh the open menu's checkboxes after a change, keeping focus and the search text
  function lfSync(f) {
    if (!lfPop) return;
    const b = f.by[lfAt.i], boxes = [...lfPop.querySelectorAll('[data-v]')];
    boxes.forEach(x => x.checked = !(b && b.hide && b.hide.has(x.dataset.v)));
    const all = lfPop.querySelector('[data-all]'), vis = boxes.filter(x => !x.closest('label').hidden);
    if (all) { all.checked = vis.every(x => x.checked); all.indeterminate = !all.checked && vis.some(x => x.checked) }
    lfPop.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', !!(f.s && f.s.i === lfAt.i && f.s.dir === +x.dataset.s)));
  }
  function lfOpen(btn) {
    const key = btn.dataset.lf, i = +btn.dataset.i, f = FILT.get(key), c = f && f.cols[i]; if (!c) return;
    const same = lfAt && lfAt.key === key && lfAt.i === i; lfClose(); if (same) return;
    const type = c.type || 'text', b = f.by[i] || {};
    const S = { text: ['A → Z', 'Z → A'], num: ['Low → high', 'High → low'], time: ['Oldest first', 'Newest first'] }[type];
    let body = '';
    if (type === 'text') {
      const n = new Map(); lfRun(f, f.all, i).forEach(r => { const k = lfKey(c.get(r)); n.set(k, (n.get(k) || 0) + 1) });
      f.all.forEach(r => { const k = lfKey(c.get(r)); if (!n.has(k)) n.set(k, 0) });
      const vals = [...n.keys()].sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
      body = (vals.length > 8 ? `<input class="ui-lf-q" type="search" placeholder="Search" aria-label="Search values">` : '') +
        `<label class="ui-lf-v ui-lf-allv"><input type="checkbox" data-all> Select all</label><div class="ui-lf-vals">` +
        vals.map(v => `<label class="ui-lf-v"><input type="checkbox" data-v="${esc(v)}"> <span>${v === '' ? '<em>(Empty)</em>' : esc(v)}</span><small>${n.get(v)}</small></label>`).join('') + '</div>';
    } else if (type === 'num') {
      body = `<div class="ui-lf-rng"><label>Min${c.unit ? ` (${esc(c.unit)})` : ''}<input type="number" inputmode="decimal" step="any" data-r="min" value="${b.min ?? ''}"></label><label>Max${c.unit ? ` (${esc(c.unit)})` : ''}<input type="number" inputmode="decimal" step="any" data-r="max" value="${b.max ?? ''}"></label></div>`;
    }
    lfPop = document.createElement('div'); lfPop.className = 'ui-lf-pop'; lfPop.setAttribute('role', 'dialog'); lfPop.setAttribute('aria-label', `${c.label}: sort and filter`);
    lfPop.innerHTML = `<div class="ui-lf-s">${S.map((t, k) => `<button type="button" data-s="${k ? -1 : 1}">${t}</button>`).join('')}</div>${body}
      <div class="ui-lf-ft"><button type="button" data-x="clear">Clear</button><button type="button" data-x="done">Done</button></div>`;
    lfAt = { key, i }; document.body.appendChild(lfPop); lfSync(f); lfPlace();
    (lfPop.querySelector('.ui-lf-q') || lfPop.querySelector('[data-s]')).focus();
    let t;
    lfPop.addEventListener('click', e => {
      const x = e.target.closest('button'); if (!x) return;
      if (x.dataset.s) { const d = +x.dataset.s; f.s = f.s && f.s.i === i && f.s.dir === d ? null : { i, dir: d }; lfChanged(f) }
      else if (x.dataset.x === 'clear') { delete f.by[i]; if (f.s && f.s.i === i) f.s = null; lfPop.querySelectorAll('[data-r]').forEach(r => r.value = ''); lfChanged(f) }
      else if (x.dataset.x === 'done') lfClose(true);
    });
    lfPop.addEventListener('change', e => {
      const x = e.target;
      if (x.matches('[data-v],[data-all]')) {
        const hide = (f.by[i] && f.by[i].hide) || new Set(), boxes = x.dataset.all != null ? [...lfPop.querySelectorAll('[data-v]')].filter(v => !v.closest('label').hidden) : [x];
        boxes.forEach(v => { x.checked ? hide.delete(v.dataset.v) : hide.add(v.dataset.v) });
        f.by[i] = { hide }; lfChanged(f);
      }
    });
    lfPop.addEventListener('input', e => {
      const x = e.target;
      if (x.matches('.ui-lf-q')) { const q = x.value.trim().toLowerCase(); lfPop.querySelectorAll('.ui-lf-vals .ui-lf-v').forEach(l => l.hidden = !!q && !l.textContent.toLowerCase().includes(q)); lfSync(f) }
      if (x.matches('[data-r]')) {
        clearTimeout(t); t = setTimeout(() => {
          const g = k => { const v = lfPop && lfPop.querySelector(`[data-r=${k}]`).value; return v === '' || v == null || !isFinite(+v) ? null : +v };
          f.by[i] = { min: g('min'), max: g('max') }; lfChanged(f);
        }, 250);
      }
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.ui-lf'); if (b) return lfOpen(b);
    const c = e.target.closest('[data-lf-clear]');
    if (c) { const f = FILT.get(c.dataset.lfClear); if (f) { f.by = {}; f.s = null; lfClose(); f.onChange && f.onChange() } return }
    if (lfPop && !lfPop.contains(e.target)) lfClose();
  });
  document.addEventListener('keydown', e => { if (lfPop && e.key === 'Escape') { e.stopPropagation(); lfClose(true) } }, true);
  addEventListener('resize', () => lfPlace());
  addEventListener('scroll', () => lfPlace(), true);

  // first paint: cards rise into place once (ui.css, html.g-boot); later redraws don't replay it
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { document.documentElement.classList.add('g-boot'); setTimeout(() => document.documentElement.classList.remove('g-boot'), 1400) }

  window.UI = { hero, filter, timeline, animate, keepFocus, esc, status, meter, week, button, card, segmented, rating, choiceList, stepper, emptyState, skeleton, toast, mount, version: '1.0.0' };
})();
