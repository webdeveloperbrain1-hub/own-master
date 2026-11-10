import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeContractInventory } from '../src/app/data/contractInventory';
import type { Contract } from '../src/app/types';
import type { FilingDraftListItem } from '../src/app/data/contractFilingClient';

test('manual progress stages reach lists without treating older ready drafts as signed', () => {
  const account = { id: 'same-id', title: 'Account agreement', contractType: 'License', status: 'completed', updatedAt: '2026-10-25T00:00:00Z' } as Contract;
  const draft: FilingDraftListItem = { id: 'same-id', name: 'Template agreement', status: 'ready', updatedAt: '2026-10-26T00:00:00Z', templateId: 'template', template: { originalName: 'source.pdf', title: 'License', contractType: 'License', category: null } };
  const items = mergeContractInventory([account], [draft], [{ source: 'filing', contractId: 'same-id', status: 'awaiting_signatures', updatedAt: '2026-10-29T00:00:00Z' }]);
  assert.equal(items[0].status, 'awaiting_signatures');
  assert.equal(items[0].updatedAt, '2026-10-29T00:00:00Z');
  assert.equal(items[1].status, 'completed');
  assert.equal(draft.status, 'ready');
});

test('saved template drafts join account contracts in most recently updated order', () => {
  const account = {
    id: 'same-id', title: 'Existing agreement', contractType: 'License', status: 'completed', updatedAt: '2026-10-25T00:00:00Z',
  } as Contract;
  const draft: FilingDraftListItem = {
    id: 'same-id', name: 'Saved agency draft', status: 'ready', updatedAt: '2026-10-27T00:00:00Z', templateId: 'template-id',
    template: { originalName: 'agency.pdf', title: 'Agency Agreement', contractType: 'Agency', category: null },
  };
  const items = mergeContractInventory([account], [draft]);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Saved agency draft');
  assert.equal(items[0].filingDraftId, 'same-id');
  assert.equal(items[0].status, 'draft');
  assert.notEqual(items[0].id, items[1].id);
  assert.equal(items[1].status, 'completed');
  assert.equal(items[1].filingDraftId, undefined);
  assert.equal(account.status, 'completed');
});

test('draft-only inventories appear even when there are no account contracts', () => {
  const draft: FilingDraftListItem = {
    id: 'draft-id', name: 'My draft', status: 'draft', updatedAt: '2026-10-27T00:00:00Z', templateId: 'template-id',
    template: { originalName: 'original.pdf', title: null, contractType: null, category: null },
  };
  assert.equal(mergeContractInventory([], [draft])[0].contractType, 'original.pdf');
  assert.deepEqual(mergeContractInventory([], []), []);
});
