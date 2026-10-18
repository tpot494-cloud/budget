// calc.js — every number the screens show is calculated here from the saved data.
// Nothing here changes data; screens call these functions and display the results.

const pad = n => String(n).padStart(2, '0');

// Local date as 'YYYY-MM-DD'. (toISOString() would use UTC, which flips to
// tomorrow's date in the evening in US time zones.)
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const monthOf = dateStr => dateStr.slice(0, 7);

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function shiftMonth(mk, delta) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

// Days left in the month after today (today counts as used).
export function daysLeftInMonth(today) {
  return daysInMonth(monthOf(today)) - Number(today.slice(8, 10));
}

// ---------- Income ----------

export function monthlyPay(settings) {
  const p = settings.pay || 0;
  if (settings.payFrequency === 'weekly') return Math.round(p * 52 / 12);
  if (settings.payFrequency === 'biweekly') return Math.round(p * 26 / 12);
  return p;
}

export function incomesInMonth(state, mk) {
  return state.incomes.filter(i => monthOf(i.date) === mk);
}

// ---------- Bills ----------

// A bill belongs to a month if it started on or before it and hasn't been removed.
export function billInMonth(bill, mk) {
  return (!bill.startMonth || bill.startMonth <= mk) && (!bill.endMonth || mk < bill.endMonth);
}

export function billsForMonth(state, mk) {
  return state.bills.filter(b => billInMonth(b, mk));
}

export function billsTotal(state, mk) {
  return billsForMonth(state, mk).reduce((t, b) => t + b.amount, 0);
}

export function dueDate(bill, mk) {
  return `${mk}-${pad(Math.min(bill.dueDay, daysInMonth(mk)))}`;
}

// Each bill for the month with whether it's been paid.
export function billStatus(state, mk) {
  return billsForMonth(state, mk).map(b => {
    const payment = state.billPayments.find(p => p.billId === b.id && p.month === mk) || null;
    return { bill: b, payment, paid: !!payment, due: dueDate(b, mk) };
  }).sort((x, y) => x.bill.dueDay - y.bill.dueDay);
}

export function billsPaidTotal(state, mk) {
  return billStatus(state, mk).reduce((t, s) => t + (s.payment ? s.payment.amount : 0), 0);
}

// ---------- Categories & purchases ----------

export function budgetsTotal(state) {
  return state.categories.filter(c => !c.archived).reduce((t, c) => t + (c.budget || 0), 0);
}

export function purchasesInMonth(state, mk) {
  return state.purchases.filter(p => monthOf(p.date) === mk);
}

export function spentInCategory(state, categoryId, mk, excludeId = null) {
  return purchasesInMonth(state, mk)
    .filter(p => p.categoryId === categoryId && p.id !== excludeId)
    .reduce((t, p) => t + p.amount, 0);
}

// Active categories plus any archived ones that have spending this month.
export function categoryTotals(state, mk) {
  const spent = {};
  for (const p of purchasesInMonth(state, mk)) spent[p.categoryId] = (spent[p.categoryId] || 0) + p.amount;
  return state.categories
    .filter(c => !c.archived || spent[c.id])
    .map(c => ({ category: c, spent: spent[c.id] || 0, budget: c.budget || 0 }))
    .sort((a, b) => b.spent - a.spent || a.category.name.localeCompare(b.category.name));
}

export function flexibleSpent(state, mk) {
  return purchasesInMonth(state, mk).reduce((t, p) => t + p.amount, 0);
}

export function overBudget(state, mk) {
  return categoryTotals(state, mk).filter(t => t.budget > 0 && t.spent > t.budget);
}

// Newest date first; within the same day, the one entered last comes first.
export function newestFirst(list) {
  return list.map((p, i) => [p, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map(x => x[0]);
}

// Up to three distinct categories from the most recent purchases.
export function recentCategoryIds(state, n = 3) {
  const ids = [];
  for (const p of newestFirst(state.purchases)) {
    const c = state.categories.find(c => c.id === p.categoryId && !c.archived);
    if (c && !ids.includes(c.id)) ids.push(c.id);
    if (ids.length >= n) break;
  }
  return ids;
}

// ---------- The plan ----------

export function plan(state, mk) {
  const pay = monthlyPay(state.settings);
  const bills = billsTotal(state, mk);
  const budgets = budgetsTotal(state);
  const leftover = pay - bills - budgets;
  const outgoing = bills + budgets;
  return {
    pay, bills, budgets, leftover,
    savingsRate: pay > 0 ? leftover / pay : 0,
    runwayMonths: outgoing > 0 ? savingsTotal(state) / outgoing : null,
  };
}

// ---------- Savings ----------

// Savings total = the balance you entered from your bank, plus deposits, withdrawals
// and extra income to savings logged after you entered it. Entries dated before that
// are already in the bank number; same-day entries count if logged after it.
function afterBaseline(entry, asOf) {
  if (!asOf) return true;
  const asOfDate = todayStr(new Date(asOf));
  if (entry.date !== asOfDate) return entry.date > asOfDate;
  return !!entry.createdAt && entry.createdAt > asOf;
}

export function savingsEntries(state) {
  const log = (state.savingsLog || []).map(e => ({ ...e, source: 'log' }));
  const inc = state.incomes.filter(i => i.allocation === 'savings')
    .map(i => ({ id: i.id, date: i.date, amount: i.amount, kind: 'deposit', note: i.note, createdAt: i.createdAt, inBalance: i.inBalance, source: 'income' }));
  return [...log, ...inc];
}

export function savingsDetail(state) {
  const st = state.settings;
  const asOf = st.savingsAsOf || null;
  let deposits = 0, withdrawals = 0, income = 0, counted = 0;
  for (const e of savingsEntries(state)) {
    if (e.inBalance || !afterBaseline(e, asOf)) continue;
    counted++;
    if (e.kind === 'withdrawal') withdrawals += e.amount;
    else if (e.source === 'income') income += e.amount;
    else deposits += e.amount;
  }
  const base = st.savings || 0;
  return { base, asOf, deposits, withdrawals, income, counted, total: base + deposits + income - withdrawals };
}

export const savingsTotal = state => savingsDetail(state).total;

export const isCounted = (state, e) => !e.inBalance && afterBaseline(e, state.settings.savingsAsOf || null);

// Net money moved into savings between two dates (inclusive).
export function savedBetween(state, from, to) {
  return savingsEntries(state).filter(e => e.date >= from && e.date <= to)
    .reduce((t, e) => t + (e.kind === 'withdrawal' ? -e.amount : e.amount), 0);
}

// Monday of the current week.
export function weekStart(today) {
  const d = parseDate(today);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return todayStr(d);
}

// ---------- Goals ----------

// Goals draw on the single savings balance.
export function goalPlan(goal, savings, today) {
  const remaining = Math.max(0, goal.target - savings);
  const days = daysBetween(today, goal.targetDate);
  const weeksLeft = Math.floor(days / 7);
  let weekly = null;
  if (remaining === 0) weekly = 0;
  else if (weeksLeft >= 1) weekly = Math.ceil(remaining / weeksLeft / 100) * 100; // round up to whole dollars
  return {
    remaining, weeksLeft, weekly,
    progress: goal.target > 0 ? Math.min(1, savings / goal.target) : 0,
    done: remaining === 0,
    pastDue: days < 0 && remaining > 0,
  };
}
