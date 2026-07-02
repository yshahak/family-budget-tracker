import { readFileSync } from 'fs';
const t = JSON.parse(readFileSync('local-data/budget_transactions.json','utf8'));
const MONTHS = ['2026-02','2026-03','2026-04','2026-05']; // complete months only
const N = MONTHS.length;
const inM = x => x.date && MONTHS.includes(x.date.slice(0,7));
const money = n => Math.round(n).toLocaleString();

// ---- 1. Total outflow / inflow per month ----
console.log('=== TOTALS PER COMPLETE MONTH (Feb–May 2026) ===');
for (const m of MONTHS) {
  const rows = t.filter(x => x.date?.slice(0,7)===m && !x.ignored);
  const out = rows.filter(x=>x.chargedAmount<0).reduce((a,b)=>a+Math.abs(b.chargedAmount),0);
  const inc = rows.filter(x=>x.chargedAmount>0).reduce((a,b)=>a+b.chargedAmount,0);
  console.log(`${m}: outflow ${money(out).padStart(8)} | inflow ${money(inc).padStart(8)} | net ${money(inc-out).padStart(8)}`);
}
const allOut = t.filter(x=>inM(x)&&!x.ignored&&x.chargedAmount<0).reduce((a,b)=>a+Math.abs(b.chargedAmount),0);
const allInc = t.filter(x=>inM(x)&&!x.ignored&&x.chargedAmount>0).reduce((a,b)=>a+b.chargedAmount,0);
console.log(`AVG/mo: outflow ${money(allOut/N)} | inflow ${money(allInc/N)} | net ${money((allInc-allOut)/N)}`);

// ---- 2. Per source/account outflow ----
console.log('\n=== AVG MONTHLY OUTFLOW BY SOURCE/ACCOUNT ===');
const bySrc = {};
for (const x of t) {
  if(!inM(x)||x.ignored||x.chargedAmount>=0) continue;
  const k = `${x.owner} / acct ${x.accountNumber}`;
  bySrc[k]=(bySrc[k]||0)+Math.abs(x.chargedAmount);
}
for (const [k,v] of Object.entries(bySrc).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${k.padEnd(28)} ${money(v/N).padStart(8)}/mo`);

// ---- 3. Per category avg ----
console.log('\n=== AVG MONTHLY SPEND BY CATEGORY (complete months) ===');
const byCat = {};
for (const x of t) {
  if(!inM(x)||x.ignored||x.chargedAmount>=0) continue;
  const c = x.category || '(uncategorized)';
  byCat[c]=(byCat[c]||0)+Math.abs(x.chargedAmount);
}
let catTotal=0;
for (const [c,v] of Object.entries(byCat).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${c.padEnd(16)} ${money(v/N).padStart(8)}/mo`);
  catTotal+=v/N;
}
console.log(`  ${'TOTAL'.padEnd(16)} ${money(catTotal).padStart(8)}/mo`);

// ---- 4. Income detail ----
console.log('\n=== INCOME (positive amounts) AVG/mo, by description ===');
const inc = {};
for (const x of t) {
  if(!inM(x)||x.ignored||x.chargedAmount<=0) continue;
  inc[x.description]=(inc[x.description]||0)+x.chargedAmount;
}
for (const [d,v] of Object.entries(inc).sort((a,b)=>b[1]-a[1]).slice(0,15))
  console.log(`  ${money(v/N).padStart(8)}/mo  ${d}`);

// ---- 5. Top recurring/large expenses by description ----
console.log('\n=== TOP 30 EXPENSES BY TOTAL (Feb–May), avg/mo ===');
const byDesc = {};
for (const x of t) {
  if(!inM(x)||x.ignored||x.chargedAmount>=0) continue;
  if(!byDesc[x.description]) byDesc[x.description]={sum:0,n:0,cat:x.category};
  byDesc[x.description].sum+=Math.abs(x.chargedAmount);
  byDesc[x.description].n++;
}
for (const [d,o] of Object.entries(byDesc).sort((a,b)=>b[1].sum-a[1].sum).slice(0,30))
  console.log(`  ${money(o.sum/N).padStart(7)}/mo (${String(o.n).padStart(2)}x) [${(o.cat||'?').padEnd(12)}] ${d}`);
