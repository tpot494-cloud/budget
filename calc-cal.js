// calc-cal.js — what goes on the calendar: bills, paydays, savings, debt payments
// and recurring items, by day and by week. Pure math, no screen code.

import * as C from './calc.js';
import * as D from './calc-debt.js';

// ---------- Recurring items ----------

// endDate is exclusive: stopping a recurring item "today" removes today's and later occurrences.
const active = (rec, date) => (!rec.startDate || date >= rec.startDate) && (!rec.endDate || date < rec.endDate);

export function occurrences(state, rec, from, to) {
  let dates = [];
  if (rec.repeat === 'payday') dates = C.paydaysBetween(state.settings, from, to);
  else if (rec.repeat === 'weekly') {
    const first = C.addDays(from, ((rec.dow ?? 5) - C.parseDate(from).getDay() + 7) % 7);
    for (let d = first; d <= to; d = C.addDays(d, 7)) dates.push(d);
  } else {
    for (let mk = C.monthOf(from); mk <= C.monthOf(to); mk = C.shiftMonth(mk, 1)) {
      const d = `${mk}-${String(Math.min(rec.dom || 1, C.daysInMonth(mk))).padStart(2, '0')}`;
      if (d >= from && d <= to) dates.push(d);
    }
  }
  return dates.filter(d => active(rec, d));
}

export function logFor(state, rec, date) {
  const list = rec.kind === 'saving' ? state.savingsLog : state.debtPayments;
  return (list || []).find(e => e.recurringId === rec.id && e.occDate === date) || null;
}

export function recurringLabel(state, rec) {
  const debt = rec.kind === 'debt' ? state.debts.find(d => d.id === rec.debtId) : null;
  return rec.note || (rec.kind === 'saving' ? 'Savings transfer' : `Extra to ${debt ? debt.name : 'debt'}`);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function scheduleText(rec) {
  if (rec.repeat === 'payday') return 'Every payday';
  if (rec.repeat === 'weekly') return `Every ${DAYS[rec.dow ?? 5]}`;
  const n = rec.dom || 1;
  const sfx = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `Monthly on the ${n}${sfx}`;
}

export const hasRecurring = (state, kind) => (state.recurring || []).some(r => r.kind === kind && !r.endDate);

// ---------- Events by day ----------

export function eventsBetween(state, from, to, today) {
  const map = {};
  const add = (date, ev) => { if (date >= from && date <= to) (map[date] = map[date] || []).push(ev); };

  for (let mk = C.monthOf(from); mk <= C.monthOf(to); mk = C.shiftMonth(mk, 1)) {
    for (const st of C.billStatus(state, mk)) {
      const debt = state.debts.find(d => d.billId === st.bill.id);
      add(st.due, { type: 'bill', bill: st.bill, paid: st.paid, payment: st.payment, month: mk, debt,
        amount: st.paid ? st.payment.amount : st.bill.amount, name: st.bill.name });
    }
  }
  for (const d of C.paydaysBetween(state.settings, from, to)) {
    add(d, { type: 'payday', amount: state.settings.pay, arrived: d <= today });
  }
  for (const e of state.savingsLog || []) {
    if (e.kind === 'move') continue; // moves between buckets don't change how much is saved
    add(e.date, { type: e.kind === 'withdrawal' ? 'withdrawn' : 'saved', amount: e.amount, name: e.note || (e.kind === 'withdrawal' ? 'Taken out of savings' : 'Added to savings'), entryId: e.id, source: 'log' });
  }
  for (const i of state.incomes) {
    if (i.allocation === 'savings') add(i.date, { type: 'saved', amount: i.amount, name: i.note || 'Extra income', entryId: i.id, source: 'income' });
  }
  for (const p of state.debtPayments || []) {
    const debt = state.debts.find(d => d.id === p.debtId);
    add(p.date, { type: 'debtPaid', amount: p.amount, name: `Extra to ${debt ? debt.name : 'debt'}`, debt });
  }
  for (const rec of state.recurring || []) {
    for (const d of occurrences(state, rec, from, to)) {
      if (logFor(state, rec, d)) continue; // already shows as saved / paid
      add(d, { type: 'planned', kind: rec.kind, rec, amount: rec.amount, name: recurringLabel(state, rec) });
    }
  }
  return map;
}

export function dayMarkers(events = []) {
  const has = f => events.some(f);
  return {
    payDone: has(e => (e.type === 'bill' && e.paid) || e.type === 'debtPaid'),
    payDue: has(e => (e.type === 'bill' && !e.paid) || (e.type === 'planned' && e.kind === 'debt')),
    saveDone: has(e => e.type === 'saved' || e.type === 'withdrawn'),
    savePlan: has(e => e.type === 'planned' && e.kind === 'saving'),
    payday: has(e => e.type === 'payday' && e.arrived),
    paydayNext: has(e => e.type === 'payday' && !e.arrived),
  };
}

// ---------- Weekly targets ----------

// Goals share one savings pot, so the week's target is the largest of the goals' weekly needs.
export function goalWeekly(state, today) {
  let best = null;
  for (const g of state.goals) {
    const gp = C.goalPlan(g, C.goalBalance(state, g), today);
    if (gp.weekly && (!best || gp.weekly > best.amount)) best = { amount: gp.weekly, goal: g };
  }
  return best;
}

// The debt plan's extra payment, when there's no recurring schedule for it.
export function planExtra(state, today) {
  const cfg = state.settings.debtPlan;
  if (!state.debts.length || !cfg.amount || cfg.freq !== 'weekly') return null;
  const inputs = D.debtInputs(state, today).filter(d => d.balance > 0);
  if (!inputs.length) return null;
  let target = cfg.focusId ? inputs.find(d => d.id === cfg.focusId) : null;
  if (!target) target = [...inputs].sort((a, b) => cfg.strategy === 'balance' ? a.balance - b.balance : b.apr - a.apr)[0];
  return { amount: cfg.amount, debt: state.debts.find(d => d.id === target.id) };
}

export function debtPaidBetween(state, from, to) {
  return (state.debtPayments || []).filter(p => p.date >= from && p.date <= to).reduce((t, p) => t + p.amount, 0);
}

// ---------- Weeks ----------

export function weeksModel(state, today, before = 1, after = 6) {
  const thisStart = C.weekStart(today);
  const first = C.addDays(thisStart, -7 * before);
  const last = C.addDays(thisStart, 7 * (after + 1) - 1);
  const events = eventsBetween(state, first, last, today);
  const gw = goalWeekly(state, today);
  const recSaving = hasRecurring(state, 'saving');
  const recDebt = hasRecurring(state, 'debt');
  const extra = recDebt ? null : planExtra(state, today);

  // Card balance projection at each week's end, from the debt plan.
  const cardId = D.cardDebtId(state);
  let snaps = null;
  if (cardId) {
    const ends = new Set();
    for (let i = 0; i <= after; i++) ends.add(C.addDays(thisStart, 7 * i + 6));
    const cfg = state.settings.debtPlan;
    snaps = D.simulate(D.debtInputs(state, today), { start: today, extra: cfg.amount, freq: cfg.freq, strategy: cfg.strategy,
      focusId: cfg.focusId, lumpAmount: cfg.lumpAmount, lumpDate: cfg.lumpDate, snapshots: ends }).snaps;
  }

  let projected = C.savingsTotal(state);
  const weeks = [];
  for (let i = -before; i <= after; i++) {
    const start = C.addDays(thisStart, 7 * i);
    const end = C.addDays(start, 6);
    const isPast = i < 0, isCurrent = i === 0;
    const evs = [];
    for (let d = start; d <= end; d = C.addDays(d, 1)) for (const e of events[d] || []) evs.push({ ...e, date: d });
    const bills = evs.filter(e => e.type === 'bill');
    const paydays = evs.filter(e => e.type === 'payday');
    const plannedSave = evs.filter(e => e.type === 'planned' && e.kind === 'saving');
    const plannedDebt = evs.filter(e => e.type === 'planned' && e.kind === 'debt');
    const saved = C.savedBetween(state, start, end, gw ? C.goalScope(gw.goal) : null);
    const extraPaid = debtPaidBetween(state, start, end);

    // The week's target is the goal pace. Recurring transfers are your plan toward it,
    // so a recurring amount smaller than the goal pace still shows the gap.
    const plannedUnlogged = plannedSave.reduce((t, e) => t + e.amount, 0);
    const plannedTotal = plannedUnlogged
      + (state.savingsLog || []).filter(e => e.recurringId && e.occDate >= start && e.occDate <= end).reduce((t, e) => t + e.amount, 0);
    const target = gw ? gw.amount : plannedTotal;

    const extraDue = recDebt ? plannedDebt.reduce((t, e) => t + e.amount, 0) : extra ? extra.amount : 0;
    const billsOut = bills.reduce((t, e) => t + e.amount, 0);
    const out = billsOut + (recDebt ? extraDue + extraPaid : extraDue) + target;

    let endSavings;
    if (isPast) endSavings = C.savingsTotal(state) - C.savedBetween(state, C.addDays(end, 1), today);
    else {
      projected += isCurrent ? Math.max(0, target - saved) : target;
      endSavings = projected;
    }

    // Big bills due before the week's paycheck.
    let earlyWarning = null;
    if (!isPast && paydays.length && state.settings.pay) {
      const pd = paydays[0].date;
      const early = bills.filter(b => !b.paid && b.date < pd);
      const sum = early.reduce((t, b) => t + b.amount, 0);
      if (early.length && sum >= state.settings.pay * 0.5) {
        const big = early.reduce((m, b) => (b.amount > m.amount ? b : m));
        const n = C.daysBetween(big.date, pd);
        earlyWarning = `${big.name} is due ${n} ${n === 1 ? 'day' : 'days'} before this paycheck.`;
      }
    }

    weeks.push({
      start, end, isPast, isCurrent, bills, paydays, plannedSave, plannedDebt,
      saved, target, plannedTotal, plannedUnlogged, extraDue, extraPaid, extra, out, income: paydays.reduce((t, e) => t + e.amount, 0),
      endSavings, card: snaps && !isPast ? (snaps[end]?.[cardId] ?? 0) : null, earlyWarning,
    });
  }
  const future = weeks.filter(w => !w.isPast);
  const avg = future.reduce((t, w) => t + w.out, 0) / Math.max(1, future.length);
  const heaviest = future.reduce((m, w) => (!m || w.out > m.out ? w : m), null);
  if (heaviest && heaviest.out > avg * 1.4 && heaviest.out > 0) heaviest.heaviest = true;
  return { weeks, goal: gw, recSaving, recDebt, cardId };
}

// Months in the next year with an extra paycheck (weekly / every-2-weeks pay).
export function extraPaycheckMonths(state, today) {
  const st = state.settings;
  if (!st.nextPayday || !st.pay || !['weekly', 'biweekly'].includes(st.payFrequency)) return null;
  const typical = st.payFrequency === 'weekly' ? 4 : 2;
  const months = [];
  let mk = C.monthOf(today);
  for (let i = 0; i < 12; i++, mk = C.shiftMonth(mk, 1)) {
    const n = C.paydaysBetween(st, `${mk}-01`, `${mk}-${C.daysInMonth(mk)}`).length;
    if (n > typical) months.push({ mk, n });
  }
  return { months, typical, typicalAmount: typical * st.pay, average: C.monthlyPay(st), extraAmount: (typical + 1) * st.pay };
}

export function milestones(state, today) {
  const out = [];
  for (const g of state.goals) {
    const gp = C.goalPlan(g, C.goalBalance(state, g), today);
    if (gp.done) continue;
    out.push({ date: g.targetDate, kind: 'goal', title: `${g.name} reaches ${'$' + Math.round(g.target / 100).toLocaleString('en-US')}`, sub: gp.weekly ? `At $${Math.round(gp.weekly / 100).toLocaleString('en-US')} a week` : 'Target date' });
  }
  if (state.debts.length) {
    const cfg = state.settings.debtPlan;
    const inputs = D.debtInputs(state, today);
    const r = D.simulate(inputs, { start: today, extra: cfg.amount, freq: cfg.freq, strategy: cfg.strategy, focusId: cfg.focusId, lumpAmount: cfg.lumpAmount, lumpDate: cfg.lumpDate });
    for (const pd of r.perDebt) {
      const inp = inputs.find(i => i.id === pd.id);
      if (!pd.paidOffOn || inp.balance === 0) continue;
      out.push({ date: pd.paidOffOn, kind: 'debt', title: `${pd.name} paid off`, sub: 'On your debt plan' });
    }
    if (r.done && inputs.length > 1) out.push({ date: r.debtFreeOn, kind: 'free', title: 'Debt-free', sub: `+$${Math.round(inputs.reduce((t, d) => t + d.min, 0) / 100).toLocaleString('en-US')} a month back in your budget` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
