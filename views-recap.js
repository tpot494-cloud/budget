// views-recap.js — Monthly recap: where the month's money went, how each category did
// against its budget, and a place to adjust budgets for next month.

import { getState, update } from './store.js';
import * as C from './calc.js';
import { fmt, esc, monthLabel, shortDate, pct, bar, go, toast, parseMoney, moneyValue, monthNav } from './ui.js';

export function recapMonth(state, mk, today) {
  const first = `${mk}-01`, last = `${mk}-${String(C.daysInMonth(mk)).padStart(2, '0')}`;
  const end = last < today ? last : today;
  const st = state.settings;
  const paydays = st.nextPayday ? C.paydaysBetween(st, first, end) : null;
  const paycheck = paydays ? paydays.length * (st.pay || 0) : (mk < C.monthOf(today) ? C.monthlyPay(st) : null);
  const extraIncome = state.incomes.filter(i => C.monthOf(i.date) === mk).reduce((t, i) => t + i.amount, 0);
  const billsPaid = C.billsPaidTotal(state, mk);
  const spent = C.flexibleSpent(state, mk);
  const saved = C.savedBetween(state, first, end);
  const debtBillIds = new Set(state.debts.map(d => d.billId).filter(Boolean));
  const debtFromBills = state.billPayments.filter(p => p.month === mk && debtBillIds.has(p.billId)).reduce((t, p) => t + p.amount, 0);
  const debtExtra = (state.debtPayments || []).filter(p => C.monthOf(p.date) === mk).reduce((t, p) => t + p.amount, 0);
  const unpaid = C.billStatus(state, mk).filter(x => !x.paid);
  const income = (paycheck || 0) + extraIncome;
  return {
    mk, first, last, end, inProgress: last > today, paydays, paycheck, extraIncome, income,
    billsPaid, spent, saved, debtPaid: debtFromBills + debtExtra, debtExtra, unpaid,
    leftInChecking: paycheck === null ? null : income - billsPaid - spent - Math.max(0, saved) - debtExtra,
    categories: C.categoryTotals(state, mk), budgets: C.budgetsTotal(state),
    top: [...C.purchasesInMonth(state, mk)].sort((a, b) => b.amount - a.amount).slice(0, 3),
  };
}

export function recap(query) {
  const s = getState();
  const today = C.todayStr();
  const curMk = C.monthOf(today);
  const defaultMk = Number(today.slice(8, 10)) <= 7 ? C.shiftMonth(curMk, -1) : curMk;
  const mk = /^\d{4}-\d{2}$/.test(query.get('m') || '') ? query.get('m') : defaultMk;
  const r = recapMonth(s, mk, today);
  const prev = recapMonth(s, C.shiftMonth(mk, -1), today);
  const name = monthLabel(mk).split(' ')[0];
  const prevName = monthLabel(C.shiftMonth(mk, -1)).split(' ')[0];

  if (mk > curMk) {
    return { tab: 'home', html: `<header class="hdr">${monthNav(mk, monthLabel(mk), '/recap')}<h1>Monthly recap</h1></header>
      <main class="stack"><section class="card"><p class="muted">${name} hasn't started yet.</p></section></main>` };
  }

  const tile = (label, value, sub = '') => `<div class="tile"><span class="tile-label">${label}</span><span class="num tile-num">${value}</span><span class="tile-sub">${sub}</span></div>`;
  const summary = `<section class="tiles tiles-2">
    ${tile('Came in', r.paycheck === null ? (r.extraIncome ? fmt(r.extraIncome) : '—') : fmt(r.income), r.paydays ? `${r.paydays.length} ${r.paydays.length === 1 ? 'paycheck' : 'paychecks'}${r.extraIncome ? ` + ${fmt(r.extraIncome)} extra` : ''}` : r.extraIncome ? 'extra income' : 'set payday in Setup')}
    ${tile('Bills paid', fmt(r.billsPaid), r.unpaid.length ? `${r.unpaid.length} unpaid` : 'all paid')}
    ${tile('Flexible spending', fmt(r.spent), r.budgets ? `of ${fmt(r.budgets)} budgeted` : '')}
    ${tile('Saved', (r.saved < 0 ? '−' : '') + fmt(Math.abs(r.saved)), r.saved < 0 ? 'more taken out than added' : 'net into savings')}
    ${state_debts(s) ? tile('Paid toward debt', fmt(r.debtPaid), r.debtExtra ? `incl. ${fmt(r.debtExtra)} extra` : 'minimums') : ''}
    ${r.leftInChecking !== null ? tile('Left in checking', fmt(r.leftInChecking), 'estimate') : ''}
  </section>`;

  // Headline: one or two sentences that say what mattered.
  const lines = [];
  if (r.budgets && r.spent) {
    const d = r.spent - r.budgets;
    if (!r.inProgress) lines.push(d > 0 ? `Flexible spending ran ${fmt(d)} over budget.` : `Flexible spending came in ${fmt(-d)} under budget.`);
  }
  if (prev.spent && r.spent && !r.inProgress) {
    const d = r.spent - prev.spent;
    if (Math.abs(d) >= 1000) lines.push(`That's ${fmt(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than ${prevName}.`);
  }
  if (r.saved > 0) lines.push(`You moved ${fmt(r.saved)} into savings.`);
  const headline = lines.length || r.inProgress ? `<section class="hero stack-xs">
    <span class="hero-label">${monthLabel(mk)}${r.inProgress ? ' · so far' : ''}</span>
    <span class="hero-sub-lg">${r.inProgress ? `${C.daysLeftInMonth(today)} days left. Here's the month so far.` : esc(lines.shift() || `${name} is wrapped up.`)}</span>
    ${lines.length ? `<span class="hero-sub">${esc(lines.join(' '))}</span>` : ''}
  </section>` : '';

  const cats = r.categories.filter(c => !c.category.archived || c.spent);
  const catRows = cats.map(c => {
    const over = c.budget > 0 && c.spent > c.budget;
    // Round spending up to the next $10; categories with no spending keep their budget.
    const suggest = c.spent > 0 ? Math.ceil(c.spent / 1000) * 1000 : c.budget;
    const diff = c.budget ? c.spent - c.budget : null;
    return `<div class="recap-cat stack-xs">
      <div class="row-between"><span class="strong">${esc(c.category.name)}</span>
        <span class="num strong${over ? ' warn-text' : ''}">${fmt(c.spent)} <span class="${over ? '' : 'muted'}">/ ${fmt(c.budget)}</span></span></div>
      ${bar(c.budget ? pct(c.spent, c.budget) : (c.spent ? 100 : 0), over ? 'over' : '')}
      <div class="row-between recap-adjust">
        <span class="small ${over ? 'warn-text strong' : 'muted'}">${diff === null ? 'No budget' : diff > 0 ? `Over by ${fmt(diff)}` : diff < 0 ? `${fmt(-diff)} under` : 'Right on budget'}</span>
        ${c.category.archived ? '' : `<span class="recap-input"><label class="sr" for="b-${c.category.id}">New budget for ${esc(c.category.name)}</label>
          <span class="money mini"><span aria-hidden="true">$</span><input id="b-${c.category.id}" data-cat="${c.category.id}" data-suggest="${suggest}" type="text" inputmode="decimal" value="${moneyValue(c.budget)}"></span></span>`}
      </div>
    </div>`;
  }).join('');
  const budgets = cats.length ? `<section class="card stack">
    <div class="row-between"><h2>Categories</h2><span class="muted small strong">budget →</span></div>
    ${catRows}
    <div class="grid-2">
      <button type="button" class="btn btn-outline" id="useActual">Fill in what I spent</button>
      <button type="button" class="btn btn-primary" id="applyBudgets">Update budgets</button>
    </div>
    <span class="help">Budgets apply to every month from now on. "Fill in what I spent" rounds each category's spending up to the next $10 and leaves categories you didn't use alone.</span>
  </section>` : '';

  const bills = r.unpaid.length ? `<section class="card stack-sm">
    <h2>${r.inProgress ? 'Bills still due' : 'Bills not marked paid'}</h2>
    ${r.unpaid.map(x => `<div class="row-between"><span class="strong">${esc(x.bill.name)}</span><span class="muted small">due ${shortDate(x.due)} · <span class="num strong">${fmt(x.bill.amount)}</span></span></div>`).join('')}
    ${r.inProgress ? '' : `<span class="help">If you paid these, mark them paid on the Bills screen so ${name}'s numbers are right.</span>`}
    <a class="btn btn-outline" href="#/bills?m=${mk}">Open ${name} bills</a>
  </section>` : '';

  const catName = id => s.categories.find(c => c.id === id)?.name || 'Uncategorized';
  const top = r.top.length ? `<section class="card">
    <h2 class="pad-bottom">Biggest purchases</h2>
    ${r.top.map(p => `<a class="list-row" href="#/purchase/${p.id}"><span class="stack-2"><span class="strong">${esc(p.note || catName(p.categoryId))}</span><span class="muted small">${shortDate(p.date)} · ${p.splits?.length ? 'Split' : esc(catName(p.categoryId))}</span></span><span class="num strong">${fmt(p.amount, true)}</span></a>`).join('')}
  </section>` : '';

  const compare = prev.spent || prev.billsPaid || prev.saved ? `<section class="card stack-sm">
    <h2>Compared with ${prevName}</h2>
    ${[['Flexible spending', r.spent, prev.spent, true], ['Bills paid', r.billsPaid, prev.billsPaid, true], ['Saved', r.saved, prev.saved, false]].map(([label, a, b, lowerIsBetter]) => {
      const d = a - b;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<div class="row-between"><span class="strong">${label}</span><span class="small"><span class="num strong">${fmt(a)}</span> <span class="${d === 0 ? 'muted' : good ? 'accent-text strong' : 'warn-text strong'}">${d === 0 ? 'same' : (d > 0 ? '+' : '−') + fmt(Math.abs(d))}</span></span></div>`;
    }).join('')}
    ${r.inProgress ? `<span class="help">${name} isn't over yet, so it's partial.</span>` : ''}
  </section>` : '';

  const html = `<header class="hdr">${monthNav(mk, monthLabel(mk), '/recap')}<h1>Monthly recap</h1></header>
    <main class="stack">${headline}${summary}${budgets}${bills}${top}${compare}</main>`;

  function mount(root) {
    root.querySelector('#useActual')?.addEventListener('click', () => {
      root.querySelectorAll('[data-cat]').forEach(i => { i.value = moneyValue(Number(i.dataset.suggest)); });
      toast('Filled in. Review, then tap Update budgets');
    });
    root.querySelector('#applyBudgets')?.addEventListener('click', () => {
      const changes = [];
      for (const i of root.querySelectorAll('[data-cat]')) {
        const v = i.value.trim() === '' ? 0 : parseMoney(i.value);
        if (v === null || v < 0) return toast('Budgets must be numbers');
        changes.push([i.dataset.cat, v]);
      }
      update(st => { for (const [id, v] of changes) { const c = st.categories.find(x => x.id === id); if (c) c.budget = v; } });
      toast(`Budgets updated · ${fmt(C.budgetsTotal(getState()))} a month`);
      go(`/recap?m=${mk}`);
    });
  }
  return { tab: 'home', html, mount };
}

const state_debts = s => s.debts.length > 0;

// Dashboard card: shows last month's recap during the first week of a month.
export function recapCard(s, today) {
  const day = Number(today.slice(8, 10));
  const mk = day <= 7 ? C.shiftMonth(C.monthOf(today), -1) : C.monthOf(today);
  const hasData = s.purchases.some(p => C.monthOf(p.date) === mk) || s.billPayments.some(p => p.month === mk);
  if (!hasData) return '';
  const name = monthLabel(mk).split(' ')[0];
  return day <= 7
    ? `<a class="card list-row plain recap-card" href="#/recap?m=${mk}"><span class="stack-2"><span class="tile-label accent-text">Monthly recap</span><span class="strong big-label">Your ${name} recap is ready</span><span class="muted small">See how each category did and set next month's budgets</span></span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></a>`
    : '';
}
