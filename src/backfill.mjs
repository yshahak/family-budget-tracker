/**
 * Backfill transactions from a specific month.
 *
 * Usage:
 *   node src/backfill.mjs --month=2026-03
 *   node src/backfill.mjs --month=2026-03 --companies=isracard,max
 *
 * Fetches all transactions from the first of the given month onwards.
 * Dedup is handled automatically — already-saved transactions are skipped.
 * Hapoalim requires a valid session in Firestore; run scrape-hapoalim-local.mjs first if needed.
 */
import { runPipeline } from './pipeline.mjs';

const monthArg = process.argv.find(a => a.startsWith('--month='))?.split('=')[1];
const companiesArg = process.argv.find(a => a.startsWith('--companies='))?.split('=')[1];

if (!monthArg || !/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error('Usage: node src/backfill.mjs --month=YYYY-MM [--companies=isracard,max,hapoalim]');
  process.exit(1);
}

const startDate = new Date(monthArg + '-02'); // +02 avoids timezone-midnight issues
const companies = companiesArg ? companiesArg.split(',') : undefined;

console.log(`[backfill] Fetching from ${startDate.toISOString().slice(0, 10)}${companies ? ` (${companies.join(', ')})` : ' (all scrapers)'}...`);

await runPipeline({ startDate, companies });
process.exit(0);
