import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

let server;
let presentation;
let collectionView;

before(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
  });
  presentation = await server.ssrLoadModule('/src/features/word-library/components/WordPresentation.jsx');
  collectionView = await server.ssrLoadModule('/src/features/word-library/components/WordCollectionView.jsx');
});

after(async () => {
  await server?.close();
});

const word = {
  id: 'word-1',
  ko: '어쩌피',
  zh: '反正、終究',
  pos: '副詞',
  date: '2026-09-16',
  total: 4,
  score: -2,
  level: '不熟悉',
  meanings: [{
    id: 'meaning-1',
    zh: '反正',
    pattern: '어차피 + 結果',
    examples: [{ id: 'example-1', ko: '어차피 해야 해요.', zh: '反正都得做。' }],
  }],
  notes: ['**口語**中常用。'],
  related: [],
};

test('the canonical word card owns the list layout, actions, metadata and folder tags', () => {
  const markup = renderToStaticMarkup(React.createElement(presentation.WordCard, {
    word,
    folders: [{ id: 'folder-1', name: '常用副詞', wordIds: ['word-1'] }],
    onSpeak: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onOpen: () => {},
    onToggleStar: () => {},
    selectable: true,
    selected: true,
    onToggleSelected: () => {},
    onToggleChinese: () => {},
  }));

  assert.match(markup, /class="word-card clickable-card selected-word-card"/);
  assert.match(markup, /class="card-head word-card-head"/);
  assert.match(markup, /熟悉分數 -2/);
  assert.match(markup, /常用副詞/);
  assert.match(markup, /不熟悉/);
  assert.match(markup, /aria-label="顯示中文"/);
  assert.doesNotMatch(markup, /反正、終究/);
  assert.doesNotMatch(markup, /note-card|compact-card/);
});

test('word card Chinese meaning is opt-in', () => {
  const markup = renderToStaticMarkup(React.createElement(presentation.WordCard, {
    word,
    showChinese: true,
    onToggleChinese: () => {},
  }));

  assert.match(markup, /aria-label="隱藏中文"/);
  assert.match(markup, /class="word-card-meaning">反正、終究/);
});

test('word details are shared by detail, study and practice surfaces', () => {
  const markup = renderToStaticMarkup(React.createElement(presentation.WordDetails, {
    word,
    onSpeak: () => {},
  }));

  assert.match(markup, /어차피 \+ 結果/);
  assert.match(markup, /어차피 해야 해요\./);
  assert.match(markup, /反正都得做。/);
  assert.match(markup, /<strong>口語<\/strong>/);
});

test('hidden-Chinese study details keep Korean examples without leaking translations', () => {
  const markup = renderToStaticMarkup(React.createElement(presentation.WordDetails, {
    word,
    onSpeak: () => {},
    showChinese: false,
  }));

  assert.match(markup, /어차피 해야 해요\./);
  assert.doesNotMatch(markup, /反正都得做。|어차피 \+ 結果|口語/);
});

test('folder collections keep remove-membership and permanent-delete actions distinct', () => {
  const collection = {
    pagedItems: [word],
    selectedIds: ['word-1'],
    setSelectedIds: () => {},
    toggleSelected: () => {},
    visibleIds: ['word-1'],
    pageCount: 1,
    pageNumber: 1,
    setPageNumber: () => {},
    totalCount: 1,
  };
  const markup = renderToStaticMarkup(React.createElement(collectionView.WordCollectionView, {
    collection,
    folders: [{ id: 'folder-1', name: '常用副詞', wordIds: ['word-1'] }],
    onSpeak: () => {},
    onOpen: () => {},
    onEdit: () => {},
    onDelete: () => {},
    deleteLabel: '從資料夾移除',
    deleteConfirmMessage: () => '只移除資料夾關聯',
    onToggleStar: () => {},
    onAssignFolders: () => {},
    onCreateFolderAndAssign: () => {},
    onDeleteRecords: () => {},
    currentFolder: { id: 'folder-1', name: '常用副詞' },
    onRemoveFromCurrentFolder: () => {},
  }));

  assert.match(markup, /aria-label="從資料夾移除"/);
  assert.match(markup, /移出資料夾/);
  assert.match(markup, /永久刪除/);
});
