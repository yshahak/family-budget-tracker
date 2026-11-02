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
  /חיוב מאשראי/,    // credit card bill payment — already captured via card scrapers
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
      '--disable-extensions',
      '--mute-audio',
    ]
  : [];
async function launchBrowser(label = 'browser') {
  console.log(`[scraper] launchBrowser — inCloud=${inCloud} args=${JSON.stringify(BROWSER_ARGS)}`);
  console.log(`[scraper] puppeteer executablePath=${puppeteer.executablePath()}`);
  // --enable-automation (Puppeteer's default) is one of the signals Isracard/Amex's
  // bot-detection checks for — dropping it is a known community workaround for the
  // 403/"Block Automation" responses (israeli-bank-scrapers#1181).
  const browser = await puppeteer.launch({ headless: inCloud, args: BROWSER_ARGS, ignoreDefaultArgs: ['--enable-automation'] });
  console.log(`[scraper] browser launched OK`);
  attachDiagnostics(browser, label);
  return browser;
}

// Diagnostics for "Target closed" failures: logs tab lifecycle and renderer crashes so we can
// tell a bank-initiated tab swap from a Chrome crash.
function attachDiagnostics(browser, label) {
  const t0 = Date.now();
  const log = (...a) => console.log(`[diag:${label}] +${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
  const watchPage = (page, via) => {
    if (!page) return;
    log(`page opened (${via}) url=${page.url()}`);
    page.on('close', () => log(`page closed url=${page.url()}`));
    page.on('error', e => log(`page CRASH: ${e.message}`));
    page.on('pageerror', e => log(`pageerror: ${String(e.message).slice(0, 200)}`));
    page.on('framenavigated', f => { if (f === page.mainFrame()) log(`navigated -> ${f.url()}`); });
  };
  browser.on('targetcreated', async t => { log(`target created type=${t.type()} url=${t.url()}`); if (t.type() === 'page') watchPage(await t.page().catch(() => null), 'targetcreated'); });
  browser.on('targetdestroyed', t => log(`target destroyed type=${t.type()} url=${t.url()}`));
  browser.on('disconnected', () => log('browser DISCONNECTED'));
  browser.process()?.stderr?.on('data', d => log(`chrome stderr: ${String(d).trim().slice(0, 300)}`));
  browser.pages().then(ps => ps.forEach(p => watchPage(p, 'existing'))).catch(() => {});
}

// Headless Chrome omits Accept-Language by default, another bot-detection signal
// flagged in the same upstream issue.
async function preparePage(page) {
  await page.setExtraHTTPHeaders({ 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' });
}

export async function scrapeAll(startDate, { companies, delayMs = 0 } = {}) {
  const profiles = companies
    ? SCRAPE_PROFILES.filter(p => companies.includes(p.company))
    : SCRAPE_PROFILES;
  const results = [];
  const errors = [];

  for (const profile of profiles) {
    console.log(`[scraper] Scraping ${profile.name} (${profile.company})...`);
    try {
      const isHapoalim = profile.company === 'hapoalim';

      // Always provide our own browser so we control launch args (especially --no-sandbox in Cloud Run)
      const browser = await launchBrowser(profile.name);

      const scraper = createScraper({
        companyId: CompanyTypes[profile.company],
        startDate,
        combineInstallments: false,
        showBrowser: !inCloud,
        timeoutMs: isHapoalim ? 120000 : 60000,
        browser,
        skipCloseBrowser: true,
        includeRawTransaction: true,
        preparePage,
        navigationRetryCount: 3,
      });

      const otpWatcher = isHapoalim ? startOtpWatcher(browser) : null;
      const result = await scraper.scrape(profile.credentials);
      otpWatcher?.stop();

      await browser.close();

      if (!result.success) {
        const msg = `${profile.name} failed: ${result.errorType} — ${result.errorMessage}`;
        console.error(`[scraper] ${msg}`);
        errors.push(msg);
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
      const msg = `${profile.name} threw: ${e.message}`;
      console.error(`[scraper] ${msg}`);
      errors.push(msg);
    }
    if (delayMs > 0 && profile !== profiles.at(-1)) {
      console.log(`[scraper] waiting ${delayMs / 1000}s before next profile...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return { results, errors };
}
