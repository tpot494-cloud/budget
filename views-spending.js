// views-spending.js — the purchase log, category totals, and the add/edit purchase form.

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import { fmt, esc, monthLabel, dayHeading, pct, bar, go, toast, seg, bindSegs, moneyField, parseMoney, icon, monthNav } from './ui.js';

export function spendingTabs(active) {
  return `<div class="seg seg-nav" style="--n:2">
    <a href="#/spending"${active === 'purchases' ? ' aria-current="page"' : ''}>Purchases</a>
    <a href="#/bills"${active === 'bills' ? ' aria-current="page"' : ''}>Bills</a>
  </div>`;
}

export function purchases(query) {
  const s = getState();
  const today = C.todayStr();
  const mk = /^\d{4}-\d{2}$/.test(query.get('m') || '') ? query.get('m') : C.monthOf(today);
  const isCurrent = mk === C.monthOf(today);
  const budgets = C.budgetsTotal(s);
  const spent = C.flexibleSpent(s, mk);
  const left = budgets - spent;

  const summary = `<section class="card stack-sm">
    <span class="tile-label">Flexible spending</span>
    <div class="row-base"><span class="num big">${fmt(spent)}</span><span class="muted strong">of ${fmt(budgets)} budgeted</span></div>
    ${bar(pct(spent, budgets), 'thick' + (spent > budgets && budgets > 0 ? ' over' : ''))}
    <span class="muted small strong">${left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over`}${isCurrent ? ` · ${C.daysLeftInMonth(today)} days to go` : ''}</span>
  </section>`;

  const totals = C.categoryTotals(s, mk);
  const byCat = `<section class="card stack">
    <h2>By category</h2>
    ${totals.length ? totals.map(t => {
      const isOver = t.budget > 0 && t.spent > t.budget;
      return `<div class="stack-xs">
        <div class="row-between"><span class="strong">${esc(t.category.name)}${t.category.archived ? ' <span class="muted small">(archived)</span>' : ''}</span>
          <span class="num strong${isOver ? ' warn-text' : ''}">${fmt(t.spent)} <span class="${isOver ? '' : 'muted'}">/ ${fmt(t.budget)}</span></span></div>
        ${bar(t.budget > 0 ? pct(t.spent, t.budget) : (t.spent ? 100 : 0), isOver ? 'over' : '')}
        ${isOver ? `<span class="warn-text small strong">Over by ${fmt(t.spent - t.budget)}</span>` : ''}
      </div>`;
    }).join('') : `<p class="muted">No categories yet. Add some in Setup.</p>`}
  </section>`;

  const list = C.newestFirst(C.purchasesInMonth(s, mk));
  const catName = id => s.categories.find(c => c.id === id)?.name || 'Uncategorized';
  let lastDay = null;
  const rows = list.map(p => {
    const headDay = p.date !== lastDay ? `<h3 class="day">${dayHeading(p.date, today)}</h3>` : '';
    lastDay = p.date;
    return `${headDay}<a class="list-row" href="#/purchase/${p.id}">
      <span class="stack-2"><span class="strong">${esc(p.note || catName(p.categoryId))}</span><span class="muted small">${esc(catName(p.categoryId))} · ${p.paidWith === 'card' ? 'Card' : 'Debit'}</span></span>
      <span class="num strong">${fmt(p.amount, true)}</span></a>`;
  }).join('');
  const log = `<section class="card">
    <h2>Purchases</h2>
    ${rows || `<p class="muted pad-top">Nothing logged ${isCurrent ? 'yet this month' : 'this month'}. Tap + to add a purchase.</p>`}
  </section>`;

  return {
    tab: 'spending',
    html: `<header class="hdr">${monthNav(mk, monthLabel(mk), '/spending')}<h1>Spending</h1>${spendingTabs('purchases')}</header>
      <main class="stack">${summary}${byCat}${log}</main>
      <a class="fab" href="#/purchase/new" aria-label="Add purchase">${icon.plus}</a>`,
  };
}

export function purchaseForm(id) {
  const s = getState();
  const existing = id ? s.purchases.find(p => p.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That purchase no longer exists.</p><a class="btn btn-outline" href="#/spending">Back</a></main>` };

  const recent = C.recentCategoryIds(s);
  const active = s.categories.filter(c => !c.archived);
  const p = existing || {
    date: C.todayStr(), amount: 0, note: '',
    categoryId: recent[0] || active[0]?.id || '__new',
    paidWith: s.settings.lastPaidWith || 'debit',
  };
  // Keep an archived category selectable when editing an old purchase that uses it.
  const options = [...active];
  const cur = s.categories.find(c => c.id === p.categoryId);
  if (cur && cur.archived) options.push(cur);

  const html = `<header class="form-hdr"><a href="#/spending" class="link">Cancel</a><h1>${existing ? 'Edit purchase' : 'Add purchase'}</h1><span></span></header>
  <main class="stack form">
    ${moneyField('amt', 'Amount', p.amount, 'class="big-input"')}
    <div class="field">
      <label for="cat">Category</label>
      <div class="select"><select id="cat">
        ${options.map(c => `<option value="${c.id}"${c.id === p.categoryId ? ' selected' : ''}>${esc(c.name)}${c.archived ? ' (archived)' : ''}</option>`).join('')}
        <option value="__new"${p.categoryId === '__new' ? ' selected' : ''}>+ New category…</option>
      </select></div>
      ${recent.length > 1 ? `<div class="chips">${recent.map(cid => `<button type="button" class="chip" data-cat="${cid}">${esc(s.categories.find(c => c.id === cid).name)}</button>`).join('')}</div>` : ''}
      <div class="new-cat stack-sm" hidden>
        <div class="field"><label for="ncName">New category name</label><input id="ncName" type="text" placeholder="Coffee"></div>
        ${moneyField('ncBudget', 'Monthly budget (optional)', 0)}
      </div>
      <div class="budget-note" hidden></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="date">Date</label><input id="date" type="date" value="${p.date}"></div>
      <div class="field"><label for="note">Note</label><input id="note" type="text" value="${esc(p.note)}" placeholder="What was it?"></div>
    </div>
    <div class="field"><span class="label">Paid with</span>${seg('paid', [['debit', 'Debit'], ['card', 'Credit card']], p.paidWith, 'Paid with')}
      <span class="help">Credit card purchases will count toward the card's balance on the Debt screen.</span></div>
    ${existing ? '' : `<div class="check"><input id="repeat" type="checkbox"><label for="repeat"><span class="strong">This repeats every month</span><span class="muted small">Save it as a bill instead, so it rolls over automatically.</span></label></div>`}
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Save purchase'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Delete purchase</button>` : ''}
  </main>`;

  function mount(root) {
    const val = bindSegs(root);
    const $ = sel => root.querySelector(sel);
    const catSel = $('#cat');

    function refresh() {
      const isNew = catSel.value === '__new';
      $('.new-cat').hidden = !isNew;
      root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.cat === catSel.value));
      const note = $('.budget-note');
      const cat = s.categories.find(c => c.id === catSel.value);
      const amount = parseMoney($('#amt').value) || 0;
      const date = $('#date').value || C.todayStr();
      if (!cat || !cat.budget) { note.hidden = true; return; }
      const before = C.spentInCategory(s, cat.id, C.monthOf(date), existing?.id);
      const after = before + amount;
      if (after > cat.budget) {
        note.className = 'budget-note alert-warn';
        note.textContent = before > cat.budget
          ? `${cat.name} is already ${fmt(before - cat.budget)} over budget this month. This would make it ${fmt(after - cat.budget)} over.`
          : `This would put ${cat.name} ${fmt(after - cat.budget)} over its ${fmt(cat.budget)} budget.`;
      } else {
        note.className = 'budget-note muted small';
        note.textContent = `${fmt(cat.budget - after)} left in ${cat.name} this month after this.`;
      }
      note.hidden = false;
    }
    catSel.addEventListener('change', refresh);
    $('#amt').addEventListener('input', refresh);
    $('#date').addEventListener('change', refresh);
    root.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { catSel.value = c.dataset.cat; refresh(); }));
    refresh();
    if (!existing) setTimeout(() => $('#amt').focus(), 50);

    $('#save').addEventListener('click', () => {
      const amount = parseMoney($('#amt').value);
      const date = $('#date').value;
      if (!amount || amount <= 0) return toast('Enter an amount');
      if (!date) return toast('Pick a date');
      let categoryId = catSel.value;
      let newCat = null;
      if (categoryId === '__new') {
        const name = $('#ncName').value.trim();
        if (!name) return toast('Name the new category');
        if (s.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && !c.archived)) return toast('That category already exists');
        newCat = { id: uid(), name, budget: parseMoney($('#ncBudget').value) || 0, archived: false };
        categoryId = newCat.id;
      }
      const note = $('#note').value.trim();
      const paidWith = val('paid');

      if (!existing && $('#repeat')?.checked) {
        // Turn it into a bill, and mark this month's occurrence as already paid.
        const catNameNow = newCat ? newCat.name : s.categories.find(c => c.id === categoryId)?.name;
        const bill = { id: uid(), name: note || catNameNow || 'Bill', amount, dueDay: Number(date.slice(8, 10)), variable: false, startMonth: C.monthOf(date), endMonth: null };
        update(st => {
          if (newCat) st.categories.push(newCat);
          st.bills.push(bill);
          st.billPayments.push({ id: uid(), billId: bill.id, month: C.monthOf(date), amount, paidOn: date });
          st.settings.lastPaidWith = paidWith;
        });
        toast('Saved as a monthly bill');
        return go('/bills');
      }

      const entry = { id: existing ? existing.id : uid(), date, amount, categoryId, note, paidWith };
      update(st => {
        if (newCat) st.categories.push(newCat);
        if (existing) Object.assign(st.purchases.find(x => x.id === existing.id), entry);
        else st.purchases.push(entry);
        st.settings.lastPaidWith = paidWith;
      });
      toast(existing ? 'Saved' : 'Purchase saved');
      go('/spending' + (C.monthOf(date) !== C.monthOf(C.todayStr()) ? '?m=' + C.monthOf(date) : ''));
    });

    $('#del')?.addEventListener('click', () => {
      if (!confirm('Delete this purchase?')) return;
      update(st => { st.purchases = st.purchases.filter(x => x.id !== existing.id); });
      toast('Deleted');
      go('/spending');
    });
  }

  return { hideNav: true, html, mount };
}
