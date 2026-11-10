import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRecovery, recoveryKey, removeRecovery, writeRecovery } from '../src/app/data/draftRecovery.ts';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const document = { templateId: 'template-a', name: 'Working draft', text: 'Artist: New name\nFee: $500', html: '<p>Artist: New name</p><p>Fee: $500</p>', baseUpdatedAt: '2026-11-03T00:00:00.000Z' };

test('recovery preserves the latest complete document, formatting, and saved-version reference', () => {
  const store = storage();
  const key = recoveryKey('owner-a', 'saved-contract:one');
  writeRecovery(store, key, { ...document, text: 'Earlier edit' });
  assert.equal(writeRecovery(store, key, document), true);
  const copy = readRecovery(store, key)!;
  for (const field of Object.keys(document) as (keyof typeof document)[]) assert.equal(copy[field], document[field]);
  assert.equal(copy.version, 1);
  assert.ok(Number.isFinite(Date.parse(copy.recoveredAt)));
});

test('owners, projects, and individual contracts have separate recovery copies', () => {
  const store = storage();
  const key = recoveryKey('owner-a', 'new-contract:song-a');
  writeRecovery(store, key, document);
  assert.equal(readRecovery(store, recoveryKey('owner-b', 'new-contract:song-a')), null);
  assert.equal(readRecovery(store, recoveryKey('owner-a', 'new-contract:song-b')), null);
  assert.equal(readRecovery(store, recoveryKey('owner-a', 'saved-contract:one')), null);
  assert.notEqual(recoveryKey('a:b', 'c'), recoveryKey('a', 'b:c'));
});

test('saving or explicitly discarding removes only the selected recovery copy', () => {
  const store = storage();
  writeRecovery(store, 'one', document);
  writeRecovery(store, 'two', document);
  removeRecovery(store, 'one');
  assert.equal(readRecovery(store, 'one'), null);
  assert.ok(readRecovery(store, 'two'));
});

test('invalid recovery data is ignored without interrupting the editor', () => {
  const store = storage();
  for (const value of ['{', 'null', '[]', JSON.stringify({ ...document, version: 2 }), JSON.stringify({ ...document, version: 1, recoveredAt: 'invalid' }), JSON.stringify({ ...document, html: 123, version: 1, recoveredAt: new Date().toISOString() })]) {
    store.setItem('draft', value);
    assert.equal(readRecovery(store, 'draft'), null);
  }
});

test('blocked or full browser storage does not crash editing or navigation', () => {
  const fail = () => { throw new Error('Storage unavailable'); };
  const store = { getItem: fail, setItem: fail, removeItem: fail };
  assert.equal(readRecovery(store, 'draft'), null);
  assert.equal(writeRecovery(store, 'draft', document), false);
  assert.doesNotThrow(() => removeRecovery(store, 'draft'));
});
