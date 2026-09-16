import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .content import order_questions
from .models import Card, GrammarNote, Question


REVIEW_INTERVALS = (1, 3, 7, 14, 30, 90)
DAILY_RECOGNITION_LIMIT = 50
DAILY_RECOGNITION_MODE = "daily-recognition"
DAILY_WRONG_REVIEW_MODE = "daily-wrong-review"
NOTE_CATEGORY_GRAMMAR = "grammar"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def today_string() -> str:
    return date.today().isoformat()


def add_days(date_key: str, days: int) -> str:
    return (date.fromisoformat(date_key) + timedelta(days=days)).isoformat()


def attempt_date(attempt: Dict[str, Any]) -> str:
    return str(attempt.get("date") or str(attempt.get("time") or "")[:10])


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
def get_progress(state: Dict[str, Any], question: Question) -> Dict[str, Any]:
    saved = (state.get("progress") or {}).get(question.id)
    if saved:
        return saved
    return {
        "stage": 0,
        "nextDue": add_days(question.date, REVIEW_INTERVALS[0]),
        "lastResult": None,
        "lastAnsweredAt": None,
    }


def due_questions(state: Dict[str, Any], questions: List[Question], date_key: Optional[str] = None) -> List[Question]:
    date_key = date_key or today_string()
    return [question for question in questions if get_progress(state, question).get("nextDue", question.date) <= date_key]


def daily_due_questions(state: Dict[str, Any], questions: List[Question], date_key: Optional[str] = None) -> List[Question]:
    date_key = date_key or today_string()
    learned_word_ids = set(state.get("learnedWordIds") or [])
    terms = [question for question in questions if question.kind == "term" and question.item_id not in learned_word_ids]
    return order_questions(due_questions(state, terms, date_key))


def daily_wrong_term_questions(
    state: Dict[str, Any],
    questions: List[Question],
    date_key: Optional[str] = None,
) -> List[Question]:
    date_key = date_key or today_string()
    learned_word_ids = set(state.get("learnedWordIds") or [])
    term_by_id = {
        question.id: question
        for question in questions
        if question.kind == "term" and question.item_id not in learned_word_ids
    }
    wrong_ids: set[str] = set()
    attempts = sorted(
        (
            attempt for attempt in (state.get("attempts") or [])
            if attempt_date(attempt) == date_key
        ),
        key=lambda attempt: str(attempt.get("time") or ""),
    )
    for attempt in attempts:
        question_id = str(attempt.get("questionId") or "")
        if not question_id:
            continue
        if attempt.get("mode") == DAILY_WRONG_REVIEW_MODE:
            if attempt.get("correct") is True:
                wrong_ids.discard(question_id)
            elif attempt.get("correct") is False:
                wrong_ids.add(question_id)
        elif attempt.get("correct") is False:
            wrong_ids.add(question_id)
    return sorted(
        (term_by_id[question_id] for question_id in wrong_ids if question_id in term_by_id),
        key=lambda question: (
            unicodedata.normalize("NFC", question.ko).casefold(),
            question.zh,
            question.id,
        ),
    )


def daily_grammar_questions(
    notes: List[GrammarNote],
    review: Dict[str, Any],
    date_key: Optional[str] = None,
) -> Tuple[Optional[GrammarNote], List[Question]]:
    date_key = date_key or today_string()
    if review.get("completedDate") == date_key:
        return None, []
    eligible = [note for note in notes if note.category == NOTE_CATEGORY_GRAMMAR and note.examples]
    if not eligible:
        return None, []

    last_id = str(review.get("lastCompletedGrammarId") or "")
    last_index = next((index for index, note in enumerate(eligible) if note.id == last_id), -1)
    if last_index >= 0:
        note = eligible[(last_index + 1) % len(eligible)]
    else:
        last_created_at = str(review.get("lastCompletedCreatedAt") or "")
        note = next(
            (candidate for candidate in eligible if last_created_at and candidate.created_at > last_created_at),
            eligible[0],
        )

    return note, grammar_practice_questions([note])


def grammar_practice_questions(notes: Iterable[GrammarNote]) -> List[Question]:
    questions: List[Question] = []
    for note in notes:
        source = Card(
            id=note.id,
            date="",
            ko=note.title,
            zh="",
            pos="文法",
            meanings=[{"zh": "", "examples": list(note.examples)}],
            notes=[note.notes] if note.notes else [],
        )
        for example in note.examples:
            questions.append(Question(
                id=f"grammar:{note.id}:{example['id']}",
                item_id=note.id,
                date="",
                kind="grammar-example",
                ko=example["ko"],
                zh=example["zh"],
                source=source,
            ))
    return questions


def seed_from_string(text: str) -> int:
    seed = 17
    for char in text:
        seed = ((seed * 31) + ord(char)) % 233280
    return seed


def shuffle_items(items: Iterable[Any], seed: int) -> List[Any]:
    result = list(items)
    value = seed or 1
    for idx in range(len(result) - 1, 0, -1):
        value = (value * 9301 + 49297) % 233280
        swap_idx = int((value / 233280) * (idx + 1))
        result[idx], result[swap_idx] = result[swap_idx], result[idx]
    return result


def daily_round_questions(
    state: Dict[str, Any],
    questions: List[Question],
    state_key: str,
    mode: str,
    date_key: Optional[str] = None,
    limit: int = 20,
) -> List[Question]:
    date_key = date_key or today_string()
    ordered_questions = order_questions(questions)
    if not ordered_questions:
        return []

    question_ids = {question.id for question in ordered_questions}
    attempts = [
        attempt for attempt in (state.get("attempts") or [])
        if attempt.get("mode") == mode and attempt.get("questionId") in question_ids
    ]
    round_state = state.get(state_key)
    if not round_state:
        correct_ids: set[str] = set()
        pending_wrong_ids: set[str] = set()
        round_completed_on = ""
        for attempt in sorted(
            (attempt for attempt in attempts if attempt_date(attempt) < date_key),
            key=lambda attempt: str(attempt.get("time") or ""),
        ):
            question_id = str(attempt.get("questionId"))
            if attempt.get("correct"):
                correct_ids.add(question_id)
                pending_wrong_ids.discard(question_id)
            else:
                correct_ids.discard(question_id)
                pending_wrong_ids.add(question_id)
            if len(correct_ids) == len(question_ids):
                round_completed_on = attempt_date(attempt)
        round_state = {
            "correctIds": sorted(correct_ids), "pendingWrongIds": sorted(pending_wrong_ids),
            "roundCompletedOn": round_completed_on, "dailyDate": "", "assignmentIds": [], "answeredIds": [],
        }

    correct_ids = {item for item in round_state.get("correctIds", []) if item in question_ids}
    pending_wrong_ids = {item for item in round_state.get("pendingWrongIds", []) if item in question_ids}
    round_completed_on = str(round_state.get("roundCompletedOn") or "")
    if len(correct_ids) == len(question_ids) and not round_completed_on:
        round_completed_on = str(round_state.get("dailyDate") or date_key)
    if round_state.get("dailyDate") != date_key and round_completed_on and round_completed_on < date_key:
        correct_ids.clear()
        pending_wrong_ids.clear()
        round_completed_on = ""

    attempts_today = sorted(
        (attempt for attempt in attempts if attempt_date(attempt) == date_key),
        key=lambda attempt: str(attempt.get("time") or ""),
    )
    attempted_ids = list(dict.fromkeys(str(attempt.get("questionId")) for attempt in attempts_today))
    assignment_ids = [item for item in (round_state.get("assignmentIds") or []) if item in question_ids]
    if round_state.get("dailyDate") != date_key or (not assignment_ids and not attempted_ids):
        wrong = shuffle_items(
            (question for question in ordered_questions if question.id in pending_wrong_ids),
            seed_from_string(f"{date_key}-{mode}-wrong"),
        )[:limit]
        wrong_ids = {question.id for question in wrong}
        unseen = [question for question in ordered_questions if question.id not in correct_ids and question.id not in wrong_ids]
        assignment_ids = [question.id for question in shuffle_items(
            wrong + shuffle_items(unseen, seed_from_string(f"{date_key}-{mode}-unseen"))[:max(0, limit - len(wrong))],
            seed_from_string(f"{date_key}-{mode}-assignment"),
        )]
    assignment_limit = max(limit, len(attempted_ids))
    assignment_ids = (attempted_ids + [item for item in assignment_ids if item not in attempted_ids])[:assignment_limit]
    answered_ids = set(attempted_ids)
    for attempt in attempts_today:
        question_id = str(attempt.get("questionId"))
        if attempt.get("correct"):
            correct_ids.add(question_id)
            pending_wrong_ids.discard(question_id)
        else:
            correct_ids.discard(question_id)
            pending_wrong_ids.add(question_id)
    if len(correct_ids) == len(question_ids):
        round_completed_on = date_key
    state[state_key] = {
        "correctIds": sorted(correct_ids), "pendingWrongIds": sorted(pending_wrong_ids),
        "roundCompletedOn": round_completed_on, "dailyDate": date_key,
        "assignmentIds": assignment_ids, "answeredIds": list(answered_ids),
    }
    by_id = {question.id: question for question in ordered_questions}
    return [by_id[item] for item in assignment_ids if item not in answered_ids and item in by_id]


def daily_recognition_questions(
    state: Dict[str, Any],
    questions: List[Question],
    date_key: Optional[str] = None,
    limit: int = DAILY_RECOGNITION_LIMIT,
) -> List[Question]:
    learned_word_ids = set(state.get("learnedWordIds") or [])
    examples = [question for question in questions if question.kind == "example" and question.item_id not in learned_word_ids]
    return daily_round_questions(
        state,
        examples,
        "recognition",
        DAILY_RECOGNITION_MODE,
        date_key,
        limit,
    )


def record_answer(
    state: Dict[str, Any],
    question: Question,
    correct: bool,
    date_key: Optional[str] = None,
    now: Optional[str] = None,
) -> None:
    now = now or utc_now_iso()
    date_key = date_key or today_string()
    previous = get_progress(state, question)
    stats = state.setdefault("stats", {})
    old = stats.get(question.id, {})
    next_stats = {
        **old,
        "total": int(old.get("total", 0)) + 1,
        "correct": int(old.get("correct", 0)) + (1 if correct else 0),
        "wrong": int(old.get("wrong", 0)) + (0 if correct else 1),
        "lastAnsweredAt": now,
        "lastResult": "correct" if correct else "wrong",
    }
    stats[question.id] = next_stats
    transition = next_review_transition(
        int(previous.get("stage", 0)), old, next_stats, correct, REVIEW_INTERVALS,
    )
    stage = transition["stage"]
    interval_days = transition["intervalDays"]
    state.setdefault("progress", {})[question.id] = {
        "stage": stage,
        "nextDue": add_days(date_key, interval_days),
        "lastAnsweredAt": now,
        "lastResult": "correct" if correct else "wrong",
    }
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {"id": str(uuid.uuid4()), "questionId": question.id, "correct": correct, "date": date_key, "time": now})
    del attempts[5000:]


def record_daily_wrong_review_answer(
    state: Dict[str, Any],
    question: Question,
    correct: bool,
) -> None:
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {
        "id": str(uuid.uuid4()),
        "questionId": question.id,
        "correct": correct,
        "date": today_string(),
        "time": utc_now_iso(),
        "mode": DAILY_WRONG_REVIEW_MODE,
    })
    del attempts[5000:]


def record_daily_round_answer(
    state: Dict[str, Any],
    question: Question,
    correct: bool,
    state_key: str,
    mode: str,
    record_wrong_stats: bool = False,
) -> None:
    round_state = state.setdefault(state_key, {
        "correctIds": [], "pendingWrongIds": [], "roundCompletedOn": "", "dailyDate": today_string(),
        "assignmentIds": [], "answeredIds": [],
    })
    correct_ids = set(round_state.get("correctIds") or [])
    pending_wrong_ids = set(round_state.get("pendingWrongIds") or [])
    if correct:
        correct_ids.add(question.id)
        pending_wrong_ids.discard(question.id)
    else:
        correct_ids.discard(question.id)
        pending_wrong_ids.add(question.id)
    round_state["correctIds"] = sorted(correct_ids)
    round_state["pendingWrongIds"] = sorted(pending_wrong_ids)
    round_state["answeredIds"] = list(dict.fromkeys([*(round_state.get("answeredIds") or []), question.id]))
    if not correct and record_wrong_stats:
        record_answer(state, question, False)
        state["attempts"][0]["mode"] = mode
        return
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {
        "id": str(uuid.uuid4()),
        "questionId": question.id,
        "correct": correct,
        "date": today_string(),
        "time": utc_now_iso(),
        "mode": mode,
    })
    del attempts[5000:]


def record_daily_recognition_answer(state: Dict[str, Any], question: Question, correct: bool) -> None:
    record_daily_round_answer(
        state,
        question,
        correct,
        "recognition",
        DAILY_RECOGNITION_MODE,
    )


def toggle_star(state: Dict[str, Any], card: Card) -> None:
    starred = state.setdefault("starred", [])
    if card.id in starred:
        starred.remove(card.id)
        card.is_starred = False
    else:
        starred.append(card.id)
        card.is_starred = True


def normalize_text(text: str) -> str:
    return "".join(ch for ch in text if not unicodedata.category(ch).startswith("P")).lower()


def count_korean_letters(text: str) -> int:
    return sum(1 for ch in text if "\uac00" <= ch <= "\ud7af" or "\u1100" <= ch <= "\u11ff" or "\u3130" <= ch <= "\u318f")


def korean_length_warning(user_input: str, answer: str) -> str:
    actual = count_korean_letters(user_input)
    expected = count_korean_letters(answer)
    if actual == expected:
        return ""
    return f"字數不符：目前 {actual} 個韓文字，答案需要 {expected} 個。請修改後再送出。"
