import { firestoreTimestampIso } from '../shared/firestoreTimestamp.js';
import { createId } from '../shared/id.js';

export const YT_SUBTITLE_MODE_JSON = 'json';
export const YT_SUBTITLE_MODE_SRT = 'srt';
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube.com';
export const UNTAGGED_SUBTITLE_LABEL = '無標籤';

function subtitleEntryIds(entries, existingEntries = []) {
  const usedIds = new Set();
  return entries.map((entry, index) => {
    const exact = existingEntries.find((current) => (
      !usedIds.has(current.id)
      && current.ko === entry.ko
      && current.zh === entry.zh
      && current.startMs === entry.startMs
    ));
    if (exact) {
      usedIds.add(exact.id);
      return { ...entry, id: exact.id };
    }
    const samePosition = existingEntries[index];
    if (samePosition?.id && !usedIds.has(samePosition.id)) {
      usedIds.add(samePosition.id);
      return { ...entry, id: samePosition.id };
    }
    return { ...entry, id: createId() };
  });
}

export function parseYoutubeSubtitleJson(text, existingEntries = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('字幕 JSON 格式無法解析');
  }
  if (!parsed || !Array.isArray(parsed.data)) throw new Error('字幕 JSON 必須是包含 data 陣列的物件');
  const entries = parsed.data.map((entry, index) => {
    const ko = String(entry?.ko || '').trim();
    const zh = String(entry?.zh || '').trim();
    if (!ko || !zh) throw new Error(`第 ${index + 1} 句必須同時包含 ko 與 zh`);
    return { ko, zh, startMs: null, endMs: null };
  });
  if (!entries.length) throw new Error('字幕 JSON 至少需要一個句子');
  return subtitleEntryIds(entries, existingEntries);
}

function parseSrtTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4]);
}

function formatSrtTimestamp(value) {
  const milliseconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const fraction = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(fraction).padStart(3, '0')}`;
}

export function parseYoutubeSubtitleSrt(text, existingEntries = []) {
  const blocks = String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
  const entries = blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (/^\d+$/.test(lines[0])) lines.shift();
    const timing = lines.shift()?.match(/^(.+?)\s+-->\s+(.+?)(?:\s+.*)?$/);
    if (!timing) throw new Error(`第 ${index + 1} 段缺少有效的 SRT 時間戳`);
    const startMs = parseSrtTimestamp(timing[1]);
    const endMs = parseSrtTimestamp(timing[2]);
    if (startMs === null || endMs === null) throw new Error(`第 ${index + 1} 段的時間戳格式不正確`);
    if (lines.length < 2) throw new Error(`第 ${index + 1} 段必須提供韓文與中文各一行`);
    return {
      ko: lines[0].replace(/<[^>]+>/g, ''),
      zh: lines.slice(1).join(' ').replace(/<[^>]+>/g, ''),
      startMs,
      endMs,
    };
  });
  if (!entries.length) throw new Error('SRT 至少需要一段字幕');
  return subtitleEntryIds(entries, existingEntries);
}

export function formatYoutubeSubtitleJson(entries = []) {
  return JSON.stringify({ data: entries.map(({ ko, zh }) => ({ ko, zh })) }, null, 2);
}

export function formatYoutubeSubtitleSrt(entries = []) {
  return entries.map((entry, index) => [
    index + 1,
    `${formatSrtTimestamp(entry.startMs)} --> ${formatSrtTimestamp(entry.endMs)}`,
    entry.ko,
    entry.zh,
  ].join('\n')).join('\n\n');
}

export function normalizeYoutubeSubtitle(note, fallbackId = '') {
  const mode = note?.mode === YT_SUBTITLE_MODE_SRT ? YT_SUBTITLE_MODE_SRT : YT_SUBTITLE_MODE_JSON;
  const entries = Array.isArray(note?.entries)
    ? note.entries.map((entry, index) => ({
      id: String(entry?.id || `${fallbackId || 'subtitle'}-entry-${index}`),
      ko: String(entry?.ko || '').trim(),
      zh: String(entry?.zh || '').trim(),
      startMs: Number.isFinite(Number(entry?.startMs)) ? Math.max(0, Math.floor(Number(entry.startMs))) : null,
      endMs: Number.isFinite(Number(entry?.endMs)) ? Math.max(0, Math.floor(Number(entry.endMs))) : null,
    })).filter((entry) => entry.ko && entry.zh)
    : [];
  return {
    id: String(note?.id || fallbackId),
    title: String(note?.title || '').trim(),
    tag: String(note?.tag || '').trim(),
    learned: note?.learned === true,
    youtubeUrl: String(note?.youtubeUrl || '').trim(),
    videoId: youtubeVideoId(note?.youtubeUrl || note?.videoId || ''),
    mode,
    entries,
    createdAt: firestoreTimestampIso(note?.createdAt),
    updatedAt: firestoreTimestampIso(note?.updatedAt),
  };
}

export function youtubeVideoId(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
    }
  } catch {
    return '';
  }
  return '';
}

export function naverDictionaryUrl(query) {
  return `https://korean.dict.naver.com/kozhdict/#/search?query=${encodeURIComponent(String(query || '').trim())}`;
}

export function subtitleEntryAtTime(entries = [], milliseconds) {
  const current = Number(milliseconds);
  if (!Number.isFinite(current)) return null;
  return entries.find((entry) => (
    entry.startMs !== null && current >= entry.startMs && (entry.endMs === null || current < entry.endMs)
  )) || null;
}

export function subtitleTagLabel(note) {
  return String(note?.tag || '').trim() || UNTAGGED_SUBTITLE_LABEL;
}

export function groupYoutubeSubtitlesByTag(notes = []) {
  const groups = new Map();
  notes.forEach((note) => {
    const label = subtitleTagLabel(note);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(note);
  });
  return [...groups.entries()]
    .map(([label, groupedNotes]) => ({ label, notes: groupedNotes }))
    .sort((left, right) => {
      if (left.label === UNTAGGED_SUBTITLE_LABEL) return 1;
      if (right.label === UNTAGGED_SUBTITLE_LABEL) return -1;
      return left.label.localeCompare(right.label, 'zh-TW');
    });
}
