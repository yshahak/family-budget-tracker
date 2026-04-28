import { getDb } from './firestore.mjs';

const DOC = () => getDb().collection('hapoalim_session').doc('cookies');
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export async function saveSession(browser) {
  // Open a fresh page on the bank domain to collect all session cookies
  const page = await browser.newPage();
  try {
    await page.goto('https://www.bankhapoalim.co.il', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (_) {}

  const all = await page.cookies();
  await page.close();

  const cookies = all.filter(k => k.domain.includes('hapoalim') || k.domain.includes('bankhapoalim'));
  if (cookies.length === 0) {
    console.warn('[hapoalim-session] No hapoalim cookies found — session not saved');
    return false;
  }
  // Strip undefined fields (Firestore rejects them)
  const clean = JSON.parse(JSON.stringify(cookies));
  await DOC().set({ cookies: clean, savedAt: new Date() });
  console.log(`[hapoalim-session] Saved ${cookies.length} cookies`);
  return true;
}

export async function loadSession(browser) {
  const doc = await DOC().get();
  if (!doc.exists) {
    console.log('[hapoalim-session] No saved session');
    return false;
  }
  const { cookies, savedAt } = doc.data();
  const ageMs = Date.now() - savedAt.toDate().getTime();
  if (ageMs > SESSION_MAX_AGE_MS) {
    console.log('[hapoalim-session] Session too old, need re-auth');
    return false;
  }

  // Inject cookies via a temporary page on the bank domain
  const page = await browser.newPage();
  try {
    await page.goto('https://www.bankhapoalim.co.il', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.setCookie(...cookies);
    console.log(`[hapoalim-session] Injected ${cookies.length} cookies (age: ${Math.round(ageMs / 3600000)}h)`);
  } catch (e) {
    console.warn('[hapoalim-session] Cookie injection warning:', e.message);
  } finally {
    await page.close();
  }
  return true;
}

export async function markHapoalimSuccess() {
  await DOC().set({ lastScrapeAt: new Date() }, { merge: true });
}

export async function getHapoalimAge() {
  const doc = await DOC().get();
  if (!doc.exists || !doc.data().lastScrapeAt) return null;
  return Date.now() - doc.data().lastScrapeAt.toDate().getTime();
}

export async function clearSession() {
  await DOC().delete();
  console.log('[hapoalim-session] Session cleared');
}
