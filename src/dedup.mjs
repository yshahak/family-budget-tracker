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

export async function filterNewWithDb(txns, accountNumber, owner, db) {
  const col = db.collection('budget_transactions');
  const newTxns = [];
  const resolved = [];
  let pendingResolved = 0;
  const occurrenceByIndex = assignOccurrences(txns, accountNumber, owner);

  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i];
    const occurrence = occurrenceByIndex.get(i) ?? 0;
    const id = makeTxnId(txn, accountNumber, owner, occurrence);
    const pendingId = makePendingId(txn, accountNumber, owner, occurrence);

    const doc = await col.doc(id).get();
    if (doc.exists) continue; // already known

    if (pendingId !== id) {
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
        pendingResolved++;
        resolved.push({ id: pendingId, txn, previousCategorySource: pendingDoc.data()?.categorySource ?? null });
        continue;
      }
    }

    newTxns.push({ ...txn, _id: id });
  }

  return { newTxns, pendingResolved, resolved };
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
