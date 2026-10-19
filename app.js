// app.js — starts the app: loads your data, picks the screen from the address
// (#/home, #/spending, ...), and keeps the app working offline.

import { load } from './store.js';
import { navHtml } from './ui.js';
import { dashboard, incomeForm } from './views-home.js';
import { purchases, purchaseForm } from './views-spending.js';
import { bills, billForm, payForm } from './views-bills.js';
import { setup, categoryForm, goalForm } from './views-setup.js';
import { debtExtra, debtByDate, debtForm, debtPayForm } from './views-debt.js';
import { savingsScreen, savingForm, accountForm } from './views-savings.js';
import { calendarMonth, calendarWeeks } from './views-calendar.js';
import { recurringEditForm } from './views-recurring.js';
import { recap } from './views-recap.js';

const routes = [
  [/^\/home$/, () => dashboard()],
  [/^\/spending$/, (m, q) => purchases(q)],
  [/^\/purchase\/new$/, () => purchaseForm(null)],
  [/^\/purchase\/(.+)$/, m => purchaseForm(m[1])],
  [/^\/bills$/, (m, q) => bills(q)],
  [/^\/bill\/new$/, () => billForm(null)],
  [/^\/bill\/(.+)$/, m => billForm(m[1])],
  [/^\/pay\/(.+)$/, (m, q) => payForm(m[1], q)],
  [/^\/income\/new$/, () => incomeForm(null)],
  [/^\/income\/(.+)$/, m => incomeForm(m[1])],
  [/^\/setup$/, () => setup()],
  [/^\/category\/new$/, () => categoryForm(null)],
  [/^\/category\/(.+)$/, m => categoryForm(m[1])],
  [/^\/goal\/new$/, () => goalForm(null)],
  [/^\/goal\/(.+)$/, m => goalForm(m[1])],
  [/^\/savings$/, () => savingsScreen()],
  [/^\/savings-account\/(.+)$/, m => accountForm(m[1])],
  [/^\/saving-new$/, (m, q) => savingForm(null, q)],
  [/^\/saving\/(.+)$/, (m, q) => savingForm(m[1], q)],
  [/^\/debt$/, () => debtExtra()],
  [/^\/debt-date$/, (m, q) => debtByDate(q)],
  [/^\/debt-new$/, () => debtForm(null)],
  [/^\/debt-edit\/(.+)$/, m => debtForm(m[1])],
  [/^\/debt-pay\/(.+)$/, m => debtPayForm(m[1])],
  [/^\/calendar$/, (m, q) => calendarMonth(q)],
  [/^\/calendar-weeks$/, (m, q) => calendarWeeks(q)],
  [/^\/recurring\/(.+)$/, m => recurringEditForm(m[1])],
  [/^\/goals$/, (m, q) => calendarWeeks(q)],
  [/^\/recap$/, (m, q) => recap(q)],
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
let lastPath = null;

function render() {
  const raw = location.hash.slice(1) || '/home';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  let view = null;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { view = fn(m, query); break; }
  }
  if (!view) { location.replace('#/home'); return; }

  app.innerHTML = view.html;
  document.body.classList.toggle('no-nav', !!view.hideNav);
  nav.hidden = !!view.hideNav;
  if (!view.hideNav) nav.innerHTML = navHtml(view.tab);
  if (view.mount) view.mount(app);
  // Keep scroll position when a screen just refreshes itself; start at the top on a new screen.
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}

load();
window.addEventListener('hashchange', render);
window.addEventListener('app:rerender', render);
render();

// Ask Android to keep this app's storage even when the phone runs low on space.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist(); }).catch(() => {});
}

// Offline support. When a new version is uploaded, the new service worker takes
// over and the page reloads once so you're on the latest version.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
