import assert from 'node:assert/strict';
import test from 'node:test';
import { createShadowingSubtitle, SHADOWING_SUBTITLE_TAG } from '../src/subtitles/shadowing.js';
import { normalizeYoutubeSubtitle } from '../src/subtitles/model.js';

const source = normalizeYoutubeSubtitle({
  id: 'source', title: 'thoughts', tag: 'Sol', learned: true, mode: 'srt',
  youtubeUrl: 'https://youtu.be/abcdefghijk',
  entries: [
    { id: 'one', ko: '첫 문장', zh: '第一句', startMs: 1000, endMs: 3000 },
    { id: 'two', ko: '두 번째', zh: '第二句', startMs: 5000, endMs: 8000 },
    { id: 'three', ko: '세 번째', zh: '第三句', startMs: 9000, endMs: 10000 },
  ],
});

test('shadowing snapshots preserve source order, text and timing without copying source identity or learned state', () => {
  const result = createShadowingSubtitle(source, ['three', 'one', 'one'], '2026-10-30');
  assert.equal(result.title, '20261030-Sol-thoughts');
  assert.equal(result.tag, SHADOWING_SUBTITLE_TAG);
  assert.equal(result.learned, false);
  assert.equal(result.id, undefined);
  assert.equal(result.mode, 'srt');
  assert.equal(result.youtubeUrl, source.youtubeUrl);
  assert.deepEqual(result.entries, [source.entries[0], source.entries[2]]);
  result.entries[0].ko = 'changed';
  assert.equal(source.entries[0].ko, '첫 문장');
  assert.deepEqual(result.highlights, []);
  assert.equal(normalizeYoutubeSubtitle(result).videoId, source.videoId);
});

test('shadowing requires a video and valid selected sentences and omits an absent source tag in its title', () => {
  assert.throws(() => createShadowingSubtitle(null, []), /影片/);
  assert.throws(() => createShadowingSubtitle({ ...source, videoId: '' }, ['one']), /影片/);
  assert.throws(() => createShadowingSubtitle(source, ['missing']), /至少勾選/);
  assert.equal(createShadowingSubtitle({ ...source, tag: '' }, ['one'], '2026-10-30').title, '20261030-thoughts');
});
