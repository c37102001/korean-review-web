import assert from 'node:assert/strict';
import test from 'node:test';

import { sourceFolderWritePlan } from '../src/services/wordLibraryService.js';

const source = { folderId: 'source-folder', folderName: '閱讀測驗' };

test('source word writes preserve chosen folders and include an existing source folder', () => {
  const plan = sourceFolderWritePlan([
    { id: 'chosen', name: '常用', wordIds: [] },
    { id: 'reading', name: '閱讀測驗', wordIds: [] },
  ], source, ['chosen']);

  assert.deepEqual(plan.folderIds, ['chosen', 'reading']);
  assert.deepEqual(plan.foldersToCreate, []);
});

test('source word writes create the source folder when it does not exist', () => {
  const plan = sourceFolderWritePlan([], source, []);

  assert.deepEqual(plan.folderIds, []);
  assert.equal(plan.foldersToCreate.length, 1);
  assert.equal(plan.foldersToCreate[0].id, 'source-folder');
  assert.equal(plan.foldersToCreate[0].name, '閱讀測驗');
});
