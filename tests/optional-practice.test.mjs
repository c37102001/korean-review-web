import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

let server;
let draw;
let helpers;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  helpers = await server.ssrLoadModule('/src/optionalPractice.js');
  draw = helpers.drawPracticeIds;
});
after(async () => { await server?.close(); });

test('unseen questions precede a new round', () => {
  const result = draw(['a', 'b', 'c', 'd'], ['a', 'b'], [], 3, () => 0);
  assert.deepEqual(result.ids, ['c', 'd', 'a']);
  assert.deepEqual(new Set(result.seenIds), new Set(['c', 'd', 'a']));
  assert.deepEqual(draw(['a', 'b', 'c', 'd'], result.seenIds, [], 1, () => 0).ids, ['b']);
});
test('active tasks reserve questions and small pools never duplicate a question', () => {
  assert.deepEqual(draw(['a', 'a', 'b', 'c'], [], ['b'], 10, () => 0).ids, ['a', 'c']);
  assert.deepEqual(draw(['a'], [], ['a'], 10).ids, []);
  assert.deepEqual(draw([], [], [], 10).ids, []);
});
test('changing filters preserves other pools history and newly added questions have priority', () => {
  const result = draw(['a', 'b'], ['a', 'b', 'outside'], [], 1, () => 0);
  assert.ok(result.seenIds.includes('outside'));
  assert.deepEqual(draw(['a', 'new'], ['a'], [], 1, () => 0).ids, ['new']);
});
test('question counts must be bounded positive integers', () => {
  for (const count of [0, -1, 1.5, NaN, 501]) assert.throws(() => draw(['a'], [], [], count));
});

test('task answers are idempotent, persist partial progress and remove a completed task', () => {
  const first = helpers.addPracticeTask({ tasks: [], pools: {} }, { id: 'one', kind: 'words' }, ['a', 'b'], 2);
  assert.equal(helpers.addPracticeTask(first, { id: 'one', kind: 'words' }, ['a', 'b'], 2), first);
  const partial = helpers.answerPracticeTask(first, 'one', 'a', true);
  assert.deepEqual(partial.tasks[0].answeredIds, ['a']);
  assert.equal(helpers.answerPracticeTask(partial, 'one', 'a', true), partial);
  assert.equal(helpers.answerPracticeTask(partial, 'one', 'unknown', true), partial);
  const finished = helpers.answerPracticeTask(partial, 'one', 'b', true);
  assert.deepEqual(finished.tasks, []);
  assert.deepEqual(new Set(finished.pools.words), new Set(['a', 'b']));
  assert.equal(helpers.removePracticeTask(finished, 'one'), finished);
  assert.deepEqual(first.tasks[0].answeredIds, []);
});

test('cancel releases only unanswered questions, and listening/reading histories are independent', () => {
  let state = helpers.addPracticeTask({ tasks: [], pools: {} }, { id: 'one', kind: 'listening' }, ['a', 'b'], 2);
  state = helpers.addPracticeTask(state, { id: 'two', kind: 'reading' }, ['a', 'b'], 2);
  state = helpers.answerPracticeTask(state, 'one', 'a', true);
  state = helpers.removePracticeTask(state, 'one');
  assert.deepEqual(state.pools.listening, ['a']);
  assert.deepEqual(new Set(state.pools.reading), new Set(['a', 'b']));
  assert.equal(state.tasks.length, 1);
});

test('wrong answers finish the current task but immediately return to the drawing pool', () => {
  let state = helpers.addPracticeTask({ tasks: [], pools: {} }, { id: 'one', kind: 'reading' }, ['a', 'b'], 2);
  state = helpers.answerPracticeTask(state, 'one', 'a', false);
  assert.deepEqual(state.tasks[0].answeredIds, ['a']);
  assert.deepEqual(state.pools.reading, ['b']);
  state = helpers.answerPracticeTask(state, 'one', 'b', true);
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.pools.reading, ['b']);
  const next = helpers.addPracticeTask(state, { id: 'two', kind: 'reading' }, ['a', 'b'], 1);
  assert.deepEqual(next.tasks[0].ids, ['a']);
});
