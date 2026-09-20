import assert from 'node:assert/strict';
import test from 'node:test';

import { isRepeatedWordActivation, koreanTextMatches } from '../src/features/text-selection/model.js';

test('the same highlighted word opens on a second activation within the gesture window', () => {
  const previous = { key: 'word:4:7', time: 1_000 };
  assert.equal(isRepeatedWordActivation(previous, 'word:4:7', 1_400), true);
  assert.equal(isRepeatedWordActivation(previous, 'other:4:7', 1_200), false);
  assert.equal(isRepeatedWordActivation(previous, 'word:4:7', 1_421), false);
});

test('Korean text matches canonical words and variants while preserving every matching card', () => {
  const words = [
    { id: 'hide', ko: '숨기다', variants: ['숨길'], zh: '藏起來' },
    { id: 'other', ko: '숨다', variants: ['숨길'], zh: '躲藏' },
  ];
  const matches = koreanTextMatches('몸을 숨길 곳', words);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].word.id, 'hide');
  assert.deepEqual(matches[0].words.map((word) => word.id), ['hide', 'other']);
  assert.equal(matches[0].start, 3);
  assert.equal(matches[0].end, 5);
});
