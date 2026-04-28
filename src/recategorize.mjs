/**
 * One-time script: re-runs categorization on all transactions with category=null.
 * Updates Firestore only — does NOT send Telegram messages.
 * Usage: node src/recategorize.mjs
 */
import './config.mjs';
import { getDb } from './firestore.mjs';
import { categorize } from './categorizer.mjs';

async function main() {
  const db = getDb();
  const snap = await db.collection('budget_transactions')
    .where('category', '==', null)
    .get();

  console.log(`[recategorize] Found ${snap.size} uncategorized transactions`);

  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const txn = doc.data();
    process.stdout.write(`  "${txn.description}" ... `);

    const { category, source } = await categorize(txn.description);

    if (category) {
      await doc.ref.update({ category, categorySource: source, updatedAt: new Date() });
      console.log(`→ ${category} (${source})`);
      updated++;
    } else {
      console.log('→ still unknown');
      skipped++;
    }

    // Stay within Gemini free tier rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n[recategorize] Done — ${updated} updated, ${skipped} still unknown`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
