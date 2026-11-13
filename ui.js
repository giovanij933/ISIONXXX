/* ISIONXXX // ui — shared, accessible UI components for the ISIONXXX apps.

   How it works
   - Every component is a function: props in, an HTML string out. Text is always escaped, so props can carry user
     data safely. Components hold no state: the app keeps it and renders again.
   - UI.mount(root) is called once per page. It handles clicks and keys for every component under root through
     delegation (so it survives innerHTML re-renders), keeps ARIA state in step, and fires one event:
       root.addEventListener('ui-change', e => { e.detail.name, e.detail.value })
   - Styles live in ui.css; tokens are --ui-* custom properties so an app can retheme without touching the file.

   Components: card, meter, week, status, segmented, rating, choiceList, stepper, button, emptyState, skeleton,
   plus UI.toast(message) for announcements, and UI.confirm / UI.ask / UI.undo in place of the browser's confirm() and
   prompt(). See ui.html for every component, its props and its states.
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
  // a toast shows above an open sheet too: a <dialog> sits in the page's top layer, above any z-index, so the toast is a
  // popover, shown (again) last to be on top of it; it leaves the top layer once it has faded
  const pop = el => { if (!el.showPopover) return; try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover() } catch (e) {} };
  function toast(msg, { tone } = {}) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ui-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); toastEl.setAttribute('popover', 'manual'); document.body.appendChild(toastEl) }
    toastEl.textContent = msg; pop(toastEl); toastEl.className = 'ui-toast ui-on' + (tone ? ' ui-' + tone : '');
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.classList.remove('ui-on'); toastT = setTimeout(() => { try { toastEl.hidePopover?.() } catch (e) {} }, 300) }, 3000);
  }

  /* ---------- confirm, ask, undo: the app's own versions of confirm(), prompt() and "are you sure?" ----------
     The browser's dialogs are grey system alerts titled with the site's address, on an iPhone home-screen app too.
       UI.confirm({ title, body, ok = 'OK', cancel = 'Cancel', danger }) → Promise<boolean>
       UI.ask({ title, body, value, placeholder, ok, cancel }) → Promise<string | null>   (null when cancelled)
       UI.undo(message, undoFn, { ms = 6000 })   a toast with an Undo button (⌘Z / Ctrl+Z too) while it shows
     A single delete should happen at once and offer UI.undo; UI.confirm is for what can't be taken back (delete
     everything, replace from a backup, discard a session in progress). The sheet is a <dialog>, so it gets the
     apps' glass, rises as a sheet on phones, closes on Escape, a tap outside or a swipe down, and gives focus back. */
  function sheet({ title, body, ok, cancel, danger, input }) {
    return new Promise(resolve => {
      const back = document.activeElement, d = document.createElement('dialog'), id = uid('cf'), no = input ? null : false;
      d.className = 'ui-cf'; d.setAttribute('aria-labelledby', id + 't'); if (body) d.setAttribute('aria-describedby', id + 'b');
      d.innerHTML = `<form><h3 id="${id}t" class="ui-cf-t">${esc(title)}</h3>${body ? `<p id="${id}b" class="ui-cf-b">${esc(body)}</p>` : ''}${input
        ? `<input class="ui-cf-in" type="text" autocomplete="off" aria-labelledby="${id}t" value="${esc(input.value ?? '')}" placeholder="${esc(input.placeholder || '')}">` : ''}
        <div class="ui-cf-a"><button type="button" class="ui-btn ui-secondary" data-cf="no">${esc(cancel)}</button><button type="submit" class="ui-btn ${danger ? 'ui-danger-fill' : 'ui-primary'}" data-cf="yes">${esc(ok)}</button></div></form>`;
      const inp = d.querySelector('input');
      let done = false;
      const finish = v => {
        if (done) return; done = true; if (d.open) d.close(); setTimeout(() => d.remove(), 400);
        try { if (back && back.isConnected) back.focus({ preventScroll: true }) } catch (e) {}
        resolve(v);
      };
      d.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish(input ? inp.value.trim() : true) });
      d.querySelector('[data-cf=no]').addEventListener('click', () => finish(no));
      d.addEventListener('close', () => finish(no));   // Escape, a swipe down, or closed by the page
      d.addEventListener('click', e => {               // a tap on the backdrop, outside the sheet
        if (e.target !== d) return; const r = d.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) finish(no);
      });
      document.body.appendChild(d); d.showModal();
      // the safe choice has focus: Cancel when it destroys something, the field when asking
      (inp || (danger ? d.querySelector('[data-cf=no]') : d.querySelector('[data-cf=yes]'))).focus();
      if (inp) inp.select();
    });
  }
  const confirmSheet = ({ title, body, ok = 'OK', cancel = 'Cancel', danger = false } = {}) => sheet({ title, body, ok, cancel, danger });
  const ask = ({ title, body, value = '', placeholder = '', ok = 'OK', cancel = 'Cancel' } = {}) => sheet({ title, body, ok, cancel, input: { value, placeholder } });
  let undoEl, undoT, undoFn;
  function undoHide() { clearTimeout(undoT); undoFn = null; if (undoEl) undoEl.classList.remove('ui-on') }
  function undo(msg, fn, { ms = 6000 } = {}) {
    if (!undoEl) {
      undoEl = document.createElement('div'); undoEl.className = 'ui-toast ui-undo'; undoEl.setAttribute('role', 'status');
      undoEl.innerHTML = '<span></span><button type="button" class="ui-undo-b">Undo</button>'; document.body.appendChild(undoEl);
      undoEl.lastChild.addEventListener('click', () => { const f = undoFn; undoHide(); if (f) f() });
      document.addEventListener('keydown', e => {
        if (!undoFn || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || e.target.closest('input,textarea,select,[contenteditable]')) return;
        e.preventDefault(); const f = undoFn; undoHide(); f();
      });
    }
    if (!undoEl.isConnected) document.body.appendChild(undoEl);
    clearTimeout(undoT); undoFn = fn; undoEl.firstChild.textContent = msg;
    requestAnimationFrame(() => undoEl.classList.add('ui-on')); undoT = setTimeout(undoHide, ms);
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
  // "a · b · c" wraps between its parts: a line may end with a dot but never starts with one
  const dots = t => String(t).split(' · ').map(p => p.length <= 14 ? p.replace(/ /g, '\u00A0') : p).join('\u00A0· ');   // and a short part ("15 min") stays in one piece
  const tlRows = items => items.filter(x => x && isFinite(x.at)).sort((a, b) => a.at - b.at)
    .map(x => `<li${x.tone ? ` class="ui-${esc(x.tone)}"` : ''}><time>${TFMT.format(x.at)}</time><i aria-hidden="true"></i><span>${x.tag ? `<b>${esc(x.tag)}</b> ` : ''}${dots(esc(x.text))}</span></li>`).join('');
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
      ${stats.length ? `<div class="ui-stats-c"><div class="ui-stats">${stats.map(st => { const tag = st.attrs ? 'button' : 'div';
        return `<${tag} class="ui-stat${st.on ? ' ui-on' : ''}"${st.attrs ? ` type="button" ${attr(st.attrs)}${st.on != null ? ` aria-pressed="${!!st.on}"` : ''}` : ''}><span class="ui-stat-l">${esc(st.label)}</span><b${st.tone === 'pos' || st.tone === 'neg' ? ` class="ui-${st.tone}"` : ''}>${esc(st.value)}</b>${st.sub ? `<small>${esc(st.sub)}</small>` : ''}</${tag}>` }).join('')}</div></div>` : ''}
      ${action ? `<div class="ui-actions">${button({ variant: 'primary', ...action })}</div>` : ''}
      ${(() => {
        // today's entries, in a side panel on wide screens (header + count, or a placeholder until there are some)
        const n = log.filter(x => x && isFinite(x.at)).length, rows = tlRows(log), when = esc(String(title).toLowerCase()), hid = 'ui-hl-' + String(key).replace(/[^\w-]/g, '_');   // from the key, not a running count: the same data gives the same HTML, so UI.paint can tell nothing changed
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
    // the number gets its own layer while it counts (ui.css .ui-counting), so each frame repaints the number, not the page
    node.classList.add('ui-counting');
    const step = now => { const k = Math.min(1, Math.max(0, (now - t0) / D)), e = 1 - Math.pow(1 - k, 3); node.textContent = to.replace(re, fmt(start + (end - start) * e)); if (k < 1 && node.isConnected) requestAnimationFrame(step); else { node.textContent = to; node.classList.remove('ui-counting') } };
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
    // charts draw themselves in when they first appear or their data changes: lines trace, bars grow, areas fade.
    // While it draws, the chart is its own layer (ui.css svg.ui-draw), so each frame repaints the chart, not the page;
    // the class comes off once the last bar has grown. Shapes you can't see (the apps' transparent tap areas) don't fade
    // Reads first, then writes: reading a style or a size right after a change forces the browser to recompute the page,
    // and doing that per chart and per shape cost 100-240 ms (CPU 4x slower) of every app's first draw.
    const draw = [], vh = innerHeight, seen = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh };
    const chart = (c, k, show) => {
      const h = c.innerHTML, sig = h.length + ':' + h.slice(0, 160);
      if (MEM.chart.get(k) === sig) return; MEM.chart.set(k, sig); if (calm || !show) return;
      const lines = [...c.querySelectorAll('polyline, path')].filter(l => l.tagName.toLowerCase() === 'polyline' || l.getAttribute('fill') === 'none');
      // the apps' transparent tap areas (.hit) have nothing to fade; checked by class, since reading each shape's
      // computed fill cost up to 120 ms on charts with hundreds of them
      const shapes = [...c.querySelectorAll('polygon, path')].filter(l => !lines.includes(l) && !l.classList.contains('hit') && !/^(none|transparent)$/.test(l.getAttribute('fill') || ''));
      draw.push({ c, lines, shapes, bars: c.querySelectorAll('rect') });
    };
    const st = PAINT.get(root);
    // a page drawn by UI.paint: only the cards it has just replaced can have changed, and only the ones on screen draw
    // in. A chart drawing in is repainted every frame, and most of a page's charts are below the screen
    if (st) st.slots.forEach((s, i) => {
      const f = s.fresh; if (!f) return; s.fresh = 0;
      const cs = chartsIn(s.el); if (!cs.length) return;
      const show = f === 1 || (f === 2 && seen(s.el));
      cs.forEach((c, j) => chart(c, chartKey(root, i, j), show));
    });
    else root.querySelectorAll('svg.chart').forEach((c, i) => chart(c, (root.id || 'r') + i, true));
    const again = draw.filter(d => d.c.classList.contains('ui-draw'));
    again.forEach(d => d.c.classList.remove('ui-draw')); if (again.length) void root.offsetWidth;   // restart a chart already drawing in
    draw.forEach(({ c, lines, shapes, bars }) => {
      lines.forEach(l => l.classList.add('ui-trace')); shapes.forEach(l => l.classList.add('ui-fadein'));
      bars.forEach((r, j) => { r.classList.add('ui-grow'); r.style.animationDelay = Math.min(j * 18, 400) + 'ms' });
      c.classList.add('ui-draw'); clearTimeout(c.__drawn); c.__drawn = setTimeout(() => c.classList.remove('ui-draw'), 1500);
    });
    // a number counts up only where you can see it
    root.querySelectorAll('[data-count]').forEach(n => { const k = n.dataset.count, now = n.textContent, was = MEM.count.get(k); MEM.count.set(k, now); if (!calm && was !== now && seen(n)) countUp(n, was ?? null, now) });
    if (fresh.length && onDone) onDone(fresh);
    return fresh;
  }

  /* ---------- paint: redraw a page without redoing what didn't change ----------
     UI.paint(root, html) leaves root as root.innerHTML = html would, but does less to get there. An app draws its whole
     page from its data on every tap; most of that page is off screen, and much of it comes out the same.
     - A card whose HTML is what it was last time is left alone.
     - A card that changed and is on screen, or within half a screen below it, is replaced at once.
     - A card that changed farther away is replaced between the next frames, nearest first, so the tap is answered as
       soon as what you're looking at is ready. Scrolling towards one replaces it at once, and one above the screen
       that comes out a different height doesn't move what you're looking at.
     A card is a child of root, or a child of one of root's rows (section, .g, .grid). When the rows themselves differ
     from last time, or something else has changed root's children, the whole page is replaced, as innerHTML would.
     { now: true } replaces everything that changed at once: for a small area, or one with rings (UI.animate fills
     them and reports the ones that turned done). UI.paint.flush() finishes what is pending; so do printing and Tab.
     UI.animate(root), called afterwards as before, moves only what was just replaced on screen.               */
  const PAINT = new WeakMap(), LATER = new Set();   // root → its cards; the roots with cards still to replace
  const ROW = 'section,.g,.grid';
  const looseText = n => { for (const k of n.childNodes) if (k.nodeType === 3 && k.data.trim()) return true; return false };
  function cardsOf(parent) {
    if (looseText(parent)) return null;
    const list = [], shape = [];
    for (const n of parent.children) {
      if (n.matches(ROW) && n.childElementCount && !looseText(n)) { shape.push(n.cloneNode(false).outerHTML + n.childElementCount); list.push(...n.children) }
      else { shape.push('1'); list.push(n) }
    }
    return { list, shape: shape.join('|') };
  }
  const chartsIn = el => el.matches('svg.chart') ? [el] : el.querySelectorAll('svg.chart');
  const chartKey = (root, i, j) => (root.id || 'r') + '/' + i + '/' + j;
  function paint(root, html, { now = false } = {}) {
    let st = PAINT.get(root);
    const sound = !!st && st.n === root.childElementCount && st.slots.every(s => root.contains(s.el));
    if (sound && st.html === html) return;
    const t = document.createElement('template'); t.innerHTML = html;
    const nu = cardsOf(t.content);
    if (!sound || !nu || nu.shape !== st.shape || nu.list.length !== st.slots.length) {
      root.replaceChildren(t.content); LATER.delete(root);
      if (nu) PAINT.set(root, { html, shape: nu.shape, n: root.childElementCount, slots: nu.list.map(el => ({ el, src: el.outerHTML, next: null, fresh: 2 })) });
      else PAINT.delete(root);
      return;
    }
    // not drawn at all (the tab is in the background, or the app's frame inside TODAY is hidden): nothing to be quick
    // for and no frames to wait between, so everything is replaced now and nothing moves
    const hid = document.hidden || !root.getClientRects().length, vh = innerHeight, M = vh / 2, todo = [];
    // reads first (where each changed card is), then the writes
    nu.list.forEach((el, i) => {
      const s = st.slots[i], src = el.outerHTML;
      if (src === s.src) { s.next = null; return }
      todo.push([s, el, src, hid || now ? null : s.el.getBoundingClientRect()]);
    });
    for (const [s, el, src, r] of todo) {
      if (!r) put(s, el, src, hid ? 3 : 2);
      // on screen, or within half a screen below it. A card wholly above the screen waits like the far ones: it can't
      // be seen, and put in later it is put in with the page held still (putLater)
      else if (r.bottom > 0 && r.top < vh + M && (r.width || r.height)) put(s, el, src, r.top < vh ? 1 : 3);
      else s.next = { el, src };
    }
    st.html = html;
    if (st.slots.some(s => s.next)) { LATER.add(root); paintSoon() }
  }
  // fresh: 1 = replaced on screen (UI.animate draws its charts in), 2 = replaced, whether on screen not yet known
  // (UI.animate looks), 3 = replaced off screen (nothing moves), 0 = seen to
  function put(s, el, src, fresh) { s.el.replaceWith(el); s.el = el; s.src = src; s.next = null; s.fresh = fresh }
  // a card replaced later, off screen: it is simply there. What UI.animate remembers is brought up to date, so the
  // next change to it animates from here
  function putLater(root, st, s, r) {
    const { el, src } = s.next, i = st.slots.indexOf(s);
    // above the screen: if it comes out a different height, everything you're looking at would move with it. Chrome
    // holds the page still by itself (scroll anchoring, applied as soon as the layout is read); Safari doesn't
    const above = r && r.bottom <= 0 && (r.width || r.height) && scrollY > 0, h0 = above ? root.getBoundingClientRect().bottom : 0;
    put(s, el, src, 0);
    if (above) { const d = root.getBoundingClientRect().bottom - h0; if (Math.abs(d) >= .5) scrollBy({ top: d, behavior: 'instant' }) }
    chartsIn(el).forEach((c, j) => { const h = c.innerHTML; MEM.chart.set(chartKey(root, i, j), h.length + ':' + h.slice(0, 160)) });
    el.querySelectorAll('[data-count]').forEach(n => MEM.count.set(n.dataset.count, n.textContent));
    el.querySelectorAll('[data-ring]').forEach(li => { const rf = li.querySelector('.ui-rf'); if (!rf) return; rf.setAttribute('stroke-dasharray', `${rf.dataset.to} 100`); MEM.ring.set(li.dataset.ring, rf.dataset.to); MEM.done.set(li.dataset.ring, li.dataset.done === '1') });
  }
  // the cards still to replace, nearest to the screen first. all: every one of them; near: only those within half a
  // screen (you are scrolling towards them); otherwise about one large card's worth, then the next frame gets its turn
  function paintMore(mode) {
    const vh = innerHeight, M = vh / 2;
    for (const root of [...LATER]) {
      const st = PAINT.get(root), pend = st && root.isConnected ? st.slots.filter(s => s.next) : [];
      if (!pend.length) { LATER.delete(root); continue }
      const at = pend.map(s => { const r = s.el.getBoundingClientRect(); return { s, r, d: r.bottom < 0 ? -r.bottom : Math.max(0, r.top - vh) } }).sort((a, b) => a.d - b.d);
      let n = 0;
      for (const { s, r, d } of at) {
        if (mode === 'near' && d > M) break;
        n += s.next.src.length; putLater(root, st, s, r);
        if (!mode && n > 9000) break;
      }
      if (!st.slots.some(s => s.next)) LATER.delete(root); else if (!mode) break;
    }
    if (LATER.size) paintSoon();
  }
  let paintT = 0;
  // after the next frame has been drawn: a task queued from inside the frame runs once that frame is on screen
  const paintSoon = () => { if (!paintT) paintT = requestAnimationFrame(() => setTimeout(() => { paintT = 0; paintMore() }, 0)) };
  paint.flush = () => { if (LATER.size) paintMore('all') };
  addEventListener('scroll', () => { if (LATER.size) paintMore('near') }, { capture: true, passive: true });
  addEventListener('beforeprint', paint.flush);
  document.addEventListener('keydown', e => { if (e.key === 'Tab') paint.flush() }, true);

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
          if (!was && now && m.__box && m.__rect) { ghost(m.__box, m.__rect, { sheet: m.__sheet, cls: m.__sheet ? 'ss' : '', dy: m.__dy || 0 }); m.__rect = null; m.__dy = 0 }
          else if (was && !now) { m.__dirty = false; requestAnimationFrame(() => keep(m)) }
        }
      }).observe(m, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, childList: true });
    });
    addEventListener('resize', () => document.querySelectorAll('.modal:not(.hidden)').forEach(keep), { passive: true });
    // swipe down to dismiss: every <dialog>, and the .modal > .box sheets NUTRITION and LEARN draw (those close through
    // the Escape key both apps already handle), the session sheets (.ss) too. A swipe does what Escape does: a session
    // that's running (or waiting to be saved) refuses it, so its sheet springs back and says why. In a form with
    // something typed, a swipe asks before throwing it away (a session sheet's fields are its sets, saved as you go)
    let drag = null;
    document.addEventListener('input', e => { const d = e.target.closest && e.target.closest('dialog,.modal'); if (d) d.__dirty = true }, true);
    document.addEventListener('touchstart', e => {
      const t = e.target.closest ? e.target : null; if (!t || e.touches.length > 1) return;
      const dlg = t.closest('dialog[open]'), box = dlg ? null : t.closest('.modal:not(.hidden)>.box'), d = dlg || box;
      if (!d || d.scrollTop > 0) return;
      if (t.closest('input,textarea,select,[contenteditable],.tw,pre')) return;
      const dirty = !d.classList.contains('ss') && !!(box ? box.parentElement.__dirty : d.__dirty);
      drag = { d, box, dirty, y0: e.touches[0].clientY, t0: Date.now(), dy: 0 };
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!drag) return; const dy = e.touches[0].clientY - drag.y0;
      if (dy < 0 || drag.d.scrollTop > 0) { drag.d.style.transform = ''; return }
      drag.dy = dy; drag.d.style.transition = 'none'; drag.d.style.transform = `translateY(${dy * .85}px)`;
    }, { passive: true });
    const back = d => { d.style.transition = 'transform .25s cubic-bezier(.2,.8,.2,1)'; d.style.transform = ''; setTimeout(() => { d.style.transition = '' }, 260) };
    // close as Escape would; false when the app keeps it open
    const dismiss = (d, box, dy) => {
      if (box) {
        const m = box.parentElement; m.__dy = dy;
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));   // from the sheet: apps read e.target
        if (m.classList.contains('hidden')) { box.style.transition = ''; box.style.transform = ''; return true }
        m.__dy = 0; return false;
      }
      d.__dy = dy;
      // refused: it stays open, unless the app closed it itself (a running session goes down to the bar, UI.runBar)
      if (!d.dispatchEvent(new Event('cancel', { cancelable: true }))) { if (d.open) { d.__dy = 0; return false } return true }
      d.close(); return true;
    };
    document.addEventListener('touchend', () => {
      if (!drag) return; const { d, box, dy, t0, dirty } = drag; drag = null;
      const fast = dy > 60 && dy / (Date.now() - t0) > .6;
      if (!(dy > 140 || fast)) return back(d);
      if (dirty) {
        back(d);
        confirmSheet({ title: 'Discard your changes?', body: "What you typed here hasn't been saved.", ok: 'Discard', cancel: 'Keep editing', danger: true })
          .then(yes => { if (yes && !dismiss(d, box, 0)) toast('Finish or discard this first') });
        return;
      }
      if (dismiss(d, box, dy * .85)) return;
      back(d); toast('Finish or discard this first');
    });
    // a fresh open starts clean
    const show = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { this.__dirty = false; this.style.transform = ''; return show.call(this) };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installFluid); else installFluid();
  // no half-built first frame: the page stays hidden (ui.css) until it has parsed and the app's own script, which runs
  // before DOMContentLoaded, has drawn it. Otherwise a slow load paints the header and an empty page, then everything
  // jumps when the content lands (in NUTRITION that moved the whole page)
  // With db.js the app's script can start a moment after parsing (it waits for the database): show the page once it has
  const ready = () => (window.ISXDB?.started || Promise.resolve()).then(() => document.documentElement.classList.add('ui-ready'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

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

  // header ··· menu: buttons marked data-more move into a glass menu so the bar fits on a phone.
  // Apps that redraw their buttons get the menu rebuilt, and their own click handlers still see the moved buttons.
  function moreMenu(acts) {
    const items = acts.querySelectorAll(':scope>[data-more]'); if (!items.length) return;
    let wrap = acts.querySelector(':scope>.ui-more');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.className = 'ui-more';
      wrap.innerHTML = '<button type="button" class="ui-more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="More"><span class="ui-more-h"></span><span class="ui-more-v"></span></button><div class="ui-more-pop" role="menu" hidden></div>';
    }
    // the ··· button wears the same classes as the app's own plain buttons
    const ref = acts.querySelector(':scope>button:not(.pri):not(.go):not([data-more])');
    if (ref) wrap.firstChild.className = 'ui-more-btn ' + [...ref.classList].join(' ');
    const pop = wrap.lastChild; items.forEach(b => { b.setAttribute('role', 'menuitem'); pop.append(b) });
    // phones keep only the main button in the bar (ui.css), so the menu starts with copies of the everyday ones
    pop.querySelectorAll('.ui-more-m,.ui-more-sep').forEach(e => e.remove());
    const daily = [...acts.querySelectorAll(':scope>button:not(.pri):not(.go)')];
    if (daily.length) pop.prepend(...daily.map(b => {
      const m = document.createElement('button'); m.type = 'button'; m.className = 'ui-more-m'; m.setAttribute('role', 'menuitem');
      m.textContent = b.textContent; m.onclick = () => b.click(); return m;
    }), Object.assign(document.createElement('hr'), { className: 'ui-more-sep' }));
    acts.append(wrap);
  }
  // the header reads "ISIONXXX JOURNAL": the ISIONXXX name shows as its mark (ui.css), and screen readers still hear
  // it. The name links to the personal homepage, which sits beside the apps the way GitHub Pages serves them
  // (/ISIONXXX/personal/). Inside the TODAY shell the whole window goes there, not the app's frame.
  const brandInit = () => document.querySelectorAll('header.top:not(.th) .brand').forEach(h => {
    const t = h.firstChild;
    if (t?.nodeType === 3 && /^\s*ISIONXXX\s/.test(t.textContent)) {
      const s = document.createElement('span'); s.className = 'ui-brand-pre';
      const m = document.createElement('span'); m.className = 'ui-brand-mark'; m.setAttribute('role', 'img'); m.setAttribute('aria-label', 'ISIONXXX');
      s.append(m); h.insertBefore(s, t); t.textContent = t.textContent.replace(/^\s*ISIONXXX\s+/, '');
    }
    if (h.querySelector('.ui-brand-a')) return;
    const a = document.createElement('a'); a.className = 'ui-brand-a'; a.href = '../ISIONXXX/personal/'; a.target = '_top';
    a.title = 'ISIONXXX homepage'; a.append(...h.childNodes); h.append(a);
  });
  const shown = pop => [...pop.querySelectorAll('button')].filter(b => b.offsetParent);
  const moreSet = (btn, on, focus) => {
    btn.setAttribute('aria-expanded', on); btn.nextSibling.hidden = !on;
    if (on && focus) shown(btn.nextSibling)[0]?.focus();
  };
  const moreOpen = () => document.querySelector('.ui-more-btn[aria-expanded=true]');
  document.addEventListener('click', e => {
    const btn = e.target.closest('.ui-more-btn'), open = moreOpen();
    // a picked item hands focus back to ···: a dialog it opens returns focus there on close, not to the hidden item
    if (open && open !== btn) { moreSet(open, false); if (open.parentNode.contains(e.target)) open.focus() }
    if (btn) moreSet(btn, btn.getAttribute('aria-expanded') !== 'true', e.detail === 0);
  });
  document.addEventListener('keydown', e => {
    const open = moreOpen(); if (!open) return;
    if (e.key === 'Escape') { moreSet(open, false); open.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const its = shown(open.nextSibling), i = its.indexOf(document.activeElement);
    its[(i + (e.key === 'ArrowDown' ? 1 : its.length - 1)) % its.length]?.focus(); e.preventDefault();
  });
  // phones: the page softens and fades as it slides under the floating header (.ui-edge in ui.css), as in iOS 26's own apps
  const edgeInit = () => { if (document.querySelector('header.top:not(.th)') && !document.querySelector('.ui-edge')) { const e = document.createElement('div'); e.className = 'ui-edge'; e.setAttribute('aria-hidden', 'true'); document.body.prepend(e) } };
  const moreInit = () => edgeInit() || brandInit() || document.querySelectorAll('header.top .acts').forEach(a => { moreMenu(a); new MutationObserver(() => moreMenu(a)).observe(a, { childList: true }) });
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', moreInit) : moreInit();

  // on desktop, dropdowns open as a glass list like the ··· menu instead of the browser's own; phones and tablets keep
  // their native picker. The select stays the real control: picking sets its value and fires input + change, so every
  // app's handlers work unchanged. data-native opts out.
  let selPop = null, selFor = null;
  const selDesk = matchMedia('(hover: hover) and (pointer: fine)');
  const selOk = s => selDesk.matches && s && s.tagName === 'SELECT' && !s.multiple && !(s.size > 1) && !s.disabled && !('native' in s.dataset);
  const selClose = (refocus) => {
    if (!selPop) return; const s = selFor;
    try { selPop.hidePopover?.() } catch (e) {} selPop.remove(); selPop = selFor = null;
    if (refocus && s) s.focus({ preventScroll: true });
  };
  const selPick = (s, i) => {
    if (s.selectedIndex !== i) { s.selectedIndex = i; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })) }
    selClose(true);
  };
  function selOpen(s) {
    selClose(); selFor = s;
    const pop = selPop = document.createElement('div'); pop.className = 'ui-sel-pop'; pop.setAttribute('role', 'listbox');
    if (s.getAttribute('aria-label')) pop.setAttribute('aria-label', s.getAttribute('aria-label'));
    [...s.children].forEach(n => {
      const add = (o, nested) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ui-sel-opt' + (nested ? ' ui-sel-in' : '');
        b.setAttribute('role', 'option'); b.setAttribute('aria-selected', o.selected); b.textContent = o.textContent; b.disabled = o.disabled;
        b.onclick = () => selPick(s, o.index); pop.append(b);
      };
      if (n.tagName === 'OPTGROUP') { const h = document.createElement('div'); h.className = 'ui-sel-grp'; h.textContent = n.label; pop.append(h); [...n.children].forEach(o => add(o, true)) }
      else if (n.tagName === 'OPTION' && !n.hidden) add(n);
    });
    if ('popover' in HTMLElement.prototype) pop.popover = 'manual';   // top layer, so it also opens above dialogs
    // inside an open dialog the list must live in the dialog: everything outside a modal dialog is inert
    (s.closest('dialog[open]') || document.body).append(pop); try { pop.showPopover?.() } catch (e) {}
    const r = s.getBoundingClientRect(), vh = innerHeight, gap = 6;
    pop.style.minWidth = r.width + 'px';
    const below = vh - r.bottom - gap - 8, above = r.top - gap - 8, up = below < 220 && above > below;
    pop.style.maxHeight = Math.max(120, Math.min(360, up ? above : below)) + 'px';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    pop.style.top = (up ? r.top - gap - h : r.bottom + gap) + 'px';
    const cur = pop.querySelector('[aria-selected=true]') || pop.querySelector('.ui-sel-opt:not(:disabled)');
    cur?.scrollIntoView({ block: 'nearest' }); cur?.focus({ preventScroll: true });
  }
  const selTap = e => {
    const s = e.target.closest?.('select'); if (!selOk(s)) return;
    if (e.button !== 0) return;
    e.preventDefault(); s.focus({ preventScroll: true });
    selFor === s ? selClose(true) : selOpen(s);
  };
  document.addEventListener('mousedown', selTap, true);
  document.addEventListener('mousedown', e => { if (selPop && !selPop.contains(e.target) && e.target !== selFor) selClose() }, true);
  document.addEventListener('keydown', e => {
    const s = e.target;
    if (!selPop) { if (selOk(s) && (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); selOpen(s) } return }
    if (!selPop.contains(document.activeElement)) return;
    const its = [...selPop.querySelectorAll('.ui-sel-opt:not(:disabled)')], i = its.indexOf(document.activeElement);
    const go = j => { e.preventDefault(); its[Math.max(0, Math.min(its.length - 1, j))]?.focus() };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(its.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); selClose(true) }
    else if (e.key === 'Tab') selClose(true);
    else if (e.key.length === 1 && /\S/.test(e.key)) {   // type a letter to jump to the next option starting with it
      const k = e.key.toLowerCase(), n = its.length, j = [...Array(n)].map((_, d) => (i + 1 + d) % n).find(x => its[x].textContent.trim().toLowerCase().startsWith(k));
      if (j != null) go(j);
    }
  }, true);
  addEventListener('resize', () => selClose());
  addEventListener('scroll', e => { if (selPop && !selPop.contains(e.target)) selClose() }, true);

  // no page zoom: the apps stay fixed like a native app. iOS ignores user-scalable=no, so pinches are stopped here too
  ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault() }, { passive: false });

  /* ---------- plans: what each app would start next, for TODAY's plan card ----------
     An app registers a builder once its data is loaded: UI.planner(app, srcKeys, build). build() returns the rows to
     show, [{title, sub, act, h0, h1}]: act is the app action that starts it (the same names TODAY's {isx:'do'} uses),
     h0/h1 an optional local-hour window for plans that change with the time of day. The result is saved as
     isx.plan.<app> (never synced) with a signature of the data it came from and the day, so TODAY can see a plan is
     out of date (UI.planOf(app).fresh) and ask the app to rebuild it with postMessage {isx:'replan'}. Apps call
     UI.replan() after they save; it rebuilds once the current task is done. */
  const planDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  const planSig = src => src.map(k => { try { return (localStorage.getItem(k) || '').length } catch (e) { return 0 } }).join(':') + '|' + planDay();
  let planReg = null, planT = 0;
  function planNow() {
    clearTimeout(planT); planT = 0; if (!planReg) return;
    const { app, src, build } = planReg;
    try { const items = (build() || []).filter(Boolean); localStorage.setItem('isx.plan.' + app, JSON.stringify({ v: 1, app, sig: planSig(src), src, at: Date.now(), items })) }
    catch (e) { console.warn('UI.planner(' + app + ')', e) }
  }
  const replan = () => { if (planReg && !planT) planT = setTimeout(planNow, 0) };
  function planner(app, src, build) { planReg = { app, src, build }; planNow() }
  function planOf(app) {
    try { const p = JSON.parse(localStorage.getItem('isx.plan.' + app)); return p && p.v === 1 ? Object.assign(p, { fresh: p.sig === planSig(p.src || []) }) : null } catch (e) { return null }
  }
  addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.isx === 'replan') planNow() });
  addEventListener('isx-sync', replan);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) replan() });

  // the installed app's launch screen. Without one, iOS opens a home-screen web app on a white screen, a flash in dark
  // mode. iOS takes the launch image when the page is added to the home screen from Safari, and keeps it; it only uses
  // an image of the screen's exact size. So it is drawn here, on the phone, at that size, in the page's own background:
  // the launch screen is the app's first frame (the page fades in over it), and plain, as Apple's guidelines ask. It is
  // light or dark as the phone was when the app was added: iOS doesn't switch it later.
  let launchT = 0, launchN = 0;
  function launchImage() {
    // Safari on an iPhone or iPad only: not the installed app, a frame inside TODAY, or a Mac
    if (navigator.standalone !== false || window.top !== window || !(navigator.maxTouchPoints > 0)) return;
    const n = ++launchN, seen = c => c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$|\/\s*0\)$/.test(c);
    const bg = [document.body, document.documentElement].map(e => e && getComputedStyle(e).backgroundColor).find(seen);
    const cv = document.createElement('canvas'), cx = cv.getContext('2d'), r = devicePixelRatio || 1;
    if (!bg || !cx || !cv.toBlob) return;
    const w = Math.min(screen.width, screen.height), h = Math.max(screen.width, screen.height);
    const draw = (o, x, y) => new Promise(done => {
      cv.width = Math.round(x * r); cv.height = Math.round(y * r);
      cx.fillStyle = bg; cx.fillRect(0, 0, cv.width, cv.height);
      cv.toBlob(b => { if (!b) return done(null); const f = new FileReader(); f.onload = () => done([o, f.result]); f.onerror = () => done(null); f.readAsDataURL(b) }, 'image/png');
    });
    draw('portrait', w, h).then(p => draw('landscape', h, w).then(l => {
      cv.width = cv.height = 0;
      if (!p || !l || n !== launchN) return;  // a newer one (the phone switched light/dark meanwhile) replaces this
      document.querySelectorAll('link[data-ui-launch]').forEach(x => x.remove());
      for (const [o, src] of [p, l]) {
        const x = document.createElement('link');
        x.rel = 'apple-touch-startup-image'; x.media = `screen and (orientation: ${o})`; x.href = src; x.dataset.uiLaunch = '';
        document.head.append(x);
      }
    }));
  }
  // after the page has settled, and again if the phone switches between light and dark before the app is added
  const launchSoon = ms => { clearTimeout(launchT); launchT = setTimeout(launchImage, ms) };
  document.readyState === 'complete' ? launchSoon(800) : addEventListener('load', () => launchSoon(800));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => launchSoon(100));

  /* ---------- the session bar: a running session, put away ----------
     UI.runBar({label, text, open}) shows a bar at the bottom: a pulsing dot, the label (the session), text() (its clock,
     read every second) and an arrow up. A tap brings the session back: the bar goes and open() runs. UI.runBar(null)
     takes it away. One at a time. Apps show it when a swipe down (or Escape) on a running session's sheet puts it away
     (ARCHITECTURE.md, 2j); the session keeps running underneath. */
  let runEl = null, runT = 0;
  function runBar(o) {
    clearInterval(runT); runT = 0;
    if (!o) { if (runEl) { runEl.remove(); runEl = null; document.documentElement.classList.remove('ui-has-run') } return }
    if (!runEl) {
      runEl = document.createElement('button'); runEl.type = 'button'; runEl.className = 'ui-run';
      runEl.innerHTML = '<i aria-hidden="true"></i><b></b><span></span><em aria-hidden="true"></em>';
      document.body.appendChild(runEl); document.documentElement.classList.add('ui-has-run');
    }
    const b = runEl.querySelector('b'), t = runEl.querySelector('span');
    const paint = () => { let x = ''; try { x = String(o.text?.() ?? '') } catch (e) { } b.textContent = o.label || ''; t.textContent = x; runEl.setAttribute('aria-label', `${o.label}${x ? ', ' + x : ''}: back to the session`) };
    paint(); runT = setInterval(paint, 1000);
    runEl.onclick = () => { const f = o.open; runBar(null); try { f && f() } catch (e) { console.warn('UI.runBar', e) } };
  }

  /* ---------- updates: a new version takes over on the first reopen ----------
     Each app's service worker installs a new version as soon as the browser sees it and takes over the open page
     (skipWaiting, clients.claim), but the page keeps running the version it loaded, so an update used to take two
     launches. When the new version takes over (controllerchange), the page reloads into it if nothing would be lost:
     no sheet open, no field in use, no session on the bar, here or in a frame inside it (TODAY's apps), and within 30 s
     of the page being shown, so it never reloads under you mid-task. Otherwise a pill offers it ("Updated · tap to
     reload"), and the next time the app comes back it reloads by itself if it can. Coming back to the app (iOS keeps it
     in memory, so that is often what reopening it is) checks for a new version, at most once a minute. A page that had
     no service worker yet (the first visit) doesn't reload when one takes it over. */
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    let shown = Date.now(), pend = false, checked = Date.now(), pill = null;
    const busyIn = doc => { try {
      const a = doc.activeElement;
      return !!(doc.querySelector('dialog[open],.modal:not(.hidden),.po:not(.hidden),.ui-run') || a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.readOnly && a.type !== 'button' || a?.isContentEditable)
        || [...doc.querySelectorAll('iframe')].some(f => { try { return f.contentDocument && busyIn(f.contentDocument) } catch (e) { return false } });
    } catch (e) { return true } };
    const offer = () => {
      if (pill || document.hidden) return;
      pill = document.createElement('button'); pill.type = 'button'; pill.className = 'ui-upd'; pill.textContent = 'Updated · tap to reload';
      pill.onclick = () => location.reload(); document.body.appendChild(pill);
    };
    const settle = () => { if (!pend || document.hidden) return; if (Date.now() - shown < 30000 && !busyIn(document)) location.reload(); else offer() };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) { pend = true; settle() } });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      shown = Date.now();
      if (pend) return settle();
      if (Date.now() - checked > 60000) { checked = Date.now(); navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { }) }
    });
  }

  window.UI = { planner, replan, planOf, planSig, hero, filter, timeline, animate, paint, keepFocus, esc, status, meter, week, button, card, segmented, rating, choiceList, stepper, emptyState, skeleton, toast, confirm: confirmSheet, ask, undo, mount, runBar, version: '1.10.0' };
})();
