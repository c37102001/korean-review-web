import { useEffect, useState } from 'react';

function includesId(ids, wordId) {
  const normalizedId = String(wordId || '').trim();
  if (!normalizedId) return false;
  if (ids instanceof Set) return ids.has(normalizedId);
  return Array.isArray(ids) && ids.some((id) => String(id || '').trim() === normalizedId);
}

function updateOptimisticSets(wordId, active, setAdded, setRemoved) {
  const id = String(wordId);
  if (active) {
    setAdded((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setRemoved((current) => new Set(current).add(id));
    return;
  }
  setAdded((current) => new Set(current).add(id));
  setRemoved((current) => {
    const next = new Set(current);
    next.delete(id);
    return next;
  });
}

export function useWordClassification({
  learnedWordIds = new Set(),
  unfamiliarWordIds = new Set(),
  onToggleLearned,
  onToggleUnfamiliar,
}) {
  const [addedLearned, setAddedLearned] = useState(() => new Set());
  const [removedLearned, setRemovedLearned] = useState(() => new Set());
  const [addedUnfamiliar, setAddedUnfamiliar] = useState(() => new Set());
  const [removedUnfamiliar, setRemovedUnfamiliar] = useState(() => new Set());
  const [saving, setSaving] = useState('');
  const [errors, setErrors] = useState({ learned: '', unfamiliar: '' });

  useEffect(() => {
    setAddedLearned((current) => new Set([...current].filter((id) => !includesId(learnedWordIds, id))));
    setRemovedLearned((current) => new Set([...current].filter((id) => includesId(learnedWordIds, id))));
  }, [learnedWordIds]);

  useEffect(() => {
    setAddedUnfamiliar((current) => new Set([...current].filter((id) => !includesId(unfamiliarWordIds, id))));
    setRemovedUnfamiliar((current) => new Set([...current].filter((id) => includesId(unfamiliarWordIds, id))));
  }, [unfamiliarWordIds]);

  const isLearned = (wordId) => {
    const id = String(wordId || '');
    return !removedLearned.has(id) && (includesId(learnedWordIds, id) || addedLearned.has(id));
  };
  const isUnfamiliar = (wordId) => {
    const id = String(wordId || '');
    return !removedUnfamiliar.has(id) && (includesId(unfamiliarWordIds, id) || addedUnfamiliar.has(id));
  };
  const clearErrors = () => setErrors({ learned: '', unfamiliar: '' });

  const toggle = async (type, wordId) => {
    if (!wordId || saving) return false;
    const learned = type === 'learned';
    const active = learned ? isLearned(wordId) : isUnfamiliar(wordId);
    const action = learned ? onToggleLearned : onToggleUnfamiliar;
    if (!action) return false;
    setSaving(type);
    setErrors((current) => ({ ...current, [type]: '' }));
    try {
      await action(wordId, active);
      if (learned) updateOptimisticSets(wordId, active, setAddedLearned, setRemovedLearned);
      else updateOptimisticSets(wordId, active, setAddedUnfamiliar, setRemovedUnfamiliar);
      return true;
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [type]: error.message || (learned ? '更新已學習資料夾失敗' : '更新不熟悉資料夾失敗'),
      }));
      return false;
    } finally {
      setSaving('');
    }
  };

  return {
    clearErrors,
    errors,
    isLearned,
    isUnfamiliar,
    saving,
    toggleLearned: (wordId) => toggle('learned', wordId),
    toggleUnfamiliar: (wordId) => toggle('unfamiliar', wordId),
  };
}
