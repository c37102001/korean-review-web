export const PROGRESS_SHARD_COUNT = 16;

export function emptyStore() {
  return {
    stats: {},
    progress: {},
    attempts: [],
    customRecords: [],
    completedReviewDates: [],
    starred: [],
    recognition: null,
  };
}

export function attemptDate(attempt) {
  return attempt?.date || attempt?.time?.slice(0, 10) || '';
}

export function attemptsByDate(attempts) {
  return (attempts || []).reduce((groups, attempt) => {
    const date = attemptDate(attempt);
    if (!date) return groups;
    if (!groups[date]) groups[date] = [];
    groups[date].push(attempt);
    return groups;
  }, {});
}

export function progressShardId(questionId) {
  const hash = [...questionId].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return String(hash % PROGRESS_SHARD_COUNT).padStart(2, '0');
}
