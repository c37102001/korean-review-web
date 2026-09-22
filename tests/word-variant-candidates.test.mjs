import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVariantPlan, proposeWordVariants } from '../scripts/word-variant-candidates.mjs';

function word(ko, pos, variants) {
  return { item: { ko, pos, ...(variants === undefined ? {} : { variants }) } };
}

test('common action and descriptive predicates receive their polite and modifier forms', () => {
  assert.deepEqual(proposeWordVariants(word('구르다', '動詞')).additions, ['굴러요']);
  assert.deepEqual(proposeWordVariants(word('크다', '形容詞')).additions, ['커요', '큰']);
  assert.deepEqual(proposeWordVariants(word('중요하다', '形容詞')).additions, ['중요해요', '중요한']);
  assert.deepEqual(proposeWordVariants(word('돕다', '動詞')).additions, ['도와요']);
  assert.deepEqual(proposeWordVariants(word('걷다', '動詞')).additions, ['걸어요', '걷어요']);
  assert.deepEqual(proposeWordVariants(word('예쁘다', '形容詞')).additions, ['예뻐요', '예쁜']);
});

test('lexical homographs and irregular forms use their recorded meanings', () => {
  assert.deepEqual(proposeWordVariants(word('묻다', '動詞')).additions, ['묻어요']);
  assert.deepEqual(proposeWordVariants(word('붓다', '動詞')).additions, ['부어요', '붓어요']);
  assert.deepEqual(proposeWordVariants(word('이르다', '動詞')).additions, ['이르러요', '일러요']);
  assert.deepEqual(proposeWordVariants(word('띠다', '動詞')).additions, ['띠어요']);
  assert.deepEqual(proposeWordVariants(word('계시다', '動詞')).additions, ['계세요']);
  assert.deepEqual(proposeWordVariants(word('필연적이다', '形容詞')).additions, ['필연적이에요', '필연적인']);
  assert.deepEqual(proposeWordVariants(word('보편적', '形容詞')).additions, ['보편적인']);
});

test('existing variants survive and only absent forms are proposed', () => {
  assert.deepEqual(proposeWordVariants(word('크다', '形容詞', ['커요', '특별형'])).additions, ['큰']);
  assert.deepEqual(proposeWordVariants(word('크다', '形容詞', ['커요', '큰'])).additions, []);
});

test('noun, phrase, malformed predicate and tombstone are never changed', () => {
  assert.deepEqual(proposeWordVariants(word('사과', '名詞')).additions, []);
  assert.deepEqual(proposeWordVariants(word('피해를 보다', '片語')).additions, []);
  assert.deepEqual(proposeWordVariants(word('조용', '形容詞')).additions, []);
  assert.deepEqual(proposeWordVariants(word('크다', '形容詞', '커요')).additions, []);
  const plan = buildVariantPlan([
    { _docId: 'active', ...word('크다', '形容詞') },
    { _docId: 'removed', deletedAt: '2026-09-22T00:00:00Z', ...word('구르다', '動詞') },
  ]);
  assert.deepEqual(plan.changes.map((change) => change.id), ['active']);
});
