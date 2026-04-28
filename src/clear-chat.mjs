/**
 * Deletes ALL messages in the Telegram group by brute-forcing message ID range.
 * Works because: group is new, all messages are from the bot, IDs are sequential integers.
 * Usage: node src/clear-chat.mjs
 */
import './config.mjs';
import { getDb } from './firestore.mjs';
import { getBot } from './notifier.mjs';
import { TELEGRAM_CHAT_ID } from './config.mjs';

async function main() {
  const bot = getBot();
  const db = getDb();

  // Find the max known message ID from Firestore to set the range ceiling
  const snap = await db.collection('budget_transactions').get();
  const msgIds = snap.docs
    .map(d => d.data().telegramMessageId)
    .filter(Boolean);

  const maxKnown = msgIds.length ? Math.max(...msgIds) : 500;
  const minId = 1;
  const maxId = maxKnown + 50; // buffer for any untracked messages

  console.log(`[clear] Attempting to delete message IDs ${minId}–${maxId} in chat ${TELEGRAM_CHAT_ID}`);

  let deleted = 0;
  let failed = 0;

  for (let id = minId; id <= maxId; id++) {
    try {
      await bot.deleteMessage(TELEGRAM_CHAT_ID, id);
      deleted++;
      process.stdout.write(`\r[clear] Deleted: ${deleted}  Failed/missing: ${failed}  (id=${id})`);
    } catch (e) {
      failed++;
    }
    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 50));
  }

  // Also clear all telegramMessageId from Firestore
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, { telegramMessageId: null });
  }
  await batch.commit();

  console.log(`\n[clear] Done — deleted ${deleted} messages, ${failed} were missing/already gone`);
  console.log(`[clear] Cleared telegramMessageId from ${snap.size} Firestore docs`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
