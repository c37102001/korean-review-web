import { useEffect, useState } from 'react';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from './firebase.js';

export function drawPracticeIds(poolIds, seenIds = [], reservedIds = [], count = 10, random = Math.random) {
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('題數須為 1 至 500 的整數');
  const pool = [...new Set(poolIds)];
  const reserved = new Set(reservedIds);
  let seen = new Set(seenIds);
  const result = [];
  const limit = Math.min(count, pool.filter((id) => !reserved.has(id)).length);
  while (result.length < limit) {
    let candidates = pool.filter((id) => !reserved.has(id) && !result.includes(id) && !seen.has(id));
    if (!candidates.length) {
      pool.forEach((id) => seen.delete(id));
      result.forEach((id) => seen.add(id));
      candidates = pool.filter((id) => !reserved.has(id) && !result.includes(id));
    }
    if (!candidates.length) break;
    const id = candidates[Math.floor(random() * candidates.length)];
    result.push(id);
    seen.add(id);
  }
  return { ids: result, seenIds: [...seen] };
}

export function addPracticeTask(current, task, poolIds, count) {
  if (current.tasks.some((entry) => entry.id === task.id)) return current;
  if (current.tasks.length >= 20) throw new Error('最多保留 20 組練習，請先完成或移除現有練習');
  const reserved = current.tasks.filter((entry) => entry.kind === task.kind).flatMap((entry) => entry.ids);
  const selection = drawPracticeIds(poolIds, current.pools[task.kind] || [], reserved, count);
  if (!selection.ids.length) throw new Error('沒有可新增的題目，請調整篩選或先完成現有練習');
  return {
    ...current,
    tasks: [...current.tasks, { ...task, ids: selection.ids, answeredIds: [] }],
    pools: { ...current.pools, [task.kind]: selection.seenIds },
  };
}

export function answerPracticeTask(current, taskId, questionId, correct) {
  const task = current.tasks.find((entry) => entry.id === taskId);
  if (!task || !task.ids.includes(questionId) || task.answeredIds.includes(questionId)) return current;
  const nextPools = correct ? current.pools : {
    ...current.pools,
    [task.kind]: (current.pools[task.kind] || []).filter((id) => id !== questionId),
  };
  return {
    ...current,
    pools: nextPools,
    tasks: current.tasks.map((entry) => entry.id !== taskId ? entry : {
      ...entry, answeredIds: [...entry.answeredIds, questionId],
    }).filter((entry) => entry.ids.some((id) => !entry.answeredIds.includes(id))),
  };
}

export function removePracticeTask(current, taskId) {
  const task = current.tasks.find((entry) => entry.id === taskId);
  if (!task) return current;
  const unanswered = new Set(task.ids.filter((id) => !task.answeredIds.includes(id)));
  return {
    ...current,
    tasks: current.tasks.filter((entry) => entry.id !== taskId),
    pools: { ...current.pools, [task.kind]: (current.pools[task.kind] || []).filter((id) => !unanswered.has(id)) },
  };
}

// A transaction updates only this field, preserving the existing grammar cursor.
export function useOptionalPractice(user) {
  const [state, setState] = useState({ tasks: [], pools: {} });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setState({ tasks: [], pools: {} });
    if (!user) { setLoading(false); return undefined; }
    setLoading(true);
    return onSnapshot(doc(db, 'users', user.uid, 'settings', 'grammarReview'), (snapshot) => {
      setState(snapshot.data()?.optionalPractice || { tasks: [], pools: {} });
      setLoading(false);
      setError('');
    }, (failure) => { setError(failure.message); setLoading(false); });
  }, [user?.uid]);
  const update = async (change) => {
    if (!user) throw new Error('請先登入');
    const ref = doc(db, 'users', user.uid, 'settings', 'grammarReview');
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.data()?.optionalPractice || { tasks: [], pools: {} };
      const next = change(current);
      if (next === current) return;
      transaction.set(ref, { optionalPractice: next }, { merge: true });
    });
  };
  const create = (task, poolIds, count) => update((current) => addPracticeTask(current, task, poolIds, count));
  const answer = (taskId, questionId, correct) => update((current) => answerPracticeTask(current, taskId, questionId, correct));
  const remove = (taskId) => update((current) => removePracticeTask(current, taskId));
  return { ...state, loading, error, create, answer, remove };
}
