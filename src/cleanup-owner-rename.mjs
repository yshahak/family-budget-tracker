/**
 * One-time cleanup: removes duplicate transactions created when profile names
 * were temporarily renamed from 'yaakov'/'ester' to 'owner1'/'owner2'.
 *
 * Deletes all budget_transactions docs where owner is 'owner1', 'owner1-max',
 * or 'owner2', along with their Telegram messages.
 *
 * Usage: node src/cleanup-owner-rename.mjs [--dry-run]
 */
import { getDb } from './firestore.mjs';
import { getBot } from './notifier.mjs';
import { TELEGRAM_CHAT_ID } from './config.mjs';

const dryRun = process.argv.includes('--dry-run');
const STALE_OWNERS = ['owner1', 'owner1-max', 'owner2'];

console.log(`[cleanup] ${dryRun ? 'DRY RUN — ' : ''}Scanning for stale owner entries...`);

const db = getDb();
let deleted = 0;
let msgDeleted = 0;

for (const owner of STALE_OWNERS) {
  const snap = await db.collection('budget_transactions').where('owner', '==', owner).get();
  console.log(`[cleanup] owner=${owner}: ${snap.size} docs`);

  for (const doc of snap.docs) {
    const txn = doc.data();

    if (txn.telegramMessageId && !dryRun) {
      try {
        await getBot().deleteMessage(TELEGRAM_CHAT_ID, txn.telegramMessageId);
        msgDeleted++;
      } catch (e) {
        // Message may already be deleted or too old — ignore
      }
    }

    console.log(`  ${dryRun ? '[would delete]' : '[deleting]'} ${doc.id} | ${txn.date} | ${txn.description} | ₪${txn.chargedAmount}`);

    if (!dryRun) {
      await doc.ref.delete();
      deleted++;
    }
  }
}

console.log(`[cleanup] Done. ${dryRun ? '(dry run)' : `Deleted ${deleted} docs, ${msgDeleted} Telegram messages.`}`);
process.exit(0);
