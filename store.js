// store.js — where the app's data lives (on this phone only) and how it's saved,
// backed up and restored. All money is stored as whole cents (integers) so
// totals never pick up floating-point rounding errors like 0.1 + 0.2.

const KEY = 'budget-app-data';
export const SCHEMA = 1;

export function emptyState() {
  return {
    schema: SCHEMA,
    settings: {
      pay: 0,                 // take-home pay per paycheck, in cents
      payFrequency: 'monthly', // 'weekly' | 'biweekly' | 'semimonthly' (1st & 15th) | 'monthly'
      nextPayday: null,       // 'YYYY-MM-DD'; anchors the payday schedule on the calendar
      savings: 0,             // savings balance from the bank, in cents (see savingsAsOf)
      savingsAsOf: null,      // when that balance was entered (ISO timestamp); null = from the start
      lastBackupAt: null,     // ISO timestamp of the last export
      lastPaidWith: 'debit',  // remembered for the add-purchase form
      debtPlan: { amount: 0, freq: 'weekly', strategy: 'rate', focusId: null, lumpAmount: 0, lumpDate: '' },
    },
    categories: [
      { id: uid(), name: 'Groceries', budget: 0, archived: false },
      { id: uid(), name: 'Dining out', budget: 0, archived: false },
      { id: uid(), name: 'Gas', budget: 0, archived: false },
      { id: uid(), name: 'Gifts', budget: 0, archived: false },
      { id: uid(), name: 'Fun', budget: 0, archived: false },
    ],
    bills: [],        // { id, name, amount, dueDay, variable, startMonth, endMonth|null }
    billPayments: [], // { id, billId, month:'YYYY-MM', amount, paidOn:'YYYY-MM-DD' }
    purchases: [],    // { id, date, amount, categoryId, note, paidWith:'debit'|'card' }
    incomes: [],      // { id, date, amount, source:'bonus'|'sale'|'other', note, allocation:'savings'|'spending' }
    goals: [],        // { id, name, target, targetDate }
    debts: [],        // { id, name, type, balance (from statement), asOf, apr (%), minPayment, billId }
    debtPayments: [], // extra payments beyond the monthly bill: { id, debtId, date, amount }
    savingsLog: [],   // money moved in or out of savings: { id, date, amount, kind:'deposit'|'withdrawal', note, createdAt, recurringId?, occDate? }
    recurring: [],    // planned repeats: { id, kind:'saving'|'debt', debtId?, amount, repeat:'payday'|'weekly'|'monthly', dow, dom, note, startDate, endDate|null }
  };
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

let state = null;

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  if (!raw) { state = emptyState(); return state; }
  try {
    state = migrate(JSON.parse(raw));
  } catch (e) {
    // Never silently throw away data we can't read: keep a copy before starting fresh.
    try { localStorage.setItem(KEY + '-unreadable-' + Date.now(), raw); } catch (e2) {}
    state = emptyState();
  }
  return state;
}

export function getState() { return state; }

// Every change goes through update() so it's saved immediately.
export function update(fn) {
  fn(state);
  return save();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('Could not save on this phone (storage may be full). Export a backup now.');
    return false;
  }
}

// Brings data saved by an older version up to the current shape.
export function migrate(data) {
  if (!data || typeof data !== 'object') throw new Error('Not app data');
  const base = emptyState();
  const out = { ...base, ...data };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  out.settings.debtPlan = { ...base.settings.debtPlan, ...((data.settings || {}).debtPlan || {}) };
  for (const k of ['categories', 'bills', 'billPayments', 'purchases', 'incomes', 'goals', 'debts', 'debtPayments', 'savingsLog', 'recurring']) {
    out[k] = Array.isArray(data[k]) ? data[k] : [];
  }
  // Data from before v1.2: the savings number already includes everything up to now,
  // including extra income that was added to it, so start counting new entries from now.
  if (!('savingsAsOf' in (data.settings || {}))) {
    out.settings.savingsAsOf = new Date().toISOString();
    out.incomes = out.incomes.map(i => (i.allocation === 'savings' ? { ...i, inBalance: true } : i));
  }
  // A backup with no categories key at all keeps the defaults; an empty list stays empty.
  if (!('categories' in data)) out.categories = base.categories;
  out.schema = SCHEMA;
  return out;
}

// ---------- Backup ----------

// Uses the phone's share sheet when it can (Save to Files on iPhone; Drive, email
// or Files on Android). Falls back to a normal download. Returns how it was saved.
export async function exportBackup({ forceDownload = false } = {}) {
  const stamp = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = `budget-backup-${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}.json`;
  const payload = { app: 'budget-app', exportedAt: stamp.toISOString(), data: { ...state, settings: { ...state.settings, lastBackupAt: stamp.toISOString() } } };
  const text = JSON.stringify(payload, null, 2);

  if (!forceDownload && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Budget backup' });
        markBackedUp(stamp);
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // Any other share failure: fall through to a download.
      }
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  markBackedUp(stamp);
  return 'downloaded';
}

function markBackedUp(stamp) {
  state.settings.lastBackupAt = stamp.toISOString();
  save();
}

// Returns a short summary for the confirm prompt, or throws if the file isn't a backup.
export function readBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error("That file isn't a backup from this app."); }
  if (!parsed || parsed.app !== 'budget-app' || !parsed.data) throw new Error("That file isn't a backup from this app.");
  const data = migrate(parsed.data);
  return {
    data,
    exportedAt: parsed.exportedAt,
    counts: { purchases: data.purchases.length, bills: data.bills.length, categories: data.categories.length },
  };
}

export function replaceAll(data) {
  state = migrate(data);
  return save();
}

export function eraseAll() {
  state = emptyState();
  return save();
}
