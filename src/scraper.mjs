import { createScraper, CompanyTypes } from '../israeli-bank-scrapers/lib/index.js';
import puppeteer from 'puppeteer';
import { SCRAPE_PROFILES } from './config.mjs';
import { startOtpWatcher } from './hapoalim-otp.mjs';

// Patterns that indicate internal bank transfers or credit card payments
// already captured by the card scrapers — skip to avoid double-counting.
const HAPOALIM_SKIP_PATTERNS = [
  /מסטרקרד/,
  /דיינרס/,
  /מקס איט/,
  /כרטיסי אשראי/,
  /טעינת כרטיס/,
  /החזר טעינה/,
  /ני"ע-מכירה/,    // securities sale — income, not an expense
  /^זיכוי מ/,       // incoming bank transfers (salary etc.)
  /^העברה/,         // outgoing transfers
  /^העב'/,          // outgoing transfers (short form)
  /^bit העברת/,     // BIT transfers
  /^תיקון מס/,      // tax corrections
  /^רבית$/,         // interest
  /קצבת ילדים/,     // child allowance (income)
];

function shouldSkip(txn) {
  return HAPOALIM_SKIP_PATTERNS.some(p => p.test(txn.description));
}

const inCloud = !!process.env.WEBHOOK_URL;
const BROWSER_ARGS = inCloud
  ? [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-extensions',
      '--mute-audio',
    ]
  : [];
async function launchBrowser() {
  console.log(`[scraper] launchBrowser — inCloud=${inCloud} args=${JSON.stringify(BROWSER_ARGS)}`);
  console.log(`[scraper] puppeteer executablePath=${puppeteer.executablePath()}`);
  const browser = await puppeteer.launch({ headless: inCloud, args: BROWSER_ARGS });
  console.log(`[scraper] browser launched OK`);
  return browser;
}

export async function scrapeAll(startDate, { companies } = {}) {
  const profiles = companies
    ? SCRAPE_PROFILES.filter(p => companies.includes(p.company))
    : SCRAPE_PROFILES;
  const results = [];

  for (const profile of profiles) {
    console.log(`[scraper] Scraping ${profile.name} (${profile.company})...`);
    try {
      const isHapoalim = profile.company === 'hapoalim';

      // Always provide our own browser so we control launch args (especially --no-sandbox in Cloud Run)
      const browser = await launchBrowser();

      const scraper = createScraper({
        companyId: CompanyTypes[profile.company],
        startDate,
        combineInstallments: false,
        showBrowser: !inCloud,
        timeoutMs: isHapoalim ? 120000 : 60000,
        browser,
        skipCloseBrowser: true,
      });

      const otpWatcher = isHapoalim ? startOtpWatcher(browser) : null;
      const result = await scraper.scrape(profile.credentials);
      otpWatcher?.stop();

      await browser.close();

      if (!result.success) {
        console.error(`[scraper] ${profile.name} failed: ${result.errorType} — ${result.errorMessage}`);
        continue;
      }

      for (const account of result.accounts) {
        let txns = account.txns;
        if (profile.company === 'hapoalim') {
          const before = txns.length;
          txns = txns.filter(t => t.chargedAmount < 0 && !shouldSkip(t));
          console.log(`[scraper] ${profile.name} / account ${account.accountNumber}: ${txns.length} txns (${before - txns.length} income/internal skipped)`);
        } else {
          console.log(`[scraper] ${profile.name} / account ${account.accountNumber}: ${txns.length} txns`);
        }
        results.push({ owner: profile.name, accountNumber: account.accountNumber, txns });
      }
    } catch (e) {
      console.error(`[scraper] ${profile.name} threw:`, e.message);
    }
  }

  return results;
}
