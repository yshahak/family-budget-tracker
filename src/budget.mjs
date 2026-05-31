import { getDb } from './firestore.mjs';
let LOCAL_BUCKETS = null;
try { ({ BUDGET_BUCKETS: LOCAL_BUCKETS } = await import('./local-config.mjs')); } catch {}

const DEFAULT_BUDGET_BUCKETS = [
  { name: 'אוכל',        amount: 3000, categories: ['קניות לבית', 'בית', 'מכולת'] },
  { name: 'מסעדות',      amount: 500,  categories: ['מסעדות'] },
  { name: 'הלוואות',     amount: 1000, categories: ['הלוואות'] },
  { name: 'תחבורה',      amount: 1500, categories: ['תחבורה'] },
  { name: 'שונות',       amount: 1000, categories: ['אחר', 'קניות אונליין'] },
  { name: 'פייבוקס/ביט', amount: 500,  categories: ['פייבוקס/ביט'] },
  { name: 'חשבונות',     amount: 1000, categories: ['חשבונות'] },
  { name: 'ביגוד',       amount: 500,  categories: ['ביגוד'] },
  { name: 'בריאות',      amount: 500,  categories: ['בריאות'] },
  { name: 'חינוך',       amount: 1000, categories: ['חינוך', 'ילדים'] },
  { name: 'חוגים',       amount: 500,  categories: ['חוגים'] },
  { name: 'חופשות',      amount: 500,  categories: ['נסיעות'] },
  { name: 'חסכונות',      amount: 500,  categories: ['חסכונות'] },
  { name: 'תרומות',      amount: 200,  categories: ['תרומות'] },
  { name: 'בידור',       amount: 200,  categories: ['בידור'] },
];

// Monthly budget buckets — amounts in ILS
export const BUDGET_BUCKETS = LOCAL_BUCKETS ?? DEFAULT_BUDGET_BUCKETS;

export function getBucket(category) {
  return BUDGET_BUCKETS.find(b => b.categories.includes(category)) ?? null;
}

const bucketDocId = name => name.replace(/\//g, '_');

// Returns amount overrides from Firestore, falling back to BUDGET_BUCKETS defaults
export async function getAmountOverrides() {
  const snap = await getDb().collection('budget_amounts').get();
  const overrides = {};
  snap.docs.forEach(d => { overrides[d.id] = d.data().amount; });
  return overrides;
}

export async function updateBucketAmount(bucketName, amount) {
  await getDb().collection('budget_amounts').doc(bucketDocId(bucketName)).set({ amount });
}

async function bucketsWithAmounts() {
  const overrides = await getAmountOverrides();
  return BUDGET_BUCKETS.map(b => ({ ...b, amount: overrides[bucketDocId(b.name)] ?? overrides[b.name] ?? b.amount }));
}

// Returns { start, end } ISO date strings for the given month ('YYYY-MM') or current month
function monthBounds(month) {
  const d = month ? new Date(month + '-02') : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
  return { start, end };
}

export async function getAllBucketsStatus(month = null) {
  const { start, end } = monthBounds(month);

  const snap = await getDb()
    .collection('budget_transactions')
    .where('date', '>=', start)
    .where('date', '<', end)
    .get();

  const byCategory = {};
  for (const doc of snap.docs) {
    const t = doc.data();
    if (t.chargedAmount < 0 && t.category && !t.ignored) {
      byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.chargedAmount);
    }
  }

  const buckets = await bucketsWithAmounts();
  return buckets.map(bucket => ({
    ...bucket,
    spent: bucket.categories.reduce((sum, cat) => sum + (byCategory[cat] || 0), 0),
  }));
}

export async function getMonthlyTransactionsForBucket(bucketName, month = null) {
  const bucket = BUDGET_BUCKETS.find(b => b.name === bucketName);
  if (!bucket) return [];

  const { start, end } = monthBounds(month);

  const snap = await getDb()
    .collection('budget_transactions')
    .where('date', '>=', start)
    .where('date', '<', end)
    .orderBy('date', 'desc')
    .get();

  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => bucket.categories.includes(t.category) && t.chargedAmount < 0 && !t.ignored);
}

export async function getMonthlyBudgetInfo(category, month = null) {
  const bucket = getBucket(category);
  if (!bucket) return null;

  const { start, end } = monthBounds(month);

  const snap = await getDb()
    .collection('budget_transactions')
    .where('date', '>=', start)
    .where('date', '<', end)
    .get();

  let spent = 0;
  for (const doc of snap.docs) {
    const t = doc.data();
    if (bucket.categories.includes(t.category) && t.chargedAmount < 0 && !t.ignored) {
      spent += Math.abs(t.chargedAmount);
    }
  }

  const overrides = await getAmountOverrides();
  const amount = overrides[bucket.name] ?? bucket.amount;
  return { name: bucket.name, spent, budget: amount };
}
