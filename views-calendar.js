// views-calendar.js — the Calendar tab: Month grid and Weeks list.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import * as K from './calc-cal.js';
import { fmt, esc, monthLabel, shortDate, go, toast, icon, monthNav } from './ui.js';
import { logOccurrence } from './views-recurring.js';
import { monthYear } from './views-debt.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dowOf = d => C.parseDate(d).getDay();
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tabs(active) {
  return `<div class="seg seg-nav" style="--n:2">
    <a href="#/calendar"${active === 'month' ? ' aria-current="page"' : ''}>Month</a>
    <a href="#/calendar-weeks"${active === 'weeks' ? ' aria-current="page"' : ''}>Weeks</a>
  </div>`;
}

function rangeLabel(a, b) {
  const [, am, ad] = a.split('-').map(Number);
  const [, bm, bd] = b.split('-').map(Number);
  return am === bm ? `${SHORT[am - 1]} ${ad} – ${bd}` : `${SHORT[am - 1]} ${ad} – ${SHORT[bm - 1]} ${bd}`;
}

const marker = {
  payDone: '<i class="mk mk-pay-done"></i>',
  payDue: '<i class="mk mk-pay-due"></i>',
  saveDone: '<i class="mk mk-save-done"></i>',
  savePlan: '<i class="mk mk-save-plan"></i>',
  payday: '<i class="mk mk-payday"></i>',
  paydayNext: '<i class="mk mk-payday-next"></i>',
};

const evIcon = {
  pay: '<span class="ev-icon ev-pay"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg></span>',
  save: '<span class="ev-icon ev-save"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V7M7 11l5-5 5 5"/><path d="M5 21h14"/></svg></span>',
  income: '<span class="ev-icon ev-income"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3"/></svg></span>',
};

function eventRow(e, date, today) {
  const amt = (sign, cents) => `<span class="num strong">${sign}${fmt(cents, cents % 100 !== 0)}</span>`;
  if (e.type === 'bill') {
    const sub = e.paid ? `Paid ${shortDate(e.payment.paidOn)}` : date < today ? 'Overdue' : date === today ? 'Due today' : 'Due';
    const extra = e.bill.variable && !e.paid ? ' · amount varies' : '';
    return `<div class="list-row">${evIcon.pay}<span class="stack-2 grow"><span class="strong">${esc(e.name)}</span><span class="muted small${!e.paid && date <= today ? ' warn-text strong' : ''}">${sub}${extra}</span></span>
      <span class="ev-right">${amt(e.bill.variable && !e.paid ? '~' : '', e.amount)}${e.paid ? '' : `<button type="button" class="btn-small" data-pay="${e.bill.id}" data-m="${e.month}">Mark paid</button>`}</span></div>`;
  }
  if (e.type === 'payday') {
    return `<div class="list-row">${evIcon.income}<span class="stack-2 grow"><span class="strong">Payday</span><span class="muted small">${e.arrived ? 'Paycheck' : 'Expected paycheck'}</span></span>${amt('+', e.amount)}</div>`;
  }
  if (e.type === 'saved' || e.type === 'withdrawn') {
    const href = e.source === 'income' ? `#/income/${e.entryId}` : `#/saving/${e.entryId}`;
    return `<a class="list-row" href="${href}">${evIcon.save}<span class="stack-2 grow"><span class="strong">${esc(e.name)}</span><span class="muted small">${e.type === 'withdrawn' ? 'Taken out of savings' : 'Savings'}</span></span>${amt(e.type === 'withdrawn' ? '−' : '+', e.amount)}</a>`;
  }
  if (e.type === 'debtPaid') {
    return `<div class="list-row">${evIcon.pay}<span class="stack-2 grow"><span class="strong">${esc(e.name)}</span><span class="muted small">Extra payment made</span></span>${amt('', e.amount)}</div>`;
  }
  // planned recurring
  return `<div class="list-row">${e.kind === 'saving' ? evIcon.save : evIcon.pay}<span class="stack-2 grow"><span class="strong">${esc(e.name)}</span><span class="muted small">Planned · ${esc(K.scheduleText(e.rec))}${date < today ? ' · not logged yet' : ''}</span></span>
    <span class="ev-right">${amt('', e.amount)}<button type="button" class="btn-small" data-log="${e.rec.id}" data-date="${date}">Log it</button></span></div>`;
}

// ---------- Month ----------

export function calendarMonth(query) {
  const s = getState();
  const today = C.todayStr();
  const curMk = C.monthOf(today);
  const mk = /^\d{4}-\d{2}$/.test(query.get('m') || '') ? query.get('m') : curMk;
  const first = `${mk}-01`, last = `${mk}-${String(C.daysInMonth(mk)).padStart(2, '0')}`;
  let sel = query.get('d');
  if (!sel || C.monthOf(sel) !== mk) sel = mk === curMk ? today : first;
  const events = K.eventsBetween(s, first, last, today);

  // Tiles
  const status = C.billStatus(s, mk);
  const unpaid = status.filter(x => !x.paid);
  const billsTile = mk < curMk
    ? { label: 'Bills paid', value: fmt(C.billsPaidTotal(s, mk)), sub: `${status.length} bills` }
    : { label: mk === curMk ? 'Bills still due' : 'Bills due', value: fmt(unpaid.reduce((t, x) => t + x.bill.amount, 0)), sub: `${unpaid.length} ${mk === curMk ? 'left this month' : 'bills'}` };
  let payTile;
  if (!s.settings.nextPayday) payTile = { label: 'Paydays', value: '—', sub: 'Set next payday in Setup' };
  else if (mk === curMk) {
    const next = C.paydaysBetween(s.settings, today, C.addDays(today, 45));
    payTile = next.length
      ? { label: next[0] === today ? 'Payday' : 'Next payday', value: next[0] === today ? 'Today' : `${DOW[dowOf(next[0])]}, ${shortDate(next[0])}`, sub: `+${fmt(s.settings.pay)}${next[1] ? ` · then ${shortDate(next[1])}` : ''}`, small: true }
      : { label: 'Paydays', value: '—', sub: '' };
  } else {
    const pds = C.paydaysBetween(s.settings, first, last);
    payTile = { label: 'Paydays', value: String(pds.length), sub: `+${fmt(pds.length * s.settings.pay)}` };
  }
  const savedMonth = C.savedBetween(s, first, mk === curMk ? today : last);
  const gw = K.goalWeekly(s, today);
  const tiles = `<section class="tiles">
    ${[billsTile, payTile, { label: mk > curMk ? 'Saved' : 'Saved this month', value: (savedMonth < 0 ? '−' : '') + fmt(Math.abs(savedMonth)), sub: gw ? `target ${fmt(gw.amount)} a week` : '' }].map(t =>
      `<div class="tile"><span class="tile-label">${t.label}</span><span class="${t.small ? 'tile-date' : 'num tile-num'}">${t.value}</span><span class="tile-sub">${t.sub}</span></div>`).join('')}
  </section>`;

  // Grid
  const lead = dowOf(first);
  const n = C.daysInMonth(mk);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell"></div>');
  for (let d = 1; d <= n; d++) {
    const date = `${mk}-${String(d).padStart(2, '0')}`;
    const evs = events[date] || [];
    const m = K.dayMarkers(evs);
    const cls = date === sel ? ' is-sel' : date === today ? ' is-today' : '';
    const label = `${SHORT[Number(mk.slice(5)) - 1]} ${d}${date === today ? ', today' : ''}${evs.length ? ': ' + evs.map(e => e.type === 'payday' ? 'payday' : e.name).join(', ') : ''}`;
    cells.push(`<a class="cal-cell${cls}" href="#/calendar?m=${mk}&d=${date}" aria-label="${esc(label)}"${date === sel ? ' aria-current="date"' : ''}>
      <span class="cal-num">${d}</span><span class="cal-marks">${Object.keys(marker).filter(k => m[k]).map(k => marker[k]).join('')}</span></a>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-cell"></div>');
  const grid = `<section class="card cal">
    <div class="cal-head" aria-hidden="true">${DOW.map(d => `<span>${d.toUpperCase()}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="cal-legend">
      <span><i class="mk mk-pay-due"></i>Payment due</span><span><i class="mk mk-pay-done"></i>Paid</span>
      <span><i class="mk mk-save-done"></i>Saved</span><span><i class="mk mk-save-plan"></i>Recurring savings</span>
      <span><i class="mk mk-payday"></i>Payday</span>
    </div>
  </section>`;

  // Selected day
  const selEvs = events[sel] || [];
  const dayCard = `<section class="card" id="day">
    <h2 class="pad-bottom">${DOW_LONG[dowOf(sel)]}, ${shortDate(sel)}${sel === today ? ' · Today' : ''}</h2>
    ${selEvs.length ? selEvs.map(e => eventRow(e, sel, today)).join('') : '<p class="muted">Nothing scheduled this day.</p>'}
  </section>`;

  // This week, any day
  let anyDay = '';
  if (mk === curMk) {
    const ws = C.weekStart(today), we = C.addDays(ws, 6);
    const rows = [];
    if (gw) {
      const sc = C.goalScope(gw.goal);
      const saved = Math.max(0, C.savedBetween(s, ws, today, sc));
      let planned = 0;
      for (let d = C.addDays(today, 1); d <= we; d = C.addDays(d, 1)) for (const e of (K.eventsBetween(s, d, d, today)[d] || [])) if (e.type === 'planned' && e.kind === 'saving') planned += e.amount;
      const left = Math.max(0, gw.amount - saved - planned);
      const status = saved >= gw.amount ? ' · done' : planned ? ` · ${fmt(planned)} planned later this week` : '';
      rows.push(`<div class="list-row plain-row"><span class="stack-2 grow"><span class="strong">Save for ${esc(gw.goal.name)}</span><span class="small ink2">${fmt(saved)} of ${fmt(gw.amount)} this week${status}</span></span>
        ${left ? `<a class="btn-small" href="#/saving-new?k=deposit&a=${left}${sc ? `&acct=${sc.accountId}${sc.bucketId ? `&b=${sc.bucketId}` : ''}` : ''}">Log it</a>` : icon.check}</div>`);
    }
    const pe = K.hasRecurring(s, 'debt') ? null : K.planExtra(s, today);
    if (pe) {
      const paid = K.debtPaidBetween(s, ws, we);
      rows.push(`<div class="list-row plain-row"><span class="stack-2 grow"><span class="strong">Extra to ${esc(pe.debt.name)}</span><span class="small ink2">${fmt(Math.min(paid, pe.amount))} of ${fmt(pe.amount)} this week · debt plan</span></span>
        ${paid < pe.amount ? `<a class="btn-small" href="#/debt-pay/${pe.debt.id}">Log it</a>` : icon.check}</div>`);
    }
    if (rows.length) anyDay = `<section class="card soft stack-xs"><h2>This week, any day</h2><p class="small ink2 pad-bottom">No set day for these. Log them whenever you make them, or make them recurring.</p>${rows.join('')}</section>`;
  }

  // Rest of month / whole month agenda
  let agenda = '';
  if (mk >= curMk) {
    const from = mk === curMk ? C.addDays(today, 1) : first;
    const items = [];
    for (let d = from; d <= last; d = C.addDays(d, 1)) {
      for (const e of events[d] || []) {
        if ((e.type === 'bill' && !e.paid) || e.type === 'payday' || e.type === 'planned') items.push({ e, d });
      }
    }
    if (items.length) agenda = `<section class="card"><h2 class="pad-bottom">${mk === curMk ? 'Rest of ' + monthLabel(mk).split(' ')[0] : 'Coming up in ' + monthLabel(mk).split(' ')[0]}</h2>
      ${items.map(({ e, d }) => {
        const when = `${DOW[dowOf(d)]}, ${shortDate(d)}`;
        if (e.type === 'payday') return `<div class="list-row"><span class="stack-2"><span class="strong">Payday</span><span class="muted small">${when}</span></span><span class="num strong">+${fmt(e.amount)}</span></div>`;
        const isSave = e.type === 'planned' && e.kind === 'saving';
        return `<div class="list-row"><span class="stack-2"><span class="strong${isSave ? ' accent-text' : ''}">${esc(e.name)}</span><span class="muted small">${when}${e.type === 'planned' ? ' · planned' : e.bill.variable ? ' · amount varies' : ''}</span></span><span class="num strong${isSave ? ' accent-text' : ''}">${e.type === 'bill' && e.bill.variable ? '~' : ''}${fmt(e.amount)}</span></div>`;
      }).join('')}</section>`;
  }

  const nudge = s.settings.pay && !s.settings.nextPayday ? `<a class="alert-amber plain" href="#/setup">Add your next payday in Setup to see paydays on the calendar.</a>` : '';

  const html = `<header class="hdr">${monthNav(mk, monthLabel(mk), '/calendar')}<h1>Calendar</h1>${tabs('month')}</header>
    <main class="stack">${nudge}${tiles}${grid}${dayCard}${anyDay}${agenda}</main>`;

  function mount(root) {
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
      const bill = s.bills.find(x => x.id === b.dataset.pay);
      const m = b.dataset.m;
      if (bill.variable || s.debts.some(d => d.billId === bill.id)) return go(`/pay/${bill.id}?m=${m}`);
      update(st => st.billPayments.push({ id: uid(), billId: bill.id, month: m, amount: bill.amount, paidOn: m === curMk ? today : C.dueDate(bill, m) }));
      toast(`${bill.name} marked paid`);
      go(`/calendar?m=${mk}&d=${sel}`);
    }));
    root.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => {
      logOccurrence(b.dataset.log, b.dataset.date);
      go(`/calendar?m=${mk}&d=${sel}`);
    }));
  }
  return { tab: 'calendar', html, mount };
}

// ---------- Weeks ----------

export function calendarWeeks(query) {
  const s = getState();
  const today = C.todayStr();
  const after = Math.min(52, Math.max(6, Number(query.get('n')) || 6));
  const model = K.weeksModel(s, today, 1, after);
  const gw = model.goal;

  let goalCard = '';
  if (gw) {
    const total = C.goalBalance(s, gw.goal);
    const gp = C.goalPlan(gw.goal, total, today);
    const pct = Math.round(gp.progress * 100);
    goalCard = `<section class="card stack-sm">
      <div class="row-between"><h2>${esc(gw.goal.name)}${gw.goal.accountId ? `<span class="muted small"> · ${esc(C.goalScopeLabel(s, gw.goal))}</span>` : ''}</h2><span class="small strong accent-text">${fmt(gw.amount)} a week</span></div>
      <div class="row-base"><span class="num big-mid">${fmt(Math.max(0, Math.min(total, gw.goal.target)))}</span><span class="muted strong">of ${fmt(gw.goal.target)} by ${shortDate(gw.goal.targetDate)}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span class="help">Miss a week and the remaining weeks' target goes up to catch you back up.</span>
    </section>`;
  }

  const xp = K.extraPaycheckMonths(s, today);
  const insight = xp && xp.months.length ? `<section class="alert-amber stack-xs">
    <span class="strong">${xp.months.map(m => monthLabel(m.mk)).join(' and ')} ${xp.months.length === 1 ? 'has' : 'have'} ${xp.typical + 1} paydays</span>
    <span class="small">Your plan uses the ${fmt(xp.average)} monthly average, but most months bring ${xp.typical} paychecks (${fmt(xp.typicalAmount)})${xp.average > xp.typicalAmount ? `, which is ${fmt(xp.average - xp.typicalAmount)} less` : ''}. The ${xp.typical + 1}-paycheck months (${fmt(xp.extraAmount)}) make up the difference, so a little cushion in regular months keeps you safe.</span>
  </section>` : '';

  const check = `<svg role="img" aria-label="Done" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="var(--accent)"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const line = (mark, html, cls = '') => `<span class="wk-line ${cls}"><span class="wk-mark">${mark}</span><span>${html}</span></span>`;

  const weeks = model.weeks.map(w => {
    const lines = [];
    // Savings
    if (w.isPast || w.isCurrent) {
      if (w.target > 0 && w.saved >= w.target) lines.push(line(check, `<b>Saved ${fmt(w.saved)} of ${fmt(w.target)}</b>`));
      else if (w.target > 0) lines.push(line('<i class="mk mk-save-plan"></i>', `<b class="accent-text">${w.isPast ? `Saved ${fmt(Math.max(0, w.saved))} of ${fmt(w.target)}` : `Save ${fmt(w.target)} · ${fmt(Math.max(0, w.saved))} so far${w.plannedUnlogged ? `, ${fmt(w.plannedUnlogged)} planned` : ''}`}</b>`));
      else if (w.saved) lines.push(line(check, `<b>Saved ${fmt(w.saved)}</b>`));
    } else if (w.target > 0) {
      const gap = model.goal && model.recSaving && w.plannedTotal < w.target;
      lines.push(line('<i class="mk mk-save-plan"></i>', `<b class="accent-text">Save ${fmt(w.target)}</b>${model.recSaving ? `<span class="muted"> · ${w.plannedTotal ? `${fmt(w.plannedTotal)} planned${gap ? `, ${fmt(w.target - w.plannedTotal)} to add` : ''}` : 'nothing planned'}</span>` : ''}`));
    }

    // Payments
    const parts = w.bills.map(b => `${esc(b.name)} ${b.bill.variable && !b.paid ? '~' : ''}${fmt(b.amount)}${w.isCurrent && b.date === today && !b.paid ? ' (today)' : b.bill.amount >= 50000 && !w.isPast ? ` (${DOW[dowOf(b.date)]})` : ''}`);
    let extraTotal = 0;
    if (model.recDebt) {
      for (const p of w.plannedDebt) { parts.push(`${esc(p.name)} ${fmt(p.amount)}`); extraTotal += p.amount; }
      if (w.extraPaid) { parts.push(`extra paid ${fmt(w.extraPaid)}`); extraTotal += w.extraPaid; }
    } else if (w.extra) {
      const label = `${esc(w.extra.debt.name.toLowerCase().includes('card') ? 'card' : w.extra.debt.name)} extra`;
      if (w.isPast) { if (w.extraPaid) { parts.push(`extra ${fmt(w.extraPaid)}`); extraTotal += w.extraPaid; } }
      else { parts.push(`${label} ${fmt(w.extra.amount)}`); extraTotal += w.extra.amount; }
    } else if (w.extraPaid) { parts.push(`extra ${fmt(w.extraPaid)}`); extraTotal += w.extraPaid; }
    const payTotal = w.bills.reduce((t, b) => t + b.amount, 0) + extraTotal;
    if (parts.length) {
      lines.push(w.isPast
        ? line('<i class="mk mk-pay-done"></i>', `<span class="muted">Paid ${parts.join(', ')}</span>`)
        : line('<i class="mk mk-pay-due"></i>', `<b>Pay ${fmt(payTotal)}</b><span class="muted"> · ${parts.join(', ')}</span>`));
    }
    for (const p of w.paydays) lines.push(line(`<i class="mk ${p.arrived ? 'mk-payday' : 'mk-payday-next'}"></i>`, `<b>Payday +${fmt(p.amount)} · ${DOW[dowOf(p.date)]}</b>`));
    if (w.earlyWarning) lines.push(`<span class="wk-warn">${esc(w.earlyWarning)}</span>`);
    if (!lines.length) lines.push(line('', '<span class="muted">Nothing scheduled</span>'));

    const tag = w.isPast ? '<span class="muted small strong">Last week</span>'
      : w.isCurrent ? '<span class="small strong accent-text">This week</span>'
      : w.heaviest ? `<span class="pill-warn">Heaviest week · ${fmt(w.out)} out</span>`
      : `<span class="muted small strong">${fmt(w.out)} out</span>`;
    return `<article class="wk${w.isCurrent ? ' wk-now' : ''}${w.isPast ? ' wk-past' : ''}">
      <div class="row-between"><span class="wk-dates">${rangeLabel(w.start, w.end)}</span>${tag}</div>
      <div class="wk-body"><div class="wk-lines">${lines.join('')}</div>
        <div class="wk-right num"><span>${fmt(w.endSavings)}</span>${w.card !== null ? `<span class="muted">card ${fmt(w.card)}</span>` : ''}</div></div>
    </article>`;
  }).join('');

  const ms = K.milestones(s, today);
  const milestones = ms.length ? `<section class="card stack">
    <h2>Milestones</h2>
    ${ms.map(m => `<div class="ms-row"><i class="ms-dot ms-${m.kind}"></i><span class="stack-2 grow"><span class="strong">${esc(m.title)}</span><span class="muted small">${esc(m.sub)}</span></span><span class="strong">${monthYear(m.date)}</span></div>`).join('')}
    <span class="help">These come from your debt plan and goals. Change either one and the dates move here too.</span>
  </section>` : '';

  const empty = !s.settings.pay && !s.bills.length ? `<section class="card"><p class="muted">Add your pay, bills and goals in Setup and your weeks will fill in here.</p></section>` : '';

  const html = `<header class="hdr"><span class="eyebrow">${rangeLabel(model.weeks[0].start, model.weeks[model.weeks.length - 1].end)} · weeks start Sunday</span><h1>Calendar</h1>${tabs('weeks')}</header>
    <main class="stack-tight">${empty}${goalCard}${insight}
      <div class="cal-legend loose">
        <span><i class="mk mk-save-done"></i>Savings</span><span><i class="mk mk-pay-done"></i>Payments</span><span><i class="mk mk-payday"></i>Payday</span>
        <span>Right: projected savings${model.cardId ? ' and card balance' : ''} at week's end</span>
      </div>
      ${weeks}
      <a class="btn btn-outline" href="#/calendar-weeks?n=${after + 6}">Show more weeks</a>
      ${milestones}
    </main>`;
  return { tab: 'calendar', html };
}
