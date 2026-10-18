// views-savings.js — the Savings screen: total, history, add / take out, update from bank.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney } from './ui.js';
import { recurringPicker, bindRecurring, saveRecurring } from './views-recurring.js';

export function savingsScreen() {
  const s = getState();
  const today = C.todayStr();
  const det = C.savingsDetail(s);
  const mk = C.monthOf(today);
  const monthNet = C.savedBetween(s, `${mk}-01`, today);
  const weekNet = C.savedBetween(s, C.weekStart(today), today);

  const hero = `<section class="hero stack-sm">
    <span class="hero-label">Savings total</span>
    <span class="num hero-num">${fmt(det.total)}</span>
    <span class="hero-sub">This week ${weekNet >= 0 ? '+' : '−'}${fmt(Math.abs(weekNet))} · this month ${monthNet >= 0 ? '+' : '−'}${fmt(Math.abs(monthNet))}</span>
  </section>
  <div class="grid-2">
    <a class="btn btn-primary" href="#/saving-new?k=deposit">+ Add to savings</a>
    <a class="btn btn-outline" href="#/saving-new?k=withdrawal">− Take out</a>
  </div>`;

  const breakdown = det.counted ? `<div class="breakdown">
      <div class="row-between"><span>From your bank${det.asOf ? ` (${shortDate(C.todayStr(new Date(det.asOf)), true)})` : ''}</span><span class="num">${fmt(det.base, true)}</span></div>
      ${det.deposits ? `<div class="row-between"><span>+ Added since</span><span class="num">${fmt(det.deposits, true)}</span></div>` : ''}
      ${det.income ? `<div class="row-between"><span>+ Extra income to savings</span><span class="num">${fmt(det.income, true)}</span></div>` : ''}
      ${det.withdrawals ? `<div class="row-between"><span>− Taken out since</span><span class="num">${fmt(det.withdrawals, true)}</span></div>` : ''}
    </div>` : '';

  const entries = C.savingsEntries(s).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const history = `<section class="card">
    <h2>History</h2>
    ${entries.length ? entries.slice(0, 60).map(e => {
      const counted = C.isCounted(s, e);
      const href = e.source === 'income' ? `#/income/${e.id}` : `#/saving/${e.id}`;
      const label = e.note || (e.source === 'income' ? 'Extra income' : e.kind === 'withdrawal' ? 'Taken out' : 'Added to savings');
      return `<a class="list-row" href="${href}">
        <span class="stack-2"><span class="strong">${esc(label)}</span><span class="muted small">${shortDate(e.date, true)}${e.source === 'income' ? ' · Extra income' : ''}${counted ? '' : ' · already in bank balance'}</span></span>
        <span class="num strong${e.kind === 'withdrawal' ? ' warn-text' : ''}">${e.kind === 'withdrawal' ? '−' : '+'}${fmt(e.amount, true)}</span></a>`;
    }).join('') : `<p class="muted pad-top">Nothing logged yet. Use "Add to savings" whenever you move money into savings.</p>`}
  </section>`;

  const bank = `<section class="card stack-sm">
    <h2>Update from your bank</h2>
    ${breakdown}
    ${moneyField('bank', 'Savings balance your bank shows', 0)}
    <button type="button" class="btn btn-outline" id="setBank">Update total</button>
    <span class="help">Replaces the total with your bank's number. Everything logged up to now is treated as already included, and new entries add on from here.</span>
  </section>`;

  const html = `<header class="hdr"><a class="eyebrow back-link" href="#/home">‹ Dashboard</a><h1>Savings</h1></header>
    <main class="stack">${hero}${history}${bank}</main>`;

  function mount(root) {
    root.querySelector('#setBank').addEventListener('click', () => {
      const v = parseMoney(root.querySelector('#bank').value);
      if (v === null || v < 0) return toast('Enter your savings balance');
      update(st => { st.settings.savings = v; st.settings.savingsAsOf = new Date().toISOString(); });
      toast(`Savings total is now ${fmt(v)}`);
      go('/savings');
    });
  }
  return { tab: 'home', html, mount };
}

export function savingForm(id, query) {
  const s = getState();
  const existing = id ? (s.savingsLog || []).find(e => e.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That entry no longer exists.</p><a class="btn btn-outline" href="#/savings">Back</a></main>` };
  const e = existing || { date: C.todayStr(), amount: Number(query.get('a')) || 0, kind: query.get('k') === 'withdrawal' ? 'withdrawal' : 'deposit', note: '' };

  const html = `<header class="form-hdr"><a href="#/savings" class="link">Cancel</a><h1>${existing ? 'Edit entry' : e.kind === 'withdrawal' ? 'Take out' : 'Add to savings'}</h1><span></span></header>
  <main class="stack form">
    ${moneyField('amt', 'Amount', e.amount, 'class="big-input"')}
    <div class="field"><span class="label">Type</span>${seg('kind', [['deposit', 'Add to savings'], ['withdrawal', 'Take out']], e.kind, 'Entry type')}</div>
    ${existing ? '' : recurringPicker('Is this a one-time or recurring saving?')}
    <div class="grid-2">
      <div class="field" data-once><label for="date">Date</label><input id="date" type="date" value="${e.date}" max="${C.todayStr()}"></div>
      <div class="field"><label for="note">Note</label><input id="note" type="text" value="${esc(e.note)}" placeholder="${e.kind === 'withdrawal' ? 'Car repair' : 'Weekly transfer'}"></div>
    </div>
    <span class="help">Moving money into savings isn't spending, so it doesn't count against your category budgets.</span>
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Save'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Delete entry</button>` : ''}
  </main>`;

  function mount(root) {
    let picker = null;
    const val = bindSegs(root, (n, v) => {
      if (!picker) return;
      picker.onSeg(n, v);
      if (n === 'kind') picker.setToggleVisible(v === 'deposit');
    });
    if (!existing) {
      picker = bindRecurring(root);
      if (e.kind === 'withdrawal') picker.setToggleVisible(false);
    }
    if (!existing) setTimeout(() => root.querySelector('#amt').focus(), 50);
    root.querySelector('#save').addEventListener('click', () => {
      const amount = parseMoney(root.querySelector('#amt').value);
      const date = root.querySelector('#date').value;
      if (!amount || amount <= 0) return toast('Enter an amount');
      if (picker && picker.mode === 'recurring') {
        const sched = picker.read();
        if (sched.error) return toast(sched.error);
        saveRecurring({ kind: 'saving', amount, note: root.querySelector('#note').value.trim(), ...sched });
        return go('/calendar');
      }
      if (!date) return toast('Pick a date');
      const kind = val('kind');
      const fields = { date, amount, kind, note: root.querySelector('#note').value.trim() };
      update(st => {
        if (existing) Object.assign(st.savingsLog.find(x => x.id === existing.id), fields);
        else st.savingsLog.push({ id: uid(), ...fields, createdAt: new Date().toISOString() });
      });
      toast(`Savings total is now ${fmt(C.savingsTotal(getState()))}`);
      go('/savings');
    });
    root.querySelector('#del')?.addEventListener('click', () => {
      if (!confirm('Delete this entry? Your savings total will update.')) return;
      update(st => { st.savingsLog = st.savingsLog.filter(x => x.id !== existing.id); });
      toast('Deleted');
      go('/savings');
    });
  }
  return { hideNav: true, html, mount };
}
