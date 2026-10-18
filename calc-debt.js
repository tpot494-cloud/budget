// calc-debt.js — debt balances and payoff projections. Pure math, no screen code.
//
// How the estimate works: you enter a balance from a statement (with its date).
// From then on the app adds logged card purchases and estimated interest, and
// subtracts payments you mark, until you update it from the next statement.
//
// How projections work: the app steps forward one day at a time. Interest accrues
// daily (credit cards charge a daily rate), minimums are paid on each debt's due
// day, and your extra payments go out on the schedule you pick. When a debt is
// paid off, its minimum rolls into the next debt on the list.

import { daysBetween, daysInMonth, monthOf, billInMonth } from './calc.js';

export const TYPES = [['card', 'Credit card'], ['auto', 'Auto'], ['student', 'Student'], ['other', 'Other']];
export const typeLabel = t => (TYPES.find(x => x[0] === t) || TYPES[3])[1];

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function linkedBill(state, debt) {
  return debt.billId ? state.bills.find(b => b.id === debt.billId) || null : null;
}

// The monthly minimum comes from the linked bill, so the budget and the debt view always agree.
export function minPayment(state, debt, mk) {
  const b = linkedBill(state, debt);
  if (b && billInMonth(b, mk)) return b.amount;
  return debt.minPayment || 0;
}

export function dueDayOf(state, debt) {
  return linkedBill(state, debt)?.dueDay || debt.dueDay || 1;
}

// Logged card purchases go to the first credit card in the list.
export function cardDebtId(state) {
  return state.debts.find(d => d.type === 'card')?.id || null;
}

export function balanceDetail(state, debt, today) {
  const after = date => date > debt.asOf && date <= today;
  const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
  const purchases = debt.id === cardDebtId(state)
    ? sum(state.purchases.filter(p => p.paidWith === 'card' && after(p.date)), p => p.amount) : 0;
  const billPaid = debt.billId
    ? sum(state.billPayments.filter(p => p.billId === debt.billId && after(p.paidOn)), p => p.amount) : 0;
  const extraPaid = sum((state.debtPayments || []).filter(p => p.debtId === debt.id && after(p.date)), p => p.amount);
  const days = Math.max(0, daysBetween(debt.asOf, today));
  const interest = Math.round(debt.balance * (debt.apr / 100) / 365 * days);
  const estimate = Math.max(0, debt.balance + purchases + interest - billPaid - extraPaid);
  return { statement: debt.balance, asOf: debt.asOf, purchases, interest, payments: billPaid + extraPaid, estimate };
}

// The inputs a projection needs, from saved data.
export function debtInputs(state, today) {
  const mk = monthOf(today);
  return state.debts.map(d => ({
    id: d.id, name: d.name, type: d.type,
    balance: balanceDetail(state, d, today).estimate,
    apr: d.apr || 0,
    min: minPayment(state, d, mk),
    dueDay: dueDayOf(state, d),
  }));
}

export function totalDebt(inputs) {
  return inputs.reduce((t, d) => t + d.balance, 0);
}

// opts: { start, extra, freq: 'weekly'|'monthly'|'quarterly', strategy: 'rate'|'balance',
//         focusId, lumpAmount, lumpDate, rollover (default true) }
export function simulate(debts, opts) {
  const rollover = opts.rollover !== false;
  const ds = debts.map(d => ({ ...d, bal: d.balance, int: 0, paidOffOn: d.balance > 0 ? null : opts.start }));
  const order = () => ds.filter(d => d.bal > 0).sort((a, b) => {
    if (opts.focusId) {
      if (a.id === opts.focusId) return -1;
      if (b.id === opts.focusId) return 1;
    }
    if (opts.strategy === 'balance') return a.bal - b.bal || b.apr - a.apr;
    return b.apr - a.apr || a.bal - b.bal;
  });

  const [sy, sm, sd] = opts.start.split('-').map(Number);
  let totalInterest = 0;
  const snaps = {};
  const snap = date => { if (opts.snapshots && opts.snapshots.has(date)) snaps[date] = Object.fromEntries(ds.map(d => [d.id, Math.round(d.bal)])); };
  snap(opts.start);
  const MAX_DAYS = 365 * 30;
  for (let day = 1; day <= MAX_DAYS; day++) {
    const date = new Date(sy, sm - 1, sd + day);
    const ds_ = dstr(date);
    const dom = date.getDate();
    const dim = daysInMonth(ds_.slice(0, 7));
    const monthsIn = (date.getFullYear() - sy) * 12 + (date.getMonth() - (sm - 1));

    for (const d of ds) {
      if (d.bal > 0) { const i = d.bal * (d.apr / 100) / 365; d.bal += i; d.int += i; totalInterest += i; }
    }

    let pool = 0;
    for (const d of ds) {
      if (dom !== Math.min(d.dueDay, dim)) continue;
      if (d.bal > 0) {
        const p = Math.min(d.min, d.bal);
        d.bal -= p;
        if (rollover) pool += d.min - p;
        if (d.bal < 0.5) { d.bal = 0; d.paidOffOn = ds_; }
      } else if (rollover) pool += d.min;
    }

    if (opts.extra > 0) {
      if (opts.freq === 'weekly' && day % 7 === 0) pool += opts.extra;
      else if (opts.freq === 'monthly' && dom === 1) pool += opts.extra;
      else if (opts.freq === 'quarterly' && dom === 1 && monthsIn % 3 === 1) pool += opts.extra;
    }
    if (opts.lumpAmount > 0 && ds_ === opts.lumpDate) pool += opts.lumpAmount;

    for (const d of order()) {
      if (pool <= 0) break;
      const p = Math.min(pool, d.bal);
      d.bal -= p; pool -= p;
      if (d.bal < 0.5) { d.bal = 0; d.paidOffOn = ds_; }
    }

    snap(ds_);
    if (ds.every(d => d.bal === 0)) break;
  }

  const done = ds.every(d => d.bal === 0);
  return {
    done,
    debtFreeOn: done ? ds.reduce((m, d) => (d.paidOffOn > m ? d.paidOffOn : m), opts.start) : null,
    interest: Math.round(totalInterest),
    snaps,
    perDebt: ds.map(d => ({ id: d.id, name: d.name, paidOffOn: d.bal === 0 ? d.paidOffOn : null, interest: Math.round(d.int) })),
  };
}

export function minimumsOnly(debts, start) {
  return simulate(debts, { start, extra: 0, freq: 'monthly', strategy: 'rate', rollover: false });
}

export function extraPerMonth(planCfg) {
  const a = planCfg.amount || 0;
  if (planCfg.freq === 'weekly') return Math.round(a * 52 / 12);
  if (planCfg.freq === 'quarterly') return Math.round(a / 3);
  return a;
}

// Smallest weekly extra (rounded up to whole dollars) that clears the target
// (one debt, or all when targetId is null) by the date. null = not possible by then.
export function requiredWeekly(debts, targetId, byDate, start, strategy) {
  const run = x => simulate(debts, { start, extra: x, freq: 'weekly', strategy, focusId: targetId });
  const clearedOn = r => (targetId ? r.perDebt.find(d => d.id === targetId)?.paidOffOn : r.debtFreeOn);
  const ok = x => { const c = clearedOn(run(x)); return !!c && c <= byDate; };
  if (ok(0)) return { weekly: 0, result: run(0) };
  const owed = targetId ? debts.find(d => d.id === targetId).balance : totalDebt(debts);
  let hi = Math.max(10000, owed * 2);
  if (!ok(hi)) return null;
  let lo = 0;
  while (hi - lo > 100) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid; else lo = mid;
  }
  const weekly = Math.ceil(hi / 100) * 100;
  return { weekly, result: run(weekly) };
}

// When the target is cleared paying a given weekly extra.
export function clearDateWithWeekly(debts, targetId, weekly, start, strategy) {
  const r = simulate(debts, { start, extra: weekly, freq: 'weekly', strategy, focusId: targetId });
  const t = targetId ? r.perDebt.find(d => d.id === targetId) : null;
  return { date: t ? t.paidOffOn : r.debtFreeOn, interest: t ? t.interest : r.interest };
}
