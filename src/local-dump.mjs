/**
 * Dumps Firestore collections to local-data/*.json for offline analysis.
 * Usage: node src/local-dump.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import './config.mjs';
import { getDb } from './firestore.mjs';

const OUT_DIR = 'local-data';

async function dumpCollection(name) {
  const snap = await getDb().collection(name).get();
  const docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  // Firestore Timestamps → ISO strings
  const serialized = JSON.parse(JSON.stringify(docs, (_, v) =>
    v?.toDate ? v.toDate().toISOString() : v
  ));
  const path = `${OUT_DIR}/${name}.json`;
  writeFileSync(path, JSON.stringify(serialized, null, 2));
  console.log(`  ${name}: ${docs.length} docs → ${path}`);
  return docs.length;
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('Dumping Firestore collections...');
await dumpCollection('budget_transactions');
await dumpCollection('budget_rules');
await dumpCollection('budget_amounts');
console.log('Done.');
process.exit(0);
