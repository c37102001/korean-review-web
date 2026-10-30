import { todayString } from '../shared/date.js';

export const SHADOWING_SUBTITLE_TAG = '跟讀練習';

export function createShadowingSubtitle(source, selectedIds, date = todayString()) {
  if (!source?.videoId) throw new Error('請先選擇有影片連結的字幕檔案');
  const selected = new Set(selectedIds);
  const entries = source.entries.filter((entry) => selected.has(entry.id)).map((entry) => ({ ...entry }));
  if (!entries.length) throw new Error('請至少勾選一句字幕');
  return {
    title: [date.replaceAll('-', ''), source.tag, source.title].filter(Boolean).join('-'),
    tag: SHADOWING_SUBTITLE_TAG,
    learned: false,
    youtubeUrl: source.youtubeUrl,
    mode: source.mode,
    entries,
    highlights: [],
  };
}
