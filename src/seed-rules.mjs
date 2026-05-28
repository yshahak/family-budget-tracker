/**
 * Run once to populate budget_rules with common Israeli merchant patterns.
 * Usage: node src/seed-rules.mjs
 */
import '../src/config.mjs';
import { getDb } from './firestore.mjs';
import { EXTRA_SEED_RULES } from './local-config.mjs';

const RULES = [
  // ── Groceries ──────────────────────────────────────────────────────
  { pattern: 'רמי לוי',           category: 'קניות לבית' },
  { pattern: 'שופרסל',            category: 'קניות לבית' },
  { pattern: 'shufersal',         category: 'קניות לבית' },
  { pattern: 'ויקטורי',           category: 'קניות לבית' },
  { pattern: 'victory',           category: 'קניות לבית' },
  { pattern: 'יינות ביתן',        category: 'קניות לבית' },
  { pattern: 'yeinot bitan',      category: 'קניות לבית' },
  { pattern: 'מחסני השוק',        category: 'קניות לבית' },
  { pattern: 'סופר זול',          category: 'קניות לבית' },
  { pattern: 'super zol',         category: 'קניות לבית' },
  { pattern: 'טיב טעם',           category: 'קניות לבית' },
  { pattern: 'tiv taam',          category: 'קניות לבית' },
  { pattern: 'am:pm',             category: 'קניות לבית' },
  { pattern: 'stop market',       category: 'קניות לבית' },
  { pattern: 'freshmarket',       category: 'קניות לבית' },
  { pattern: 'fresh market',      category: 'קניות לבית' },
  { pattern: 'סופר גלסנר',        category: 'קניות לבית' },
  { pattern: 'סטורו',             category: 'קניות לבית' },
  { pattern: 'מגה',               category: 'קניות לבית' },
  { pattern: 'פרש מרקט',          category: 'קניות לבית' },

  // ── Restaurants & Food ─────────────────────────────────────────────
  { pattern: 'wolt',              category: 'מסעדות' },
  { pattern: '10bis',             category: 'מסעדות' },
  { pattern: 'עשר ביס',           category: 'מסעדות' },
  { pattern: 'pizza hut',         category: 'מסעדות' },
  { pattern: 'dominos',           category: 'מסעדות' },
  { pattern: 'mcdonalds',         category: 'מסעדות' },
  { pattern: "mc donald",         category: 'מסעדות' },
  { pattern: 'burger king',       category: 'מסעדות' },
  { pattern: 'שווארמה',           category: 'מסעדות' },
  { pattern: 'פלאפל',             category: 'מסעדות' },
  { pattern: 'hummus',            category: 'מסעדות' },
  { pattern: 'חומוס',             category: 'מסעדות' },
  { pattern: 'cafe cafe',         category: 'מסעדות' },
  { pattern: 'ארומה',             category: 'מסעדות' },
  { pattern: 'aroma',             category: 'מסעדות' },
  { pattern: 'sushi',             category: 'מסעדות' },
  { pattern: 'גריל',              category: 'מסעדות' },
  { pattern: 'לחם',               category: 'מסעדות' },
  { pattern: 'קפה',               category: 'מסעדות' },
  { pattern: 'מסעדה',             category: 'מסעדות' },
  { pattern: 'coffix',            category: 'מסעדות' },
  { pattern: 'cofix',             category: 'מסעדות' },
  { pattern: 'שוורמה',            category: 'מסעדות' },

  // ── Transport ──────────────────────────────────────────────────────
  { pattern: 'gett',              category: 'תחבורה' },
  { pattern: 'uber',              category: 'תחבורה' },
  { pattern: 'רב פס',             category: 'תחבורה' },
  { pattern: 'rav-kav',           category: 'תחבורה' },
  { pattern: 'ravkav',            category: 'תחבורה' },
  { pattern: 'תחבורה',            category: 'תחבורה' },
  { pattern: 'סונול',             category: 'תחבורה' },
  { pattern: 'sonol',             category: 'תחבורה' },
  { pattern: 'פז ',               category: 'תחבורה' },
  { pattern: 'paz ',              category: 'תחבורה' },
  { pattern: 'דלק',               category: 'תחבורה' },
  { pattern: 'delek',             category: 'תחבורה' },
  { pattern: 'ten',               category: 'תחבורה' },
  { pattern: 'מוניות',            category: 'תחבורה' },
  { pattern: 'חניה',              category: 'תחבורה' },
  { pattern: 'parking',           category: 'תחבורה' },
  { pattern: 'רכבת',              category: 'תחבורה' },

  // ── Health ─────────────────────────────────────────────────────────
  { pattern: 'מכבי',              category: 'בריאות' },
  { pattern: 'maccabi',           category: 'בריאות' },
  { pattern: 'כללית',             category: 'בריאות' },
  { pattern: 'clalit',            category: 'בריאות' },
  { pattern: 'מאוחדת',            category: 'בריאות' },
  { pattern: 'לאומית',            category: 'בריאות' },
  { pattern: 'leumit',            category: 'בריאות' },
  { pattern: 'סופר פארם',         category: 'בריאות' },
  { pattern: 'super pharm',       category: 'בריאות' },
  { pattern: 'superpharm',        category: 'בריאות' },
  { pattern: 'בית מרקחת',         category: 'בריאות' },
  { pattern: 'pharmacy',          category: 'בריאות' },
  { pattern: 'רופא',              category: 'בריאות' },
  { pattern: 'שיניים',            category: 'בריאות' },
  { pattern: 'dental',            category: 'בריאות' },
  { pattern: 'קופת חולים',        category: 'בריאות' },
  { pattern: 'ביטוח בריאות',      category: 'בריאות' },

  // ── Clothing ───────────────────────────────────────────────────────
  { pattern: 'zara',              category: 'ביגוד' },
  { pattern: 'h&m',               category: 'ביגוד' },
  { pattern: 'next ',             category: 'ביגוד' },
  { pattern: 'next online',       category: 'ביגוד' },
  { pattern: 'castro',            category: 'ביגוד' },
  { pattern: 'renuar',            category: 'ביגוד' },
  { pattern: 'fox ',              category: 'ביגוד' },
  { pattern: 'terminal x',        category: 'ביגוד' },
  { pattern: 'adidas',            category: 'ביגוד' },
  { pattern: 'nike',              category: 'ביגוד' },
  { pattern: 'golf ',             category: 'ביגוד' },
  { pattern: 'mango',             category: 'ביגוד' },
  { pattern: 'uniqlo',            category: 'ביגוד' },
  { pattern: 'shein',             category: 'ביגוד' },
  { pattern: 'asos',              category: 'ביגוד' },
  { pattern: 'lacoste',           category: 'ביגוד' },
  { pattern: 'tommy',             category: 'ביגוד' },

  // ── Entertainment ──────────────────────────────────────────────────
  { pattern: 'netflix',           category: 'בידור' },
  { pattern: 'spotify',           category: 'בידור' },
  { pattern: 'disney',            category: 'בידור' },
  { pattern: 'apple music',       category: 'בידור' },
  { pattern: 'youtube premium',   category: 'בידור' },
  { pattern: 'amazon prime',      category: 'בידור' },
  { pattern: 'steam',             category: 'בידור' },
  { pattern: 'playstation',       category: 'בידור' },
  { pattern: 'xbox',              category: 'בידור' },
  { pattern: 'cinema city',       category: 'בידור' },
  { pattern: 'yes planet',        category: 'בידור' },
  { pattern: 'google play',       category: 'בידור' },
  { pattern: 'apple.com/bill',    category: 'בידור' },
  { pattern: 'hot vod',           category: 'בידור' },

  // ── Bills ──────────────────────────────────────────────────────────
  { pattern: 'בזק',               category: 'חשבונות' },
  { pattern: 'bezeq',             category: 'חשבונות' },
  { pattern: 'hot ',              category: 'חשבונות' },
  { pattern: 'yes ',              category: 'חשבונות' },
  { pattern: 'partner',           category: 'חשבונות' },
  { pattern: 'פרטנר',             category: 'חשבונות' },
  { pattern: 'cellcom',           category: 'חשבונות' },
  { pattern: 'סלקום',             category: 'חשבונות' },
  { pattern: '012',               category: 'חשבונות' },
  { pattern: '019',               category: 'חשבונות' },
  { pattern: 'טלזר',              category: 'חשבונות' },
  { pattern: 'חברת החשמל',        category: 'חשבונות' },
  { pattern: 'electric',          category: 'חשבונות' },
  { pattern: 'ארנונה',            category: 'חשבונות' },
  { pattern: 'מים',               category: 'חשבונות' },
  { pattern: 'water',             category: 'חשבונות' },
  { pattern: 'גז',                category: 'חשבונות' },
  { pattern: 'אינטרנט',           category: 'חשבונות' },
  { pattern: 'fiber',             category: 'חשבונות' },
  { pattern: 'aws ',              category: 'חשבונות' },
  { pattern: 'google cloud',      category: 'חשבונות' },
  { pattern: 'דמי כרטיס',         category: 'חשבונות' },
  { pattern: 'ביטוח חובה',        category: 'תחבורה' },
  { pattern: 'ביטוח רכב',         category: 'תחבורה' },
  { pattern: 'ביטוח בריאות',      category: 'בריאות' },
  { pattern: 'ביטוח חיים',        category: 'חשבונות' },
  { pattern: 'ביטוח מבנה',        category: 'קניות לבית' },
  { pattern: 'ביטוח סיעוד',       category: 'בריאות' },
  { pattern: 'הפניקס',            category: 'חשבונות' },
  { pattern: 'ליברה',             category: 'תחבורה' },
  { pattern: 'איתוראן',           category: 'תחבורה' },
  { pattern: 'כביש 6',            category: 'תחבורה' },
  { pattern: 'פנגו',              category: 'תחבורה' },
  { pattern: 'insurance',         category: 'חשבונות' },

  // ── Online Shopping ────────────────────────────────────────────────
  { pattern: 'amazon',            category: 'קניות אונליין' },
  { pattern: 'aliexpress',        category: 'קניות אונליין' },
  { pattern: 'ebay',              category: 'קניות אונליין' },
  { pattern: 'ksp',               category: 'קניות אונליין' },
  { pattern: 'ivory',             category: 'קניות אונליין' },
  { pattern: 'bug ',              category: 'קניות אונליין' },
  { pattern: 'מחסני חשמל',        category: 'קניות אונליין' },
  { pattern: 'מחשבים',            category: 'קניות אונליין' },
  // ── PayBox / Bit / digital wallets ───────────────────────────────────────
  { pattern: 'paybox',            category: 'פייבוקס/ביט' },
  { pattern: 'פייבוקס',          category: 'פייבוקס/ביט' },
  { pattern: 'העברה בbit',       category: 'פייבוקס/ביט' },
  { pattern: 'העברה ב bit',      category: 'פייבוקס/ביט' },
  { pattern: 'העברה בביט',       category: 'פייבוקס/ביט' },
  { pattern: 'העברה ב ביט',      category: 'פייבוקס/ביט' },
  { pattern: 'bit app',          category: 'פייבוקס/ביט' },

  // ── Travel ─────────────────────────────────────────────────────────
  { pattern: 'booking',           category: 'נסיעות' },
  { pattern: 'airbnb',            category: 'נסיעות' },
  { pattern: 'expedia',           category: 'נסיעות' },
  { pattern: 'el al',             category: 'נסיעות' },
  { pattern: 'אל על',             category: 'נסיעות' },
  { pattern: 'arkia',             category: 'נסיעות' },
  { pattern: 'wizz',              category: 'נסיעות' },
  { pattern: 'ryanair',           category: 'נסיעות' },
  { pattern: 'easyjet',           category: 'נסיעות' },
  { pattern: 'hotel',             category: 'נסיעות' },
  { pattern: 'hilton',            category: 'נסיעות' },
  { pattern: 'marriott',          category: 'נסיעות' },

  // ── חינוך — mandatory education (no choice) ────────────────────────
  { pattern: 'צהרון',             category: 'חינוך' },
  { pattern: 'גן ',               category: 'חינוך' },
  { pattern: 'כפר הרואה',         category: 'חינוך' },
  { pattern: 'אוניברסיטה',        category: 'חינוך' },
  { pattern: 'מכללה',             category: 'חינוך' },

  // ── חוגים — optional activities, kids & adults ─────────────────────
  { pattern: 'udemy',             category: 'חוגים' },
  { pattern: 'coursera',          category: 'חוגים' },
  { pattern: 'duolingo',          category: 'חוגים' },
  { pattern: 'preply',            category: 'חוגים' },
  { pattern: 'italki',            category: 'חוגים' },
  { pattern: 'נערי הברזל',        category: 'חוגים' },
  { pattern: 'חוג',               category: 'חוגים' },
  { pattern: 'יוגה',              category: 'חוגים' },
  { pattern: 'שחייה',             category: 'חוגים' },
  { pattern: 'כדורגל',            category: 'חוגים' },
  { pattern: 'כדורסל',            category: 'חוגים' },
  { pattern: 'גיטרה',             category: 'חוגים' },
  { pattern: 'פסנתר',             category: 'חוגים' },

  // ── Home ───────────────────────────────────────────────────────────
  { pattern: 'ikea',              category: 'קניות לבית' },
  { pattern: 'איקאה',             category: 'קניות לבית' },
  { pattern: 'ace ',              category: 'קניות לבית' },
  { pattern: 'home center',       category: 'קניות לבית' },
  { pattern: 'depot',             category: 'קניות לבית' },
  { pattern: 'שיפוצים',           category: 'קניות לבית' },
  { pattern: 'קבלן',              category: 'קניות לבית' },

  // ── misc kids items ────────────────────────────────────────────────
  { pattern: 'baby',              category: 'קניות לבית' },
  { pattern: 'תינוק',             category: 'קניות לבית' },
  { pattern: 'toys',              category: 'קניות לבית' },
  { pattern: 'אמא ואני',          category: 'קניות לבית' },
];

async function main() {
  const db = getDb();
  const col = db.collection('budget_rules');
  let count = 0;

  for (const rule of [...RULES, ...(EXTRA_SEED_RULES ?? [])]) {
    const docId = Buffer.from(rule.pattern.toLowerCase().trim()).toString('base64url').slice(0, 64);
    await col.doc(docId).set(
      { pattern: rule.pattern.toLowerCase().trim(), category: rule.category, createdBy: 'seed', updatedAt: new Date() },
      { merge: true }
    );
    count++;
  }

  console.log(`[seed] Wrote ${count} rules to budget_rules`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
