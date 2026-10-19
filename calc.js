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
  if (settings.payFrequency === 'semimonthly') return p * 2;
  return p;
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// Twice-a-month paydays fall on the 1st and 15th, moved to the Friday before if
// either lands on a weekend (what most employers do).
function weekdayBefore(dateStr) {
  const d = parseDate(dateStr);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return todayStr(d);
}

// Paydays between two dates (inclusive), projected from the "next payday" setting.
// Works backwards too, so past paydays show on earlier months.
export function paydaysBetween(settings, from, to) {
  const anchor = settings.nextPayday;
  if (!anchor || !settings.pay) return [];
  const f = settings.payFrequency;
  const out = [];
  if (f === 'weekly' || f === 'biweekly') {
    const step = f === 'weekly' ? 7 : 14;
    const k = Math.ceil(daysBetween(anchor, from) / step);
    for (let d = addDays(anchor, k * step); d <= to; d = addDays(d, step)) out.push(d);
    return out;
  }
  const day = Number(anchor.slice(8, 10));
  for (let mk = shiftMonth(monthOf(from), -1); mk <= shiftMonth(monthOf(to), 1); mk = shiftMonth(mk, 1)) {
    const dates = f === 'semimonthly'
      ? [weekdayBefore(`${mk}-01`), weekdayBefore(`${mk}-15`)]
      : [`${mk}-${pad(Math.min(day, daysInMonth(mk)))}`];
    for (const d of dates) if (d >= from && d <= to) out.push(d);
  }
  return [...new Set(out)].sort();
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

// A purchase's category parts: one part normally, several when it's split.
export function purchaseParts(p) {
  return p.splits && p.splits.length ? p.splits : [{ categoryId: p.categoryId, amount: p.amount }];
}

export const usesCategory = (p, categoryId) => purchaseParts(p).some(x => x.categoryId === categoryId);

export function spentInCategory(state, categoryId, mk, excludeId = null) {
  let t = 0;
  for (const p of purchasesInMonth(state, mk)) {
    if (p.id === excludeId) continue;
    for (const part of purchaseParts(p)) if (part.categoryId === categoryId) t += part.amount;
  }
  return t;
}

// Active categories plus any archived ones that have spending this month.
export function categoryTotals(state, mk) {
  const spent = {};
  for (const p of purchasesInMonth(state, mk)) for (const part of purchaseParts(p)) spent[part.categoryId] = (spent[part.categoryId] || 0) + part.amount;
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

// Savings live in one or more accounts. Each account has its own bank balance and up
// to 4 named buckets; whatever isn't in a named bucket is "Unassigned".
//   account total  = bank balance + deposits/withdrawals/extra income logged after it
//   named bucket   = everything ever added to / taken from / moved into or out of it
//   unassigned     = account total − named buckets
// So updating from the bank never disturbs your buckets; the difference lands in Unassigned.

export const accounts = state => state.savingsAccounts || [];
export function accountOf(state, e) {
  const list = accounts(state);
  return list.find(a => a.id === e.accountId) || list[0] || null;
}
export function bucketName(acct, bucketId) {
  return acct?.buckets?.find(b => b.id === bucketId)?.name || 'Unassigned';
}

export function savingsEntries(state) {
  const fallback = accounts(state)[0]?.id || null;
  const log = (state.savingsLog || []).map(e => ({ ...e, accountId: e.accountId || fallback, source: 'log' }));
  const inc = state.incomes.filter(i => i.allocation === 'savings')
    .map(i => ({ id: i.id, date: i.date, amount: i.amount, kind: 'deposit', note: i.note, createdAt: i.createdAt, inBalance: i.inBalance,
      accountId: i.accountId || fallback, bucketId: i.bucketId || null, source: 'income' }));
  return [...log, ...inc];
}

export function accountDetail(state, acct, entries = savingsEntries(state)) {
  const mine = entries.filter(e => e.accountId === acct.id);
  let deposits = 0, withdrawals = 0, income = 0, counted = 0;
  for (const e of mine) {
    if (e.kind === 'move' || e.inBalance || !afterBaseline(e, acct.asOf || null)) continue;
    counted++;
    if (e.kind === 'withdrawal') withdrawals += e.amount;
    else if (e.source === 'income') income += e.amount;
    else deposits += e.amount;
  }
  const base = acct.balance || 0;
  const total = base + deposits + income - withdrawals;
  const buckets = (acct.buckets || []).map(b => {
    let bal = 0;
    for (const e of mine) {
      if (e.kind === 'move') { if (e.toBucketId === b.id) bal += e.amount; if (e.fromBucketId === b.id) bal -= e.amount; }
      else if (e.bucketId === b.id) bal += e.kind === 'withdrawal' ? -e.amount : e.amount;
    }
    return { ...b, balance: bal };
  });
  const unassigned = total - buckets.reduce((t, b) => t + b.balance, 0);
  return { acct, base, asOf: acct.asOf || null, deposits, withdrawals, income, counted, total, buckets, unassigned };
}

export function savingsDetail(state) {
  const entries = savingsEntries(state);
  const list = accounts(state).map(a => accountDetail(state, a, entries));
  return { accounts: list, total: list.reduce((t, d) => t + d.total, 0) };
}

export const savingsTotal = state => savingsDetail(state).total;

export function isCounted(state, e) {
  if (e.kind === 'move') return true;
  const acct = accountOf(state, e);
  return !e.inBalance && afterBaseline(e, acct?.asOf || null);
}

// Balance of one bucket (bucketId null = Unassigned) or a whole account.
export function scopeBalance(state, accountId, bucketId) {
  const acct = accounts(state).find(a => a.id === accountId);
  if (!acct) return savingsTotal(state);
  const d = accountDetail(state, acct);
  if (bucketId === undefined || bucketId === '') return d.total;
  if (bucketId === null) return d.unassigned;
  return d.buckets.find(b => b.id === bucketId)?.balance ?? d.unassigned;
}

// Net money moved into savings between two dates (inclusive). With a scope, counts
// only that account (and bucket, including moves in and out of it).
export function savedBetween(state, from, to, scope = null) {
  let t = 0;
  for (const e of savingsEntries(state)) {
    if (e.date < from || e.date > to) continue;
    if (scope && scope.accountId && e.accountId !== scope.accountId) continue;
    if (e.kind === 'move') {
      if (scope && scope.bucketId) { if (e.toBucketId === scope.bucketId) t += e.amount; if (e.fromBucketId === scope.bucketId) t -= e.amount; }
      continue;
    }
    if (scope && scope.bucketId && e.bucketId !== scope.bucketId) continue;
    t += e.kind === 'withdrawal' ? -e.amount : e.amount;
  }
  return t;
}

// Sunday that starts the week containing this date.
export function weekStart(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return todayStr(d);
}

// ---------- Goals ----------

// A goal counts all savings, one account, or one bucket of an account.
export function goalScope(goal) {
  if (!goal.accountId) return null;
  return { accountId: goal.accountId, bucketId: goal.bucketId || undefined };
}
export function goalBalance(state, goal) {
  const sc = goalScope(goal);
  return sc ? scopeBalance(state, sc.accountId, sc.bucketId) : savingsTotal(state);
}
export function goalScopeLabel(state, goal) {
  const sc = goalScope(goal);
  if (!sc) return 'All savings';
  const acct = accounts(state).find(a => a.id === sc.accountId);
  if (!acct) return 'All savings';
  return sc.bucketId ? `${acct.name} › ${bucketName(acct, sc.bucketId)}` : acct.name;
}

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
