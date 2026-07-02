import { readFileSync } from 'fs';
const t = JSON.parse(readFileSync('local-data/budget_transactions.json','utf8'));
const M = ['2026-02','2026-03','2026-04','2026-05']; const N = 4;
const inM = x => x.date && M.includes(x.date.slice(0,7));
const money = n => Math.round(n).toLocaleString();

// Group every outflow by description: total, #distinct months present
const g = {};
for (const x of t) {
  if (!inM(x) || x.ignored || x.chargedAmount>=0) continue;
  const d = x.description || '(none)';
  if (!g[d]) g[d] = { sum:0, months:new Set(), cat:x.category };
  g[d].sum += Math.abs(x.chargedAmount);
  g[d].months.add(x.date.slice(0,7));
}
const rows = Object.entries(g).map(([d,o]) => ({ d, sum:o.sum, mo:o.months.size, cat:o.cat, avg:o.sum/N }));

// Recurring = appears in >=3 of 4 months. Irregular = 1-2 months (lumpy/one-off).
const recurring = rows.filter(r => r.mo >= 3).sort((a,b)=>b.avg-a.avg);
const irregular = rows.filter(r => r.mo <= 2).sort((a,b)=>b.sum-a.sum);

const recTotal = recurring.reduce((a,b)=>a+b.avg,0);
const irrTotal = irregular.reduce((a,b)=>a+b.avg,0); // avg/mo across the 4 months

console.log('=== RECURRING (present in 3–4 of 4 months) — your true fixed monthly base ===');
for (const r of recurring) console.log(`  ${money(r.avg).padStart(6)}/mo  [${(r.cat||'?').padEnd(11)}] ${r.d}`);
console.log(`  --- recurring base: ${money(recTotal)}/mo ---`);

console.log('\n=== IRREGULAR / LUMPY (only 1–2 months) — what שונות buffer must absorb ===');
for (const r of irregular.slice(0,40)) console.log(`  ${money(r.sum).padStart(6)} total (${r.mo}mo) [${(r.cat||'?').padEnd(11)}] ${r.d}`);
console.log(`  ... (${irregular.length} distinct irregular merchants total)`);
console.log(`\n  irregular spend = ${money(irrTotal)}/mo  (vs 4,000 שונות buffer)`);
console.log(`  >>> buffer gap: ${money(irrTotal-4000)}/mo over the 4,000 cushion`);
