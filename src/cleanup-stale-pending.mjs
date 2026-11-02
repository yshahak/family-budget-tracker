/**
 * One-time cleanup: deletes Hapoalim `pending` docs older than 2 days. Hapoalim pending lines
 * settle within days, so anything still pending long after is a ghost double-counting its
 * completed twin. Backs docs up to local-data/ before deleting.
 *
 * Usage: node src/cleanup-stale-pending.mjs [--dry-run]
 */
import './config.mjs';
import fs from 'fs';
import { getDb } from './firestore.mjs';

const dryRun = process.argv.includes('--dry-run');
const cutoff = new Date(Date.now() - 2 * 86400000);
const snap = await getDb().collection('budget_transactions').where('status', '==', 'pending').get();
const stale = snap.docs.filter(d => {
  const x = d.data();
  return /^\d{2}-\d{3}-\d+$/.test(x.accountNumber ?? '') && x.date && new Date(x.date) < cutoff;
});
for (const d of stale) console.log(dryRun ? '[DRY RUN] would delete' : 'deleting', d.id, d.data().date, d.data().chargedAmount, d.data().description);
if (!dryRun && stale.length) {
  fs.mkdirSync('local-data', { recursive: true });
  fs.writeFileSync(`local-data/stale-pending-backup-${Date.now()}.json`, JSON.stringify(stale.map(d => ({ id: d.id, ...d.data() })), null, 2));
  for (const d of stale) await d.ref.delete();
}
console.log(`${stale.length} stale pending docs${dryRun ? '' : ' deleted'}`);
