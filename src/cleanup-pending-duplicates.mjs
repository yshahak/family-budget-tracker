/**
 * One-time cleanup script: removes duplicate pending transactions that have been
 * superseded by a completed entry.
 *
 * Usage:
 *   node src/cleanup-pending-duplicates.mjs [--dry-run]
 */

import './config.mjs';
import { getDb } from './firestore.mjs';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[cleanup-pending-duplicates] Starting${dryRun ? ' (DRY RUN)' : ''}...`);

  const db = getDb();
  const snapshot = await db.collection('budget_transactions').get();
  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`[cleanup-pending-duplicates] Loaded ${docs.length} documents`);

  // Group by date|description|chargedAmount|accountNumber|owner
  const groups = new Map();
  for (const doc of docs) {
    const key = `${doc.date}|${doc.description}|${doc.chargedAmount}|${doc.accountNumber}|${doc.owner}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }

  let deletedCount = 0;
  const toDelete = [];

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const hasPending = group.some(d => d.status === 'pending');
    const hasCompleted = group.some(d => d.status === 'completed');

    if (hasPending && hasCompleted) {
      const pendingDocs = group.filter(d => d.status === 'pending');
      for (const doc of pendingDocs) {
        toDelete.push(doc);
        console.log(`[cleanup-pending-duplicates] ${dryRun ? '[DRY RUN] Would delete' : 'Deleting'} pending doc ${doc.id} — ${key}`);
      }
    }
  }

  if (toDelete.length === 0) {
    console.log('[cleanup-pending-duplicates] No pending duplicates found.');
  } else if (!dryRun) {
    for (const doc of toDelete) {
      await db.collection('budget_transactions').doc(doc.id).delete();
      deletedCount++;
    }
  } else {
    deletedCount = toDelete.length;
  }

  console.log(`[cleanup-pending-duplicates] Done. ${dryRun ? 'Would delete' : 'Deleted'} ${deletedCount} pending duplicate(s).`);
}

main().catch(err => {
  console.error('[cleanup-pending-duplicates] Fatal error:', err.message);
  process.exit(1);
});
