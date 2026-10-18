// views-setup.js — Setup (pay, savings, categories, goals, backup), the category and
// goal forms, and placeholder screens for the views coming in the next update.

import { getState, update, uid, exportBackup, readBackup, replaceAll, eraseAll } from './store.js';
import * as C from './calc.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney, icon } from './ui.js';

export function setup() {
  const s = getState();
  const st = s.settings;
  const today = C.todayStr();
  const mk = C.monthOf(today);

  const hasData = s.purchases.length || s.bills.length || st.pay;
  let backupText, backupWarn = false;
  if (!st.lastBackupAt) { backupText = 'No backup yet'; backupWarn = !!hasData; }
  else {
    const days = C.daysBetween(C.todayStr(new Date(st.lastBackupAt)), today);
    backupText = days === 0 ? 'Last backup today' : `Last backup ${days} ${days === 1 ? 'day' : 'days'} ago`;
    backupWarn = days > 14;
  }

  const backup = `<section class="card stack-sm">
    <div class="row-gap"><span class="badge-icon">${icon.download}</span>
      <span class="stack-2"><h2>Backup</h2><span class="small strong ${backupWarn ? 'warn-text' : 'muted'}">${backupText}</span></span></div>
    <div class="grid-2">
      <button type="button" class="btn btn-primary" id="export">Export backup</button>
      <button type="button" class="btn btn-outline" id="import">Import</button>
    </div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <span class="help">Saves one file to your phone's Downloads. Keep a copy somewhere safe: it's the only copy of your data outside this app.</span>
  </section>`;

  const money = `<section class="card stack">
    <h2>Money in</h2>
    ${moneyField('pay', 'Take-home pay per paycheck', st.pay)}
    <div class="field"><span class="label">How often you're paid</span>
      ${seg('freq', [['weekly', 'Weekly'], ['biweekly', 'Biweekly'], ['monthly', 'Monthly']], st.payFrequency, 'Pay frequency')}
      <span class="help" id="payHelp">${payHelp(st)}</span></div>
    <span class="help">Only reliable pay goes here. Log bonuses and one-off money from the Dashboard.</span>
  </section>`;

  const savings = `<section class="card stack">
    <h2>Savings</h2>
    ${moneyField('savings', 'Current savings', st.savings)}
    <span class="help">Update this whenever you check your bank.</span>
  </section>`;

  const billCount = C.billsForMonth(s, mk).length;
  const billsRow = `<a class="card list-row plain" href="#/bills">
    <span class="stack-2"><span class="strong big-label">Bills</span><span class="muted small">${billCount} ${billCount === 1 ? 'bill' : 'bills'} · roll over every month</span></span>
    <span class="row-gap"><span class="num strong">${fmt(C.billsTotal(s, mk))}/mo</span>${icon.chevron}</span></a>`;

  const active = s.categories.filter(c => !c.archived);
  const archived = s.categories.filter(c => c.archived);
  const cats = `<section class="card">
    <div class="row-between"><h2>Spending categories</h2><span class="num strong">${fmt(C.budgetsTotal(s))}/mo</span></div>
    <p class="help pad-bottom">Purchases you log count against these budgets.</p>
    ${active.map(c => `<a class="list-row" href="#/category/${c.id}"><span class="strong">${esc(c.name)}</span>
      <span class="row-gap"><span class="num strong">${c.budget ? fmt(c.budget) : '<span class="muted">No budget</span>'}</span>${icon.chevron}</span></a>`).join('')}
    ${archived.length ? `<details class="archived"><summary>${archived.length} archived</summary>
      ${archived.map(c => `<a class="list-row" href="#/category/${c.id}"><span class="muted strong">${esc(c.name)}</span>${icon.chevron}</a>`).join('')}</details>` : ''}
    <a class="btn btn-dashed mt" href="#/category/new">+ Add category</a>
  </section>`;

  const goals = `<section class="card">
    <h2 class="pad-bottom">Goals</h2>
    ${s.goals.map(g => `<a class="list-row" href="#/goal/${g.id}">
      <span class="stack-2"><span class="strong">${esc(g.name)}</span><span class="muted small">${fmt(g.target)} by ${shortDate(g.targetDate, true)}</span></span>${icon.chevron}</a>`).join('')}
    <a class="btn btn-dashed mt" href="#/goal/new">+ Add goal</a>
  </section>`;

  const danger = `<section class="stack-sm pad-top">
    <button type="button" class="btn btn-danger" id="erase">Erase all data</button>
    <span class="help center">Use this to clear test entries. Export a backup first if you might want them back.</span>
  </section>`;

  const html = `<header class="hdr"><h1>Setup</h1><span class="muted">The numbers every other screen is calculated from.</span></header>
    <main class="stack">${backup}${money}${savings}${billsRow}${cats}${goals}${danger}</main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    bindSegs(root, (name, value) => {
      if (name === 'freq') {
        update(x => { x.settings.payFrequency = value; });
        $('#payHelp').textContent = payHelp(getState().settings);
        toast('Saved');
      }
    });
    // Money fields save when you leave the field.
    for (const [sel, key] of [['#pay', 'pay'], ['#savings', 'savings']]) {
      $(sel).addEventListener('change', e => {
        const v = parseMoney(e.target.value);
        if (v === null && e.target.value.trim() !== '') return toast('Enter a number');
        update(x => { x.settings[key] = v || 0; });
        if (key === 'pay') $('#payHelp').textContent = payHelp(getState().settings);
        toast('Saved');
      });
    }
    $('#export').addEventListener('click', () => { exportBackup(); toast('Backup saved to Downloads'); go('/setup'); });
    $('#import').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const info = readBackup(await file.text());
        const when = info.exportedAt ? new Date(info.exportedAt).toLocaleDateString() : 'an unknown date';
        if (!confirm(`Replace everything in the app with the backup from ${when}?\n\n${info.counts.purchases} purchases, ${info.counts.bills} bills, ${info.counts.categories} categories.\n\nWhat's in the app now will be lost.`)) return;
        replaceAll(info.data);
        toast('Backup restored');
        go('/home');
      } catch (err) {
        alert(err.message);
      } finally { e.target.value = ''; }
    });
    $('#erase').addEventListener('click', () => {
      if (!confirm('Erase all data in this app? This cannot be undone.')) return;
      if (!confirm('Last check: erase everything?')) return;
      eraseAll();
      toast('All data erased');
      go('/setup');
    });
  }

  return { tab: 'setup', html, mount };
}

function payHelp(st) {
  if (!st.pay) return 'Enter what lands in your account each payday.';
  if (st.payFrequency === 'monthly') return `${fmt(C.monthlyPay(st))} a month.`;
  return `Works out to ${fmt(C.monthlyPay(st))} a month on average.`;
}

export function categoryForm(id) {
  const s = getState();
  const existing = id ? s.categories.find(c => c.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That category no longer exists.</p><a class="btn btn-outline" href="#/setup">Back</a></main>` };
  const c = existing || { name: '', budget: 0, archived: false };
  const used = existing ? s.purchases.filter(p => p.categoryId === existing.id).length : 0;
  const others = s.categories.filter(x => x.id !== c.id && !x.archived);

  const manage = !existing ? '' : `<section class="card stack-sm">
    <h2>Manage</h2>
    ${used ? `<p class="help">${used} ${used === 1 ? 'purchase uses' : 'purchases use'} this category, so it can't be deleted. Merge it into another category, or archive it to hide it while keeping past months' totals.</p>` : `<p class="help">No purchases use this category, so it can be deleted.</p>`}
    ${used && others.length ? `<div class="field"><label for="mergeTo">Merge into</label><div class="select"><select id="mergeTo">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div></div>
      <button type="button" class="btn btn-outline" id="merge">Merge</button>` : ''}
    ${used ? `<button type="button" class="btn btn-outline" id="archive">${c.archived ? 'Unarchive' : 'Archive'}</button>` : `<button type="button" class="btn btn-danger" id="del">Delete category</button>`}
  </section>`;

  const html = `<header class="form-hdr"><a href="#/setup" class="link">Cancel</a><h1>${existing ? 'Edit category' : 'New category'}</h1><span></span></header>
  <main class="stack form">
    <div class="field"><label for="name">Name</label><input id="name" type="text" value="${esc(c.name)}" placeholder="Coffee"></div>
    ${moneyField('budget', 'Monthly budget', c.budget)}
    ${existing ? '<span class="help">Renaming is safe: past purchases follow the category.</span>' : ''}
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Add category'}</button>
    ${manage}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    $('#save').addEventListener('click', () => {
      const name = $('#name').value.trim();
      const budget = parseMoney($('#budget').value);
      if (!name) return toast('Give it a name');
      if (budget === null && $('#budget').value.trim() !== '') return toast('Budget must be a number');
      if (s.categories.some(x => x.id !== c.id && !x.archived && x.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists');
      update(st => {
        if (existing) Object.assign(st.categories.find(x => x.id === existing.id), { name, budget: budget || 0 });
        else st.categories.push({ id: uid(), name, budget: budget || 0, archived: false });
      });
      toast('Saved');
      go('/setup');
    });
    $('#merge')?.addEventListener('click', () => {
      const to = s.categories.find(x => x.id === $('#mergeTo').value);
      if (!confirm(`Move all ${used} purchases from ${c.name} into ${to.name}, then remove ${c.name}?`)) return;
      update(st => {
        st.purchases.forEach(p => { if (p.categoryId === c.id) p.categoryId = to.id; });
        st.categories = st.categories.filter(x => x.id !== c.id);
      });
      toast(`Merged into ${to.name}`);
      go('/setup');
    });
    $('#archive')?.addEventListener('click', () => {
      update(st => { const x = st.categories.find(x => x.id === c.id); x.archived = !x.archived; });
      toast(c.archived ? 'Unarchived' : 'Archived');
      go('/setup');
    });
    $('#del')?.addEventListener('click', () => {
      if (!confirm(`Delete ${c.name}?`)) return;
      update(st => { st.categories = st.categories.filter(x => x.id !== c.id); });
      toast('Deleted');
      go('/setup');
    });
  }
  return { hideNav: true, html, mount };
}

export function goalForm(id) {
  const s = getState();
  const existing = id ? s.goals.find(g => g.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That goal no longer exists.</p><a class="btn btn-outline" href="#/setup">Back</a></main>` };
  const g = existing || { name: '', target: 0, targetDate: '' };

  const html = `<header class="form-hdr"><a href="#/setup" class="link">Cancel</a><h1>${existing ? 'Edit goal' : 'New goal'}</h1><span></span></header>
  <main class="stack form">
    <div class="field"><label for="name">Name</label><input id="name" type="text" value="${esc(g.name)}" placeholder="Emergency fund"></div>
    ${moneyField('target', 'Target amount', g.target)}
    <div class="field"><label for="date">Reach it by</label><input id="date" type="date" value="${g.targetDate}" min="${C.todayStr()}"></div>
    <span class="help">Progress is measured against your total savings balance.</span>
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Add goal'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Delete goal</button>` : ''}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    $('#save').addEventListener('click', () => {
      const name = $('#name').value.trim();
      const target = parseMoney($('#target').value);
      const targetDate = $('#date').value;
      if (!name) return toast('Give the goal a name');
      if (!target || target <= 0) return toast('Enter a target amount');
      if (!targetDate) return toast('Pick a date');
      update(st => {
        if (existing) Object.assign(st.goals.find(x => x.id === existing.id), { name, target, targetDate });
        else st.goals.push({ id: uid(), name, target, targetDate });
      });
      toast('Saved');
      go('/setup');
    });
    $('#del')?.addEventListener('click', () => {
      if (!confirm(`Delete ${g.name}?`)) return;
      update(st => { st.goals = st.goals.filter(x => x.id !== g.id); });
      toast('Deleted');
      go('/setup');
    });
  }
  return { hideNav: true, html, mount };
}

export function comingSoon(which) {
  const s = getState();
  if (which === 'debt') {
    const cardSpend = s.purchases.filter(p => p.paidWith === 'card').reduce((t, p) => t + p.amount, 0);
    return { tab: 'debt', html: `<header class="hdr"><h1>Debt payoff</h1></header><main class="stack">
      <section class="card stack-sm"><h2>Coming in the next update</h2>
      <p class="muted">Payoff plans by extra amount or by date, payoff order, and how each plan changes your monthly budget.</p>
      <p class="muted">Card purchases are already being tracked${cardSpend ? ` (${fmt(cardSpend, true)} so far)` : ''}, so they'll count toward your card balance as soon as this screen arrives.</p></section></main>` };
  }
  return { tab: 'goals', html: `<header class="hdr"><h1>Goals</h1></header><main class="stack">
    <section class="card stack-sm"><h2>Coming in the next update</h2>
    <p class="muted">A calendar view of how much to save each week to hit each goal.</p>
    <p class="muted">Goals you add in Setup already show their weekly target on the Dashboard.</p>
    <a class="btn btn-outline" href="#/goal/new">Add a goal</a></section></main>` };
}
