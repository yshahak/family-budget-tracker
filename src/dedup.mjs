import { createHash } from 'crypto';
import { getDb } from './firestore.mjs';

export function makeTxnId(txn, accountNumber, owner) {
  const key = `${txn.date}|${txn.identifier ?? txn.description}|${txn.chargedAmount}|${accountNumber}|${owner}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function filterNew(txns, accountNumber, owner) {
  const db = getDb();
  const results = [];
  for (const txn of txns) {
    const id = makeTxnId(txn, accountNumber, owner);
    const doc = await db.collection('budget_transactions').doc(id).get();
    if (!doc.exists) results.push({ ...txn, _id: id });
  }
  return results;
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

export async function updateTelegramMessageId(txnId, messageId) {
  await getDb().collection('budget_transactions').doc(txnId).update({ telegramMessageId: messageId });
}

export async function updateIgnored(txnId, ignored) {
  await getDb().collection('budget_transactions').doc(txnId).update({
    ignored: ignored ? true : false,
    updatedAt: new Date(),
  });
}
