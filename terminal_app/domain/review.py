from typing import Any, Dict, Iterable, List


REVIEW_INTERVALS = (1, 3, 7, 14, 30, 90)


def familiarity_score(stats: Dict[str, Any]) -> int:
    correct = int(stats.get("correct") or 0)
    wrong_value = stats.get("wrong")
    wrong = int(wrong_value) if wrong_value is not None else max(0, int(stats.get("total") or 0) - correct)
    return correct - wrong


def next_review_transition(
    previous_stage: int,
    previous_stats: Dict[str, Any],
    next_stats: Dict[str, Any],
    correct: bool,
    intervals: Iterable[int] = REVIEW_INTERVALS,
) -> Dict[str, int]:
    schedule = tuple(intervals)
    previous_score = familiarity_score(previous_stats)
    next_score = familiarity_score(next_stats)
    remains_unfamiliar = next_score < 0
    if remains_unfamiliar:
        stage = 0
    elif correct:
        stage = min((0 if previous_score < 0 else int(previous_stage)) + 1, len(schedule) - 1)
    else:
        stage = 0
    return {
        "stage": stage,
        "intervalDays": 2 if remains_unfamiliar and correct else schedule[stage],
    }


def wrong_question_ids(events: Iterable[Dict[str, Any]]) -> List[str]:
    wrong: set[str] = set()
    for event in events:
        question_id = str(event.get("questionId") or "")
        if not question_id:
            continue
        if event.get("correct") is True:
            wrong.discard(question_id)
        elif event.get("correct") is False:
            wrong.add(question_id)
    return sorted(wrong)


def exclude_learned_word_ids(question_word_ids: Iterable[str], learned_word_ids: Iterable[str]) -> List[str]:
    learned = set(learned_word_ids)
    return [word_id for word_id in question_word_ids if word_id not in learned]
