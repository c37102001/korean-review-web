import { useCallback, useEffect, useState } from 'react';
import { normalizeReadingTest, validateReadingTest } from '../../../reading/model.js';
import { readingTestsRepository } from '../../../repositories/userContentRepository.js';
import { createId } from '../../../shared/id.js';

const MAX_ATOMIC_RECORD_WRITES = 450;

export function useReadingTests(user, enabled = true) {
  const [state, setState] = useState({ tests: [], loading: false, error: '' });

  useEffect(() => {
    if (!user || !enabled) {
      setState({ tests: [], loading: false, error: '' });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    return readingTestsRepository.subscribe(
      user.uid,
      (documents) => {
        const tests = documents
          .map((entry) => normalizeReadingTest(entry, entry.id))
          .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || '') || left.order - right.order || left.id.localeCompare(right.id));
        setState({ tests, loading: false, error: '' });
      },
      (error) => setState((current) => ({ ...current, loading: false, error: error.message })),
    );
  }, [user, enabled]);

  const saveMany = useCallback(async (inputs) => {
    if (!user) throw new Error('尚未登入');
    if (!inputs.length) throw new Error('沒有可儲存的閱讀題目');
    if (inputs.length > MAX_ATOMIC_RECORD_WRITES) throw new Error(`一次最多可以匯入 ${MAX_ATOMIC_RECORD_WRITES} 題`);
    const now = new Date().toISOString();
    const tests = inputs.map((input, index) => validateReadingTest(normalizeReadingTest({
      ...input,
      id: input.id || createId(),
      order: Number.isSafeInteger(input.order) ? input.order : index,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }, input.id), index));
    await readingTestsRepository.saveMany(user.uid, tests);
    return tests;
  }, [user]);

  const save = useCallback(async (input) => (await saveMany([input]))[0], [saveMany]);
  const remove = useCallback(async (id) => {
    if (!user) throw new Error('尚未登入');
    await readingTestsRepository.remove(user.uid, id);
  }, [user]);

  return { ...state, save, saveMany, remove };
}
