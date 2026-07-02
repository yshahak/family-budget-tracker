/**
 * One-off diagnostic: scrape Hapoalim directly and print memo/rawTransaction for
 * standing-order (הוראת-קבע) transactions, without touching Firestore or the pipeline.
 *
 * Sets a dummy WEBHOOK_URL before importing anything so notifier.mjs's getBot() never
 * starts Telegram polling locally — polling mode calls deleteWebhook and kills the live
 * Cloud Run webhook. The OTP prompt still goes out fine since sendMessage doesn't need polling,
 * and the OTP code itself is relayed via the otp_cache Firestore doc (production's webhook
 * handles the /otp command and writes there).
 *
 * Usage: node src/inspect-hapoalim-memo.mjs
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

if (!process.env.WEBHOOK_URL) process.env.WEBHOOK_URL = 'https://dummy.invalid';

const { scrapeAll } = await import('./scraper.mjs');

const startDate = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1);
console.log(`[inspect] scraping Hapoalim from ${startDate.toISOString().slice(0, 10)}...`);
console.log('[inspect] Opening browser — enter OTP via Telegram /otp command if prompted...');

const results = await scrapeAll(startDate, { companies: ['hapoalim'] });

for (const { owner, accountNumber, txns } of results) {
  for (const txn of txns) {
    if (!/הוראת.?קבע/.test(txn.description)) continue;
    console.log('---');
    console.log(`owner=${owner} account=${accountNumber}`);
    console.log(`date=${txn.date} description="${txn.description}" chargedAmount=${txn.chargedAmount}`);
    console.log(`identifier=${txn.identifier} memo="${txn.memo}"`);
    if (txn.rawTransaction) console.log('rawTransaction:', JSON.stringify(txn.rawTransaction, null, 2));
  }
}

console.log('[inspect] done.');
process.exit(0);
