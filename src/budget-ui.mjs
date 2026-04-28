import { BUDGET_BUCKETS, getAllBucketsStatus, getAmountOverrides } from './budget.mjs';
import { CATEGORY_EMOJI } from './categories.mjs';

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bucketEmoji(bucket) {
  return CATEGORY_EMOJI[bucket.categories[0]] ?? '📦';
}

export async function buildBudgetMessage() {
  const overrides = await getAmountOverrides();
  const buckets = BUDGET_BUCKETS.map(b => ({ ...b, amount: overrides[b.name] ?? b.amount }));
  const total = buckets.reduce((s, b) => s + b.amount, 0);

  const lines = [
    `💰 <b>ניהול תקציב חודשי</b>`,
    `סה"כ תקציב: ₪${total.toLocaleString('he-IL')}\n`,
  ];
  for (const b of buckets) {
    lines.push(`${bucketEmoji(b)} ${esc(b.name).padEnd(12)} ₪${b.amount.toLocaleString('he-IL')}`);
  }
  return lines.join('\n');
}

export function buildBudgetKeyboard() {
  const rows = [];
  for (let i = 0; i < BUDGET_BUCKETS.length; i += 2) {
    rows.push(
      BUDGET_BUCKETS.slice(i, i + 2).map(b => ({
        text: `✏️ ${b.name}`,
        callback_data: `budget_edit|${b.name}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}
