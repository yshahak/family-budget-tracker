/**
 * Monthly spending analysis from local-data/budget_transactions.json.
 * Run local-dump.mjs first to refresh the data.
 * Usage: node src/local-analyze.mjs [--months=4]
 */
import { readFileSync } from 'fs';
import { BUDGET_BUCKETS } from './budget.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace('--','').split('=')));
const MONTHS_BACK = parseInt(args.months ?? 4);

const txns = JSON.parse(readFileSync('local-data/budget_transactions.json', 'utf8'));
const amountOverrides = Object.fromEntries(
  JSON.parse(readFileSync('local-data/budget_amounts.json', 'utf8')).map(d => [d._id, d.amount])
);
const buckets = BUDGET_BUCKETS.map(b => ({ ...b, amount: amountOverrides[b.name] ?? b.amount }));

// Build list of YYYY-MM months to analyze
function recentMonths(n) {
  const months = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    months.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

const months = recentMonths(MONTHS_BACK);

// Group spend by bucket by month
const bucketMonthSpend = {};
for (const bucket of buckets) {
  bucketMonthSpend[bucket.name] = {};
  for (const m of months) bucketMonthSpend[bucket.name][m] = 0;
}


const uncategorized = {};
for (const m of months) uncategorized[m] = 0;

for (const t of txns) {
  if (t.ignored || !t.date || t.chargedAmount >= 0) continue;
  const month = t.date.slice(0, 7);
  if (!months.includes(month)) continue;

  const bucket = buckets.find(b => b.categories.includes(t.category));
  if (bucket) {
    bucketMonthSpend[bucket.name][month] += Math.abs(t.chargedAmount);
  } else {
    uncategorized[month] += Math.abs(t.chargedAmount);
  }
}

// Render table
const COL = 10;
const pad = (s, n = COL) => String(s).padStart(n);
const fmt = n => n > 0 ? Math.round(n).toLocaleString() : '-';

const monthLabels = months.map(m => m.slice(5)); // MM only
console.log('\n── Monthly Spending vs Budget ──────────────────────────────────\n');
console.log(
  'Bucket'.padEnd(14) +
  'Budget'.padStart(8) +
  months.map(m => pad(m.slice(5))).join('') +
  pad('Avg') +
  pad('vs Budget')
);
console.log('─'.repeat(14 + 8 + months.length * COL + COL * 2));

for (const bucket of buckets) {
  const spends = months.map(m => bucketMonthSpend[bucket.name][m]);
  const nonZero = spends.filter(s => s > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  const diff = avg - bucket.amount;
  const diffStr = avg === 0 ? '-' : (diff > 0 ? `+${Math.round(diff).toLocaleString()}` : Math.round(diff).toLocaleString());
  const flag = diff > bucket.amount * 0.1 ? ' ⚠️' : diff > 0 ? ' ↑' : '';

  console.log(
    bucket.name.padEnd(14) +
    pad(Math.round(bucket.amount).toLocaleString(), 8) +
    spends.map(s => pad(fmt(s))).join('') +
    pad(avg > 0 ? Math.round(avg).toLocaleString() : '-') +
    pad(diffStr) +
    flag
  );
}

// Uncategorized row
const uncatSpends = months.map(m => uncategorized[m]);
const uncatAvg = uncatSpends.filter(s => s > 0);
if (uncatAvg.length) {
  const avg = uncatAvg.reduce((a, b) => a + b, 0) / uncatAvg.length;
  console.log(
    '(ללא קטגוריה)'.padEnd(14) +
    pad('-', 8) +
    uncatSpends.map(s => pad(fmt(s))).join('') +
    pad(Math.round(avg).toLocaleString()) +
    pad('-')
  );
}

console.log('─'.repeat(14 + 8 + months.length * COL + COL * 2));

// Monthly totals
const monthTotals = months.map(m =>
  buckets.reduce((sum, b) => sum + bucketMonthSpend[b.name][m], 0) + uncategorized[m]
);
const totalBudget = buckets.reduce((s, b) => s + b.amount, 0);
console.log(
  'TOTAL'.padEnd(14) +
  pad(Math.round(totalBudget).toLocaleString(), 8) +
  monthTotals.map(t => pad(fmt(t))).join('') +
  pad(Math.round(monthTotals.filter(t=>t>0).reduce((a,b)=>a+b,0) / monthTotals.filter(t=>t>0).length).toLocaleString()) +
  pad('')
);

console.log('\n⚠️  = avg spend >10% over budget\n');
process.exit(0);
