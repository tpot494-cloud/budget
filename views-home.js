// views-home.js — the Dashboard and the extra-income form.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import { fmt, esc, monthLabel, shortDate, pct, bar, go, toast, seg, bindSegs, moneyField, parseMoney } from './ui.js';

const SOURCES = [['bonus', 'Bonus'], ['sale', 'Sold something'], ['other', 'Other']];
const sourceLabel = v => (SOURCES.find(s => s[0] === v) || SOURCES[2])[1];

export function dashboard() {
  const s = getState();
  const today = C.todayStr();
  const mk = C.monthOf(today);
  const p = C.plan(s, mk);

  const head = `<header class="hdr"><span class="eyebrow">${monthLabel(mk)}</span><h1>Dashboard</h1></header>`;

  if (!p.pay) {
    return {
      tab: 'home',
      html: `${head}<main class="stack">
        <section class="card stack-sm">
          <h2>Start here</h2>
          <p class="muted">Add your take-home pay, savings, bills and category budgets in Setup. Everything on this screen is calculated from those.</p>
          <a class="btn btn-primary" href="#/setup">Go to Setup</a>
        </section></main>`,
    };
  }

  const billsPct = pct(p.bills, p.pay), budgetsPct = pct(p.budgets, p.pay);
  const over = p.leftover < 0;
  const hero = `<section class="hero stack-sm">
    <span class="hero-label">Left over this month</span>
    <span class="num hero-num">${fmt(p.leftover)}</span>
    <span class="hero-sub">Take-home ${fmt(p.pay)} − bills ${fmt(p.bills)} − budgets ${fmt(p.budgets)}</span>
    <div class="stacked" aria-hidden="true">
      <i style="width:${billsPct.toFixed(1)}%;opacity:.35"></i>
      <i style="width:${budgetsPct.toFixed(1)}%;opacity:.65"></i>
      <i style="flex:1"></i>
    </div>
    <div class="legend">
      <span><b style="opacity:.35"></b>Bills ${Math.round(billsPct)}%</span>
      <span><b style="opacity:.65"></b>Budgets ${Math.round(budgetsPct)}%</span>
      <span><b></b>Left over ${over ? 0 : Math.round(100 - billsPct - budgetsPct)}%</span>
    </div>
    ${over ? `<span class="hero-warn">Your plan spends ${fmt(-p.leftover)} more than you take home.</span>` : ''}
  </section>`;

  const runway = p.runwayMonths === null ? '—' : `${(Math.floor(p.runwayMonths * 10) / 10).toFixed(1)} mo`;
  const tiles = `<section class="tiles">
    <div class="tile"><span class="tile-label">Savings</span><span class="num tile-num">${fmt(s.settings.savings)}</span><span class="tile-sub">in the bank</span></div>
    <div class="tile"><span class="tile-label">Savings rate</span><span class="num tile-num">${Math.round(p.savingsRate * 100)}%</span><span class="tile-sub">of take-home</span></div>
    <div class="tile"><span class="tile-label">Runway</span><span class="num tile-num">${runway}</span><span class="tile-sub">if pay stopped</span></div>
  </section>`;

  const paid = C.billsPaidTotal(s, mk);
  const spent = C.flexibleSpent(s, mk);
  const overs = C.overBudget(s, mk);
  const month = `<section class="card stack">
    <div class="row-between"><h2>This month so far</h2><span class="muted small strong">${C.daysLeftInMonth(today)} days left</span></div>
    <div class="stack-xs">
      <div class="row-between"><span class="strong">Bills paid</span><span class="num strong">${fmt(paid)} <span class="muted">of ${fmt(p.bills)}</span></span></div>
      ${bar(pct(paid, p.bills))}
    </div>
    <div class="stack-xs">
      <div class="row-between"><span class="strong">Flexible spending</span><span class="num strong">${fmt(spent)} <span class="muted">of ${fmt(p.budgets)}</span></span></div>
      ${bar(pct(spent, p.budgets), spent > p.budgets && p.budgets > 0 ? 'over' : '')}
    </div>
    ${overs.slice(0, 2).map(o => `<div class="alert-warn">${esc(o.category.name)} is ${fmt(o.spent - o.budget)} over its ${fmt(o.budget)} budget.</div>`).join('')}
    ${overs.length > 2 ? `<div class="alert-warn">${overs.length - 2} more ${overs.length - 2 === 1 ? 'category is' : 'categories are'} over budget.</div>` : ''}
    <a class="btn btn-outline" href="#/spending">Open spending</a>
  </section>`;

  const incomes = C.incomesInMonth(s, mk).sort((a, b) => b.date.localeCompare(a.date));
  const toSavings = incomes.filter(i => i.allocation === 'savings').reduce((t, i) => t + i.amount, 0);
  const toSpend = incomes.filter(i => i.allocation !== 'savings').reduce((t, i) => t + i.amount, 0);
  const extra = `<section class="card stack-sm">
    <div class="row-between"><h2>Extra income</h2><span class="num strong">${fmt(toSavings + toSpend)}</span></div>
    <p class="muted small">Bonuses and one-off money. Not counted in your plan above.</p>
    ${incomes.length ? `<div class="list">${incomes.map(i => `
      <a class="list-row" href="#/income/${i.id}">
        <span class="stack-2"><span class="strong">${esc(i.note || sourceLabel(i.source))}</span><span class="muted small">${shortDate(i.date)} · ${i.allocation === 'savings' ? 'To savings' : 'Spending money'}</span></span>
        <span class="num strong">${fmt(i.amount, true)}</span>
      </a>`).join('')}</div>
      ${toSpend ? `<div class="alert-amber">${fmt(toSpend)} extra spending money this month.</div>` : ''}` : ''}
    <a class="btn btn-dashed" href="#/income/new">+ Log extra income</a>
  </section>`;

  const goals = s.goals.map(g => {
    const gp = C.goalPlan(g, s.settings.savings || 0, today);
    let msg;
    if (gp.done) msg = 'Goal reached. Nice work.';
    else if (gp.pastDue) msg = `The target date has passed. Pick a new date in Setup.`;
    else if (gp.weekly === null) msg = `${fmt(gp.remaining)} to go, due this week.`;
    else msg = `Save ${fmt(gp.weekly)} a week for the next ${gp.weeksLeft} ${gp.weeksLeft === 1 ? 'week' : 'weeks'} to hit it on time.`;
    return `<section class="card stack">
      <div class="row-between"><h2>${esc(g.name)}</h2><span class="muted small strong">by ${shortDate(g.targetDate, true)}</span></div>
      <div class="row-base"><span class="num big">${fmt(Math.min(s.settings.savings || 0, g.target))}</span><span class="muted strong">of ${fmt(g.target)} · ${Math.round(gp.progress * 100)}%</span></div>
      ${bar(gp.progress * 100, 'thick')}
      <div class="alert-amber">${msg}</div>
    </section>`;
  }).join('');

  return { tab: 'home', html: `${head}<main class="stack">${hero}${tiles}${month}${goals}${extra}</main>` };
}

export function incomeForm(id) {
  const s = getState();
  const existing = id ? s.incomes.find(i => i.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That entry no longer exists.</p><a class="btn btn-outline" href="#/home">Back</a></main>` };
  const inc = existing || { date: C.todayStr(), amount: 0, source: 'bonus', note: '', allocation: 'savings' };

  const html = `<header class="form-hdr"><a href="#/home" class="link">Cancel</a><h1>${existing ? 'Edit income' : 'Extra income'}</h1><span></span></header>
  <main class="stack form">
    ${moneyField('amt', 'Amount', inc.amount, 'class="big-input"')}
    <div class="field"><span class="label">Where it came from</span>${seg('source', SOURCES, inc.source, 'Source')}</div>
    <div class="grid-2">
      <div class="field"><label for="date">Date</label><input id="date" type="date" value="${inc.date}"></div>
      <div class="field"><label for="note">Note</label><input id="note" type="text" value="${esc(inc.note)}" placeholder="Q3 bonus"></div>
    </div>
    <div class="field"><span class="label">Where it goes</span>${seg('alloc', [['savings', 'Savings'], ['spending', 'Spending money']], inc.allocation, 'Allocation')}
      <span class="help">Spending money shows as extra for that month only.</span></div>
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Save income'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Delete</button>` : ''}
  </main>`;

  function mount(root) {
    const val = bindSegs(root);
    root.querySelector('#save').addEventListener('click', () => {
      const amount = parseMoney(root.querySelector('#amt').value);
      const date = root.querySelector('#date').value;
      if (!amount || amount <= 0) return toast('Enter an amount');
      if (!date) return toast('Pick a date');
      const entry = {
        id: existing ? existing.id : uid(),
        date, amount,
        source: val('source'),
        note: root.querySelector('#note').value.trim(),
        allocation: val('alloc'),
      };
      update(st => {
        if (existing) Object.assign(st.incomes.find(i => i.id === existing.id), entry);
        else st.incomes.push(entry);
      });
      // Ask instead of auto-adding: if savings was already updated from the bank,
      // adding again would count the same money twice.
      if (!existing && entry.allocation === 'savings') {
        if (confirm(`Add ${fmt(amount, true)} to your savings balance?\n\nChoose Cancel if your savings number already includes it.`)) {
          update(st => { st.settings.savings = (st.settings.savings || 0) + amount; });
          toast(`Savings is now ${fmt(getState().settings.savings)}`);
        }
      } else toast('Saved');
      go('/home');
    });
    root.querySelector('#del')?.addEventListener('click', () => {
      if (!confirm('Delete this income entry? Your savings balance won\'t change.')) return;
      update(st => { st.incomes = st.incomes.filter(i => i.id !== existing.id); });
      toast('Deleted');
      go('/home');
    });
  }

  return { hideNav: true, html, mount };
}
