import puppeteer from 'puppeteer';
import { CATEGORY_EMOJI } from './categories.mjs';

const BROWSER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote',
];

function barColor(pct) {
  if (pct >= 115) return '#c62828';
  if (pct >= 100) return '#ef5350';
  if (pct >= 90)  return '#ff7043';
  if (pct >= 75)  return '#ffa726';
  return '#66bb6a';
}

function bucketEmoji(bucket) {
  return CATEGORY_EMOJI[bucket.categories[0]] ?? '📦';
}

function buildHtml(buckets, label) {
  const totalBudget = buckets.reduce((s, b) => s + b.amount, 0);
  const totalSpent  = buckets.reduce((s, b) => s + b.spent,  0);
  const totalPct    = Math.round((totalSpent / totalBudget) * 100);
  const totalColor  = barColor(totalPct);

  const rows = buckets.map(b => {
    const pct      = b.amount > 0 ? Math.round((b.spent / b.amount) * 100) : 0;
    const barW     = Math.min(pct, 100);
    const color    = barColor(pct);
    const pctColor = pct >= 100 ? '#c62828' : pct >= 90 ? '#e65100' : pct >= 75 ? '#f57c00' : '#2e7d32';
    const spent    = Math.round(b.spent).toLocaleString('he-IL');
    const budget   = b.amount.toLocaleString('he-IL');
    return `
    <div class="row">
      <div class="name">${b.name}</div>
      <div class="bar-wrap">
        <div class="bar-track">
          <div class="bar-fill" style="width:${barW}%;background:${color}"></div>
        </div>
      </div>
      <div class="meta">
        <span class="amounts">₪${spent} / ₪${budget}</span>
        <span class="pct" style="color:${pctColor}">${pct}%</span>
      </div>
    </div>`;
  }).join('');

  const tSpent  = Math.round(totalSpent).toLocaleString('he-IL');
  const tBudget = Math.round(totalBudget).toLocaleString('he-IL');
  const tBarW   = Math.min(totalPct, 100);

  return `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@400;600;700&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box }
body {
  font-family: 'Noto Sans Hebrew', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  background: #eef1f5;
  width: 520px;
  padding: 10px;
  direction: rtl;
}
#card {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,.1);
}
.header {
  background: linear-gradient(135deg, #1a237e, #3949ab);
  color: #fff;
  padding: 13px 18px;
  text-align: center;
  font-size: 17px;
  font-weight: 700;
}
.total {
  background: #263238;
  color: #fff;
  padding: 10px 16px;
}
.total-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 14px;
}
.t-label   { font-weight: 700 }
.t-amounts { flex: 1; opacity: .85; font-size: 13px }
.t-pct     { font-weight: 700; font-size: 15px; color: ${totalColor} }
.t-track   { height: 10px; background: rgba(255,255,255,.2); border-radius: 5px; overflow: hidden }
.t-fill    { height: 100%; border-radius: 5px; width: ${tBarW}%; background: ${totalColor} }
.rows      { padding: 3px 0 }
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border-bottom: 1px solid #f0f0f0;
}
.row:last-child { border-bottom: none }
.name      { min-width: 90px; font-size: 13px; font-weight: 600; white-space: nowrap }
.bar-wrap  { flex: 1 }
.bar-track { height: 8px; background: #e8ecef; border-radius: 4px; overflow: hidden }
.bar-fill  { height: 100%; border-radius: 4px }
.meta      { display: flex; flex-direction: column; align-items: flex-end; min-width: 115px }
.amounts   { font-size: 11px; color: #888; white-space: nowrap }
.pct       { font-size: 13px; font-weight: 700 }
</style></head>
<body><div id="card">
  <div class="header">📊 סטטוס תקציב — ${label}</div>
  <div class="total">
    <div class="total-info">
      <span class="t-label">סה"כ</span>
      <span class="t-amounts">₪${tSpent} / ₪${tBudget}</span>
      <span class="t-pct">${totalPct}%</span>
    </div>
    <div class="t-track"><div class="t-fill"></div></div>
  </div>
  <div class="rows">${rows}</div>
</div></body></html>`;
}

export async function renderStatusImage(buckets, label) {
  const html = buildHtml(buckets, label);
  const browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 540, height: 900 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await Promise.race([
      page.evaluate(() => document.fonts.ready),
      new Promise(r => setTimeout(r, 4000)),
    ]);
    const el = await page.$('#card');
    return await el.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}
