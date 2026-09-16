import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  excludeLearnedWordIds,
  nextReviewTransition,
  REVIEW_INTERVALS,
  reviewFamiliarityScore,
  wrongQuestionIds,
} from '../src/review-engine/rules.js';

const contract = JSON.parse(await readFile(new URL('../contracts/review-rules-v1.json', import.meta.url), 'utf8'));

test('web review rules match the versioned Web/Terminal contract', () => {
  assert.equal(contract.version, 1);
  assert.deepEqual([...REVIEW_INTERVALS], contract.reviewIntervals);
  contract.familiarityCases.forEach(({ stats, score }) => {
    assert.equal(reviewFamiliarityScore(stats), score);
  });
  contract.scheduleCases.forEach(({ name, expected, ...input }) => {
    assert.deepEqual(nextReviewTransition(input), expected, name);
  });
  contract.wrongPoolCases.forEach(({ events, expected }) => {
    assert.deepEqual(wrongQuestionIds(events), expected);
  });
  contract.learnedExclusionCases.forEach(({ questionWordIds, learnedWordIds, expected }) => {
    assert.deepEqual(excludeLearnedWordIds(questionWordIds, learnedWordIds), expected);
  });
});

test('YT and reading share one selectable-text ownership boundary', async () => {
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/features/text-selection/hooks/useTextSelectionActions.js', import.meta.url), 'utf8');
  assert.equal((main.match(/addEventListener\('selectionchange'/g) || []).length, 0);
  assert.equal((hook.match(/addEventListener\('selectionchange'/g) || []).length, 1);
  assert.match(main, /<SelectableKoreanText/);
  assert.match(main, /<SelectionActionPopover/);
});

test('notes, subtitles and reading use shared library layout primitives', async () => {
  const pages = await Promise.all([
    '../src/features/notes/pages/NotesNotebookPage.jsx',
    '../src/features/subtitles/pages/YoutubeSubtitlesPage.jsx',
    '../src/features/reading/pages/ReadingTestsPage.jsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  pages.forEach((source) => assert.match(source, /LibraryPageShell/));
  assert.match(pages[0], /CollapsibleGroup/);
  assert.match(pages[1], /CollapsibleGroup/);
  assert.match(pages[1], /LearnedVisibilityToggle/);
  assert.match(pages[2], /LearnedVisibilityToggle/);
});
