// views-recurring.js — the shared "one time or recurring?" piece used by the savings and
// extra-debt-payment forms, logging a planned occurrence, and editing/stopping a recurring item.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import * as K from './calc-cal.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney } from './ui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nextPaydayText(s) {
  const today = C.todayStr();
  const next = C.paydaysBetween(s.settings, today, C.addDays(today, 40))[0];
  if (!next) return 'Set your next payday in Setup to use this.';
  const f = s.settings.payFrequency;
  const how = f === 'weekly' ? 'every week' : f === 'biweekly' ? 'every 2 weeks' : f === 'semimonthly' ? 'twice a month' : 'every month';
  return `Next: ${DAYS[C.parseDate(next).getDay()].slice(0, 3)}, ${shortDate(next)}, then ${how} with your paycheck.`;
}

// The toggle plus recurring fields. Elements marked data-once show only for one-time.
export function recurringPicker(question, rec = null, withToggle = true) {
  const s = getState();
  const r = rec || { repeat: 'payday', dow: C.parseDate(C.todayStr()).getDay(), dom: Number(C.todayStr().slice(8, 10)) };
  return `
  ${withToggle ? `<div class="field" data-toggle-wrap><span class="label">${esc(question)}</span>${seg('mode', [['once', 'One time'], ['recurring', 'Recurring']], 'once', question)}</div>` : ''}
  <div class="stack-sm" data-rec${withToggle ? ' hidden' : ''}>
    <div class="field"><span class="label">Repeats</span>${seg('repeat', [['payday', 'Every payday'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], r.repeat, 'Repeats')}
      <span class="help" data-show="payday">${esc(nextPaydayText(s))}</span></div>
    <div class="field" data-show="weekly"><span class="label">On</span>
      <div class="day-chips" role="group" aria-label="Day of the week">${DAYS.map((d, i) => `<button type="button" class="day-chip" data-dow="${i}" aria-label="${d}" aria-pressed="${i === (r.dow ?? 5)}">${d[0]}</button>`).join('')}</div></div>
    <div class="field" data-show="monthly"><label for="dom">Day of the month</label><input id="dom" type="number" inputmode="numeric" min="1" max="31" value="${r.dom || 1}"></div>
    <div class="note-soft">Shows on the calendar as planned. Nothing is counted until you tap <b>Log it</b>, the same way bills wait for Mark paid.</div>
  </div>`;
}

export function bindRecurring(root, onMode) {
  const $ = sel => root.querySelector(sel);
  const state = { mode: 'once', repeat: root.querySelector('[data-seg="repeat"] [aria-pressed="true"]')?.dataset.value || 'payday',
    dow: Number(root.querySelector('.day-chip[aria-pressed="true"]')?.dataset.dow ?? 5) };
  if (!$('[data-toggle-wrap]') && $('[data-rec]')) state.mode = 'recurring';
  const refresh = () => {
    const rec = state.mode === 'recurring';
    root.querySelectorAll('[data-rec]').forEach(el => { el.hidden = !rec; });
    root.querySelectorAll('[data-once]').forEach(el => { el.hidden = rec; });
    root.querySelectorAll('[data-show]').forEach(el => { el.hidden = el.dataset.show !== state.repeat; });
    onMode && onMode(state.mode);
  };
  root.querySelectorAll('.day-chip').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.day-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    state.dow = Number(b.dataset.dow);
  }));
  refresh();
  return {
    onSeg(name, value) { if (name === 'mode' || name === 'repeat') { state[name] = value; refresh(); } },
    setToggleVisible(v) { const w = $('[data-toggle-wrap]'); if (w) w.hidden = !v; if (!v && state.mode === 'recurring') { state.mode = 'once'; refresh(); } },
    get mode() { return state.mode; },
    read() {
      const dom = Math.round(Number($('#dom')?.value || 1));
      if (state.repeat === 'payday' && !getState().settings.nextPayday) return { error: 'Set your next payday in Setup first' };
      if (state.repeat === 'monthly' && !(dom >= 1 && dom <= 31)) return { error: 'Day of the month must be 1–31' };
      return { repeat: state.repeat, dow: state.dow, dom };
    },
  };
}

export function saveRecurring(fields) {
  const rec = { id: uid(), startDate: C.todayStr(), endDate: null, ...fields };
  update(st => st.recurring.push(rec));
  const next = K.occurrences(getState(), rec, C.todayStr(), C.addDays(C.todayStr(), 62))[0];
  toast(next ? `Planned. First one ${shortDate(next)}` : 'Recurring item saved');
  return rec;
}

// Records a planned occurrence as done.
export function logOccurrence(recId, date, amount) {
  const s = getState();
  const rec = s.recurring.find(r => r.id === recId);
  if (!rec || K.logFor(s, rec, date)) return;
  const amt = amount ?? rec.amount;
  update(st => {
    if (rec.kind === 'saving') st.savingsLog.push({ id: uid(), date, amount: amt, kind: 'deposit', note: rec.note || '', createdAt: new Date().toISOString(), recurringId: rec.id, occDate: date, accountId: rec.accountId || null, bucketId: rec.bucketId || null });
    else st.debtPayments.push({ id: uid(), debtId: rec.debtId, date, amount: amt, recurringId: rec.id, occDate: date });
  });
  toast(rec.kind === 'saving' ? `Saved. Savings total is now ${fmt(C.savingsTotal(getState()))}` : 'Payment logged');
}

export function recurringEditForm(id) {
  const s = getState();
  const rec = s.recurring.find(r => r.id === id);
  if (!rec) return { html: `<main class="stack"><p>That item no longer exists.</p><a class="btn btn-outline" href="#/setup">Back</a></main>` };
  const today = C.todayStr();
  const next = K.occurrences(s, rec, today, C.addDays(today, 120)).slice(0, 4);
  const debt = rec.kind === 'debt' ? s.debts.find(d => d.id === rec.debtId) : null;
  const stopped = !!rec.endDate;

  const html = `<header class="form-hdr"><a href="#/setup" class="link">Cancel</a><h1>${rec.kind === 'saving' ? 'Recurring saving' : 'Recurring payment'}</h1><span></span></header>
  <main class="stack form">
    ${debt ? `<p class="muted">Extra payment to ${esc(debt.name)}.</p>` : ''}
    ${stopped ? `<div class="alert-amber">Stopped ${shortDate(rec.endDate, true)}. Past entries are kept.</div>` : ''}
    ${moneyField('amt', 'Amount', rec.amount, 'class="big-input"')}
    ${recurringPicker('', rec, false)}
    <div class="field"><label for="note">Name</label><input id="note" type="text" value="${esc(rec.note || '')}" placeholder="${rec.kind === 'saving' ? 'Emergency fund transfer' : 'Extra card payment'}"></div>
    ${next.length && !stopped ? `<div class="card soft stack-xs"><span class="strong small">Coming up</span>${next.map(d => `<span class="small">${shortDate(d, true)}</span>`).join('')}</div>` : ''}
    <span class="help">Changes apply from now on. Entries you've already logged don't change.</span>
    <button type="button" class="btn btn-primary" id="save">Save changes</button>
    ${stopped ? '' : `<button type="button" class="btn btn-danger" id="stop">Stop this</button>`}
  </main>`;

  function mount(root) {
    let picker;
    bindSegs(root, (n, v) => picker.onSeg(n, v));
    picker = bindRecurring(root);
    root.querySelector('#save').addEventListener('click', () => {
      const amount = parseMoney(root.querySelector('#amt').value);
      if (!amount || amount <= 0) return toast('Enter an amount');
      const sched = picker.read();
      if (sched.error) return toast(sched.error);
      const changesSchedule = sched.repeat !== rec.repeat || sched.dow !== rec.dow || sched.dom !== rec.dom;
      update(st => {
        const r = st.recurring.find(x => x.id === rec.id);
        if (changesSchedule && rec.startDate < today) {
          // Keep history on the old schedule; the new schedule starts today.
          r.endDate = today;
          st.recurring.push({ ...r, id: uid(), amount, note: root.querySelector('#note').value.trim(), ...sched, startDate: today, endDate: null });
        } else Object.assign(r, { amount, note: root.querySelector('#note').value.trim(), ...sched });
      });
      toast('Saved');
      go('/setup');
    });
    root.querySelector('#stop')?.addEventListener('click', () => {
      if (!confirm('Stop this recurring item? It won\'t show on the calendar from today on. Logged entries are kept.')) return;
      update(st => { st.recurring.find(x => x.id === rec.id).endDate = today; });
      toast('Stopped');
      go('/setup');
    });
  }
  return { hideNav: true, html, mount };
}

// For Setup: a list of active recurring items.
export function recurringListCard(s) {
  const items = (s.recurring || []).filter(r => !r.endDate);
  return `<section class="card">
    <h2 class="pad-bottom">Recurring savings & payments</h2>
    ${items.length ? items.map(r => `<a class="list-row" href="#/recurring/${r.id}">
      <span class="stack-2"><span class="strong">${esc(K.recurringLabel(s, r))}</span><span class="muted small">${K.scheduleText(r)}${r.kind === 'debt' ? ' · extra debt payment' : ' · savings'}</span></span>
      <span class="num strong">${fmt(r.amount, r.amount % 100 !== 0)}</span></a>`).join('')
      : `<p class="muted small">None yet. When you add to savings or log an extra debt payment, choose "Recurring" to plan it on the calendar.</p>`}
  </section>`;
}
