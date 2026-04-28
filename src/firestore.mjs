import { Firestore } from '@google-cloud/firestore';

let db = null;

export function getDb() {
  if (!db) db = new Firestore();
  return db;
}
