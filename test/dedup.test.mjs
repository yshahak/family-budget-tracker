import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeTxnId, makePendingId, filterNewWithDb } from '../src/dedup.mjs';

// --- Helpers ---

function makeTxn({ date = '2026-06-01', identifier, description = 'Super Market', chargedAmount = 100 } = {}) {
  return { date, identifier, description, chargedAmount, status: 'completed' };
}

function makeDb(docs = {}) {
  // docs: { [docId]: dataObject | null }
  const store = new Map(Object.entries(docs));
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const data = store.get(id);
              return {
                exists: data !== undefined,
                data: () => data,
              };
            },
            async update(fields) {
              const existing = store.get(id) ?? {};
              store.set(id, { ...existing, ...fields });
            },
          };
        },
        // expose store for assertions
        _store: store,
      };
    },
    _store: store,
  };
}

// --- makeTxnId ---

describe('makeTxnId', () => {
  test('uses identifier when present', () => {
    const txn = makeTxn({ identifier: 'ID-123', description: 'Shop' });
    const id = makeTxnId(txn, 'acc1', 'owner1');
    // Should not match the description-based hash
    const descId = makePendingId(txn, 'acc1', 'owner1');
    assert.notEqual(id, descId);
  });

  test('falls back to description when identifier is absent', () => {
    const txn = makeTxn({ identifier: undefined, description: 'Shop' });
    const id = makeTxnId(txn, 'acc1', 'owner1');
    const pendingId = makePendingId(txn, 'acc1', 'owner1');
    assert.equal(id, pendingId);
  });

  test('two txns with different identifiers get different IDs', () => {
    const txn1 = makeTxn({ identifier: 'ID-001' });
    const txn2 = makeTxn({ identifier: 'ID-002' });
    assert.notEqual(
      makeTxnId(txn1, 'acc1', 'owner1'),
      makeTxnId(txn2, 'acc1', 'owner1'),
    );
  });
});

// --- makePendingId ---

describe('makePendingId', () => {
  test('always uses description regardless of identifier', () => {
    const txnWith = makeTxn({ identifier: 'ID-123', description: 'Shop' });
    const txnWithout = makeTxn({ identifier: undefined, description: 'Shop' });
    assert.equal(
      makePendingId(txnWith, 'acc1', 'owner1'),
      makePendingId(txnWithout, 'acc1', 'owner1'),
    );
  });

  test('different descriptions produce different pending IDs', () => {
    const txn1 = makeTxn({ description: 'Shop A' });
    const txn2 = makeTxn({ description: 'Shop B' });
    assert.notEqual(
      makePendingId(txn1, 'acc1', 'owner1'),
      makePendingId(txn2, 'acc1', 'owner1'),
    );
  });
});

// --- filterNewWithDb ---

describe('filterNewWithDb', () => {
  test('all truly new (db empty) → returns all in newTxns, pendingResolved = 0', async () => {
    const txns = [
      makeTxn({ identifier: 'ID-A', description: 'Market' }),
      makeTxn({ identifier: 'ID-B', description: 'Pharmacy' }),
    ];
    const db = makeDb();
    const { newTxns, pendingResolved } = await filterNewWithDb(txns, 'acc1', 'owner1', db);
    assert.equal(newTxns.length, 2);
    assert.equal(pendingResolved, 0);
    // Each result should have _id set
    assert.ok(newTxns[0]._id);
    assert.ok(newTxns[1]._id);
  });

  test('already known (completed doc exists at hash) → skips, newTxns is empty', async () => {
    const txn = makeTxn({ identifier: 'ID-A', description: 'Market' });
    const id = makeTxnId(txn, 'acc1', 'owner1');
    const db = makeDb({ [id]: { status: 'completed', description: 'Market' } });
    const { newTxns, pendingResolved } = await filterNewWithDb([txn], 'acc1', 'owner1', db);
    assert.equal(newTxns.length, 0);
    assert.equal(pendingResolved, 0);
  });

  test('pending→completed resolution: pending doc at pendingId, id !== pendingId → pendingResolved = 1, newTxns empty, doc updated', async () => {
    // pending txn has no identifier → pendingId = id at that point
    const pendingTxn = makeTxn({ identifier: undefined, description: 'Market', chargedAmount: 50 });
    const pendingId = makePendingId(pendingTxn, 'acc1', 'owner1');

    // completed txn has identifier → different id
    const completedTxn = makeTxn({ identifier: 'ID-REAL', description: 'Market', chargedAmount: 50 });
    const completedId = makeTxnId(completedTxn, 'acc1', 'owner1');

    // Sanity: they must be different for this test to be meaningful
    assert.notEqual(completedId, pendingId);

    // DB has the pending doc stored at pendingId
    const db = makeDb({ [pendingId]: { status: 'pending', description: 'Market' } });

    const { newTxns, pendingResolved } = await filterNewWithDb([completedTxn], 'acc1', 'owner1', db);

    assert.equal(newTxns.length, 0);
    assert.equal(pendingResolved, 1);

    // The pending doc should be updated
    const col = db.collection('budget_transactions');
    const updatedData = col._store.get(pendingId);
    assert.equal(updatedData.status, 'completed');
    assert.equal(updatedData.identifier, 'ID-REAL');
    assert.ok(updatedData.resolvedAt instanceof Date);
  });
});
