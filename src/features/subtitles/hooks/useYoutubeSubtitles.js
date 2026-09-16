import { useCallback, useEffect, useState } from 'react';
import { youtubeSubtitlesRepository } from '../../../repositories/userContentRepository.js';
import { createId } from '../../../shared/id.js';
import { normalizeYoutubeSubtitle } from '../../../subtitles/model.js';

export function useYoutubeSubtitles(user, enabled = true) {
  const [state, setState] = useState({ notes: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ notes: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return youtubeSubtitlesRepository.subscribe(
      user.uid,
      (documents) => {
        const notes = documents
          .map((note) => normalizeYoutubeSubtitle(note, note.id))
          .filter((note) => note.title)
          .sort((left, right) => (right.updatedAt || right.createdAt || '').localeCompare(left.updatedAt || left.createdAt || '') || left.title.localeCompare(right.title));
        setState({ notes, loading: false, error: '' });
      },
      (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    );
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input.id || createId();
    const now = new Date().toISOString();
    const note = normalizeYoutubeSubtitle({
      ...input, id, createdAt: input.createdAt || now, updatedAt: now,
    }, id);
    if (!note.title) throw new Error('請輸入字幕筆記標題');
    if (!note.entries.length) throw new Error('請至少加入一個字幕句子');
    if (note.youtubeUrl && !note.videoId) throw new Error('YouTube 連結格式無法辨識，請使用 youtube.com 或 youtu.be 連結');
    await youtubeSubtitlesRepository.save(user.uid, id, note);
    return note;
  }, [user]);

  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await youtubeSubtitlesRepository.remove(user.uid, id);
  }, [user]);

  return { ...state, save, remove };
}
