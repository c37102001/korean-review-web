import { useCallback, useEffect, useState } from 'react';
import { normalizeGrammarNote } from '../../../notes/model.js';
import {
  grammarNotesRepository,
  saveUserSetting,
  subscribeUserSetting,
} from '../../../repositories/userContentRepository.js';
import { createId } from '../../../shared/id.js';

const dateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function useGrammarNotes(user, enabled = true) {
  const [state, setState] = useState({
    notes: [], review: null, loading: false, reviewLoading: false, error: '',
  });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ notes: [], review: null, loading: false, reviewLoading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return grammarNotesRepository.subscribe(
      user.uid,
      (documents) => {
        const notes = documents
          .map((note) => normalizeGrammarNote(note, note.id))
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || '') || left.title.localeCompare(right.title));
        setState((current) => ({ ...current, notes, loading: false, error: '' }));
      },
      (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    );
  }, [user, enabled]);

  useEffect(() => {
    if (!user || !enabled) return undefined;
    setState((current) => ({ ...current, reviewLoading: true }));
    return subscribeUserSetting(
      user.uid,
      'grammarReview',
      (review) => setState((current) => ({ ...current, review, reviewLoading: false })),
      (error) => setState((current) => ({ ...current, reviewLoading: false, error: error.message })),
    );
  }, [user, enabled]);

  const save = useCallback(async (input) => {
    if (!user) throw new Error('尚未登入');
    const id = input.id || createId();
    const now = new Date().toISOString();
    const note = normalizeGrammarNote({
      ...input, id, createdAt: input.createdAt || now, updatedAt: now,
    }, id);
    if (!note.title) throw new Error('請輸入筆記標題');
    await grammarNotesRepository.save(user.uid, id, note);
    return note;
  }, [user]);

  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await grammarNotesRepository.remove(user.uid, id);
  }, [user]);

  const completeReview = useCallback(async (note, date = dateKey()) => {
    if (!user) throw new Error('尚未登入');
    const review = {
      lastCompletedGrammarId: note.id,
      lastCompletedCreatedAt: note.createdAt || '',
      completedDate: date,
      updatedAt: new Date().toISOString(),
    };
    await saveUserSetting(user.uid, 'grammarReview', review);
    return review;
  }, [user]);

  return { ...state, save, remove, completeReview };
}
