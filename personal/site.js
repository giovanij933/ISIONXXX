'use strict';

// This homepage owns one key; the seven apps' data remains with those apps.
const FOCUS_KEY = 'isx.personal.intention.v1';
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dialog = document.querySelector('#focus-dialog');
const input = document.querySelector('#focus-input');
const focusText = document.querySelector('#intention-text');
const editButton = document.querySelector('#edit-focus');
const error = document.querySelector('#focus-error');
let currentFocus = '';
let toastTimer;

function showToast(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}

function refreshFocus() {
  const now = new Date();
  const date = document.querySelector('#today-date');
  date.dateTime = localDay();
  date.textContent = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', weekday: 'short' }).format(now);
  currentFocus = '';
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_KEY));
    if (saved && saved.date === localDay() && typeof saved.text === 'string') currentFocus = saved.text.slice(0, 160).trim();
  } catch { /* Empty, unavailable, and malformed storage all get the empty state. */ }
  focusText.textContent = currentFocus || 'What deserves your attention today?';
  focusText.classList.toggle('empty', !currentFocus);
  editButton.replaceChildren(document.createTextNode(currentFocus ? 'Edit intention ' : 'Set an intention '));
  const symbol = document.createElement('span');
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = currentFocus ? '↗' : '＋';
  editButton.append(symbol);
}

function updateLength() {
  document.querySelector('#focus-length').textContent = `${input.value.length} / 160`;
}

editButton.addEventListener('click', () => {
  refreshFocus();
  input.value = currentFocus;
  error.textContent = '';
  updateLength();
  dialog.showModal();
  input.focus();
});
document.querySelector('#close-focus').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const r = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
});
input.addEventListener('input', () => { updateLength(); error.textContent = ''; });

function saveFocus(text) {
  try {
    if (text) localStorage.setItem(FOCUS_KEY, JSON.stringify({ date: localDay(), text }));
    else localStorage.removeItem(FOCUS_KEY);
  } catch {
    error.textContent = 'This browser couldn’t save your note. Your text is still here to copy.';
    return;
  }
  refreshFocus();
  dialog.close();
  showToast(text ? 'A little direction for today. Intention saved.' : 'Your intention has been cleared.');
}

document.querySelector('#focus-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    error.textContent = 'Add a few words, or choose “Clear note”.';
    input.focus();
    return;
  }
  saveFocus(text.slice(0, 160));
});
document.querySelector('#clear-focus').addEventListener('click', () => saveFocus(''));

for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => {
    const category = button.dataset.filter;
    let count = 0;
    for (const card of document.querySelectorAll('.app-card')) {
      card.hidden = category !== 'all' && card.dataset.category !== category;
      if (!card.hidden) count++;
    }
    for (const filter of document.querySelectorAll('[data-filter]')) {
      const selected = filter === button;
      filter.classList.toggle('active', selected);
      filter.setAttribute('aria-pressed', String(selected));
    }
    document.querySelector('#tool-count').textContent = category === 'all' ? 'Seven spaces, one place.' : `${count} tools for ${category}.`;
  });
}

window.addEventListener('storage', event => { if (event.key === FOCUS_KEY || event.key === null) refreshFocus(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFocus(); });
window.addEventListener('focus', refreshFocus);
// Update an open page across midnight without carrying yesterday's note forward.
setInterval(() => { if (document.querySelector('#today-date').dateTime !== localDay()) refreshFocus(); }, 60000);
refreshFocus();
// the shell's service worker (scope /ISIONXXX/) keeps this page for opening with no signal; registering from here
// covers a first visit that starts on this page
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
