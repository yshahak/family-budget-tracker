import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const TELEGRAM_BOT_TOKEN = required('TELEGRAM_BOT_TOKEN');
export const TELEGRAM_CHAT_ID = required('TELEGRAM_CHAT_ID');
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
export const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
export const PORT = parseInt(process.env.PORT || '8080', 10);

// Each entry with credentials present becomes an active scrape profile.
// Add/remove entries to match the bank accounts you want to track.
// PROFILE1_NAME / PROFILE2_NAME control the internal owner key stored in Firestore —
// set them to stable values and never change them after the first run.
const P1 = process.env.PROFILE1_NAME || 'owner1';
const P2 = process.env.PROFILE2_NAME || 'owner2';

const profiles = [
  {
    name: P1,
    displayName: process.env.OWNER1_DISPLAY || 'Owner 1',
    company: 'isracard',
    credentials: { id: process.env.ISRACARD_ID, card6Digits: process.env.ISRACARD_DIGITS, password: process.env.ISRACARD_PASS },
  },
  {
    name: `${P1}-max`,
    displayName: process.env.OWNER1_DISPLAY || 'Owner 1',
    company: 'max',
    credentials: { username: process.env.MAX_ID, password: process.env.MAX_PASS },
  },
  {
    name: P2,
    displayName: process.env.OWNER2_DISPLAY || 'Owner 2',
    company: 'isracard',
    credentials: { id: process.env.OWNER2_ISRACARD_ID, card6Digits: process.env.OWNER2_ISRACARD_DIGITS, password: process.env.OWNER2_ISRACARD_PASS },
  },
  {
    name: P1,
    displayName: process.env.OWNER1_DISPLAY || 'Owner 1',
    company: 'hapoalim',
    credentials: { userCode: process.env.HAPOALIM_USER, password: process.env.HAPOALIM_PASS },
  },
];
export const SCRAPE_PROFILES = profiles.filter(p => Object.values(p.credentials).every(Boolean));

// Map from profile name → display name for use in Telegram messages
export const DISPLAY_NAME = Object.fromEntries(SCRAPE_PROFILES.map(p => [p.name, p.displayName]));

if (SCRAPE_PROFILES.length === 0) throw new Error('No valid scrape profiles found in .env');
