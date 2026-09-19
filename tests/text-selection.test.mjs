import assert from 'node:assert/strict';
import test from 'node:test';

import { isRepeatedWordActivation } from '../src/features/text-selection/model.js';

test('the same highlighted word opens on a second activation within the gesture window', () => {
  const previous = { key: 'word:4:7', time: 1_000 };
  assert.equal(isRepeatedWordActivation(previous, 'word:4:7', 1_400), true);
  assert.equal(isRepeatedWordActivation(previous, 'other:4:7', 1_200), false);
  assert.equal(isRepeatedWordActivation(previous, 'word:4:7', 1_421), false);
});
