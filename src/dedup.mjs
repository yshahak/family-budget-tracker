import { createHash } from 'crypto';
import { getDb } from './firestore.mjs';

// occurrence=0 must produce the exact same id as before this param existed, so every
// previously-unique transaction keeps its id. Only same-day/-amount siblings that hash
// identically (e.g. several standing orders to the same counterparty reference) get a suffix.
export function makeTxnId(txn, accountNumber, owner, occurrence = 0) {
  const base = `${txn.date}|${txn.identifier ?? txn.description}|${txn.chargedAmount}|${accountNumber}|${owner}`;
  return createHash('sha256').update(occurrence > 0 ? `${base}|${occurrence}` : base).digest('hex').slice(0, 16);
}

export function makePendingId(txn, accountNumber, owner, occurrence = 0) {
  const base = `${txn.date}|${txn.description}|${txn.chargedAmount}|${accountNumber}|${owner}`;
  return createHash('sha256').update(occurrence > 0 ? `${base}|${occurrence}` : base).digest('hex').slice(0, 16);
}

function groupKey(txn, accountNumber, owner) {
  return `${txn.date}|${txn.identifier ?? txn.description}|${txn.chargedAmount}|${accountNumber}|${owner}`;
}

// Some banks (Hapoalim standing orders in particular) reuse the same reference number for
// several distinct recurring payments (e.g. multiple kids' accounts at the same institution),
// so date+identifier+amount alone doesn't uniquely identify a transaction. Disambiguate same-day
// siblings by their ledger position (rawTransaction.recordNumber, descending — higher means
// created earlier), which stays stable relative to its siblings across repeated scrapes even as
// its absolute value shifts as newer transactions accumulate. Falls back to scrape order.
function assignOccurrences(txns, accountNumber, owner) {
  const groups = new Map();
  txns.forEach((txn, index) => {
    const key = groupKey(txn, accountNumber, owner);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ txn, index });
  });

  const occurrenceByIndex = new Map();
  for (const entries of groups.values()) {
    if (entries.length <= 1) continue;
    const sorted = [...entries].sort((a, b) =>
      (b.txn.rawTransaction?.recordNumber ?? 0) - (a.txn.rawTransaction?.recordNumber ?? 0)
    );
    sorted.forEach((entry, occurrence) => occurrenceByIndex.set(entry.index, occurrence));
  }
  return occurrenceByIndex;
}

// Siblings that share a bank reference number can settle across different scrape runs
// rather than all in one batch, so the occurrence index computed from the current batch
// alone can't be trusted to reproduce the one used when the pending doc was created.
// Probe a range of occurrence values instead — which slot we land on doesn't matter since
// the memo that arrives on settlement (not the occurrence index) is what disambiguates
// the sibling; we just need to claim *some* unclaimed matching pending doc.
const MAX_OCCURRENCE_PROBE = 10;

// Securities purchase orders ("ני"ע-קניה") can settle days later as a net debit
// ("ני"ע-קניה-נט") for a different amount — price moves between order and settlement — and
// several gross legs sometimes net into one settlement, so exact date/amount/description
// matching never resolves them (unlike standing orders, whose amount/description are stable).
// The bank reference number (identifier) is known even at order time for these, though, so
// once a completed transaction with that identifier arrives, any still-pending legs placed
// shortly before it are superseded and can be dropped rather than double-counted forever.
const IDENTIFIER_SETTLEMENT_WINDOW_DAYS = 5;

async function supersedeStalePendingByIdentifier(col, txn, accountNumber, owner) {
  if (!txn.identifier) return 0;
  const snap = await col
    .where('status', '==', 'pending')
    .where('identifier', '==', txn.identifier)
    .where('accountNumber', '==', accountNumber)
    .where('owner', '==', owner)
    .get();

  let superseded = 0;
  for (const doc of snap.docs) {
    const pendingDate = doc.data().date;
    if (!pendingDate) continue;
    const diffDays = (new Date(txn.date) - new Date(pendingDate)) / 86400000;
    if (diffDays >= 0 && diffDays <= IDENTIFIER_SETTLEMENT_WINDOW_DAYS) {
      await doc.ref.delete();
      superseded++;
    }
  }
  return superseded;
}

export async function filterNewWithDb(txns, accountNumber, owner, db) {
  const col = db.collection('budget_transactions');
  const newTxns = [];
  const resolved = [];
  let pendingResolved = 0;
  const occurrenceByIndex = assignOccurrences(txns, accountNumber, owner);
  const claimedPendingIds = new Set();

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    const occurrence = occurrenceByIndex.get(i) ?? 0;
    const id = makeTxnId(txn, accountNumber, owner, occurrence);

    const doc = await col.doc(id).get();
    if (doc.exists) continue; // already known

    let resolvedPending = false;
    for (let probe = 0; probe <= MAX_OCCURRENCE_PROBE; probe++) {
      const pendingId = makePendingId(txn, accountNumber, owner, probe);
      if (claimedPendingIds.has(pendingId)) continue;
      const pendingDoc = await col.doc(pendingId).get();
      if (pendingDoc.exists && pendingDoc.data()?.status === 'pending') {
        // Resolve pending → completed. Memo/identifier only become available from the
        // bank once a transaction settles, so this is the first point they can be saved.
        await col.doc(pendingId).update({
          status: 'completed',
          identifier: txn.identifier,
          memo: txn.memo ?? null,
          resolvedAt: new Date(),
        });
        claimedPendingIds.add(pendingId);
        pendingResolved++;
        resolved.push({ id: pendingId, txn, previousCategorySource: pendingDoc.data()?.categorySource ?? null });
        resolvedPending = true;
        break;
      }
    }
    if (resolvedPending) continue;

    pendingResolved += await supersedeStalePendingByIdentifier(col, txn, accountNumber, owner);
    newTxns.push({ ...txn, _id: id });
  }

  return { newTxns, pendingResolved, resolved };
}

// A pending doc whose transaction no longer shows up as pending in a fresh scrape has settled
// (usually as a completed doc with a different date/description/amount, so the exact-match
// resolution above never claimed it) or was cancelled — either way it must not keep counting
// next to its completed twin. Only trusts a scrape that actually covers the pending doc's date
// (>= startDate) and ignores docs younger than a day, to avoid racing the bank's own lag.
const STALE_PENDING_MIN_AGE_MS = 24 * 3600 * 1000;

export async function purgeStalePending(txns, accountNumber, owner, startDate, db = getDb()) {
  const livePending = new Set(
    txns.filter(t => t.status === 'pending').map(t => `${t.date}|${t.description}|${t.chargedAmount}`)
  );
  const snap = await db.collection('budget_transactions')
    .where('status', '==', 'pending')
    .where('accountNumber', '==', accountNumber)
    .where('owner', '==', owner)
    .get();

  const purged = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.date || new Date(d.date) < startDate) continue;
    const created = d.createdAt?.toDate?.() ?? new Date(d.createdAt);
    if (Date.now() - created.getTime() < STALE_PENDING_MIN_AGE_MS) continue;
    if (livePending.has(`${d.date}|${d.description}|${d.chargedAmount}`)) continue;
    await doc.ref.delete();
    purged.push({ id: doc.id, date: d.date, description: d.description, chargedAmount: d.chargedAmount });
  }
  return purged;
}

export async function filterNew(txns, accountNumber, owner) {
  const db = getDb();
  return filterNewWithDb(txns, accountNumber, owner, db);
}

export async function saveTxn(txn, accountNumber, owner, category, categorySource, telegramMessageId = null) {
  const id = txn._id ?? makeTxnId(txn, accountNumber, owner);
  await getDb().collection('budget_transactions').doc(id).set({
    id,
    date: txn.date,
    processedDate: txn.processedDate,
    description: txn.description,
    chargedAmount: txn.chargedAmount,
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    accountNumber,
    owner,
    status: txn.status,
    type: txn.type,
    identifier: txn.identifier ?? null,
    memo: txn.memo ?? null,
    installments: txn.installments ?? null,
    category: category ?? null,
    categorySource: categorySource ?? null,
    telegramMessageId,
    createdAt: new Date(),
  });
  return id;
}

export async function updateCategory(txnId, category) {
  await getDb().collection('budget_transactions').doc(txnId).update({
    category,
    categorySource: 'manual',
    updatedAt: new Date(),
  });
}

export async function updateCategoryAuto(txnId, category, source) {
  await getDb().collection('budget_transactions').doc(txnId).update({
    category,
    categorySource: source,
    updatedAt: new Date(),
  });
}

export async function updateTelegramMessageId(txnId, messageId) {
  await getDb().collection('budget_transactions').doc(txnId).update({ telegramMessageId: messageId });
}

export async function updateIgnored(txnId, ignored) {
  await getDb().collection('budget_transactions').doc(txnId).update({
    ignored: ignored ? true : false,
    updatedAt: new Date(),
  });
}
