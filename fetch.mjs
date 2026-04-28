import { createScraper, CompanyTypes } from './israeli-bank-scrapers/lib/index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const raw = readFileSync(envPath, 'utf-8');
  const creds = {};
  for (const line of raw.split('\n')) {
    const [key, ...rest] = line.trim().split('=');
    if (key) creds[key.trim()] = rest.join('=').trim();
  }
  console.log(`[env] Loaded: id=${creds.id}, digits=${creds.digits}, pass=***`);
  return creds;
}

async function main() {
  const env = loadEnv();

  const options = {
    companyId: CompanyTypes.isracard,
    startDate: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), // last ~2 months
    combineInstallments: false,
    showBrowser: true,
  };

  const credentials = {
    id: env.ISRACARD_ID,
    card6Digits: env.ISRACARD_DIGITS,
    password: env.ISRACARD_PASS,
  };

  console.log(`[scraper] Starting Isracard scraper, startDate=${options.startDate.toISOString().slice(0, 10)}`);

  const scraper = createScraper(options);
  const result = await scraper.scrape(credentials);

  if (!result.success) {
    console.error(`[scraper] FAILED — errorType=${result.errorType}, message=${result.errorMessage}`);
    process.exit(1);
  }

  console.log(`[scraper] Success! Found ${result.accounts.length} account(s)`);

  for (const account of result.accounts) {
    console.log(`\n=== Account: ${account.accountNumber} (${account.txns.length} transactions) ===`);
    for (const txn of account.txns) {
      const sign = txn.chargedAmount < 0 ? '' : '+';
      console.log(
        `  [${txn.date.slice(0, 10)}] ${txn.description.padEnd(40)} ${sign}${txn.chargedAmount.toFixed(2)} ${txn.originalCurrency}  [${txn.status}]`
      );
    }
  }

  // Also dump raw JSON for debugging
  const outPath = path.join(__dirname, 'transactions.json');
  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n[output] Raw data written to ${outPath}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
