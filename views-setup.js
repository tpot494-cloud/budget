// views-setup.js — Setup (pay, savings, categories, goals, backup), the category and
// goal forms, and placeholder screens for the views coming in the next update.

import { getState, update, uid, exportBackup, readBackup, replaceAll, eraseAll, exportPurchasesCsv } from './store.js';
import * as C from './calc.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney, icon } from './ui.js';
import { recurringListCard } from './views-recurring.js';

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
    <span class="help">Opens your phone's share menu so you can save the backup file to Files, Drive or email. Keep a copy somewhere safe: it's the only copy of your data outside this app.</span>
    <button type="button" class="link-btn small" id="download">Download the file instead</button>
  </section>
  <section class="card stack-sm">
    <h2>Export for Excel</h2>
    <p class="help">Every purchase as a CSV file that opens in Excel or Sheets: date, month, amount, category, note and how you paid. Split purchases get one row per category, so totals by category stay correct.</p>
    <button type="button" class="btn btn-outline" id="csv"${s.purchases.length ? '' : ' disabled'}>Export purchases (${s.purchases.length})</button>
  </section>`;

  const money = `<section class="card stack">
    <h2>Money in</h2>
    ${moneyField('pay', 'Take-home pay per paycheck', st.pay)}
    <div class="field"><span class="label">How often you're paid</span>
      ${seg('freq', [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']], st.payFrequency, 'Pay frequency').replace('style="--n:4"', 'style="--n:2"')}
      <span class="help" id="payHelp">${payHelp(st)}</span></div>
    <div class="field"><label for="payday">Next payday</label><input id="payday" type="date" value="${st.nextPayday || ''}">
      <span class="help">Paydays show on the calendar from this date. Twice a month uses the 1st and 15th, moved to the Friday before when one lands on a weekend.</span></div>
    <span class="help">Only reliable pay goes here. Log bonuses and one-off money from the Dashboard.</span>
  </section>`;

  const savings = `<a class="card list-row plain" href="#/savings">
    <span class="stack-2"><span class="strong big-label">Savings</span><span class="muted small">Add or take out money, or update from your bank</span></span>
    <span class="row-gap"><span class="num strong">${fmt(C.savingsTotal(s))}</span>${icon.chevron}</span></a>`;

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
      <span class="stack-2"><span class="strong">${esc(g.name)}</span><span class="muted small">${fmt(g.target)} by ${shortDate(g.targetDate, true)}${g.accountId ? ' · ' + esc(C.goalScopeLabel(s, g)) : ''}</span></span>${icon.chevron}</a>`).join('')}
    <a class="btn btn-dashed mt" href="#/goal/new">+ Add goal</a>
  </section>`;

  const danger = `<section class="stack-sm pad-top">
    <button type="button" class="btn btn-danger" id="erase">Erase all data</button>
    <span class="help center">Use this to clear test entries. Export a backup first if you might want them back.</span>
  </section>`;

  const html = `<header class="hdr"><h1>Setup</h1><span class="muted">The numbers every other screen is calculated from.</span></header>
    <main class="stack">${backup}${money}${savings}${billsRow}${cats}${goals}${recurringListCard(s)}${danger}</main>`;

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
    for (const [sel, key] of [['#pay', 'pay']]) {
      $(sel).addEventListener('change', e => {
        const v = parseMoney(e.target.value);
        if (v === null && e.target.value.trim() !== '') return toast('Enter a number');
        update(x => { x.settings[key] = v || 0; });
        if (key === 'pay') $('#payHelp').textContent = payHelp(getState().settings);
        toast('Saved');
      });
    }
    const doExport = async forceDownload => {
      const how = await exportBackup({ forceDownload });
      if (how === 'cancelled') return;
      toast(how === 'shared' ? 'Backup shared' : 'Backup saved to Downloads');
      go('/setup');
    };
    $('#payday').addEventListener('change', e => {
      update(x => { x.settings.nextPayday = e.target.value || null; });
      toast('Saved');
    });
    $('#export').addEventListener('click', () => doExport(false));
    $('#download').addEventListener('click', () => doExport(true));
    $('#csv').addEventListener('click', async () => {
      const how = await exportPurchasesCsv();
      if (how !== 'cancelled') toast(how === 'shared' ? 'Purchases exported' : 'Saved to Downloads');
    });
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
  const used = existing ? s.purchases.filter(p => C.usesCategory(p, existing.id)).length : 0;
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
        st.purchases.forEach(p => {
          if (p.categoryId === c.id) p.categoryId = to.id;
          if (p.splits && p.splits.length) {
            // Fold split parts into the target category, combining if it's already there.
            const merged = [];
            for (const part of p.splits) {
              const cid = part.categoryId === c.id ? to.id : part.categoryId;
              const ex = merged.find(m => m.categoryId === cid);
              if (ex) ex.amount += part.amount; else merged.push({ categoryId: cid, amount: part.amount });
            }
            if (merged.length > 1) p.splits = merged; else { delete p.splits; p.categoryId = merged[0].categoryId; }
          }
        });
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
    <div class="field"><label for="scope">Counts toward it</label><div class="select"><select id="scope">
      <option value="all"${!g.accountId ? ' selected' : ''}>All savings</option>
      ${C.accounts(s).map(a => `<option value="a:${a.id}"${g.accountId === a.id && !g.bucketId ? ' selected' : ''}>${esc(a.name)} (whole account)</option>` +
        (a.buckets || []).map(b => `<option value="b:${a.id}:${b.id}"${g.accountId === a.id && g.bucketId === b.id ? ' selected' : ''}>${esc(a.name)} › ${esc(b.name)}</option>`).join('')).join('')}
    </select></div>
      <span class="help">Pick a bucket to track this goal on its own money, separate from your other savings.</span></div>
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
      const [kind, accountId, bucketId] = $('#scope').value.split(':');
      const scope = kind === 'all' ? {} : kind === 'a' ? { accountId } : { accountId, bucketId };
      update(st => {
        if (existing) {
          const goal = st.goals.find(x => x.id === existing.id);
          delete goal.accountId; delete goal.bucketId;
          Object.assign(goal, { name, target, targetDate, ...scope });
        } else st.goals.push({ id: uid(), name, target, targetDate, ...scope });
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
