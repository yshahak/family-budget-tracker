/**
 * One-time backfill: re-scrape Hapoalim (which now captures memo/beneficiary detail) and
 * patch `memo` onto already-saved Firestore transactions that predate that change.
 * Also re-runs categorization for any patched transaction whose category wasn't set
 * manually, since a memo-aware rule may now resolve it correctly.
 *
 * Usage: node src/backfill-memo.mjs [--dry-run]
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

if (!process.env.WEBHOOK_URL) process.env.WEBHOOK_URL = 'https://dummy.invalid';

const dryRun = process.argv.includes('--dry-run');

const { scrapeAll } = await import('./scraper.mjs');
const { makeTxnId } = await import('./dedup.mjs');
const { categorize } = await import('./categorizer.mjs');
const { getDb } = await import('./firestore.mjs');

const startDate = new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1);
console.log(`[backfill-memo] scraping Hapoalim from ${startDate.toISOString().slice(0, 10)}...`);
console.log('[backfill-memo] Opening browser — enter OTP via Telegram /otp command if prompted...');

const results = await scrapeAll(startDate, { companies: ['hapoalim'] });
const db = getDb();
const col = db.collection('budget_transactions');

let patched = 0, recategorized = 0, skippedNoMemo = 0, notFound = 0;

for (const { owner, accountNumber, txns } of results) {
  for (const txn of txns) {
    if (!txn.memo) { skippedNoMemo++; continue; }

    const id = makeTxnId(txn, accountNumber, owner);
    const doc = await col.doc(id).get();
    if (!doc.exists) { notFound++; continue; }

    const data = doc.data();
    if (data.memo) continue; // already has memo, nothing to do

    console.log(`[backfill-memo] ${dryRun ? '[dry-run] would patch' : 'patching'} ${id}: "${data.description}" memo="${txn.memo}"`);
    if (!dryRun) await doc.ref.update({ memo: txn.memo });
    patched++;

    if (data.categorySource !== 'manual') {
      const { category, source } = await categorize(data.description, txn.memo);
      if (category && category !== data.category) {
        console.log(`[backfill-memo]   re-categorized: ${data.category} -> ${category} (${source})`);
        if (!dryRun) await doc.ref.update({ category, categorySource: source });
        recategorized++;
      }
    }
  }
}

console.log(`[backfill-memo] done. patched=${patched} recategorized=${recategorized} skippedNoMemo=${skippedNoMemo} notFound=${notFound}`);
process.exit(0);
