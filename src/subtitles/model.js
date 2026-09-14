export const YT_SUBTITLE_MODE_JSON = 'json';
export const YT_SUBTITLE_MODE_SRT = 'srt';
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
export const UNTAGGED_SUBTITLE_LABEL = '無標籤';

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
    createdAt: String(note?.createdAt || ''),
    updatedAt: String(note?.updatedAt || ''),
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
