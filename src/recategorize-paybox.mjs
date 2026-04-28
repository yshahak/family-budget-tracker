/**
 * One-time script: recategorize existing transactions that match PayBox/Bit patterns.
 * Finds all budget_transactions where description matches paybox/ביט/bit patterns
 * and updates their category to 'פייבוקס/ביט'.
 *
 * Usage: node src/recategorize-paybox.mjs [--dry-run]
 */
import { getDb } from './firestore.mjs';

const dryRun = process.argv.includes('--dry-run');
const PATTERNS = ['paybox', 'פייבוקס', 'bit ', 'בbit', 'ביט ', 'בביט', 'העברה ב bit'];

console.log(`[recategorize] ${dryRun ? 'DRY RUN — ' : ''}Scanning transactions...`);

const db = getDb();
const snap = await db.collection('budget_transactions').get();

let updated = 0;
const batch = db.batch();

for (const doc of snap.docs) {
  const t = doc.data();
  const desc = (t.description || '').toLowerCase();

  const matches = PATTERNS.some(p => desc.includes(p.toLowerCase()));
  if (!matches) continue;
  if (t.category === 'פייבוקס/ביט') continue; // already correct

  console.log(`  ${dryRun ? '[would update]' : '[updating]'} ${doc.id} | ${t.date} | ${t.description} | ${t.category} → פייבוקס/ביט`);

  if (!dryRun) {
    batch.update(doc.ref, { category: 'פייבוקס/ביט' });
    updated++;
  }
}

if (!dryRun && updated > 0) {
  await batch.commit();
}

console.log(`[recategorize] Done. ${dryRun ? '(dry run)' : `Updated ${updated} transactions.`}`);
process.exit(0);
