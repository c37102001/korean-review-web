import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

let server;
let StudyKoreanWord;

before(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false },
  });
  ({ StudyKoreanWord } = await server.ssrLoadModule('/src/features/sessions/study/StudyPage.jsx'));
});

after(async () => {
  await server?.close();
});

test('study Korean face shows every distinct conjugation on its own line', () => {
  const markup = renderToStaticMarkup(React.createElement(StudyKoreanWord, {
    item: { ko: '중요하다', variants: ['중요해요', '중요한', '중요해요', '중요하다'] },
  }));
  assert.match(markup, /<strong>중요하다<\/strong>/);
  assert.match(markup, /class="study-korean-variants"[^>]*><span lang="ko">중요해요<\/span><span lang="ko">중요한<\/span><\/div>/);
  assert.equal(markup.match(/중요해요/g)?.length, 1);
});

test('study Korean face omits the variant block when no forms are recorded', () => {
  const markup = renderToStaticMarkup(React.createElement(StudyKoreanWord, { item: { ko: '사과' } }));
  assert.doesNotMatch(markup, /study-korean-variants/);
});
