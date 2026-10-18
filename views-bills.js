// views-bills.js — monthly bills: mark paid, roll over, add/edit.
// Bills are templates. A month's paid/unpaid list is built from the templates plus
// that month's payments, so a new month "rolls over" automatically: no copying.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import { fmt, esc, monthLabel, shortDate, pct, bar, go, toast, moneyField, parseMoney, icon, monthNav } from './ui.js';
import { spendingTabs } from './views-spending.js';

export function bills(query) {
  const s = getState();
  const today = C.todayStr();
  const mk = /^\d{4}-\d{2}$/.test(query.get('m') || '') ? query.get('m') : C.monthOf(today);
  const isCurrent = mk === C.monthOf(today);
  const status = C.billStatus(s, mk);
  const total = C.billsTotal(s, mk);
  const paid = C.billsPaidTotal(s, mk);
  const unpaid = status.filter(x => !x.paid);
  const done = status.filter(x => x.paid);

  const dueText = st => {
    if (!isCurrent) return `Due ${shortDate(st.due)}`;
    const d = C.daysBetween(today, st.due);
    if (d < 0) return `<span class="warn-text strong">Overdue · was due ${shortDate(st.due)}</span>`;
    if (d === 0) return `<span class="warn-text strong">Due today</span>`;
    if (d === 1) return `<span class="warn-text strong">Due tomorrow · ${shortDate(st.due)}</span>`;
    return `Due ${shortDate(st.due)}`;
  };

  const summary = `<section class="card stack-sm">
    <span class="tile-label">${monthLabel(mk).split(' ')[0]} bills paid</span>
    <div class="row-base"><span class="num big">${fmt(paid)}</span><span class="muted strong">of ${fmt(total)}</span></div>
    ${bar(pct(paid, total), 'thick')}
    <span class="muted small strong">${unpaid.length ? `${unpaid.length} left · ${fmt(unpaid.reduce((t, x) => t + x.bill.amount, 0))} still due` : status.length ? 'All paid' : 'No bills yet'}</span>
  </section>`;

  const upNext = unpaid.length ? `<section class="card">
    <h2>Up next</h2>
    ${unpaid.map(st => `<div class="list-row">
      <a class="stack-2 grow plain" href="#/bill/${st.bill.id}"><span class="strong">${esc(st.bill.name)}</span><span class="muted small">${dueText(st)}${st.bill.variable ? ' · amount varies' : ''}</span></a>
      <span class="row-gap"><span class="num strong">${st.bill.variable ? '~' : ''}${fmt(st.bill.amount)}</span>
      <button type="button" class="btn-small" data-pay="${st.bill.id}">Mark paid</button></span>
    </div>`).join('')}
  </section>` : '';

  const paidList = done.length ? `<section class="card">
    <h2>Paid</h2>
    ${done.map(st => `<button type="button" class="list-row plain-btn" data-unpay="${st.payment.id}">
      ${icon.check}
      <span class="stack-2 grow"><span class="strong">${esc(st.bill.name)}</span><span class="muted small">Paid ${shortDate(st.payment.paidOn)}</span></span>
      <span class="num strong">${fmt(st.payment.amount, st.payment.amount % 100 !== 0)}</span>
    </button>`).join('')}
  </section>` : '';

  const nextMk = C.shiftMonth(mk, 1);
  const rollover = isCurrent && status.length ? `<section class="card soft stack-sm">
    <div class="row-gap">${icon.roll}<h2>${monthLabel(nextMk).split(' ')[0]} starts ${shortDate(nextMk + '-01')}</h2></div>
    <p class="small">All ${C.billsForMonth(s, nextMk).length} bills roll over with the same amounts and due dates, marked unpaid. Change any that are different before then.</p>
    <a class="btn btn-outline" href="#/bills?m=${nextMk}">Preview ${monthLabel(nextMk).split(' ')[0]}</a>
  </section>` : '';

  const empty = !status.length ? `<section class="card stack-sm"><p class="muted">Add the bills you pay every month: rent, car payment, phone, card minimums. They'll roll over to each new month on their own.</p></section>` : '';

  const html = `<header class="hdr">${monthNav(mk, monthLabel(mk), '/bills')}<h1>Spending</h1>${spendingTabs('bills')}</header>
    <main class="stack">${summary}${empty}${upNext}${paidList}${rollover}
    <a class="btn btn-dashed" href="#/bill/new">+ Add bill</a></main>`;

  function mount(root) {
    root.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
      const bill = s.bills.find(x => x.id === b.dataset.pay);
      // Variable bills and debt payments ask for the real amount (debt payments may include extra).
      if (bill.variable || s.debts.some(d => d.billId === bill.id)) return go(`/pay/${bill.id}?m=${mk}`);
      const paidOn = isCurrent ? today : C.dueDate(bill, mk);
      update(st => st.billPayments.push({ id: uid(), billId: bill.id, month: mk, amount: bill.amount, paidOn }));
      toast(`${bill.name} marked paid`);
      go(`/bills?m=${mk}`);
    }));
    root.querySelectorAll('[data-unpay]').forEach(b => b.addEventListener('click', () => {
      const pay = s.billPayments.find(x => x.id === b.dataset.unpay);
      const bill = s.bills.find(x => x.id === pay.billId);
      if (!confirm(`Mark ${bill.name} as unpaid for ${monthLabel(mk)}?`)) return;
      update(st => { st.billPayments = st.billPayments.filter(x => x.id !== pay.id); });
      go(`/bills?m=${mk}`);
    }));
  }

  return { tab: 'spending', html, mount };
}

export function payForm(billId, query) {
  const s = getState();
  const bill = s.bills.find(b => b.id === billId);
  if (!bill) return { html: `<main class="stack"><p>That bill no longer exists.</p><a class="btn btn-outline" href="#/bills">Back</a></main>` };
  const today = C.todayStr();
  const mk = query.get('m') || C.monthOf(today);
  const date = mk === C.monthOf(today) ? today : C.dueDate(bill, mk);

  const html = `<header class="form-hdr"><a href="#/bills?m=${mk}" class="link">Cancel</a><h1>Mark paid</h1><span></span></header>
  <main class="stack form">
    <p class="muted">${esc(bill.name)} · ${monthLabel(mk)}. Enter what you actually paid${s.debts.some(d => d.billId === bill.id) ? ', including anything extra. It comes off the debt\'s balance' : ''}.</p>
    ${moneyField('amt', 'Amount paid', bill.amount, 'class="big-input"')}
    <div class="field"><label for="date">Paid on</label><input id="date" type="date" value="${date}"></div>
    <button type="button" class="btn btn-primary" id="save">Mark paid</button>
  </main>`;

  function mount(root) {
    root.querySelector('#save').addEventListener('click', () => {
      const amount = parseMoney(root.querySelector('#amt').value);
      const paidOn = root.querySelector('#date').value;
      if (amount === null || amount < 0) return toast('Enter an amount');
      if (!paidOn) return toast('Pick a date');
      update(st => st.billPayments.push({ id: uid(), billId: bill.id, month: mk, amount, paidOn }));
      toast(`${bill.name} marked paid`);
      go(`/bills?m=${mk}`);
    });
  }
  return { hideNav: true, html, mount };
}

export function billForm(id) {
  const s = getState();
  const existing = id ? s.bills.find(b => b.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That bill no longer exists.</p><a class="btn btn-outline" href="#/bills">Back</a></main>` };
  const b = existing || { name: '', amount: 0, dueDay: 1, variable: false };

  const html = `<header class="form-hdr"><a href="#/bills" class="link">Cancel</a><h1>${existing ? 'Edit bill' : 'New bill'}</h1><span></span></header>
  <main class="stack form">
    <div class="field"><label for="name">Name</label><input id="name" type="text" value="${esc(b.name)}" placeholder="Car payment"></div>
    ${moneyField('amt', b.variable ? 'Usual amount' : 'Amount', b.amount)}
    <div class="field"><label for="due">Due day of the month</label><input id="due" type="number" inputmode="numeric" min="1" max="31" value="${b.dueDay}">
      <span class="help">If a month is shorter, it's due on the last day.</span></div>
    <div class="check"><input id="var" type="checkbox"${b.variable ? ' checked' : ''}><label for="var"><span class="strong">The amount changes month to month</span><span class="muted small">You'll enter the real amount when you mark it paid (utilities, for example).</span></label></div>
    ${existing ? `<p class="help">Changes apply to this month and every month after. Months already paid keep what you actually paid.</p>` : ''}
    ${existing && s.debts.some(d => d.billId === existing.id) ? `<p class="help">This is the monthly payment for ${esc(s.debts.find(d => d.billId === existing.id).name)}. Its amount is that debt's minimum.</p>` : ''}
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Add bill'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Stop this bill</button>` : ''}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    $('#save').addEventListener('click', () => {
      const name = $('#name').value.trim();
      const amount = parseMoney($('#amt').value);
      const dueDay = Math.round(Number($('#due').value));
      if (!name) return toast('Give the bill a name');
      if (amount === null || amount <= 0) return toast('Enter an amount');
      if (!(dueDay >= 1 && dueDay <= 31)) return toast('Due day must be 1–31');
      const variable = $('#var').checked;
      update(st => {
        if (existing) Object.assign(st.bills.find(x => x.id === existing.id), { name, amount, dueDay, variable });
        else st.bills.push({ id: uid(), name, amount, dueDay, variable, startMonth: C.monthOf(C.todayStr()), endMonth: null });
      });
      toast(existing ? 'Saved' : 'Bill added');
      go('/bills');
    });
    $('#del')?.addEventListener('click', () => {
      const mk = C.monthOf(C.todayStr());
      const paidThisMonth = s.billPayments.some(p => p.billId === existing.id && p.month === mk);
      // Ending it keeps past months' history intact; a paid bill stays in this month.
      if (!confirm(`Stop ${existing.name}? It won't appear in future months. Past months keep their history.`)) return;
      update(st => { st.bills.find(x => x.id === existing.id).endMonth = paidThisMonth ? C.shiftMonth(mk, 1) : mk; });
      toast('Bill stopped');
      go('/bills');
    });
  }
  return { hideNav: true, html, mount };
}
