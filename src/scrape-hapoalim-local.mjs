/**
 * Run this locally to scrape Hapoalim with a visible browser (useful for debugging OTP flow).
 * Usage: node src/scrape-hapoalim-local.mjs
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

import { runPipeline } from './pipeline.mjs';

const startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
console.log(`[hapoalim-local] start date: ${startDate.toISOString().slice(0, 10)}`);
console.log('[hapoalim-local] Opening browser — enter OTP if prompted via Telegram /otp command...');

const { totalNew, errors } = await runPipeline({ companies: ['hapoalim'], startDate });
console.log(`[hapoalim-local] Done — ${totalNew} new transactions.`);
if (errors.length) {
  console.error(`[hapoalim-local] Errors:\n${errors.join('\n')}`);
  process.exit(1);
}
process.exit(0);
