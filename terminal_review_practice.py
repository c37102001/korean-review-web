#!/usr/bin/env python3
"""Terminal practice interface for korean-review-web data.

Usage:
  python3 terminal_review_practice.py

Optional .env values:
  TERMINAL_PRACTICE_EMAIL=your@email.com
  TERMINAL_PRACTICE_PASSWORD=your-password

Core keys:
  0 toggle star, 8 show/hide answer or details, 4 previous, 6 next,
  + partial check, Enter submit answer, Esc back.
"""

from __future__ import annotations

import curses
import getpass
import json
import os
import random
import re
import textwrap
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib import error, parse, request


API_KEY = "AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU"
PROJECT_ID = "korean-review-web"
FIRESTORE_SCHEMA_VERSION = 3
PROGRESS_SHARD_COUNT = 16
REVIEW_INTERVALS = [1, 3, 7, 14, 30, 90]
DAILY_RECOGNITION_LIMIT = 50
DAILY_RECOGNITION_MODE = "daily-recognition"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class AuthSession:
    email: str
    uid: str
    id_token: str
    refresh_token: str


@dataclass
class Card:
    id: str
    date: str
    ko: str
    zh: str
    pos: str = ""
    meanings: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    related: List[str] = field(default_factory=list)
    created_at: str = ""
    order: int = 0
    index: int = 0
    is_starred: bool = False


@dataclass
class Question:
    id: str
    item_id: str
    date: str
    kind: str
    ko: str
    zh: str
    source: Card


@dataclass
class PartialCheckResult:
    all_correct_prefix: bool
    wrong_raw_indices: set[int]
    missing_space_before_raw_indices: set[int]


class FirebaseClient:
    def __init__(self, api_key: str, project_id: str) -> None:
        self.api_key = api_key
        self.project_id = project_id
        self._saved_state: Dict[str, Any] = empty_state()
        self._writes_blocked_until = 0.0

    def sign_in(self, email: str, password: str) -> AuthSession:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={self.api_key}"
        payload = {"email": email, "password": password, "returnSecureToken": True}
        data = self._request_json("POST", url, payload=payload)
        return AuthSession(
            email=data.get("email", email),
            uid=data["localId"],
            id_token=data["idToken"],
            refresh_token=data["refreshToken"],
        )

    def list_records(self, session: AuthSession) -> List[Dict[str, Any]]:
        return [
            _parse_firestore_fields(doc.get("fields", {})) | {"_docId": _doc_id(doc.get("name", ""))}
            for doc in self._list_documents(["users", session.uid, "records"], session)
        ]

    def load_review_state(self, session: AuthSession) -> Dict[str, Any]:
        try:
            settings_doc = self._request_json(
                "GET",
                self._document_url(["users", session.uid, "settings", "review"]),
                session=session,
            )
            settings = _parse_firestore_fields(settings_doc.get("fields", {}))
        except RuntimeError as exc:
            if "NOT_FOUND" not in str(exc) and "404" not in str(exc):
                raise
            settings = {}

        if settings.get("schemaVersion") != FIRESTORE_SCHEMA_VERSION:
            raise RuntimeError("Firestore schema v3 settings are missing")
        state = empty_state()
        for document in self._list_documents(["users", session.uid, "progressShards"], session):
            data = _parse_firestore_fields(document.get("fields", {}))
            for question_id, entry in (data.get("entries") or {}).items():
                if entry.get("stats") is not None:
                    state["stats"][question_id] = entry["stats"]
                if entry.get("progress") is not None:
                    state["progress"][question_id] = entry["progress"]
        attempts = []
        try:
            document = self._request_json(
                "GET", self._document_url(["users", session.uid, "reviewDays", today_string()]), session=session,
            )
        except RuntimeError as exc:
            if "NOT_FOUND" not in str(exc) and "404" not in str(exc):
                raise
        else:
            attempts.extend((_parse_firestore_fields(document.get("fields", {})).get("attempts") or []))
        state["attempts"] = sorted(attempts, key=lambda attempt: attempt.get("time", ""), reverse=True)[:5000]
        state["completedReviewDates"] = settings.get("completedReviewDates") or []
        state["starred"] = settings.get("starred") or []
        state["recognition"] = settings.get("recognition")
        self._saved_state = _clone_json(state)
        return state

    def save_review_state(self, session: AuthSession, state: Dict[str, Any]) -> None:
        if time.monotonic() < self._writes_blocked_until:
            raise RuntimeError("HTTP 429: Quota exceeded.")
        try:
            self._save_review_state_changes(session, self._saved_state, state)
        except RuntimeError as exc:
            if _is_quota_exceeded_error(str(exc)):
                self._writes_blocked_until = time.monotonic() + 60
            raise
        self._saved_state = _clone_json(state)
        self._writes_blocked_until = 0.0

    def _save_review_state_changes(self, session: AuthSession, previous: Dict[str, Any], state: Dict[str, Any]) -> None:
        question_ids = set(previous.get("stats") or {}) | set(previous.get("progress") or {}) | set(state.get("stats") or {}) | set(state.get("progress") or {})
        changed_shards: Dict[str, Dict[str, Any]] = {}
        for question_id in question_ids:
            old_value = {
                "stats": (previous.get("stats") or {}).get(question_id),
                "progress": (previous.get("progress") or {}).get(question_id),
            }
            new_value = {
                "stats": (state.get("stats") or {}).get(question_id),
                "progress": (state.get("progress") or {}).get(question_id),
            }
            if old_value == new_value:
                continue
            changed_shards.setdefault(_progress_shard_id(question_id), {})[question_id] = new_value if new_value["stats"] is not None or new_value["progress"] is not None else None
        for shard_id, changed_entries in changed_shards.items():
            active_entries = {question_id: entry for question_id, entry in changed_entries.items() if entry is not None}
            payload_data = {"entries": active_entries, "updatedAt": utc_now_iso()}
            payload = {"fields": {key: _to_firestore_value(value) for key, value in payload_data.items()}}
            field_paths = [f"entries.`{question_id.replace('`', r'\`')}`" for question_id in changed_entries]
            field_paths.append("updatedAt")
            query = parse.urlencode([("updateMask.fieldPaths", field_path) for field_path in field_paths])
            self._request_json(
                "PATCH",
                f"{self._document_url(['users', session.uid, 'progressShards', shard_id])}?{query}",
                payload=payload,
                session=session,
            )

        previous_attempt_ids = {attempt.get("id") for attempt in (previous.get("attempts") or [])}
        added_attempts = [attempt for attempt in (state.get("attempts") or []) if attempt.get("id") not in previous_attempt_ids]
        writes = []
        for date_key, attempts in _attempts_by_date(added_attempts).items():
            document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/reviewDays/{date_key}"
            writes.append({
                "update": {"name": document_name, "fields": {"date": _to_firestore_value(date_key)}},
                "updateMask": {"fieldPaths": ["date"]},
                "updateTransforms": [
                    {"fieldPath": "attempts", "appendMissingElements": {"values": [_to_firestore_value(attempt) for attempt in attempts]}},
                    {"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"},
                ],
            })
        if writes:
            commit_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit"
            self._request_json("POST", commit_url, payload={"writes": writes}, session=session)

        previous_completed = set(previous.get("completedReviewDates") or [])
        added_completed = [date_key for date_key in (state.get("completedReviewDates") or []) if date_key not in previous_completed]
        settings_changed = previous.get("starred") != state.get("starred") or previous.get("recognition") != state.get("recognition")
        if settings_changed:
            payload_data = {"schemaVersion": FIRESTORE_SCHEMA_VERSION, "updatedAt": utc_now_iso()}
            field_paths = ["schemaVersion", "updatedAt"]
            if previous.get("starred") != state.get("starred"):
                payload_data["starred"] = state.get("starred") or []
                field_paths.append("starred")
            if previous.get("recognition") != state.get("recognition"):
                payload_data["recognition"] = state.get("recognition")
                field_paths.append("recognition")
            payload = {"fields": {key: _to_firestore_value(value) for key, value in payload_data.items()}}
            query = parse.urlencode([("updateMask.fieldPaths", field_path) for field_path in field_paths])
            self._request_json(
                "PATCH",
                f"{self._document_url(['users', session.uid, 'settings', 'review'])}?{query}",
                payload=payload,
                session=session,
            )
        if added_completed:
            document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/settings/review"
            commit_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit"
            self._request_json("POST", commit_url, payload={"writes": [{
                "transform": {
                    "document": document_name,
                    "fieldTransforms": [
                        {"fieldPath": "completedReviewDates", "appendMissingElements": {"values": [_to_firestore_value(date_key) for date_key in added_completed]}},
                        {"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"},
                    ],
                },
            }]}, session=session)

    def _list_documents(self, segments: List[str], session: AuthSession) -> List[Dict[str, Any]]:
        docs: List[Dict[str, Any]] = []
        next_page_token: Optional[str] = None
        while True:
            query = {"pageSize": "200"}
            if next_page_token:
                query["pageToken"] = next_page_token
            url = f"{self._document_url(segments)}?{parse.urlencode(query)}"
            data = self._request_json("GET", url, session=session)
            docs.extend(data.get("documents", []))
            next_page_token = data.get("nextPageToken")
            if not next_page_token:
                return docs

    def _document_url(self, segments: List[str]) -> str:
        base = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents"
        return f"{base}/{'/'.join(parse.quote(part, safe='') for part in segments)}"

    def _refresh_session_token(self, session: AuthSession) -> None:
        url = f"https://securetoken.googleapis.com/v1/token?key={self.api_key}"
        payload = {"grant_type": "refresh_token", "refresh_token": session.refresh_token}
        data = self._request_json("POST", url, payload=payload, _retry=False)
        session.id_token = data.get("id_token", session.id_token)
        session.refresh_token = data.get("refresh_token", session.refresh_token)

    def _request_json(
        self,
        method: str,
        url: str,
        payload: Optional[Dict[str, Any]] = None,
        session: Optional[AuthSession] = None,
        _retry: bool = True,
    ) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        transient_attempt = 0
        can_refresh_token = bool(session and _retry)
        while True:
            headers = {"Content-Type": "application/json"}
            if session:
                headers["Authorization"] = f"Bearer {session.id_token}"
            req = request.Request(url, method=method, headers=headers, data=body)
            try:
                with request.urlopen(req, timeout=25) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace")
                error_message = _extract_http_error_message(details)
                if exc.code == 401 and can_refresh_token and session:
                    can_refresh_token = False
                    self._refresh_session_token(session)
                    continue
                quota_exceeded = exc.code == 429 and _is_quota_exceeded_error(error_message)
                if not quota_exceeded and exc.code in (429, 500, 502, 503, 504) and transient_attempt < 3:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.5 * (2 ** transient_attempt)
                    transient_attempt += 1
                    time.sleep(delay)
                    continue
                raise RuntimeError(f"HTTP {exc.code}: {error_message}") from None
            except error.URLError as exc:
                if transient_attempt < 3:
                    time.sleep(0.5 * (2 ** transient_attempt))
                    transient_attempt += 1
                    continue
                raise RuntimeError(f"Network error: {exc.reason}") from None


def empty_state() -> Dict[str, Any]:
    return {
        "stats": {},
        "progress": {},
        "attempts": [],
        "completedReviewDates": [],
        "starred": [],
        "recognition": None,
    }


def _clone_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _attempts_by_date(attempts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for attempt in attempts:
        date_key = attempt_date(attempt)
        if date_key:
            groups.setdefault(date_key, []).append(attempt)
    return groups


def attempt_date(attempt: Dict[str, Any]) -> str:
    return str(attempt.get("date") or str(attempt.get("time") or "")[:10])


def _progress_shard_id(question_id: str) -> str:
    return str(sum(ord(character) for character in question_id) % PROGRESS_SHARD_COUNT).zfill(2)


def _extract_http_error_message(body: str) -> str:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body
    err = parsed.get("error")
    return str(err.get("message", body)) if isinstance(err, dict) else body


def _is_quota_exceeded_error(message: str) -> bool:
    return "quota exceeded" in message.casefold()


def _doc_id(doc_name: str) -> str:
    return doc_name.rsplit("/", 1)[-1] if doc_name else ""


def _parse_firestore_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    return {key: _parse_firestore_value(value) for key, value in fields.items()}


def _parse_firestore_value(value: Dict[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [_parse_firestore_value(item) for item in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return _parse_firestore_fields(value.get("mapValue", {}).get("fields", {}))
    return None


def _to_firestore_value(value: Any) -> Dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_to_firestore_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: _to_firestore_value(val) for key, val in value.items()}}}
    return {"stringValue": str(value)}


def today_string() -> str:
    return date.today().isoformat()


def add_days(date_key: str, days: int) -> str:
    return (date.fromisoformat(date_key) + timedelta(days=days)).isoformat()


def item_zh(item: Dict[str, Any]) -> str:
    return "；".join(str(meaning.get("zh", "")).strip() for meaning in item.get("meanings", []) if meaning.get("zh"))


def record_order(record: Dict[str, Any]) -> int:
    value = record.get("order")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    created_at = str(record.get("createdAt", ""))
    try:
        return int(datetime.fromisoformat(created_at.replace("Z", "+00:00")).timestamp() * 1_000_000)
    except ValueError:
        return 0


def normalize_records(records: List[Dict[str, Any]], state: Dict[str, Any]) -> Tuple[List[Card], List[Question]]:
    starred = set(state.get("starred") or [])
    cards: List[Card] = []
    questions: List[Question] = []
    seen_examples: set[Tuple[str, str]] = set()
    for index, record in enumerate(records):
        item = record.get("item", {}) or {}
        record_id = record.get("id") or record.get("_docId")
        record_date = record.get("date")
        if not record_id or not record_date:
            raise ValueError(f"Record {index + 1} is missing its required id or date")
        meanings = item.get("meanings", []) or []
        card = Card(
            id=record_id,
            date=record_date,
            ko=str(item.get("ko", "")).strip(),
            zh=item_zh(item),
            pos=str(item.get("pos", "")).strip(),
            meanings=meanings,
            notes=[str(note) for note in (item.get("notes", []) or [])],
            related=[str(entry) for entry in (item.get("related", []) or [])],
            created_at=str(record.get("createdAt", "")),
            order=record_order(record),
            index=index,
            is_starred=(record.get("id") or record.get("_docId")) in starred,
        )
        if not card.ko:
            continue
        cards.append(card)
        questions.append(Question(card.id, card.id, card.date, "term", card.ko, card.zh, card))
        for meaning in meanings:
            for ex_index, example in enumerate(meaning.get("examples", []) or []):
                ko = str(example.get("ko", "")).strip()
                zh = str(example.get("zh", "")).strip()
                if not ko or not zh or (ko, zh) in seen_examples:
                    continue
                seen_examples.add((ko, zh))
                qid = str(example.get("id") or f"{card.id}-{meaning.get('id', 'meaning')}-ex-{ex_index}")
                questions.append(Question(qid, card.id, card.date, "example", ko, zh, card))
    cards.sort(key=lambda c: (c.date, c.order, c.id))
    for index, card in enumerate(cards):
        card.index = index
    return cards, order_questions(questions)


def load_data(client: FirebaseClient, session: AuthSession) -> Tuple[Dict[str, Any], List[Card], List[Question]]:
    state = client.load_review_state(session)
    records_by_id: Dict[str, Dict[str, Any]] = {}
    for record in client.list_records(session):
        record_id = record.get("id") or record.get("_docId")
        if record_id:
            record["id"] = record_id
            records_by_id[record_id] = record
    cards, questions = normalize_records(list(records_by_id.values()), state)
    return state, cards, questions


def get_progress(state: Dict[str, Any], question: Question) -> Dict[str, Any]:
    saved = (state.get("progress") or {}).get(question.id)
    if saved:
        return saved
    return {"stage": 0, "nextDue": add_days(question.date, REVIEW_INTERVALS[0]), "lastResult": None, "lastAnsweredAt": None}


def due_questions(state: Dict[str, Any], questions: List[Question], date_key: Optional[str] = None) -> List[Question]:
    date_key = date_key or today_string()
    return [question for question in questions if get_progress(state, question).get("nextDue", question.date) <= date_key]


def order_questions(questions: Iterable[Question]) -> List[Question]:
    rank = {"term": 0, "example": 1}
    return sorted(questions, key=lambda q: (rank.get(q.kind, 99), q.date, q.source.index, q.id))


def daily_due_questions(state: Dict[str, Any], questions: List[Question], date_key: Optional[str] = None) -> List[Question]:
    date_key = date_key or today_string()
    terms = [question for question in questions if question.kind == "term"]
    return order_questions(due_questions(state, terms, date_key))


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


def daily_recognition_questions(
    state: Dict[str, Any],
    questions: List[Question],
    date_key: Optional[str] = None,
    limit: int = DAILY_RECOGNITION_LIMIT,
) -> List[Question]:
    date_key = date_key or today_string()
    terms = order_questions(question for question in questions if question.kind == "term")
    if not terms:
        return []

    term_ids = {question.id for question in terms}
    attempts = [
        attempt for attempt in (state.get("attempts") or [])
        if attempt.get("mode") == DAILY_RECOGNITION_MODE and attempt.get("questionId") in term_ids
    ]
    recognition = state.get("recognition")
    if not recognition:
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
            if len(correct_ids) == len(term_ids):
                round_completed_on = attempt_date(attempt)
        recognition = {
            "correctIds": sorted(correct_ids), "pendingWrongIds": sorted(pending_wrong_ids),
            "roundCompletedOn": round_completed_on, "dailyDate": "", "assignmentIds": [], "answeredIds": [],
        }

    correct_ids = {item for item in recognition.get("correctIds", []) if item in term_ids}
    pending_wrong_ids = {item for item in recognition.get("pendingWrongIds", []) if item in term_ids}
    round_completed_on = str(recognition.get("roundCompletedOn") or "")
    if len(correct_ids) == len(term_ids) and not round_completed_on:
        round_completed_on = str(recognition.get("dailyDate") or date_key)
    if recognition.get("dailyDate") != date_key and round_completed_on and round_completed_on < date_key:
        correct_ids.clear()
        pending_wrong_ids.clear()
        round_completed_on = ""

    attempts_today = sorted(
        (attempt for attempt in attempts if attempt_date(attempt) == date_key),
        key=lambda attempt: str(attempt.get("time") or ""),
    )
    attempted_ids = list(dict.fromkeys(str(attempt.get("questionId")) for attempt in attempts_today))
    assignment_ids = [item for item in (recognition.get("assignmentIds") or []) if item in term_ids]
    if recognition.get("dailyDate") != date_key:
        wrong = shuffle_items(
            (question for question in terms if question.id in pending_wrong_ids),
            seed_from_string(f"{date_key}-wrong"),
        )[:limit]
        wrong_ids = {question.id for question in wrong}
        unseen = [question for question in terms if question.id not in correct_ids and question.id not in wrong_ids]
        assignment_ids = [question.id for question in shuffle_items(
            wrong + shuffle_items(unseen, seed_from_string(f"{date_key}-unseen"))[:max(0, limit - len(wrong))],
            seed_from_string(f"{date_key}-assignment"),
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
    if len(correct_ids) == len(term_ids):
        round_completed_on = date_key
    state["recognition"] = {
        "correctIds": sorted(correct_ids), "pendingWrongIds": sorted(pending_wrong_ids),
        "roundCompletedOn": round_completed_on, "dailyDate": date_key,
        "assignmentIds": assignment_ids, "answeredIds": list(answered_ids),
    }
    by_id = {question.id: question for question in terms}
    return [by_id[item] for item in assignment_ids if item not in answered_ids and item in by_id]


def record_answer(state: Dict[str, Any], question: Question, correct: bool) -> None:
    now = utc_now_iso()
    previous = get_progress(state, question)
    stage = min(int(previous.get("stage", 0)) + 1, len(REVIEW_INTERVALS) - 1) if correct else 0
    stats = state.setdefault("stats", {})
    old = stats.get(question.id, {})
    stats[question.id] = {
        "total": int(old.get("total", 0)) + 1,
        "correct": int(old.get("correct", 0)) + (1 if correct else 0),
        "wrong": int(old.get("wrong", 0)) + (0 if correct else 1),
        "lastAnsweredAt": now,
        "lastResult": "correct" if correct else "wrong",
    }
    state.setdefault("progress", {})[question.id] = {
        "stage": stage,
        "nextDue": add_days(today_string(), REVIEW_INTERVALS[stage]),
        "lastAnsweredAt": now,
        "lastResult": "correct" if correct else "wrong",
    }
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {"id": str(uuid.uuid4()), "questionId": question.id, "correct": correct, "date": today_string(), "time": now})
    del attempts[5000:]


def record_daily_recognition_answer(state: Dict[str, Any], question: Question, correct: bool) -> None:
    recognition = state.setdefault("recognition", {
        "correctIds": [], "pendingWrongIds": [], "roundCompletedOn": "", "dailyDate": today_string(),
        "assignmentIds": [], "answeredIds": [],
    })
    correct_ids = set(recognition.get("correctIds") or [])
    pending_wrong_ids = set(recognition.get("pendingWrongIds") or [])
    if correct:
        correct_ids.add(question.id)
        pending_wrong_ids.discard(question.id)
    else:
        correct_ids.discard(question.id)
        pending_wrong_ids.add(question.id)
    recognition["correctIds"] = sorted(correct_ids)
    recognition["pendingWrongIds"] = sorted(pending_wrong_ids)
    recognition["answeredIds"] = list(dict.fromkeys([*(recognition.get("answeredIds") or []), question.id]))
    if not correct:
        record_answer(state, question, False)
        state["attempts"][0]["mode"] = DAILY_RECOGNITION_MODE
        return
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {
        "id": str(uuid.uuid4()),
        "questionId": question.id,
        "correct": True,
        "date": today_string(),
        "time": utc_now_iso(),
        "mode": DAILY_RECOGNITION_MODE,
    })
    del attempts[5000:]


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


def card_examples(card: Card) -> List[Dict[str, str]]:
    examples: List[Dict[str, str]] = []
    for meaning in card.meanings:
        for entry in meaning.get("examples", []) or []:
            ko = str(entry.get("ko", "")).strip()
            zh = str(entry.get("zh", "")).strip()
            if ko or zh:
                examples.append({"ko": ko, "zh": zh})
    return examples


def _cell_width(ch: str) -> int:
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def _text_cell_width(text: str) -> int:
    return sum(_cell_width(ch) for ch in text)


def _filtered_chars_with_raw_map(text: str) -> Tuple[List[str], List[int]]:
    chars: List[str] = []
    raw_indices: List[int] = []
    for raw_idx, ch in enumerate(text):
        if unicodedata.category(ch).startswith("P"):
            continue
        chars.append(ch.lower())
        raw_indices.append(raw_idx)
    return chars, raw_indices


def partial_check_input(user_input: str, answer: str) -> PartialCheckResult:
    user_chars, user_raw_map = _filtered_chars_with_raw_map(user_input)
    answer_chars, _ = _filtered_chars_with_raw_map(answer)
    n, m = len(user_chars), len(answer_chars)
    if n == 0:
        return PartialCheckResult(True, set(), set())
    inf = 10**9
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    parent: List[List[Optional[Tuple[int, int, str]]]] = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            if dp[i][j] >= inf:
                continue
            if i < n and j < m:
                cost = 0 if user_chars[i] == answer_chars[j] else (2 if " " in (user_chars[i], answer_chars[j]) else 1)
                op = "match" if cost == 0 else "sub"
                if dp[i][j] + cost < dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = dp[i][j] + cost
                    parent[i + 1][j + 1] = (i, j, op)
            if i < n and dp[i][j] + 1 < dp[i + 1][j]:
                dp[i + 1][j] = dp[i][j] + 1
                parent[i + 1][j] = (i, j, "del_user")
            if j < m and dp[i][j] + 1 < dp[i][j + 1]:
                dp[i][j + 1] = dp[i][j] + 1
                parent[i][j + 1] = (i, j, "ins_answer")
    best_j = min(range(m + 1), key=lambda j: (dp[n][j], -j))
    wrong: set[int] = set()
    missing_space: set[int] = set()
    i, j = n, best_j
    while i > 0 or j > 0:
        step = parent[i][j]
        if step is None:
            break
        pi, pj, op = step
        if op in ("sub", "del_user") and i > 0:
            wrong.add(user_raw_map[i - 1])
        elif op == "ins_answer" and j > 0 and pi < n:
            if answer_chars[j - 1] == " ":
                missing_space.add(user_raw_map[pi])
            else:
                wrong.add(user_raw_map[pi])
        i, j = pi, pj
    return PartialCheckResult(not wrong and not missing_space, wrong, missing_space)


def load_local_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def draw_line(stdscr: curses.window, y: int, x: int, text: str, attr: int = 0) -> None:
    height, width = stdscr.getmaxyx()
    if y < 0 or y >= height or x >= width:
        return
    stdscr.addstr(y, max(0, x), text[: max(0, width - max(0, x) - 1)], attr)


def draw_wrapped(stdscr: curses.window, y: int, x: int, width: int, text: str, attr: int = 0) -> int:
    for line in textwrap.wrap(text, max(1, width)) or [""]:
        draw_line(stdscr, y, x, line, attr)
        y += 1
    return y


def draw_answer_with_feedback(
    stdscr: curses.window,
    y: int,
    x: int,
    prefix: str,
    user_input: str,
    feedback: Optional[PartialCheckResult],
    ok_attr: int,
    wrong_attr: int,
    input_attr: int = 0,
) -> List[int]:
    draw_line(stdscr, y, x, prefix)
    cursor_x = x + _text_cell_width(prefix)
    positions = [cursor_x]
    if feedback is None:
        draw_line(stdscr, y, cursor_x, user_input, input_attr)
        for ch in user_input:
            cursor_x += _cell_width(ch)
            positions.append(cursor_x)
        return positions
    all_ok = feedback.all_correct_prefix and bool(user_input)
    for raw_idx, ch in enumerate(user_input):
        if raw_idx in feedback.missing_space_before_raw_indices:
            draw_line(stdscr, y, cursor_x, "|", wrong_attr)
            cursor_x += 1
        attr = ok_attr if all_ok else (wrong_attr if raw_idx in feedback.wrong_raw_indices else 0)
        draw_line(stdscr, y, cursor_x, ch, attr)
        cursor_x += _cell_width(ch)
        positions.append(cursor_x)
    return positions


def answer_diff_parts(user_input: str, answer: str) -> List[Tuple[str, str]]:
    user_chars, _ = _filtered_chars_with_raw_map(user_input)
    answer_chars, _ = _filtered_chars_with_raw_map(answer)
    n, m = len(user_chars), len(answer_chars)
    inf = 10**9
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    parent: List[List[Optional[Tuple[int, int, str]]]] = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for i in range(n + 1):
        for j in range(m + 1):
            if dp[i][j] >= inf:
                continue
            if i < n and j < m:
                cost = 0 if user_chars[i] == answer_chars[j] else (2 if " " in (user_chars[i], answer_chars[j]) else 1)
                op = "match" if cost == 0 else "replace"
                if dp[i][j] + cost < dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = dp[i][j] + cost
                    parent[i + 1][j + 1] = (i, j, op)
            if i < n and dp[i][j] + 1 < dp[i + 1][j]:
                dp[i + 1][j] = dp[i][j] + 1
                parent[i + 1][j] = (i, j, "extra")
            if j < m and dp[i][j] + 1 < dp[i][j + 1]:
                dp[i][j + 1] = dp[i][j] + 1
                parent[i][j + 1] = (i, j, "missing")
    parts: List[Tuple[str, str]] = []
    i, j = n, m
    while i > 0 or j > 0:
        step = parent[i][j]
        if step is None:
            break
        pi, pj, op = step
        if op == "match":
            parts.append(("ok", user_chars[i - 1]))
        elif op == "replace":
            parts.append(("bad", "␠" if user_chars[i - 1] == " " else user_chars[i - 1]))
        elif op == "extra":
            parts.append(("bad", "␠" if user_chars[i - 1] == " " else user_chars[i - 1]))
        elif op == "missing":
            parts.append(("bad", "_" if answer_chars[j - 1] == " " else "□"))
        i, j = pi, pj
    return list(reversed(parts))


def draw_answer_diff(stdscr: curses.window, y: int, x: int, user_input: str, answer: str, wrong_attr: int) -> None:
    prefix = "錯誤: "
    draw_line(stdscr, y, x, prefix)
    cursor_x = x + _text_cell_width(prefix)
    for kind, text in answer_diff_parts(user_input, answer):
        attr = wrong_attr if kind == "bad" else 0
        draw_line(stdscr, y, cursor_x, text, attr)
        cursor_x += _text_cell_width(text)


def update_curses_screen(stdscr: curses.window) -> None:
    stdscr.noutrefresh()
    curses.doupdate()


def wait_message(stdscr: curses.window, title: str, message: str) -> None:
    stdscr.clear()
    curses.curs_set(0)
    draw_line(stdscr, 1, 2, title, curses.A_BOLD)
    y = draw_wrapped(stdscr, 3, 2, stdscr.getmaxyx()[1] - 4, message)
    draw_line(stdscr, y + 1, 2, "Press any key to continue...", curses.A_DIM)
    stdscr.refresh()
    stdscr.getch()


def friendly_firebase_error(exc: RuntimeError) -> str:
    detail = str(exc)
    if _is_quota_exceeded_error(detail):
        return (
            "Firebase 目前已超過免費額度（HTTP 429），這次操作沒有儲存。"
            "請等 Firebase 額度恢復後再試；若經常發生，請至 Firebase Console 檢查用量與方案。"
        )
    if detail.startswith("Network error:"):
        return f"無法連線到 Firebase，這次操作沒有儲存。{detail}"
    return f"Firebase 儲存失敗，這次操作沒有儲存。{detail}"


def restore_state(state: Dict[str, Any], snapshot: Dict[str, Any]) -> None:
    state.clear()
    state.update(_clone_json(snapshot))


def save_review_state_or_restore(
    stdscr: curses.window,
    client: FirebaseClient,
    session: AuthSession,
    state: Dict[str, Any],
    snapshot: Dict[str, Any],
    title: str = "儲存失敗",
) -> bool:
    try:
        client.save_review_state(session, state)
    except RuntimeError as exc:
        restore_state(state, snapshot)
        wait_message(stdscr, title, friendly_firebase_error(exc))
        return False
    return True


def menu(stdscr: curses.window, title: str, options: List[Tuple[str, str]], subtitle: str = "Arrows=move Enter=open Esc=back") -> Optional[str]:
    selected = 0
    curses.curs_set(0)
    stdscr.keypad(True)
    while True:
        stdscr.clear()
        draw_line(stdscr, 1, 2, title, curses.A_BOLD)
        draw_line(stdscr, 2, 2, subtitle, curses.A_DIM)
        for idx, (_, label) in enumerate(options):
            attr = curses.A_REVERSE if idx == selected else curses.A_NORMAL
            draw_line(stdscr, 3 + idx, 2, ("» " if idx == selected else "  ") + label, attr)
        stdscr.refresh()
        key = stdscr.getch()
        if key == 27:
            return None
        if key in (curses.KEY_UP, curses.KEY_LEFT):
            selected = (selected - 1) % len(options)
        elif key in (curses.KEY_DOWN, curses.KEY_RIGHT):
            selected = (selected + 1) % len(options)
        elif key in (curses.KEY_ENTER, 10, 13):
            return options[selected][0]


def date_menu(stdscr: curses.window, cards: List[Card]) -> Optional[str]:
    counts: Dict[str, int] = {}
    for card in cards:
        counts[card.date] = counts.get(card.date, 0) + 1
    options = [(date_key, f"{date_key} · {count} 張卡") for date_key, count in sorted(counts.items(), reverse=True)]
    if not options:
        wait_message(stdscr, "月曆", "目前沒有任何日期資料。")
        return None
    return menu(stdscr, "月曆 | 選擇日期", options)


def due_task_menu(stdscr: curses.window, state: Dict[str, Any], questions: List[Question]) -> Optional[Tuple[str, List[Question]]]:
    due = daily_due_questions(state, questions)
    recognition = daily_recognition_questions(state, questions)
    grouped: Dict[str, List[Question]] = {}
    for question in due:
        grouped.setdefault(question.date, []).append(question)
    if not grouped and not recognition:
        wait_message(stdscr, "今日複習題", "今天的測驗已全部完成。")
        return None
    options = []
    if recognition:
        options.append((DAILY_RECOGNITION_MODE, f"每日韓文認字測驗 · 剩餘 {len(recognition)} 題"))
    options.extend((date_key, f"{date_key} · {len(items)} 題") for date_key, items in sorted(grouped.items()))
    selected = menu(stdscr, "今日複習題 | 選擇任務", options)
    if not selected:
        return None
    if selected == DAILY_RECOGNITION_MODE:
        return selected, recognition
    return selected, order_questions(grouped[selected])


def setup_menu(stdscr: curses.window, title: str, allow_examples: bool = True) -> Optional[Dict[str, Any]]:
    direction = "zh-ko"
    source = "term"
    starred = False
    random_order = True
    record_results = True
    row = 0
    curses.curs_set(0)
    while True:
        source_label = {"term": "單字", "example": "例句", "all": "全部"}[source]
        rows = [
            f"方向: {'中翻韓' if direction == 'zh-ko' else '韓翻中'}",
            f"內容: {source_label if direction == 'zh-ko' else '單字'}",
            f"篩選: {'有星號' if starred else '全部卡片'}",
            f"順序: {'隨機' if random_order else '依序'}",
            f"紀錄: {'寫入正確/錯誤' if record_results else '不紀錄'}",
            "開始",
        ]
        stdscr.clear()
        draw_line(stdscr, 1, 2, f"設定 | {title}", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=項目  ←→=切換  Enter=開始  Esc=返回", curses.A_DIM)
        for idx, label in enumerate(rows):
            draw_line(stdscr, 3 + idx, 2, ("» " if idx == row else "  ") + label, curses.A_REVERSE if idx == row else 0)
        stdscr.refresh()
        key = stdscr.getch()
        if key == 27:
            return None
        if key == curses.KEY_UP:
            row = (row - 1) % len(rows)
        elif key == curses.KEY_DOWN:
            row = (row + 1) % len(rows)
        elif key in (curses.KEY_LEFT, curses.KEY_RIGHT):
            if row == 0:
                direction = "ko-zh" if direction == "zh-ko" else "zh-ko"
                if direction == "ko-zh":
                    source = "term"
            elif row == 1 and direction == "zh-ko" and allow_examples:
                source = {"term": "example", "example": "all", "all": "term"}[source]
            elif row == 2:
                starred = not starred
            elif row == 3:
                random_order = not random_order
            elif row == 4:
                record_results = not record_results
        elif key in (curses.KEY_ENTER, 10, 13):
            return {
                "direction": direction,
                "source": source if direction == "zh-ko" else "term",
                "starred": starred,
                "random": random_order,
                "record_results": record_results,
            }


def filtered_questions(questions: List[Question], config: Dict[str, Any]) -> List[Question]:
    result = [q for q in questions if config["source"] == "all" or q.kind == config["source"]]
    if config["direction"] == "ko-zh":
        result = [q for q in result if q.kind == "term"]
    if config["starred"]:
        result = [q for q in result if q.source.is_starred]
    result = order_questions(result)
    if config["random"]:
        random.shuffle(result)
    return result


def run_study(stdscr: curses.window, title: str, cards: List[Card], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> None:
    idx = 0
    show_details = False
    message = ""
    curses.curs_set(0)
    while True:
        if not cards:
            wait_message(stdscr, "學習模式", "沒有可學習的卡片。")
            return
        card = cards[idx]
        stdscr.clear()
        draw_line(stdscr, 1, 2, f"學習 | {title} | {idx + 1}/{len(cards)}  Esc=返回  0=星號  8=詳情  4/6=上下張", curses.A_BOLD)
        draw_line(stdscr, 2, 2, f"{'★' if card.is_starred else '☆'} {card.ko}", curses.A_BOLD)
        y = draw_wrapped(stdscr, 3, 2, stdscr.getmaxyx()[1] - 4, card.zh)
        examples = card_examples(card)
        if examples:
            draw_line(stdscr, y, 2, "例句:", curses.A_DIM)
            y += 1
            for example in examples:
                text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, text, curses.A_DIM)
        if show_details:
            for meaning in card.meanings:
                detail = f"- {meaning.get('zh', '')}"
                if meaning.get("pattern"):
                    detail += f" · {meaning.get('pattern')}"
                y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, detail)
            for note in card.notes:
                y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, f"筆記: {note}", curses.A_DIM)
        if message:
            draw_line(stdscr, y, 2, message, curses.A_BOLD)
        stdscr.refresh()
        key = stdscr.get_wch()
        if key == "\x1b":
            return
        if key == "0":
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "8":
            show_details = not show_details
        elif key == "4":
            idx = max(0, idx - 1)
            show_details = False
        elif key == "6":
            idx = min(len(cards) - 1, idx + 1)
            show_details = False


def run_daily_recognition(
    stdscr: curses.window,
    questions: List[Question],
    all_cards: List[Card],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    if not questions:
        wait_message(stdscr, "每日韓文認字測驗", "今天的認字題已完成。")
        return

    idx = 0
    revealed = False
    message = ""
    scroll_offset = 0
    results: Dict[str, bool] = {}
    cards_by_id = {card.id: card for card in all_cards}
    curses.curs_set(0)
    stdscr.keypad(True)
    while True:
        question = questions[idx]
        card = question.source
        graded = question.id in results
        if graded:
            revealed = True
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        draw_line(
            stdscr,
            1,
            2,
            f"認字 | 每日韓文認字測驗 | {idx + 1}/{len(questions)}  Esc=返回 0=星號 8=翻面 4/6=上下題 1=答錯 2=答對 ↑↓=捲動",
            curses.A_BOLD,
        )
        draw_wrapped(stdscr, 2, 2, width - 4, f"{'★' if card.is_starred else '☆'} {card.ko}", curses.A_BOLD)
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in textwrap.wrap(text, line_width) or [""]:
                detail_lines.append((line, indent, attr))

        if not revealed:
            append_detail("按 8 翻面查看完整單字卡。", attr=curses.A_DIM)
        else:
            heading = " / ".join(part for part in (card.zh, card.pos) if part)
            append_detail(heading, attr=curses.A_BOLD)
            for meaning_idx, meaning in enumerate(card.meanings, 1):
                detail = f"{meaning_idx}. {meaning.get('zh', '')}"
                if meaning.get("pattern"):
                    detail += f" · {meaning.get('pattern')}"
                append_detail(detail, indent=2)
                for example in meaning.get("examples") or []:
                    example_text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                    append_detail(example_text, indent=4, attr=curses.A_DIM)
            for note in card.notes:
                append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
            related_words = [cards_by_id[item_id].ko for item_id in card.related if item_id in cards_by_id]
            if related_words:
                append_detail(f"相關詞: {'、'.join(related_words)}", indent=2, attr=curses.A_DIM)
            if not graded:
                append_detail("請按 1（答錯）或 2（答對）自評。", attr=curses.A_BOLD)
        visible_rows = max(1, height - 5)
        scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
        for row, (line, indent, attr) in enumerate(detail_lines[scroll_offset:scroll_offset + visible_rows], 3):
            draw_line(stdscr, row, 2 + indent, line, attr)
        footer = message
        if graded:
            result_text = "答對" if results[question.id] else "答錯，已加入明日題目並記入不熟悉"
            footer = f"{result_text}。按 Enter 或 6 進入下一題。"
        elif revealed and not footer:
            footer = "1=答錯  2=答對"
        if len(detail_lines) > visible_rows:
            footer = f"{footer}  內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
        if footer:
            draw_line(stdscr, height - 1, 2, footer, curses.A_BOLD)
        update_curses_screen(stdscr)
        key = stdscr.get_wch()
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                wait_message(stdscr, "完成", "今天的韓文認字測驗已完成。")
                return
            idx += 1
            revealed = questions[idx].id in results
            message = ""
            scroll_offset = 0
            continue
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN:
            scroll_offset += 1
            continue
        if not isinstance(key, str):
            continue
        if key == "0":
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "8":
            if not graded:
                revealed = not revealed
            message = ""
            scroll_offset = 0
        elif key in ("1", "2"):
            if not revealed:
                message = "請先按 8 翻面查看答案。"
                continue
            if graded:
                message = "這題已完成評分。"
                continue
            correct = key == "2"
            snapshot = _clone_json(state)
            record_daily_recognition_answer(state, question, correct)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                message = ""
                continue
            results[question.id] = correct
            message = ""
        elif key == "4":
            idx = max(0, idx - 1)
            revealed = questions[idx].id in results
            message = ""
            scroll_offset = 0
        elif key == "6":
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                wait_message(stdscr, "完成", "今天的韓文認字測驗已完成。")
                return
            idx += 1
            revealed = questions[idx].id in results
            message = ""
            scroll_offset = 0


def run_practice(stdscr: curses.window, title: str, questions: List[Question], config: Dict[str, Any], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> None:
    idx = 0
    user_input = ""
    input_cursor = 0
    show_hint = False
    message = ""
    partial: Optional[PartialCheckResult] = None
    graded = False
    last_correct: Optional[bool] = None
    typed_attempts = 0
    retry_diff = False
    ok_attr = curses.A_BOLD
    wrong_attr = curses.A_REVERSE
    curses.curs_set(1)
    stdscr.keypad(True)
    should_record_results = config.get("record_results", True)
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(1, curses.COLOR_GREEN, -1)
            curses.init_pair(2, curses.COLOR_BLACK, curses.COLOR_RED)
            ok_attr = curses.color_pair(1) | curses.A_BOLD
            wrong_attr = curses.color_pair(2)
        except curses.error:
            pass
    while True:
        if not questions:
            wait_message(stdscr, "測驗", "沒有可測驗的題目。")
            curses.curs_set(0)
            return
        question = questions[idx]
        prompt = question.zh if config["direction"] == "zh-ko" else question.ko
        answer = question.ko if config["direction"] == "zh-ko" else question.zh
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        record_label = "" if should_record_results else " 不紀錄"
        draw_line(stdscr, 1, 2, f"測驗{record_label} | {title} | {idx + 1}/{len(questions)}  Esc=返回 0=星號 8=答案 4/6=上下題 +=檢查 Enter=送出", curses.A_BOLD)
        length_hint = f"  ({count_korean_letters(answer)} 個韓文字)" if config["direction"] == "zh-ko" else ""
        y = draw_wrapped(stdscr, 2, 2, width - 4, f"{'★' if question.source.is_starred else '☆'} 題目: {prompt}{length_hint}")
        draw_line(stdscr, y, 2, f"答案: {answer}" if show_hint else "答案: hidden (press 8)")
        input_y = y + 1
        answered_attr = ok_attr if graded and last_correct is True else 0
        positions = draw_answer_with_feedback(stdscr, input_y, 2, "輸入: ", user_input, partial, ok_attr, wrong_attr, answered_attr)
        count_x = max(positions[-1] + 2, width - 18)
        draw_line(stdscr, input_y, count_x, f"{count_korean_letters(user_input)} 個韓文字", curses.A_DIM)
        message_y = input_y + 1
        if (show_hint or graded) and question.kind == "term":
            examples = card_examples(question.source)
            if examples:
                draw_line(stdscr, message_y, 2, "例句:", curses.A_DIM)
                message_y += 1
                for example in examples:
                    text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                    message_y = draw_wrapped(stdscr, message_y, 4, width - 6, text, curses.A_DIM)
        if retry_diff or (graded and last_correct is False):
            draw_answer_diff(stdscr, message_y, 2, user_input, answer, wrong_attr)
            message_y += 1
        if message:
            draw_line(stdscr, message_y, 2, message, curses.A_BOLD)
        cursor_x = positions[min(input_cursor, len(positions) - 1)]
        stdscr.move(min(height - 1, input_y), min(width - 1, cursor_x))
        update_curses_screen(stdscr)
        key = stdscr.get_wch()
        if key == "\x1b":
            curses.curs_set(0)
            return
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if graded:
                if idx == len(questions) - 1:
                    wait_message(stdscr, "完成", "這組題目已完成。")
                    curses.curs_set(0)
                    return
                idx += 1
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                message = ""
                continue
            user_input = user_input.strip()
            input_cursor = min(input_cursor, len(user_input))
            correct = normalize_text(user_input) == normalize_text(answer)
            if not correct and question.kind == "example" and config["direction"] == "zh-ko" and typed_attempts == 0:
                typed_attempts = 1
                retry_diff = True
                partial = None
                show_hint = False
                message = "例句第一次答錯：先看提示再試一次，第二次答錯才會記錄。"
                continue
            if should_record_results:
                snapshot = _clone_json(state)
                record_answer(state, question, correct)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    message = ""
                    continue
            show_hint = True
            partial = None
            graded = True
            last_correct = correct
            retry_diff = False
            if should_record_results:
                message = "答對，按 Enter 或 6 進入下一題。" if correct else "答錯，已記錄。按 Enter 或 6 進入下一題。"
            else:
                message = "答對，未紀錄。按 Enter 或 6 進入下一題。" if correct else "答錯，未紀錄。按 Enter 或 6 進入下一題。"
            continue
        if key in (curses.KEY_BACKSPACE, "\b", "\x7f"):
            if graded:
                continue
            if input_cursor > 0:
                user_input = user_input[: input_cursor - 1] + user_input[input_cursor:]
                input_cursor -= 1
            partial = None
            retry_diff = False
            continue
        if key == curses.KEY_LEFT:
            if graded:
                continue
            input_cursor = max(0, input_cursor - 1)
            continue
        if key == curses.KEY_RIGHT:
            if graded:
                continue
            input_cursor = min(len(user_input), input_cursor + 1)
            continue
        if isinstance(key, str):
            if key == "0":
                snapshot = _clone_json(state)
                toggle_star(state, question.source)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    question.source.is_starred = question.source.id in (state.get("starred") or [])
                    message = ""
                    continue
                message = "已打星號" if question.source.is_starred else "已取消星號"
            elif key == "8":
                show_hint = not show_hint
            elif key == "+":
                if graded:
                    continue
                user_input = user_input.strip()
                input_cursor = min(input_cursor, len(user_input))
                partial = partial_check_input(user_input, answer)
                message = "目前都正確。" if partial.all_correct_prefix and user_input else "有錯誤或缺字。"
            elif key == "4":
                idx = max(0, idx - 1)
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                message = ""
            elif key == "6":
                if idx == len(questions) - 1 and graded:
                    wait_message(stdscr, "完成", "這組題目已完成。")
                    curses.curs_set(0)
                    return
                idx = min(len(questions) - 1, idx + 1)
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                message = ""
            elif key.isprintable():
                if graded:
                    continue
                user_input = user_input[:input_cursor] + key + user_input[input_cursor:]
                input_cursor += 1
                partial = None
                retry_diff = False


def run_collection(stdscr: curses.window, title: str, cards: List[Card], questions: List[Question], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> None:
    mode = menu(stdscr, f"{title} | 模式", [("study", "學習模式"), ("practice", "測驗模式")])
    if not mode:
        return
    if mode == "study":
        starred = menu(stdscr, f"{title} | 學習篩選", [("all", "全部卡片"), ("starred", "有星號")])
        if not starred:
            return
        active = [card for card in cards if starred == "all" or card.is_starred]
        run_study(stdscr, title, active, state, client, session)
    else:
        config = setup_menu(stdscr, title)
        if not config:
            return
        active_questions = filtered_questions(questions, config)
        run_practice(stdscr, title, active_questions, config, state, client, session)


def run_terminal_ui(stdscr: curses.window, client: FirebaseClient, session: AuthSession) -> None:
    try:
        state, cards, questions = load_data(client, session)
    except RuntimeError as exc:
        wait_message(stdscr, "載入失敗", str(exc))
        return
    skip_recognition_initialization = False
    while True:
        if not skip_recognition_initialization:
            snapshot = _clone_json(state)
            previous_recognition = _clone_json(state.get("recognition"))
            daily_recognition_questions(state, questions)
            if previous_recognition != state.get("recognition") and not save_review_state_or_restore(
                stdscr,
                client,
                session,
                state,
                snapshot,
                "今日題目暫時無法同步",
            ):
                skip_recognition_initialization = True
        today = today_string()
        completed = state.setdefault("completedReviewDates", [])
        choice = menu(
            stdscr,
            f"韓文筆記 Terminal | {session.email}",
            [("due", "今日複習題"), ("calendar", "月曆"), ("notebook", "單字本"), ("refresh", "重新同步"), ("quit", "離開")],
            "↑↓=移動 Enter=選擇 Esc=離開",
        )
        if choice in (None, "quit"):
            return
        if choice == "refresh":
            try:
                state, cards, questions = load_data(client, session)
                skip_recognition_initialization = False
            except RuntimeError as exc:
                wait_message(stdscr, "同步失敗", str(exc))
            continue
        if choice == "due":
            task = due_task_menu(stdscr, state, questions)
            if task:
                task_type, selected = task
                if task_type == DAILY_RECOGNITION_MODE:
                    run_daily_recognition(stdscr, selected, cards, state, client, session)
                else:
                    run_practice(
                        stdscr,
                        "今日複習題",
                        selected,
                        {"direction": "zh-ko", "source": "all", "starred": False, "random": True, "record_results": True},
                        state,
                        client,
                        session,
                    )
                if not daily_due_questions(state, questions) and not daily_recognition_questions(state, questions):
                    completed = state.setdefault("completedReviewDates", [])
                    today = today_string()
                    if today not in completed:
                        snapshot = _clone_json(state)
                        completed.append(today)
                        completed.sort()
                        save_review_state_or_restore(
                            stdscr,
                            client,
                            session,
                            state,
                            snapshot,
                            "完成紀錄儲存失敗",
                        )
        elif choice == "calendar":
            selected_date = date_menu(stdscr, cards)
            if selected_date:
                day_cards = [card for card in cards if card.date == selected_date]
                day_questions = [question for question in questions if question.date == selected_date]
                run_collection(stdscr, selected_date, day_cards, day_questions, state, client, session)
        elif choice == "notebook":
            run_collection(stdscr, "單字本", cards, questions, state, client, session)


def clear_plain_screen() -> None:
    print("\033[2J\033[H", end="")


def prompt_login(client: FirebaseClient) -> AuthSession:
    default_email = os.getenv("TERMINAL_PRACTICE_EMAIL", "").strip()
    default_password = os.getenv("TERMINAL_PRACTICE_PASSWORD", "")
    while True:
        clear_plain_screen()
        print("Login | 韓文筆記 Terminal")
        print("可在 .env 設定 TERMINAL_PRACTICE_EMAIL / TERMINAL_PRACTICE_PASSWORD")
        email_input = input(f"Email [{default_email}]: " if default_email else "Email: ").strip()
        email = email_input or default_email
        password = getpass.getpass("Password [Enter to use .env default]: " if default_password else "Password: ") or default_password
        if not email or not password:
            print("Email 和 password 都是必填。")
            input("Press Enter to retry...")
            continue
        try:
            return client.sign_in(email, password)
        except RuntimeError as exc:
            print(f"Login failed: {exc}")
            if input("Try again? (y/n): ").strip().lower() != "y":
                raise SystemExit(1)


def main() -> None:
    load_local_env()
    client = FirebaseClient(API_KEY, PROJECT_ID)
    session = prompt_login(client)
    curses.wrapper(run_terminal_ui, client, session)


if __name__ == "__main__":
    main()
