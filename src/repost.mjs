/**
 * One-time cleanup script:
 * 1. Deletes all existing bot messages from Telegram
 * 2. Re-posts transactions from Firestore (sorted by date asc)
 * 3. Updates telegramMessageId in Firestore
 *
 * Usage:
 *   node src/repost.mjs                    # delete existing then re-post all
 *   node src/repost.mjs --no-delete        # re-post all without deleting first
 *   node src/repost.mjs --limit 10         # re-post latest 10 only (for preview)
 */
import './config.mjs';
import { getDb } from './firestore.mjs';
import { getBot } from './notifier.mjs';
import { TELEGRAM_CHAT_ID, DISPLAY_NAME } from './config.mjs';
import { CATEGORY_EMOJI, CATEGORIES } from './categories.mjs';
import { getMonthlyBudgetInfo } from './budget.mjs';

const DELAY_MS = 3500;
const skipDelete = process.argv.includes('--no-delete');
const limit = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatAmount(txn) {
  const sign = txn.chargedAmount > 0 ? '+' : '';
  const abs = Math.abs(txn.chargedAmount).toFixed(2);
  if (txn.originalCurrency === 'ILS') return `${sign}₪${abs}`;
  return `${sign}${txn.originalCurrency} ${Math.abs(txn.originalAmount).toFixed(2)} (₪${abs})`;
}

function budgetLine(info) {
  if (!info) return '';
  const { name, spent, budget } = info;
  const pct = Math.round((spent / budget) * 100);
  const filled = Math.min(Math.round(pct / 10), 10);
  const square = pct >= 100 ? '🟥' : pct >= 80 ? '🟧' : '🟩';
  const bar = square.repeat(filled) + '⬜'.repeat(10 - filled);
  return `\n${bar} ${esc(name)} ₪${Math.round(spent).toLocaleString('he-IL')} / ₪${budget.toLocaleString('he-IL')} (${pct}%)`;
}

function buildText(txn, category, budgetInfo) {
  const amount = formatAmount(txn);
  const date = txn.date.slice(5, 10).replace('-', '/');
  const ownerLabel = DISPLAY_NAME[txn.owner] || txn.owner || '';

  if (category) {
    const emoji = CATEGORY_EMOJI[category] ?? '📦';
    return `${emoji} <b>${esc(txn.description)}</b> — ${esc(amount)}\n📂 ${esc(category)} | 📅 ${date} | 💳 ${txn.accountNumber} (${ownerLabel})${budgetLine(budgetInfo)}`;
  }
  return `❓ <b>${esc(txn.description)}</b> — ${esc(amount)}\n📅 ${date} | 💳 ${txn.accountNumber} (${ownerLabel})\nבחר קטגוריה:`;
}

function categoryKeyboard(txnId, selectedCategory = null) {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 3) {
    rows.push(
      CATEGORIES.slice(i, i + 3).map(cat => ({
        text: `${CATEGORY_EMOJI[cat]} ${cat}${cat === selectedCategory ? ' ✓' : ''}`,
        callback_data: `cat|${txnId}|${cat}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const db = getDb();
  const bot = getBot();

  // Load all transactions sorted by date asc
  const snap = await db.collection('budget_transactions').orderBy('date', 'asc').get();
  let txns = snap.docs.map(d => ({ ref: d.ref, ...d.data() }));

  // Apply limit — take the LAST N (most recent)
  if (isFinite(limit)) {
    txns = txns.slice(-limit);
    console.log(`[repost] Limiting to last ${limit} transactions`);
  }

  console.log(`[repost] Processing ${txns.length} transactions`);

  // Step 1 — delete existing bot messages (skipped with --no-delete)
  if (skipDelete) {
    console.log('\n[repost] Step 1: Skipping delete (--no-delete)');
  } else {
    console.log('\n[repost] Step 1: Deleting existing messages...');
    let deleted = 0;
    let deleteSkipped = 0;
    for (const txn of txns) {
      if (txn.telegramMessageId) {
        try {
          await bot.deleteMessage(TELEGRAM_CHAT_ID, txn.telegramMessageId);
          deleted++;
        } catch (e) {
          console.warn(`  [delete skip] msgId=${txn.telegramMessageId} "${txn.description?.slice(0, 20)}": ${e.message}`);
          deleteSkipped++;
        }
      } else {
        console.warn(`  [no msgId] "${txn.description?.slice(0, 20)}" — was never posted or not tracked`);
        deleteSkipped++;
      }
    }
    console.log(`[repost] Deleted ${deleted}, skipped ${deleteSkipped}`);
  }

  // Step 2 — re-post with budget lines
  console.log('\n[repost] Step 2: Re-posting transactions...');
  let posted = 0;
  for (const txn of txns) {
    const budgetInfo = txn.category ? await getMonthlyBudgetInfo(txn.category) : null;
    const text = buildText(txn, txn.category, budgetInfo);

    try {
      const msg = await bot.sendMessage(TELEGRAM_CHAT_ID, text, {
        parse_mode: 'HTML',
        reply_markup: categoryKeyboard(txn.id, txn.category),
      });

      await txn.ref.update({ telegramMessageId: msg.message_id });
      posted++;
      process.stdout.write(`  [${posted}/${txns.length}] ${txn.description.slice(0, 30)}\n`);
    } catch (e) {
      console.error(`  [error] ${txn.description}: ${e.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n[repost] Done — ${posted} messages posted`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
