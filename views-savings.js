// views-savings.js — Savings: accounts, buckets, history; add / take out / move;
// account setup (name, up to 4 named buckets, update from bank).

import { getState, update, uid } from './store.js';
import * as C from './calc.js';
import { fmt, esc, shortDate, go, toast, seg, bindSegs, moneyField, parseMoney, pct, icon } from './ui.js';
import { recurringPicker, bindRecurring, saveRecurring } from './views-recurring.js';

const MAX_BUCKETS = 4;

export function savingsScreen() {
  const s = getState();
  const today = C.todayStr();
  const det = C.savingsDetail(s);
  const mk = C.monthOf(today);
  const monthNet = C.savedBetween(s, `${mk}-01`, today);
  const weekNet = C.savedBetween(s, C.weekStart(today), today);
  const anyBuckets = det.accounts.some(d => d.buckets.length);

  const hero = `<section class="hero stack-sm">
    <span class="hero-label">Savings total${det.accounts.length > 1 ? ` · ${det.accounts.length} accounts` : ''}</span>
    <span class="num hero-num">${fmt(det.total)}</span>
    <span class="hero-sub">This week ${weekNet >= 0 ? '+' : '−'}${fmt(Math.abs(weekNet))} · this month ${monthNet >= 0 ? '+' : '−'}${fmt(Math.abs(monthNet))}</span>
  </section>
  <div class="grid-${anyBuckets ? 3 : 2}">
    <a class="btn btn-primary" href="#/saving-new?k=deposit">+ Add</a>
    <a class="btn btn-outline" href="#/saving-new?k=withdrawal">− Take out</a>
    ${anyBuckets ? `<a class="btn btn-outline" href="#/saving-new?k=move">Move</a>` : ''}
  </div>`;

  const cards = det.accounts.map(d => {
    const rows = d.buckets.map(b => `<div class="stack-xs">
        <div class="row-between"><span class="strong">${esc(b.name)}</span><span class="num strong${b.balance < 0 ? ' warn-text' : ''}">${fmt(b.balance)}</span></div>
        ${d.total > 0 ? `<div class="bar"><i style="width:${pct(Math.max(0, b.balance), d.total).toFixed(1)}%"></i></div>` : ''}
      </div>`).join('');
    const unassignedRow = d.buckets.length ? `<div class="stack-xs">
        <div class="row-between"><span class="strong muted">Unassigned</span><span class="num strong${d.unassigned < 0 ? ' warn-text' : ' muted'}">${fmt(d.unassigned)}</span></div>
        ${d.total > 0 ? `<div class="bar"><i style="width:${pct(Math.max(0, d.unassigned), d.total).toFixed(1)}%;background:#8FA39A"></i></div>` : ''}
      </div>` : '';
    const warn = d.unassigned < 0 ? `<div class="alert-warn small">Your buckets add up to ${fmt(-d.unassigned)} more than this account holds. Take that out of a bucket, or update the balance from your bank.</div>` : '';
    return `<section class="card stack">
      <div class="row-between"><h2>${esc(d.acct.name)}</h2><span class="num strong big-label">${fmt(d.total)}</span></div>
      ${rows}${unassignedRow}${warn}
      ${!d.buckets.length ? `<p class="help">No buckets yet. Split this account into up to 4 named buckets (like Emergency or Car), with the rest staying Unassigned.</p>` : ''}
      <a class="btn btn-outline" href="#/savings-account/${d.acct.id}">${d.buckets.length ? 'Edit account & buckets' : 'Set up buckets'} · update from bank</a>
    </section>`;
  }).join('');

  const entries = C.savingsEntries(s).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const multi = det.accounts.length > 1;
  const history = `<section class="card">
    <h2>History</h2>
    ${entries.length ? entries.slice(0, 60).map(e => {
      const acct = C.accountOf(s, e);
      const href = e.source === 'income' ? `#/income/${e.id}` : `#/saving/${e.id}`;
      const where = e.kind === 'move'
        ? `${esc(C.bucketName(acct, e.fromBucketId))} → ${esc(C.bucketName(acct, e.toBucketId))}`
        : `${multi ? esc(acct?.name || '') + ' · ' : ''}${acct?.buckets?.length ? esc(C.bucketName(acct, e.bucketId)) : ''}`;
      const label = e.note || (e.source === 'income' ? 'Extra income' : e.kind === 'withdrawal' ? 'Taken out' : e.kind === 'move' ? 'Moved between buckets' : 'Added to savings');
      const sub = [shortDate(e.date, true), where, e.source === 'income' ? 'Extra income' : '', C.isCounted(s, e) ? '' : 'already in bank balance'].filter(Boolean).join(' · ');
      const sign = e.kind === 'withdrawal' ? '−' : e.kind === 'move' ? '' : '+';
      return `<a class="list-row" href="${href}">
        <span class="stack-2"><span class="strong">${esc(label)}</span><span class="muted small">${sub}</span></span>
        <span class="num strong${e.kind === 'withdrawal' ? ' warn-text' : e.kind === 'move' ? ' muted' : ''}">${sign}${fmt(e.amount, true)}</span></a>`;
    }).join('') : `<p class="muted pad-top">Nothing logged yet. Use "Add" whenever you move money into savings.</p>`}
  </section>`;

  const html = `<header class="hdr"><a class="eyebrow back-link" href="#/home">‹ Dashboard</a><h1>Savings</h1></header>
    <main class="stack">${hero}${cards}
      <a class="btn btn-dashed" href="#/savings-account/new">+ Add a savings account</a>
      ${history}</main>`;
  return { tab: 'home', html };
}

// ---------- Account setup ----------

export function accountForm(id) {
  const s = getState();
  const isNew = id === 'new';
  const acct = isNew ? { name: '', balance: 0, asOf: null, buckets: [] } : C.accounts(s).find(a => a.id === id);
  if (!acct) return { html: `<main class="stack"><p>That account no longer exists.</p><a class="btn btn-outline" href="#/savings">Back</a></main>` };
  const d = isNew ? null : C.accountDetail(s, acct);
  const slots = [...acct.buckets];
  while (slots.length < MAX_BUCKETS) slots.push({ id: '', name: '' });

  const bankCard = isNew ? `${moneyField('bank', 'Current balance (from your bank)', 0)}` : `<section class="card stack-sm">
    <span class="tile-label">Account total</span>
    <span class="num big">${fmt(d.total, true)}</span>
    ${d.counted ? `<div class="breakdown">
      <div class="row-between"><span>From your bank${d.asOf ? ` (${shortDate(C.todayStr(new Date(d.asOf)), true)})` : ''}</span><span class="num">${fmt(d.base, true)}</span></div>
      ${d.deposits ? `<div class="row-between"><span>+ Added since</span><span class="num">${fmt(d.deposits, true)}</span></div>` : ''}
      ${d.income ? `<div class="row-between"><span>+ Extra income since</span><span class="num">${fmt(d.income, true)}</span></div>` : ''}
      ${d.withdrawals ? `<div class="row-between"><span>− Taken out since</span><span class="num">${fmt(d.withdrawals, true)}</span></div>` : ''}
    </div>` : ''}
    <h3 class="sub">Update from your bank</h3>
    ${moneyField('bank', 'Balance your bank shows', 0)}
    <button type="button" class="btn btn-outline" id="setBank">Update balance</button>
    <span class="help">Replaces the account total with your bank's number. Bucket amounts stay as they are; the difference lands in Unassigned.</span>
  </section>`;

  const bucketFields = slots.map((b, i) => {
    const bal = d && b.id ? d.buckets.find(x => x.id === b.id)?.balance || 0 : 0;
    return `<div class="field"><label for="bk${i}">Bucket ${i + 1}${bal ? ` <span class="muted">· holds ${fmt(bal)}</span>` : ''}</label>
      <input id="bk${i}" type="text" data-bid="${b.id}" data-bal="${bal}" value="${esc(b.name)}" placeholder="${['Emergency fund', 'Car repairs', 'Holidays', 'Travel'][i]}" maxlength="28"></div>`;
  }).join('');

  const canDelete = !isNew && C.accounts(s).length > 1;

  const html = `<header class="form-hdr"><a href="#/savings" class="link">Cancel</a><h1>${isNew ? 'New account' : 'Savings account'}</h1><span></span></header>
  <main class="stack form">
    <div class="field"><label for="name">Account name</label><input id="name" type="text" value="${esc(acct.name)}" placeholder="High-yield savings" maxlength="32"></div>
    ${bankCard}
    <section class="stack-sm">
      <h2>Buckets</h2>
      <p class="help">Up to 4 named buckets. Everything else in the account is Unassigned. Leave a name blank to not use that slot.</p>
      ${bucketFields}
      <div class="field"><span class="label">5th bucket</span><div class="fixed-bucket">Unassigned <span class="muted small">· always there, holds the rest</span></div></div>
    </section>
    <button type="button" class="btn btn-primary" id="save">${isNew ? 'Add account' : 'Save changes'}</button>
    ${canDelete ? `<button type="button" class="btn btn-danger" id="del">Remove account</button>` : ''}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    $('#setBank')?.addEventListener('click', () => {
      const v = parseMoney($('#bank').value);
      if (v === null || v < 0) return toast('Enter the balance your bank shows');
      update(st => Object.assign(st.savingsAccounts.find(a => a.id === acct.id), { balance: v, asOf: new Date().toISOString() }));
      toast(`${acct.name} is now ${fmt(v)}`);
      go(`/savings-account/${acct.id}`);
    });
    $('#save').addEventListener('click', () => {
      const name = $('#name').value.trim();
      if (!name) return toast('Name the account');
      if (C.accounts(s).some(a => a.id !== acct.id && a.name.toLowerCase() === name.toLowerCase())) return toast('You already have an account with that name');
      const inputs = [...root.querySelectorAll('[data-bid]')];
      const names = inputs.map(i => i.value.trim()).filter(Boolean);
      if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return toast('Bucket names must be different');
      if (names.some(n => n.toLowerCase() === 'unassigned')) return toast('"Unassigned" is the built-in bucket. Pick another name');
      const removed = inputs.filter(i => i.dataset.bid && !i.value.trim() && Number(i.dataset.bal));
      if (removed.length && !confirm(`Removing ${removed.length === 1 ? 'that bucket' : 'those buckets'} moves ${fmt(removed.reduce((t, i) => t + Number(i.dataset.bal), 0))} back to Unassigned. Continue?`)) return;
      const buckets = inputs.filter(i => i.value.trim()).map(i => ({ id: i.dataset.bid || uid(), name: i.value.trim() }));
      let balance = acct.balance;
      if (isNew) {
        balance = parseMoney($('#bank').value) || 0;
      }
      update(st => {
        if (isNew) st.savingsAccounts.push({ id: uid(), name, balance, asOf: new Date().toISOString(), buckets });
        else {
          Object.assign(st.savingsAccounts.find(a => a.id === acct.id), { name, buckets });
          // Goals pointed at a removed bucket fall back to the whole account.
          const ids = new Set(buckets.map(b => b.id));
          st.goals.forEach(g => { if (g.accountId === acct.id && g.bucketId && !ids.has(g.bucketId)) delete g.bucketId; });
        }
      });
      toast(isNew ? 'Account added' : 'Saved');
      go('/savings');
    });
    $('#del')?.addEventListener('click', () => {
      const used = C.savingsEntries(s).some(e => e.accountId === acct.id) || (s.recurring || []).some(r => r.kind === 'saving' && r.accountId === acct.id && !r.endDate);
      if (used || d.total !== 0) return alert('This account still has money or history. Take the money out (or move it to another account) and stop any recurring savings into it, then remove it.');
      if (!confirm(`Remove ${acct.name}?`)) return;
      update(st => {
        st.savingsAccounts = st.savingsAccounts.filter(a => a.id !== acct.id);
        st.goals.forEach(g => { if (g.accountId === acct.id) { delete g.accountId; delete g.bucketId; } });
      });
      toast('Account removed');
      go('/savings');
    });
  }
  return { hideNav: true, html, mount };
}

// ---------- Add / take out / move ----------

function accountOptions(s, selected) {
  return C.accounts(s).map(a => `<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
}
function bucketOptions(acct, selected) {
  return `<option value=""${!selected ? ' selected' : ''}>Unassigned</option>` +
    (acct?.buckets || []).map(b => `<option value="${b.id}"${b.id === selected ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
}

export function savingForm(id, query) {
  const s = getState();
  const existing = id ? (s.savingsLog || []).find(e => e.id === id) : null;
  if (id && !existing) return { html: `<main class="stack"><p>That entry no longer exists.</p><a class="btn btn-outline" href="#/savings">Back</a></main>` };
  const k = query.get('k');
  const e = existing || {
    date: C.todayStr(), amount: Number(query.get('a')) || 0, note: '',
    kind: k === 'withdrawal' ? 'withdrawal' : k === 'move' ? 'move' : 'deposit',
    accountId: query.get('acct') || C.accounts(s)[0]?.id, bucketId: query.get('b') || null,
  };
  const acct = C.accountOf(s, e);
  const multi = C.accounts(s).length > 1;
  const title = existing ? 'Edit entry' : e.kind === 'withdrawal' ? 'Take out' : e.kind === 'move' ? 'Move between buckets' : 'Add to savings';

  const html = `<header class="form-hdr"><a href="#/savings" class="link">Cancel</a><h1>${title}</h1><span></span></header>
  <main class="stack form">
    ${moneyField('amt', 'Amount', e.amount, 'class="big-input"')}
    <div class="field"><span class="label">Type</span>${seg('kind', [['deposit', 'Add'], ['withdrawal', 'Take out'], ['move', 'Move']], e.kind, 'Entry type')}</div>
    <div class="field"${multi ? '' : ' hidden'}><label for="acct">Account</label><div class="select"><select id="acct">${accountOptions(s, acct?.id)}</select></div></div>
    <div class="field" data-kind="single"><label for="bucket">Bucket</label><div class="select"><select id="bucket">${bucketOptions(acct, e.bucketId)}</select></div></div>
    <div class="grid-2" data-kind="move">
      <div class="field"><label for="from">From</label><div class="select"><select id="from">${bucketOptions(acct, e.fromBucketId)}</select></div></div>
      <div class="field"><label for="to">To</label><div class="select"><select id="to">${bucketOptions(acct, e.toBucketId || acct?.buckets?.[0]?.id)}</select></div></div>
    </div>
    ${existing ? '' : recurringPicker('Is this a one-time or recurring saving?')}
    <div class="grid-2">
      <div class="field" data-once><label for="date">Date</label><input id="date" type="date" value="${e.date}" max="${C.todayStr()}"></div>
      <div class="field"><label for="note">Note</label><input id="note" type="text" value="${esc(e.note)}" placeholder="${e.kind === 'withdrawal' ? 'Car repair' : e.kind === 'move' ? 'Rebalance' : 'Weekly transfer'}"></div>
    </div>
    <span class="help" id="kindHelp"></span>
    <button type="button" class="btn btn-primary" id="save">${existing ? 'Save changes' : 'Save'}</button>
    ${existing ? `<button type="button" class="btn btn-danger" id="del">Delete entry</button>` : ''}
  </main>`;

  function mount(root) {
    const $ = sel => root.querySelector(sel);
    let picker = null;
    let kind = e.kind;
    const HELP = {
      deposit: "Moving money into savings isn't spending, so it doesn't count against your category budgets.",
      withdrawal: 'Takes money out of the account and the bucket you pick.',
      move: "Shifts money between buckets in the same account. The account total doesn't change.",
    };
    const applyKind = () => {
      root.querySelectorAll('[data-kind="single"]').forEach(el => { el.hidden = kind === 'move' || !acctNow()?.buckets?.length; });
      root.querySelectorAll('[data-kind="move"]').forEach(el => { el.hidden = kind !== 'move'; });
      $('#kindHelp').textContent = HELP[kind];
      if (picker) picker.setToggleVisible(kind === 'deposit');
    };
    const acctNow = () => C.accounts(s).find(a => a.id === $('#acct').value);
    $('#acct').addEventListener('change', () => {
      const a = acctNow();
      $('#bucket').innerHTML = bucketOptions(a, null);
      $('#from').innerHTML = bucketOptions(a, null);
      $('#to').innerHTML = bucketOptions(a, a?.buckets?.[0]?.id);
      applyKind();
    });
    bindSegs(root, (n, v) => {
      if (n === 'kind') { kind = v; applyKind(); }
      else if (picker) picker.onSeg(n, v);
    });
    if (!existing) picker = bindRecurring(root);
    applyKind();
    if (!existing) setTimeout(() => $('#amt')?.focus(), 50);

    $('#save').addEventListener('click', () => {
      const amount = parseMoney($('#amt').value);
      const date = $('#date').value;
      if (!amount || amount <= 0) return toast('Enter an amount');
      const accountId = $('#acct').value;
      const a = acctNow();
      const bucketId = a?.buckets?.length ? ($('#bucket').value || null) : null;
      const note = $('#note').value.trim();
      if (kind === 'move') {
        if (!a?.buckets?.length) return toast('Set up buckets on this account first');
        if ($('#from').value === $('#to').value) return toast('Pick two different buckets');
      }
      if (picker && picker.mode === 'recurring' && kind === 'deposit') {
        const sched = picker.read();
        if (sched.error) return toast(sched.error);
        saveRecurring({ kind: 'saving', amount, note, accountId, bucketId, ...sched });
        return go('/calendar');
      }
      if (!date) return toast('Pick a date');
      const fields = kind === 'move'
        ? { date, amount, kind, note, accountId, fromBucketId: $('#from').value || null, toBucketId: $('#to').value || null, bucketId: null }
        : { date, amount, kind, note, accountId, bucketId, fromBucketId: undefined, toBucketId: undefined };
      update(st => {
        if (existing) Object.assign(st.savingsLog.find(x => x.id === existing.id), fields);
        else st.savingsLog.push({ id: uid(), ...fields, createdAt: new Date().toISOString() });
      });
      toast(kind === 'move' ? 'Moved' : `Savings total is now ${fmt(C.savingsTotal(getState()))}`);
      go('/savings');
    });
    $('#del')?.addEventListener('click', () => {
      if (!confirm('Delete this entry? Your savings total will update.')) return;
      update(st => { st.savingsLog = st.savingsLog.filter(x => x.id !== existing.id); });
      toast('Deleted');
      go('/savings');
    });
  }
  return { hideNav: true, html, mount };
}

export { accountOptions, bucketOptions };
