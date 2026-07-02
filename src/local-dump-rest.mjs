/**
 * Dumps Firestore collections to local-data/*.json via REST API,
 * using the gcloud CLI access token (avoids ADC identity mismatch).
 * Usage: TOKEN=$(gcloud auth print-access-token) node src/local-dump-rest.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';

const PROJECT = 'shahakbudgethelper';
const TOKEN = process.env.TOKEN;
const OUT_DIR = 'local-data';

if (!TOKEN) { console.error('Set TOKEN env var'); process.exit(1); }

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Convert a Firestore typed value to a plain JS value
function conv(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return convFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(conv);
  return null;
}
function convFields(fields) {
  const o = {};
  for (const [k, val] of Object.entries(fields)) o[k] = conv(val);
  return o;
}

async function dumpCollection(name) {
  const docs = [];
  let pageToken = '';
  do {
    const url = `${BASE}/${name}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) { console.error(`${name}: HTTP ${res.status}`, await res.text()); process.exit(1); }
    const data = await res.json();
    for (const d of data.documents || []) {
      docs.push({ _id: d.name.split('/').pop(), ...convFields(d.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(docs, null, 2));
  console.log(`  ${name}: ${docs.length} docs`);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('Dumping via REST...');
await dumpCollection('budget_transactions');
await dumpCollection('budget_rules');
await dumpCollection('budget_amounts');
console.log('Done.');
