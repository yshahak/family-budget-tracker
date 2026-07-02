/**
 * Backfill installment data onto already-saved transactions.
 *
 * Usage:
 *   node src/backfill-installments.mjs [--dry-run]
 *
 * Scrapes Isracard + Max from 2026-04-01, then for every transaction that
 * has installment info, finds the matching Firestore doc and writes the
 * installments field. Skips docs that already have it or don't exist.
 */
import { scrapeAll } from './scraper.mjs';
import { makeTxnId } from './dedup.mjs';
import { getDb } from './firestore.mjs';

const dryRun = process.argv.includes('--dry-run');
const startDate = new Date('2026-04-02'); // +02 avoids timezone-midnight issues

console.log(`[backfill-installments] startDate=${startDate.toISOString().slice(0, 10)} dryRun=${dryRun}`);

const results = await scrapeAll(startDate, { companies: ['isracard', 'max'], delayMs: 15_000 });

let checked = 0, updated = 0, skipped = 0;

for (const { owner, accountNumber, txns } of results) {
  const withInstallments = txns.filter(t => t.installments);
  console.log(`[backfill-installments] ${owner}/${accountNumber}: ${txns.length} txns, ${withInstallments.length} with installments`);

  for (const txn of withInstallments) {
    const id = makeTxnId(txn, accountNumber, owner);
    checked++;

    const ref = getDb().collection('budget_transactions').doc(id);
    const doc = await ref.get();

    if (!doc.exists) {
      console.log(`  SKIP (not in DB): ${txn.description} ${txn.date}`);
      skipped++;
      continue;
    }

    const existing = doc.data();
    if (existing.installments) {
      console.log(`  SKIP (already set): ${txn.description} — ${existing.installments.number}/${existing.installments.total}`);
      skipped++;
      continue;
    }

    console.log(`  ${dryRun ? 'DRY' : 'UPDATE'}: ${txn.description} ${txn.date} → ${txn.installments.number}/${txn.installments.total}`);
    if (!dryRun) {
      await ref.update({ installments: txn.installments });
    }
    updated++;
  }
}

console.log(`\n[backfill-installments] done — checked=${checked} updated=${updated} skipped=${skipped}${dryRun ? ' (dry run)' : ''}`);
process.exit(0);
