import { readFileSync } from 'fs';
const t = JSON.parse(readFileSync('local-data/budget_transactions.json','utf8'));
const M = ['2026-02','2026-03','2026-04','2026-05']; const N = 4;
const inM = x => x.date && M.includes(x.date.slice(0,7));
const money = n => Math.round(n).toLocaleString();

console.log('=== ALL הלוואות txns by description, avg/mo ===');
const loans = {};
for (const x of t) {
  if (!inM(x) || x.ignored || x.chargedAmount>=0 || x.category!=='הלוואות') continue;
  if (!loans[x.description]) loans[x.description] = {s:0,n:0};
  loans[x.description].s += Math.abs(x.chargedAmount); loans[x.description].n++;
}
let lt=0;
for (const [d,o] of Object.entries(loans).sort((a,b)=>b[1].s-a[1].s)) {
  console.log(`  ${money(o.s/N).padStart(6)}/mo (${o.n}x) ${d}`); lt+=o.s/N;
}
console.log('  loans category total:', money(lt));

console.log('\n=== keyword search across ALL outflow txns ===');
const kws = ['לאומי','מזרחי','קקש','פועלים','משכנתא','הוכשטיין','מנורה','השתלמות','הלואה','הלוואה','הוראת-קבע','הו"ק'];
for (const kw of kws) {
  const rows = t.filter(x => inM(x)&&!x.ignored&&x.description?.includes(kw)&&x.chargedAmount<0);
  if (!rows.length) continue;
  const s = rows.reduce((a,b)=>a+Math.abs(b.chargedAmount),0);
  console.log(`  "${kw}": ${money(s/N)}/mo (${rows.length} txns) cats:[${[...new Set(rows.map(r=>r.category))].join(',')}]`);
}
