import { getAllBucketsStatus, getMonthlyTransactionsForBucket, BUDGET_BUCKETS } from './budget.mjs';
import { CATEGORY_EMOJI } from './categories.mjs';
import { DISPLAY_NAME } from './config.mjs';

const MAX_TXN_LINES = 25;

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bar(spent, budget) {
  const pct = Math.round((spent / budget) * 100);
  const filled = Math.min(Math.round(pct / 10), 10);
  const square = pct >= 100 ? '🟥' : pct >= 80 ? '🟧' : '🟩';
  return { barStr: square.repeat(filled) + '⬜'.repeat(10 - filled), pct };
}

function bucketEmoji(bucket) {
  return CATEGORY_EMOJI[bucket.categories[0]] ?? '📦';
}

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('he-IL', { month: 'long', year: 'numeric' });
}

function monthShortLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('he-IL', { month: 'long' });
}

function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export async function buildSummaryMessage(month = null) {
  const m = month ?? currentMonth();
  const buckets = await getAllBucketsStatus(m);

  const totalBudget = buckets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = buckets.reduce((s, b) => s + b.spent, 0);
  const totalLeft = totalBudget - totalSpent;
  const totalPct = Math.round((totalSpent / totalBudget) * 100);
  const { barStr: totalBar } = bar(totalSpent, totalBudget);
  const sign = totalLeft >= 0 ? '✅' : '🚨';

  const lines = [
    `📊 <b>סטטוס תקציב — ${esc(monthLabel(m))}</b>`,
    ``,
    `${totalBar} <b>סה"כ</b> ₪${Math.round(totalSpent).toLocaleString('he-IL')} / ₪${totalBudget.toLocaleString('he-IL')} (${totalPct}%)`,
    `${sign} נותר: ₪${Math.abs(Math.round(totalLeft)).toLocaleString('he-IL')}${totalLeft < 0 ? ' חריגה!' : ''}`,
    ``,
  ];

  for (const b of buckets) {
    const { barStr, pct } = bar(b.spent, b.amount);
    const spentFmt = Math.round(b.spent).toLocaleString('he-IL');
    const budgetFmt = b.amount.toLocaleString('he-IL');
    lines.push(`${barStr} <b>${esc(b.name)}</b> ₪${spentFmt} / ₪${budgetFmt} (${pct}%)`);
  }

  return lines.join('\n');
}

export function buildSummaryKeyboard(month = null) {
  const m = month ?? currentMonth();
  const isCurrent = m === currentMonth();
  const prev = prevMonth(m);
  const next = nextMonth(m);

  const navRow = [
    { text: `← ${monthShortLabel(prev)}`, callback_data: `status_month|${prev}` },
    { text: monthLabel(m), callback_data: `status_month|${m}` },
  ];
  if (!isCurrent) {
    navRow.push({ text: `${monthShortLabel(next)} →`, callback_data: `status_month|${next}` });
  }

  const rows = [navRow];
  for (let i = 0; i < BUDGET_BUCKETS.length; i += 3) {
    rows.push(
      BUDGET_BUCKETS.slice(i, i + 3).map(b => ({
        text: `${bucketEmoji(b)} ${b.name}`,
        callback_data: `status_bucket|${b.name}|${m}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

// ── Bucket detail ─────────────────────────────────────────────────────────────

export async function buildBucketMessage(bucketName, month = null) {
  const m = month ?? currentMonth();
  const bucket = BUDGET_BUCKETS.find(b => b.name === bucketName);
  if (!bucket) return { text: `לא נמצא קטגוריה: ${bucketName}`, txns: [] };

  const buckets = await getAllBucketsStatus(m);
  const b = buckets.find(b => b.name === bucketName);
  const { barStr, pct } = bar(b.spent, b.amount);
  const spentFmt = Math.round(b.spent).toLocaleString('he-IL');
  const budgetFmt = b.amount.toLocaleString('he-IL');

  const txns = await getMonthlyTransactionsForBucket(bucketName, m);

  const lines = [
    `${bucketEmoji(bucket)} <b>${esc(bucketName)}</b> — ₪${spentFmt} / ₪${budgetFmt} (${pct}%)`,
    barStr,
    '',
  ];

  if (txns.length === 0) {
    lines.push('אין עסקאות החודש.');
  } else {
    const shown = txns.slice(0, MAX_TXN_LINES);
    for (const t of shown) {
      const date = t.date.slice(5, 10).replace('-', '/');
      const amount = Math.abs(t.chargedAmount).toFixed(0);
      const ownerFull = DISPLAY_NAME[t.owner] || t.owner || '';
      const owner = ownerFull.slice(0, 1) + '׳';
      lines.push(`${date}  ${esc(t.description.slice(0, 28))}  <b>₪${amount}</b> ${owner}`);
    }
    if (txns.length > MAX_TXN_LINES) {
      lines.push(`\n<i>... ועוד ${txns.length - MAX_TXN_LINES} עסקאות</i>`);
    }
  }

  return { text: lines.join('\n'), txns };
}

export function buildBucketKeyboard(bucketName, txns = [], month = null) {
  const m = month ?? currentMonth();
  const rows = [];

  for (const t of txns.slice(0, MAX_TXN_LINES)) {
    const date = t.date.slice(5, 10).replace('-', '/');
    const amount = Math.abs(t.chargedAmount).toFixed(0);
    const desc = t.description.slice(0, 22);
    rows.push([{
      text: `${date}  ${desc}  ₪${amount}`,
      callback_data: `txn_detail|${t.id}|${bucketName}|${m}`,
    }]);
  }

  rows.push([{ text: '← חזרה לסטטוס', callback_data: `status_back|${m}` }]);
  return { inline_keyboard: rows };
}
