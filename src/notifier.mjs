import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_URL, DISPLAY_NAME } from './config.mjs';
import { CATEGORIES, CATEGORY_EMOJI } from './categories.mjs';

let bot = null;

export function getBot() {
  if (bot) return bot;
  if (WEBHOOK_URL) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
  } else {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  }
  return bot;
}

function formatAmount(txn) {
  const sign = txn.chargedAmount > 0 ? '+' : '';
  const abs = Math.abs(txn.chargedAmount).toFixed(2);
  const base = txn.originalCurrency === 'ILS'
    ? `${sign}₪${abs}`
    : `${sign}${txn.originalCurrency} ${Math.abs(txn.originalAmount).toFixed(2)} (₪${abs})`;
  return txn.installments ? `${base} (${txn.installments.number}/${txn.installments.total})` : base;
}

export function categoryKeyboard(txnId, selectedCategory = null, ignored = false, backContext = null) {
  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 3) {
    rows.push(
      CATEGORIES.slice(i, i + 3).map(cat => ({
        text: `${CATEGORY_EMOJI[cat]} ${cat}${cat === selectedCategory ? ' ✓' : ''}`,
        callback_data: `cat|${txnId}|${cat}`,
      }))
    );
  }
  rows.push([{
    text: ignored ? '↩️ בטל התעלמות' : '🚫 התעלם',
    callback_data: `ignore|${txnId}`,
  }]);
  if (backContext) {
    rows.push([{ text: '← חזרה', callback_data: `status_bucket|${backContext.bucketName}|${backContext.month}` }]);
  }
  return { inline_keyboard: rows };
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function budgetLine(budgetInfo) {
  if (!budgetInfo) return '';
  const { name, spent, budget } = budgetInfo;
  const pct = Math.round((spent / budget) * 100);
  const spentFmt = Math.round(spent).toLocaleString('he-IL');
  const budgetFmt = budget.toLocaleString('he-IL');
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty = 10 - filled;
  const square = pct >= 100 ? '🟥' : pct >= 80 ? '🟧' : '🟩';
  const bar = square.repeat(filled) + '⬜'.repeat(empty);
  return `\n${bar} ${esc(name)} ₪${spentFmt} / ₪${budgetFmt} (${pct}%)`;
}

export function buildText(txn, accountNumber, owner, category, budgetInfo = null, ignored = false) {
  const amount = formatAmount(txn);
  const date = txn.date.slice(5, 10).replace('-', '/');
  const ownerLabel = DISPLAY_NAME[owner] || owner;

  if (ignored) {
    return `🚫 <s>${esc(txn.description)}</s> — ${esc(amount)}\n📅 ${date} | 💳 ${accountNumber} (${ownerLabel}) | <i>מתעלם</i>`;
  }
  if (category) {
    const emoji = CATEGORY_EMOJI[category] ?? '📦';
    return `${emoji} <b>${esc(txn.description)}</b> — ${esc(amount)}\n📂 ${esc(category)} | 📅 ${date} | 💳 ${accountNumber} (${ownerLabel})${budgetLine(budgetInfo)}`;
  }
  return `❓ <b>${esc(txn.description)}</b> — ${esc(amount)}\n📅 ${date} | 💳 ${accountNumber} (${ownerLabel})\nבחר קטגוריה:`;
}

export async function sendTransaction(txn, accountNumber, owner, txnId, category, budgetInfo = null) {
  const text = buildText(txn, accountNumber, owner, category, budgetInfo, false);
  const msg = await getBot().sendMessage(TELEGRAM_CHAT_ID, text, {
    parse_mode: 'HTML',
    reply_markup: categoryKeyboard(txnId, category, false),
  });
  return msg.message_id;
}

export async function updateMessageText(messageId, txn, accountNumber, owner, txnId, category, budgetInfo = null, ignored = false, backContext = null) {
  const text = buildText(txn, accountNumber, owner, category, budgetInfo, ignored) + (category && !ignored ? ' ✅' : '');
  try {
    await getBot().editMessageText(text, {
      chat_id: TELEGRAM_CHAT_ID,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: categoryKeyboard(txnId, category, ignored, backContext),
    });
  } catch (e) {
    if (!e.message?.includes('message is not modified')) throw e;
  }
}
