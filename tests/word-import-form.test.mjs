import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

let server;
let wordImportForm;

before(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
  });
  wordImportForm = await server.ssrLoadModule('/src/features/word-import/components/WordImportForm.jsx');
});

after(async () => server?.close());

test('standard add form accepts a prefilled Korean word without prepopulating other fields', () => {
  const markup = renderToStaticMarkup(React.createElement(wordImportForm.AddItemsForm, {
    title: '新增單字',
    date: '2026-09-19',
    initialKo: '언제나',
    onAddRecords: () => {},
  }));

  assert.match(markup, /表單/);
  assert.match(markup, /JSON/);
  assert.match(markup, /value="언제나"/);
  assert.match(markup, /value="2026-09-19"/);
  assert.doesNotMatch(markup, /例句已自動帶入|已學會/);
});

test('standard add form can prefill and manage highlighted surface forms', () => {
  const markup = renderToStaticMarkup(React.createElement(wordImportForm.AddItemsForm, {
    title: '新增單字',
    date: '2026-09-20',
    initialKo: '숨길',
    initialVariants: ['숨길'],
    onAddRecords: () => {},
  }));

  assert.match(markup, /活用形式（選填）/);
  assert.match(markup, /숨길/);
  assert.match(markup, /placeholder="例如：숨길"/);
});
