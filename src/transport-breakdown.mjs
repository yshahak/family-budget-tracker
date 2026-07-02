import { readFileSync } from 'fs';
const t = JSON.parse(readFileSync('local-data/budget_transactions.json','utf8'));
const M = ['2026-02','2026-03','2026-04','2026-05']; const N = 4;
const inM = x => x.date && M.includes(x.date.slice(0,7));
const money = n => Math.round(n).toLocaleString();

// classify transport txns
const FUEL = ['סונול','פז ','דלק','תחנת','ספרינט','זר תחנות','אלון','דור אלון','סדש'];
const INS  = ['ביטוח','ליברה','כלל ','מנורה','איתוראן'];
const TOLLPARK = ['כביש 6','פנגו','רב-פס','רב פס','מ.תחבורה','חניון','פנגו'];
const MAINT = ['מכונאי','פאמפי','מוסך','צמיג','אלוני','גלגל','מכונא'];

function bucket(d){
  if (MAINT.some(k=>d.includes(k))) return 'maintenance';
  if (INS.some(k=>d.includes(k))) return 'insurance';
  if (TOLLPARK.some(k=>d.includes(k))) return 'toll/park/track';
  if (FUEL.some(k=>d.includes(k))) return 'fuel';
  return 'other';
}

const groups = {fuel:{},insurance:{},'toll/park/track':{},maintenance:{},other:{}};
for (const x of t) {
  if (!inM(x)||x.ignored||x.chargedAmount>=0||x.category!=='תחבורה') continue;
  const b = bucket(x.description||'');
  groups[b][x.description] = (groups[b][x.description]||0) + Math.abs(x.chargedAmount);
}

let grand=0;
for (const [g,items] of Object.entries(groups)) {
  const subtotal = Object.values(items).reduce((a,b)=>a+b,0);
  if (!subtotal) continue;
  console.log(`\n── ${g.toUpperCase()} — ${money(subtotal/N)}/mo (${money(subtotal)} over 4mo) ──`);
  for (const [d,s] of Object.entries(items).sort((a,b)=>b[1]-a[1]))
    console.log(`   ${money(s/N).padStart(6)}/mo  ${money(s).padStart(6)} tot  ${d}`);
  grand+=subtotal;
}
console.log(`\nתחבורה GRAND TOTAL: ${money(grand/N)}/mo`);

// vacation yearly view
console.log('\n=== נסיעות (travel) monthly + 4mo total ===');
const tv = {};
for (const x of t) {
  if (!inM(x)||x.ignored||x.chargedAmount>=0||x.category!=='נסיעות') continue;
  const m=x.date.slice(0,7); tv[m]=(tv[m]||0)+Math.abs(x.chargedAmount);
}
let vt=0; for(const m of M){console.log(`   ${m}: ${money(tv[m]||0)}`); vt+=tv[m]||0;}
console.log(`   4-month total: ${money(vt)}  → avg ${money(vt/N)}/mo`);
