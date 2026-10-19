// views-debt.js — Debt payoff: extra-amount mode, pay-off-by-date mode, add/edit debt,
// update from statement, and logging extra payments.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import * as D from './calc-debt.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney, moneyValue, icon } from './ui.js';
import { recurringPicker, bindRecurring, saveRecurring } from './views-recurring.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthYear = s => (s ? `${SHORT[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : '—');

function sooner(later, earlier) {
  if (!later || !earlier) return '';
  const months = (Number(later.slice(0, 4)) - Number(earlier.slice(0, 4))) * 12 + (Number(later.slice(5, 7)) - Number(earlier.slice(5, 7)));
  if (months <= 0) return '';
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} sooner`;
  const years = Math.round(months / 12 * 2) / 2;
  return `About ${years} ${years === 1 ? 'year' : 'years'} sooner`;
}

function modeTabs(active) {
  return `<div class="seg seg-nav" style="--n:2">
    <a href="#/debt"${active === 'extra' ? ' aria-current="page"' : ''}>Extra amount</a>
    <a href="#/debt-date"${active === 'date' ? ' aria-current="page"' : ''}>Pay-off date</a>
  </div>`;
}

function header(count, active) {
  return `<header class="hdr"><span class="eyebrow">${count} ${count === 1 ? 'debt' : 'debts'}</span><h1>Debt payoff</h1>${count ? modeTabs(active) : ''}</header>`;
}

function emptyState() {
  return {
    tab: 'debt',
    html: `${header(0)}<main class="stack">
      <section class="card stack-sm"><h2>Add your debts</h2>
      <p class="muted">Add each card or loan with the balance and interest rate from its latest statement. The app links each one to its monthly bill, so your budget and payoff plan stay in sync.</p>
      <p class="muted">Already have a bill for it, like your car payment? You'll be able to link it instead of creating a second one.</p></section>
      <a class="btn btn-primary" href="#/debt-new">+ Add debt</a></main>`,
  };
}

// Monthly money set aside for goals, so payoff plans can protect it.
function goalsMonthly(s, today) {
  return s.goals.reduce((t, g) => {
    const gp = C.goalPlan(g, C.goalBalance(s, g), today);
    return t + (gp.weekly ? Math.round(gp.weekly * 52 / 12) : 0);
  }, 0);
}

// ---------- Extra amount mode ----------

export function debtExtra() {
  const s = getState();
  if (!s.debts.length) return emptyState();
  const today = C.todayStr();
  const mk = C.monthOf(today);
  const cfg = s.settings.debtPlan;
  if (cfg.focusId && !s.debts.some(d => d.id === cfg.focusId)) cfg.focusId = null;
  const inputs = D.debtInputs(s, today);
  const total = D.totalDebt(inputs);
  const base = { start: today, freq: cfg.freq, strategy: cfg.strategy, focusId: cfg.focusId, lumpAmount: cfg.lumpAmount, lumpDate: cfg.lumpDate };
  const planR = D.simulate(inputs, { ...base, extra: cfg.amount });
  const otherR = D.simulate(inputs, { ...base, extra: cfg.amount, strategy: cfg.strategy === 'rate' ? 'balance' : 'rate' });
  const minR = D.minimumsOnly(inputs, today);
  const hasExtra = cfg.amount > 0 || cfg.lumpAmount > 0;
  const minsTotal = inputs.reduce((t, d) => t + d.min, 0);
  const p = C.plan(s, mk);
  const extraMo = D.extraPerMonth(cfg);

  const heroLine = !planR.done
    ? `<span class="hero-sub-lg">Not paid off within 30 years at this rate</span><span class="hero-sub">The payments don't cover the interest. Add an extra amount below.</span>`
    : `<span class="hero-sub-lg">Debt-free by ${monthYear(planR.debtFreeOn)}</span>
       <span class="hero-sub">${hasExtra ? (minR.done ? sooner(minR.debtFreeOn, planR.debtFreeOn) + ' than paying minimums only' : 'Minimums alone would never pay it off') : 'Paying minimums only. Add an extra amount below.'}</span>`;
  const hero = `<section class="hero stack-sm">
    <span class="hero-label">Total debt (estimated today)</span>
    <span class="num hero-num">${fmt(total)}</span>
    ${heroLine}
  </section>`;

  const focus = cfg.focusId ? s.debts.find(d => d.id === cfg.focusId) : null;
  const diff = Math.abs(otherR.interest - planR.interest);
  const stratNote = !hasExtra ? '' : focus ? '' :
    cfg.strategy === 'rate'
      ? `Highest rate first saves the most interest${diff >= 100 ? `: ${fmt(diff)} more than smallest-first here` : ''}.`
      : `Smallest balance first gives quicker wins${diff >= 100 ? `, but costs ${fmt(diff)} more in interest than highest-rate-first here` : ''}.`;

  const controls = `<section class="card stack">
    <h2>Your extra payment</h2>
    ${moneyField('extra', 'Amount', cfg.amount)}
    <div class="field"><span class="label">How often</span>
      ${seg('freq', [['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly']], cfg.freq, 'Payment frequency')}
      <span class="help">On top of your ${fmt(minsTotal)}/month in minimums. Minimums still go out monthly, whichever you pick.${cfg.freq === 'quarterly' ? ' Quarterly payments start next month, then every 3 months.' : ''}</span></div>
    <div class="field"><span class="label">Which debt first</span>
      ${focus ? `<div class="focus-pill"><span><span class="strong">${esc(focus.name)} first</span><span class="muted small"> · from your pay-off date plan</span></span><button type="button" class="link-btn" id="clearFocus">Clear</button></div>` : ''}
      ${seg('strategy', [['rate', 'Highest rate'], ['balance', 'Smallest balance']], cfg.strategy, 'Payoff strategy')}
      ${stratNote ? `<span class="help">${stratNote}</span>` : ''}</div>
    <details class="lump"${cfg.lumpAmount ? ' open' : ''}><summary>One-time payment (a bonus, for example)</summary>
      <div class="grid-2 pad-top">
        ${moneyField('lumpAmt', 'Amount', cfg.lumpAmount)}
        <div class="field"><label for="lumpDate">Date</label><input id="lumpDate" type="date" value="${cfg.lumpDate || ''}" min="${today}"></div>
      </div>
      <span class="help">A what-if. Nothing is logged until you actually pay it.</span>
    </details>
  </section>`;

  const compare = `<section class="card stack-sm">
    <h2>Plan vs. minimums only</h2>
    <div class="grid-2">
      <div class="compare"><span class="tile-label">Minimums only</span><span class="compare-date">${minR.done ? monthYear(minR.debtFreeOn) : 'Never'}</span><span class="num muted small strong">${minR.done ? fmt(minR.interest) + ' interest' : 'interest outgrows payments'}</span></div>
      <div class="compare on"><span class="tile-label ink2">Your plan</span><span class="compare-date">${planR.done ? monthYear(planR.debtFreeOn) : 'Never'}</span><span class="num small strong ink2">${planR.done ? fmt(planR.interest) + ' interest' : '—'}</span></div>
    </div>
    ${hasExtra && minR.done && planR.done && minR.interest > planR.interest ? `<div class="alert-amber strong">You'd save ${fmt(minR.interest - planR.interest)} in interest.</div>` : ''}
  </section>`;

  const lastDate = planR.debtFreeOn || today;
  const span = Math.max(1, C.daysBetween(today, lastDate));
  const ordered = planR.perDebt.map(pd => ({ pd, input: inputs.find(i => i.id === pd.id), debt: s.debts.find(d => d.id === pd.id) }))
    .sort((a, b) => (a.pd.paidOffOn || '9999').localeCompare(b.pd.paidOffOn || '9999'));
  const cardId = D.cardDebtId(s);
  const order = `<section class="card stack">
    <div class="row-between"><h2>Payoff order</h2>${planR.done ? `<span class="muted small strong">${monthYear(today)} → ${monthYear(lastDate)}</span>` : ''}</div>
    ${ordered.map((o, i) => {
      const det = D.balanceDetail(s, o.debt, today);
      const w = o.pd.paidOffOn ? Math.max(3, C.daysBetween(today, o.pd.paidOffOn) / span * 100) : 100;
      return `<a class="payoff-row plain" href="#/debt-edit/${o.debt.id}">
        <span class="row-gap">
          <span class="order-num">${i + 1}</span>
          <span class="stack-2 grow"><span class="strong">${esc(o.debt.name)}</span>
            <span class="muted small">${fmt(o.input.balance)} · ${o.debt.apr}% APR · ${fmt(o.input.min)} min</span>
            ${o.debt.id === cardId && det.purchases ? `<span class="muted small strong">Includes ${fmt(det.purchases)} of new card purchases</span>` : ''}</span>
          <span class="strong">${o.pd.paidOffOn ? monthYear(o.pd.paidOffOn) : 'Never'}</span>
        </span>
        <span class="bar"><i style="width:${w.toFixed(1)}%"></i></span>
      </a>`;
    }).join('')}
    <span class="help">When a debt is paid off, its payment rolls into the next one on the list. Tap a debt to update it from a statement or log a payment.</span>
  </section>`;

  const during = p.leftover - extraMo;
  const after = p.leftover + minsTotal;
  const maxV = Math.max(p.leftover, during, after, 1);
  const effect = `<section class="card stack">
    <h2>Effect on your budget</h2>
    <div class="stack-xs"><div class="row-between"><span class="strong">Left over each month now</span><span class="num strong">${fmt(p.leftover)}</span></div>
      <div class="bar"><i style="width:${Math.max(0, p.leftover / maxV * 100).toFixed(1)}%;background:#8FA39A"></i></div></div>
    ${extraMo ? `<div class="stack-xs"><div class="row-between"><span class="strong">While on this plan</span><span class="num strong${during < 0 ? ' warn-text' : ''}">${fmt(during)}</span></div>
      <div class="bar over"><i style="width:${Math.max(0, during / maxV * 100).toFixed(1)}%"></i></div>
      <span class="muted small">−${fmt(extraMo)} a month${cfg.freq === 'weekly' ? ` (${fmt(cfg.amount)} a week)` : cfg.freq === 'quarterly' ? ' on average' : ''}${during < 0 ? '. More than you have left over.' : ''}</span></div>` : ''}
    <div class="stack-xs"><div class="row-between"><span class="strong">After you're debt-free</span><span class="num strong">${fmt(after)}</span></div>
      <div class="bar"><i style="width:${Math.max(0, after / maxV * 100).toFixed(1)}%"></i></div>
      <span class="muted small">+${fmt(minsTotal)} a month from payments you no longer make</span></div>
  </section>`;

  const html = `${header(s.debts.length, 'extra')}<main class="stack">${hero}${controls}${compare}${order}${effect}
    <a class="btn btn-dashed" href="#/debt-new">+ Add debt</a></main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    const save = changes => { update(st => Object.assign(st.settings.debtPlan, changes)); go('/debt'); };
    bindSegs(root, (name, value) => save({ [name]: value }));
    $('#extra').addEventListener('change', e => {
      const v = parseMoney(e.target.value);
      if (v === null && e.target.value.trim()) return toast('Enter a number');
      save({ amount: v || 0 });
    });
    $('#lumpAmt').addEventListener('change', e => {
      const v = parseMoney(e.target.value);
      if (v === null && e.target.value.trim()) return toast('Enter a number');
      const changes = { lumpAmount: v || 0 };
      if (v && !$('#lumpDate').value) changes.lumpDate = today;
      save(changes);
    });
    $('#lumpDate').addEventListener('change', e => save({ lumpDate: e.target.value }));
    $('#clearFocus')?.addEventListener('click', () => save({ focusId: null }));
  }

  return { tab: 'debt', html, mount };
}

// ---------- Pay-off date mode ----------

export function debtByDate(query) {
  const s = getState();
  if (!s.debts.length) return emptyState();
  const today = C.todayStr();
  const mk = C.monthOf(today);
  const inputs = D.debtInputs(s, today);
  const open = inputs.filter(d => d.balance > 0);
  const strategy = s.settings.debtPlan.strategy;

  let target = query.get('t') || s.debts.find(d => d.type === 'card')?.id || open[0]?.id || 'all';
  if (target !== 'all' && !inputs.some(d => d.id === target)) target = 'all';
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  let byDate = query.get('d');
  if (!byDate || !/^\d{4}-\d{2}-\d{2}$/.test(byDate)) byDate = C.daysBetween(today, yearEnd) >= 28 ? yearEnd : C.todayStr(new Date(Date.now() + 90 * 86400000));
  const targetId = target === 'all' ? null : target;
  const tInput = targetId ? inputs.find(d => d.id === targetId) : null;
  const tName = tInput ? tInput.name : 'all debts';

  const form = `<section class="card stack">
    <h2>Pay off by a date</h2>
    <div class="field"><label for="which">Which debt</label>
      <div class="select"><select id="which">
        ${inputs.map(d => `<option value="${d.id}"${d.id === target ? ' selected' : ''}>${esc(d.name)} · ${fmt(d.balance)}</option>`).join('')}
        ${inputs.length > 1 ? `<option value="all"${target === 'all' ? ' selected' : ''}>All debts · ${fmt(D.totalDebt(inputs))}</option>` : ''}
      </select></div></div>
    <div class="field"><label for="by">Paid off by</label><input id="by" type="date" value="${byDate}" min="${today}"></div>
  </section>`;

  let body;
  if (tInput && tInput.balance === 0) {
    body = `<section class="card"><p class="strong">${esc(tInput.name)} is already paid off.</p></section>`;
  } else {
    const req = D.requiredWeekly(inputs, targetId, byDate, today, strategy);
    const p = C.plan(s, mk);
    const weeks = Math.floor(C.daysBetween(today, byDate) / 7);
    if (!req) {
      body = `<section class="card stack-sm"><h2>That date is too soon</h2><p class="muted">Extra payments are weekly, starting a week from today. Pick a date at least a couple of weeks out.</p></section>`;
    } else {
      const t = targetId ? req.result.perDebt.find(d => d.id === targetId) : null;
      const interest = t ? t.interest : req.result.interest;
      const monthlyNeed = Math.round(req.weekly * 52 / 12);
      const hero = req.weekly === 0
        ? `<section class="hero stack-sm"><span class="hero-label">To clear ${esc(tName)} by ${shortDate(byDate, true)}</span>
            <span class="num hero-num">$0<span class="hero-unit"> extra</span></span>
            <span class="hero-sub">Your minimum payments already get there.</span></section>`
        : `<section class="hero stack-sm"><span class="hero-label">To clear ${esc(tName)} by ${shortDate(byDate, true)}</span>
            <span class="num hero-num">${fmt(req.weekly)}<span class="hero-unit"> / week</span></span>
            <span class="hero-sub">${weeks} weekly ${weeks === 1 ? 'payment' : 'payments'} · about ${fmt(interest)} in interest · on top of your minimum payments</span></section>`;

      const usePlanBtn = (amt, label = 'Use this plan') => `<button type="button" class="btn btn-small-wide" data-use="${amt}">${label}</button>`;
      let verdict = '';
      if (req.weekly > 0) {
        if (monthlyNeed <= p.leftover) {
          const g = goalsMonthly(s, today);
          const squeezesGoals = g > 0 && p.leftover - monthlyNeed < g;
          verdict = `<section class="card soft stack-sm"><h2>This fits your budget</h2>
            <p class="small">It takes ${fmt(monthlyNeed)} of your ${fmt(p.leftover)} left over each month, leaving ${fmt(p.leftover - monthlyNeed)}.</p>
            ${squeezesGoals ? `<p class="small warn-text strong">That's less than the ${fmt(g)} a month your goals need, so goal saving would slow down until this is paid off.</p>` : ''}
            ${usePlanBtn(req.weekly)}</section>`;
        } else {
          const short = monthlyNeed - Math.max(0, p.leftover);
          const alts = [];
          if (p.leftover > 0) {
            const wAll = Math.floor(p.leftover * 12 / 52 / 100) * 100;
            const a = D.clearDateWithWeekly(inputs, targetId, wAll, today, strategy);
            alts.push({ title: 'Use everything left over', w: wAll, r: a, note: s.goals.length ? 'Pauses your goal saving' : '', warn: true });
            const g = goalsMonthly(s, today);
            if (g > 0 && p.leftover - g > 0) {
              const wG = Math.floor((p.leftover - g) * 12 / 52 / 100) * 100;
              if (wG > 0) alts.push({ title: 'Keep goals on track', w: wG, r: D.clearDateWithWeekly(inputs, targetId, wG, today, strategy), note: `Still saves ${fmt(g)} a month toward your goals` });
            }
          }
          verdict = `<section class="alert-card stack-xs"><h2 class="warn-text">${fmt(short)} a month more than you have</h2>
            <p class="small">This date needs ${fmt(monthlyNeed)} a month on top of your minimums. You have ${fmt(Math.max(0, p.leftover))} left over after bills and budgets.</p></section>
            ${alts.length ? `<section class="card stack-sm"><h2>Closest dates you can afford</h2>
              ${alts.filter(a => a.r.date).map(a => `<div class="option stack-xs">
                <div class="row-between"><span class="strong">${a.title}</span><span class="strong">${shortDate(a.r.date, true)}</span></div>
                <span class="muted small">${fmt(a.w)} a week · about ${fmt(a.r.interest)} in interest</span>
                ${a.note ? `<span class="small ${a.warn ? 'warn-text strong' : 'muted'}">${a.note}</span>` : ''}
                ${usePlanBtn(a.w)}</div>`).join('')}
            </section>` : `<section class="card"><p class="muted">Your plan has nothing left over each month right now. Free some up in Setup, then come back.</p></section>`}`;
        }
      }
      const cardNote = targetId && targetId === D.cardDebtId(s) ? `<p class="help">Card purchases you log are added to the balance, so this moves if you keep using the card.</p>` : '';
      body = hero + verdict + cardNote;
    }
  }

  const html = `${header(s.debts.length, 'date')}<main class="stack">${form}${body}</main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    const nav = () => go(`/debt-date?t=${$('#which').value}&d=${$('#by').value || byDate}`);
    $('#which').addEventListener('change', nav);
    $('#by').addEventListener('change', nav);
    root.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
      const amount = Number(b.dataset.use);
      update(st => Object.assign(st.settings.debtPlan, { amount, freq: 'weekly', focusId: targetId }));
      toast(`Plan set: ${fmt(amount)} a week`);
      go('/debt');
    }));
  }
  return { tab: 'debt', html, mount };
}

// ---------- Add / edit debt ----------

function guessBill(s, type, name) {
  const free = s.bills.filter(b => !b.endMonth && !s.debts.some(d => d.billId === b.id));
  const words = { card: ['card', 'credit', 'visa', 'amex', 'discover', 'mastercard'], auto: ['car', 'auto', 'vehicle', 'truck'], student: ['student', 'loan', 'navient', 'nelnet'], other: [] }[type] || [];
  const n = (name || '').toLowerCase().trim();
  return free.find(b => n && b.name.toLowerCase() === n) || free.find(b => words.some(w => b.name.toLowerCase().includes(w))) || null;
}

export function debtForm(id) {
  const s = getState();
  const today = C.todayStr();
  const existing = id ? s.debts.find(d => d.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That debt no longer exists.</p><a class="btn btn-outline" href="#/debt">Back</a></main>` };
  const d = existing || { name: '', type: 'card', balance: 0, asOf: today, apr: '', minPayment: 0, billId: null };
  const bill = existing ? D.linkedBill(s, existing) : null;
  const linkable = s.bills.filter(b => !b.endMonth && !s.debts.some(x => x.billId === b.id && x.id !== d.id));
  const preBill = bill || (!existing ? guessBill(s, d.type, d.name) : null);
  const min = bill ? bill.amount : preBill ? preBill.amount : d.minPayment;
  const due = bill ? bill.dueDay : preBill ? preBill.dueDay : 1;
  const cardId = D.cardDebtId(s);
  const firstCard = cardId ? s.debts.find(x => x.id === cardId) : null;

  let status = '';
  if (existing) {
    const det = D.balanceDetail(s, existing, today);
    const extras = (s.debtPayments || []).filter(p => p.debtId === existing.id).sort((a, b) => b.date.localeCompare(a.date));
    status = `<section class="card stack-sm">
      <span class="tile-label">Estimated balance today</span>
      <span class="num big">${fmt(det.estimate, true)}</span>
      <div class="breakdown">
        <div class="row-between"><span>Statement (${shortDate(det.asOf, true)})</span><span class="num">${fmt(det.statement, true)}</span></div>
        ${det.purchases ? `<div class="row-between"><span>+ Card purchases since</span><span class="num">${fmt(det.purchases, true)}</span></div>` : ''}
        ${det.interest ? `<div class="row-between"><span>+ Estimated interest</span><span class="num">${fmt(det.interest, true)}</span></div>` : ''}
        ${det.payments ? `<div class="row-between"><span>− Payments since</span><span class="num">${fmt(det.payments, true)}</span></div>` : ''}
      </div>
      <h3 class="sub">Update from your statement</h3>
      <div class="grid-2">
        ${moneyField('stmt', 'Statement balance', 0)}
        <div class="field"><label for="stmtDate">As of</label><input id="stmtDate" type="date" value="${today}" max="${today}"></div>
      </div>
      <button type="button" class="btn btn-outline" id="match">Update balance</button>
      <span class="help">Do this when each statement arrives. It replaces the estimate, so interest and fees stay exact.</span>
      <a class="btn btn-dashed" href="#/debt-pay/${existing.id}">+ Log an extra payment</a>
      ${extras.length ? `<div class="list">${extras.slice(0, 5).map(p => `<button type="button" class="list-row plain-btn" data-delpay="${p.id}"><span class="stack-2"><span class="strong">Extra payment</span><span class="muted small">${shortDate(p.date, true)}</span></span><span class="num strong">${fmt(p.amount, true)}</span></button>`).join('')}</div>` : ''}
    </section>`;
  }

  const html = `<header class="form-hdr"><a href="#/debt" class="link">Cancel</a><h1>${existing ? 'Edit debt' : 'New debt'}</h1><span></span></header>
  <main class="stack form">
    ${status}
    <div class="field"><label for="name">Name</label><input id="name" type="text" value="${esc(d.name)}" placeholder="Credit card"></div>
    <div class="field"><span class="label">Type</span>${seg('type', D.TYPES.map(([v, l]) => [v, l === 'Credit card' ? 'Card' : l]), d.type, 'Debt type')}
      <span class="help" id="cardHelp">${d.type === 'card' && firstCard && firstCard.id !== d.id ? `Logged card purchases go to ${esc(firstCard.name)}, your first card.` : d.type === 'card' ? 'Card purchases you log are added to this balance.' : ''}</span></div>
    ${existing ? '' : `<div class="grid-2">
      ${moneyField('bal', 'Current balance', 0)}
      <div class="field"><label for="asOf">As of</label><input id="asOf" type="date" value="${today}" max="${today}"></div>
    </div><span class="help">Use your latest statement or what your app shows today.</span>`}
    <div class="field"><label for="apr">Interest rate (APR %)</label><input id="apr" type="text" inputmode="decimal" value="${d.apr}" placeholder="24.99"></div>
    <div class="field"><label for="bill">Monthly payment bill</label>
      <div class="select"><select id="bill">
        <option value="__new"${preBill ? '' : ' selected'}>Create a new bill</option>
        ${linkable.map(b => `<option value="${b.id}"${preBill && preBill.id === b.id ? ' selected' : ''}>Use existing: ${esc(b.name)} (${fmt(b.amount)})</option>`).join('')}
      </select></div>
      <span class="help">The minimum payment lives on a bill so your budget counts it. Linking an existing bill avoids counting it twice.</span></div>
    <div class="grid-2">
      ${moneyField('min', 'Minimum payment', min)}
      <div class="field"><label for="due">Due day</label><input id="due" type="number" inputmode="numeric" min="1" max="31" value="${due}"></div>
    </div>
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Add debt'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Remove debt</button>` : ''}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    const val = bindSegs(root, (name, value) => {
      if (name !== 'type') return;
      $('#cardHelp').textContent = value === 'card' ? (firstCard && firstCard.id !== d.id ? `Logged card purchases go to ${firstCard.name}, your first card.` : 'Card purchases you log are added to this balance.') : '';
      if (!existing && $('#bill').value === '__new') {
        const g = guessBill(s, value, $('#name').value);
        if (g) { $('#bill').value = g.id; fillFromBill(g); }
      }
    });
    function fillFromBill(b) { $('#min').value = moneyValue(b.amount); $('#due').value = b.dueDay; }
    $('#bill').addEventListener('change', e => { const b = s.bills.find(x => x.id === e.target.value); if (b) fillFromBill(b); });

    $('#save').addEventListener('click', () => {
      const name = $('#name').value.trim();
      const type = val('type');
      const apr = Number(String($('#apr').value).replace('%', '').trim());
      const minP = parseMoney($('#min').value);
      const dueDay = Math.round(Number($('#due').value));
      if (!name) return toast('Give the debt a name');
      if (!(apr >= 0 && apr < 100) || $('#apr').value.trim() === '') return toast('Enter the interest rate, like 24.99');
      if (minP === null || minP <= 0) return toast('Enter the minimum payment');
      if (!(dueDay >= 1 && dueDay <= 31)) return toast('Due day must be 1–31');
      let balance = d.balance, asOf = d.asOf;
      if (!existing) {
        balance = parseMoney($('#bal').value);
        asOf = $('#asOf').value || today;
        if (balance === null || balance < 0) return toast('Enter the current balance');
      }
      const billChoice = $('#bill').value;
      update(st => {
        let billId = billChoice;
        if (billChoice === '__new') {
          billId = uid();
          st.bills.push({ id: billId, name, amount: minP, dueDay, variable: false, startMonth: C.monthOf(today), endMonth: null });
        } else {
          Object.assign(st.bills.find(b => b.id === billChoice), { amount: minP, dueDay });
        }
        const fields = { name, type, apr, minPayment: minP, billId, balance, asOf };
        if (existing) Object.assign(st.debts.find(x => x.id === existing.id), fields);
        else st.debts.push({ id: uid(), ...fields });
      });
      toast(existing ? 'Saved' : 'Debt added');
      go('/debt');
    });

    $('#match')?.addEventListener('click', () => {
      const v = parseMoney($('#stmt').value);
      if (v === null || v < 0) return toast('Enter the statement balance');
      const asOf = $('#stmtDate').value || today;
      update(st => Object.assign(st.debts.find(x => x.id === existing.id), { balance: v, asOf }));
      toast('Balance updated');
      go(`/debt-edit/${existing.id}`);
    });

    root.querySelectorAll('[data-delpay]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Delete this extra payment?')) return;
      update(st => { st.debtPayments = st.debtPayments.filter(p => p.id !== b.dataset.delpay); });
      go(`/debt-edit/${existing.id}`);
    }));

    $('#del')?.addEventListener('click', () => {
      if (!confirm(`Remove ${existing.name} from your debts?`)) return;
      const linked = D.linkedBill(s, existing);
      const stopBill = linked && confirm(`Also stop its monthly bill, "${linked.name}"?\n\nChoose Cancel to keep the bill in your budget.`);
      update(st => {
        st.debts = st.debts.filter(x => x.id !== existing.id);
        st.debtPayments = st.debtPayments.filter(p => p.debtId !== existing.id);
        if (st.settings.debtPlan.focusId === existing.id) st.settings.debtPlan.focusId = null;
        if (stopBill) {
          const mk = C.monthOf(today);
          const paid = st.billPayments.some(p => p.billId === linked.id && p.month === mk);
          st.bills.find(b => b.id === linked.id).endMonth = paid ? C.shiftMonth(mk, 1) : mk;
        }
      });
      toast('Debt removed');
      go('/debt');
    });
  }
  return { hideNav: true, html, mount };
}

export function debtPayForm(id) {
  const s = getState();
  const debt = s.debts.find(d => d.id === id);
  if (!debt) return { html: `<main class="stack"><p>That debt no longer exists.</p><a class="btn btn-outline" href="#/debt">Back</a></main>` };
  const html = `<header class="form-hdr"><a href="#/debt-edit/${id}" class="link">Cancel</a><h1>Extra payment</h1><span></span></header>
  <main class="stack form">
    <p class="muted">For payments to ${esc(debt.name)} beyond the monthly bill, like your weekly extra. Mark the monthly bill paid on the Bills screen as usual.</p>
    ${moneyField('amt', 'Amount', s.settings.debtPlan.amount || 0, 'class="big-input"')}
    ${recurringPicker('Is this a one-time or recurring payment?')}
    <div class="field" data-once><label for="date">Date</label><input id="date" type="date" value="${C.todayStr()}" max="${C.todayStr()}"></div>
    <div class="field" data-rec hidden><label for="rnote">Name (optional)</label><input id="rnote" type="text" placeholder="Extra card payment"></div>
    <button type="button" class="btn btn-primary" id="save">Save payment</button>
  </main>`;
  function mount(root) {
    let picker = null;
    bindSegs(root, (n, v) => picker && picker.onSeg(n, v));
    picker = bindRecurring(root);
    setTimeout(() => root.querySelector('#amt')?.focus(), 50);
    root.querySelector('#save').addEventListener('click', () => {
      const amount = parseMoney(root.querySelector('#amt').value);
      const date = root.querySelector('#date').value;
      if (!amount || amount <= 0) return toast('Enter an amount');
      if (picker.mode === 'recurring') {
        const sched = picker.read();
        if (sched.error) return toast(sched.error);
        saveRecurring({ kind: 'debt', debtId: id, amount, note: root.querySelector('#rnote').value.trim(), ...sched });
        return go('/calendar');
      }
      if (!date) return toast('Pick a date');
      update(st => st.debtPayments.push({ id: uid(), debtId: id, date, amount }));
      toast('Payment logged');
      go(`/debt-edit/${id}`);
    });
  }
  return { hideNav: true, html, mount };
}

// Small summary card for the Dashboard.
export function debtSummaryCard(s, today) {
  if (!s.debts.length) return '';
  const inputs = D.debtInputs(s, today);
  const cfg = s.settings.debtPlan;
  const r = D.simulate(inputs, { start: today, extra: cfg.amount, freq: cfg.freq, strategy: cfg.strategy, focusId: cfg.focusId, lumpAmount: cfg.lumpAmount, lumpDate: cfg.lumpDate });
  return `<a class="card list-row plain" href="#/debt">
    <span class="stack-2"><span class="tile-label">Total debt</span><span class="num big">${fmt(D.totalDebt(inputs))}</span></span>
    <span class="row-gap"><span class="stack-2 right"><span class="muted small strong">Debt-free by</span><span class="strong big-label">${r.done ? monthYear(r.debtFreeOn) : 'Not yet'}</span></span>${icon.chevron}</span>
  </a>`;
}
