// ui.js — shared display helpers: money formatting, safe text, icons, navigation.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });

// fmt(cents) → "$1,234"; fmt(cents, true) → "$1,234.56"
export function fmt(cents, withCents = false) {
  const v = (cents || 0) / 100;
  const s = (withCents ? usd : usd0).format(Math.abs(v));
  return v < 0 ? '−' + s : s;
}

// Text typed into a money field → cents, or null if it isn't a number.
export function parseMoney(str) {
  const cleaned = String(str ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const moneyValue = cents => (cents ? (cents / 100).toFixed(2) : '');

// Everything typed by the user goes through esc() before it's shown, so a note
// or an imported backup can never inject markup into the page.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function shortDate(s, withYear = false) {
  const [y, m, d] = s.split('-').map(Number);
  return `${SHORT[m - 1]} ${d}${withYear ? ', ' + y : ''}`;
}
export function dayHeading(s, today) {
  const [y, m, d] = s.split('-').map(Number);
  const dow = DAYS[new Date(y, m - 1, d).getDay()];
  return s === today ? `Today · ${SHORT[m - 1]} ${d}` : `${dow} · ${SHORT[m - 1]} ${d}`;
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

// ---------- Navigation ----------

export function go(path) {
  if (location.hash === '#' + path) rerender();
  else location.hash = path;
}
export function rerender() { window.dispatchEvent(new Event('app:rerender')); }

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Icons (inline SVG, stroke uses the text color) ----------

const svg = (body, size = 24) =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icon = {
  home: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  spending: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  debt: svg('<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  setup: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', 16),
  back: svg('<path d="M15 6l-6 6 6 6"/>', 22),
  next: svg('<path d="M9 6l6 6-6 6"/>', 22),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 28),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>', 22),
  check: `<svg role="img" aria-label="Paid" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="var(--accent)"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  roll: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/>', 22),
};

const TABS = [
  ['home', '/home', 'Dashboard'],
  ['spending', '/spending', 'Spending'],
  ['debt', '/debt', 'Debt'],
  ['calendar', '/calendar', 'Calendar'],
  ['setup', '/setup', 'Setup'],
];

export function navHtml(active) {
  return TABS.map(([key, path, label]) =>
    `<a href="#${path}"${key === active ? ' aria-current="page"' : ''}>${icon[key]}<span>${label}</span></a>`
  ).join('');
}

// ---------- Small building blocks ----------

// A segmented control. options: [[value, label], ...]
export function seg(name, options, selected, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}" data-seg="${name}" style="--n:${options.length}">` +
    options.map(([v, l]) => `<button type="button" data-value="${esc(v)}" aria-pressed="${v === selected}">${esc(l)}</button>`).join('') +
    `</div>`;
}

// Wire up segmented controls inside root; returns a getter for current values.
export function bindSegs(root, onChange) {
  root.querySelectorAll('[data-seg]').forEach(group => {
    group.addEventListener('click', e => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onChange && onChange(group.dataset.seg, b.dataset.value);
    });
  });
  return name => root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`)?.dataset.value;
}

export function moneyField(id, label, cents, extra = '') {
  return `<div class="field"><label for="${id}">${esc(label)}</label>
    <div class="money"><span aria-hidden="true">$</span><input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${moneyValue(cents)}" ${extra}></div></div>`;
}

export function bar(percent, cls = '') {
  return `<div class="bar ${cls}"><i style="width:${percent.toFixed(1)}%"></i></div>`;
}

export function monthNav(mk, label, base) {
  return `<div class="month-nav">
    <a class="icon-btn" href="#${base}?m=${shiftMonthLocal(mk, -1)}" aria-label="Previous month">${icon.back}</a>
    <span>${esc(label)}</span>
    <a class="icon-btn" href="#${base}?m=${shiftMonthLocal(mk, 1)}" aria-label="Next month">${icon.next}</a>
  </div>`;
}

function shiftMonthLocal(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
