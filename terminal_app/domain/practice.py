import random
from typing import Any, Dict, Iterable, List, Tuple


def optional_practice_state(review: Dict[str, Any]) -> Dict[str, Any]:
    raw = review.get("optionalPractice") or {}
    return {
        "tasks": [entry for entry in (raw.get("tasks") or []) if isinstance(entry, dict)],
        "pools": dict(raw.get("pools") or {}),
    }


def draw_optional_practice_ids(
    pool_ids: Iterable[str],
    seen_ids: Iterable[str],
    reserved_ids: Iterable[str],
    count: int,
) -> Tuple[List[str], List[str]]:
    if count < 1 or count > 500:
        raise ValueError("題數須為 1 至 500 的整數")
    pool = list(dict.fromkeys(str(item) for item in pool_ids if item))
    reserved = set(str(item) for item in reserved_ids)
    seen = set(str(item) for item in seen_ids)
    selected: List[str] = []
    limit = min(count, len([item for item in pool if item not in reserved]))
    while len(selected) < limit:
        candidates = [item for item in pool if item not in reserved and item not in selected and item not in seen]
        if not candidates:
            seen.difference_update(pool)
            seen.update(selected)
            candidates = [item for item in pool if item not in reserved and item not in selected]
        if not candidates:
            break
        selected_id = random.choice(candidates)
        selected.append(selected_id)
        seen.add(selected_id)
    return selected, sorted(seen)


def add_optional_practice_task(
    current: Dict[str, Any], task: Dict[str, Any], pool_ids: Iterable[str], count: int,
) -> Dict[str, Any]:
    state = {"tasks": list(current.get("tasks") or []), "pools": dict(current.get("pools") or {})}
    if any(entry.get("id") == task.get("id") for entry in state["tasks"]):
        return state
    if len(state["tasks"]) >= 20:
        raise ValueError("最多保留 20 組練習，請先完成或移除現有練習")
    kind = str(task.get("kind") or "")
    reserved = [
        question_id
        for entry in state["tasks"]
        if entry.get("kind") == kind
        for question_id in (entry.get("ids") or [])
    ]
    selected, seen = draw_optional_practice_ids(pool_ids, state["pools"].get(kind) or [], reserved, count)
    if not selected:
        raise ValueError("沒有可新增的題目，請調整篩選或先完成現有練習")
    state["tasks"].append({**task, "ids": selected, "answeredIds": []})
    state["pools"][kind] = seen
    return state


def answer_optional_practice_task(
    current: Dict[str, Any], task_id: str, question_id: str, correct: bool,
) -> Dict[str, Any]:
    state = {"tasks": list(current.get("tasks") or []), "pools": dict(current.get("pools") or {})}
    task = next((entry for entry in state["tasks"] if entry.get("id") == task_id), None)
    if not task or question_id not in (task.get("ids") or []) or question_id in (task.get("answeredIds") or []):
        return state
    updated_tasks = []
    for entry in state["tasks"]:
        if entry.get("id") != task_id:
            updated_tasks.append(entry)
            continue
        updated = {**entry, "answeredIds": list(dict.fromkeys([*(entry.get("answeredIds") or []), question_id]))}
        if any(item not in updated["answeredIds"] for item in (updated.get("ids") or [])):
            updated_tasks.append(updated)
    state["tasks"] = updated_tasks
    if not correct:
        kind = str(task.get("kind") or "")
        state["pools"][kind] = [item for item in (state["pools"].get(kind) or []) if item != question_id]
    return state


def remove_optional_practice_task(current: Dict[str, Any], task_id: str) -> Dict[str, Any]:
    state = {"tasks": list(current.get("tasks") or []), "pools": dict(current.get("pools") or {})}
    task = next((entry for entry in state["tasks"] if entry.get("id") == task_id), None)
    if not task:
        return state
    answered = set(task.get("answeredIds") or [])
    unanswered = {item for item in (task.get("ids") or []) if item not in answered}
    kind = str(task.get("kind") or "")
    state["tasks"] = [entry for entry in state["tasks"] if entry.get("id") != task_id]
    state["pools"][kind] = [item for item in (state["pools"].get(kind) or []) if item not in unanswered]
    return state
