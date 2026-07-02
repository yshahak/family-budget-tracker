import { readFileSync } from 'fs';
const t = JSON.parse(readFileSync('local-data/budget_transactions.json','utf8'));
const M = ['2026-02','2026-03','2026-04','2026-05'];
const money = n => Math.round(n).toLocaleString();

// monthly total per category
const cm = {};
for (const x of t) {
  if (x.ignored || x.chargedAmount>=0 || !x.date) continue;
  const m = x.date.slice(0,7); if (!M.includes(m)) continue;
  const c = x.category || '(none)';
  (cm[c] ??= {});
  cm[c][m] = (cm[c][m]||0) + Math.abs(x.chargedAmount);
}

const rows = [];
for (const [c,mm] of Object.entries(cm)) {
  const vals = M.map(m => mm[m]||0);
  const min = Math.min(...vals);          // stable floor
  const avg = vals.reduce((a,b)=>a+b,0)/4;
  const max = Math.max(...vals);
  rows.push({ c, min, avg, max, spike: avg-min, vals });
}
rows.sort((a,b)=>b.spike-a.spike);

console.log('cat'.padEnd(14)+'floor'.padStart(8)+'avg'.padStart(8)+'max'.padStart(8)+'  spike(avg-floor)   monthly[F M A M]');
let floorSum=0, avgSum=0, spikeSum=0;
for (const r of rows) {
  floorSum+=r.min; avgSum+=r.avg; spikeSum+=r.spike;
  console.log(
    r.c.padEnd(14)+money(r.min).padStart(8)+money(r.avg).padStart(8)+money(r.max).padStart(8)+
    '   '+money(r.spike).padStart(7)+'        '+r.vals.map(v=>money(v).padStart(6)).join(' ')
  );
}
console.log('─'.repeat(70));
console.log('TOTAL'.padEnd(14)+money(floorSum).padStart(8)+money(avgSum).padStart(8)+''.padStart(8)+'   '+money(spikeSum).padStart(7));
console.log(`\nStable monthly floor (sum of per-cat minimums): ${money(floorSum)}/mo`);
console.log(`Average total spend:                            ${money(avgSum)}/mo`);
console.log(`Spike/lumpy above floor:                        ${money(spikeSum)}/mo  (vs 4,000 שונות buffer)`);
