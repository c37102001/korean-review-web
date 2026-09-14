#!/usr/bin/env python3
"""Terminal practice interface for korean-review-web data.

Usage:
  python3 terminal_review_practice.py

Optional .env values:
  TERMINAL_PRACTICE_EMAIL=your@email.com
  TERMINAL_PRACTICE_PASSWORD=your-password

Core keys:
  . toggle automatic audio, A toggle full-card autoplay, 1/2/3 set card repeats,
  0 toggle star, * add current word to unfamiliar, 5 show/hide Chinese in study mode,
  8 show/hide answer or details, 4 previous, 6 next,
  + partial check, Enter submit answer, Esc back.
"""

from __future__ import annotations

import curses
import getpass
import hashlib
import json
import os
import random
import re
import signal
import shutil
import subprocess
import textwrap
import time
import unicodedata
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib import error, parse, request


API_KEY = "AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU"
PROJECT_ID = "korean-review-web"
FIRESTORE_SCHEMA_VERSION = 3
PROGRESS_SHARD_COUNT = 16
REVIEW_INTERVALS = [1, 3, 7, 14, 30, 90]
DAILY_RECOGNITION_LIMIT = 50
DAILY_RECOGNITION_MODE = "daily-recognition"
DAILY_GRAMMAR_MODE = "daily-grammar"
NOTE_CATEGORY_GRAMMAR = "grammar"
NOTE_CATEGORY_VOCABULARY = "vocabulary"
DAILY_MIXED_MODE = "daily-mixed"
DAILY_WRONG_REVIEW_MODE = "daily-wrong-review"
YT_SUBTITLE_MODE_JSON = "json"
YT_SUBTITLE_MODE_SRT = "srt"
SYSTEM_LEARNED_FOLDER_ID = "system-learned"
SYSTEM_LEARNED_FOLDER_NAME = "已學習"
SYSTEM_UNFAMILIAR_FOLDER_ID = "system-unfamiliar"
SYSTEM_UNFAMILIAR_FOLDER_NAME = "不熟悉"
KOREAN_NEURAL_VOICE = "ko-KR-SunHiNeural"
KOREAN_NEURAL_RATE = "-8%"
CACHE_DIR = Path.home() / ".cache" / "korean-review-web-terminal"


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
class GrammarNote:
    id: str
    title: str
    notes: str
    examples: List[Dict[str, str]]
    category: str = NOTE_CATEGORY_GRAMMAR
    created_at: str = ""


@dataclass
class YoutubeSubtitle:
    id: str
    title: str
    youtube_url: str
    mode: str
    entries: List[Dict[str, Any]]
    created_at: str = ""
    updated_at: str = ""


@dataclass
class PartialCheckResult:
    all_correct_prefix: bool
    wrong_raw_indices: set[int]
    missing_space_before_raw_indices: set[int]


_AUTO_PLAY_AUDIO = True


class FirebaseClient:
    def __init__(self, api_key: str, project_id: str) -> None:
        self.api_key = api_key
        self.project_id = project_id
        self._saved_state: Dict[str, Any] = empty_state()
        self._writes_blocked_until = 0.0
        self.offline_mode = False

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

    def list_folders(self, session: AuthSession) -> List[Dict[str, Any]]:
        return [
            _parse_firestore_fields(document.get("fields", {}))
            | {"id": _doc_id(document.get("name", ""))}
            for document in self._list_documents(["users", session.uid, "folders"], session)
        ]

    def ensure_system_folder(
        self,
        session: AuthSession,
        folders: List[Dict[str, Any]],
        folder_id: str,
        folder_name: str,
        system_key: str,
    ) -> Dict[str, Any]:
        folder = next((
            folder for folder in folders
            if folder.get("id") == folder_id
            or folder.get("systemKey") == system_key
            or folder.get("name") == folder_name
        ), None)
        if folder:
            folder["wordIds"] = list(dict.fromkeys(str(item) for item in (folder.get("wordIds") or []) if item))
            return folder
        now = utc_now_iso()
        folder = {
            "id": folder_id,
            "name": folder_name,
            "wordIds": [],
            "systemKey": system_key,
            "createdAt": now,
            "updatedAt": now,
        }
        payload = {"fields": {key: _to_firestore_value(value) for key, value in folder.items()}}
        self._request_json(
            "PATCH",
            self._document_url(["users", session.uid, "folders", folder_id]),
            payload=payload,
            session=session,
        )
        return folder

    def ensure_learned_folder(self, session: AuthSession, folders: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.ensure_system_folder(
            session, folders, SYSTEM_LEARNED_FOLDER_ID, SYSTEM_LEARNED_FOLDER_NAME, "learned"
        )

    def ensure_unfamiliar_folder(self, session: AuthSession, folders: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.ensure_system_folder(
            session, folders, SYSTEM_UNFAMILIAR_FOLDER_ID, SYSTEM_UNFAMILIAR_FOLDER_NAME, "unfamiliar"
        )

    def add_word_to_folder(self, session: AuthSession, folder_id: str, word_id: str) -> None:
        document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/folders/{folder_id}"
        commit_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit"
        self._request_json("POST", commit_url, payload={"writes": [{
            "transform": {
                "document": document_name,
                "fieldTransforms": [
                    {"fieldPath": "wordIds", "appendMissingElements": {"values": [_to_firestore_value(word_id)]}},
                    {"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"},
                ],
            },
        }]}, session=session)

    def remove_word_from_folder(self, session: AuthSession, folder_id: str, word_id: str) -> None:
        document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/folders/{folder_id}"
        commit_url = f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit"
        self._request_json("POST", commit_url, payload={"writes": [{
            "transform": {
                "document": document_name,
                "fieldTransforms": [
                    {"fieldPath": "wordIds", "removeAllFromArray": {"values": [_to_firestore_value(word_id)]}},
                    {"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"},
                ],
            },
        }]}, session=session)

    def list_grammar_notes(self, session: AuthSession) -> List[Dict[str, Any]]:
        return [
            _parse_firestore_fields(document.get("fields", {}))
            | {"_docId": _doc_id(document.get("name", ""))}
            for document in self._list_documents(["users", session.uid, "grammarNotes"], session)
        ]

    def list_youtube_subtitles(self, session: AuthSession) -> List[Dict[str, Any]]:
        return [
            _parse_firestore_fields(document.get("fields", {}))
            | {"_docId": _doc_id(document.get("name", ""))}
            for document in self._list_documents(["users", session.uid, "ytSubtitles"], session)
        ]

    def load_grammar_review(self, session: AuthSession) -> Dict[str, Any]:
        try:
            document = self._request_json(
                "GET",
                self._document_url(["users", session.uid, "settings", "grammarReview"]),
                session=session,
            )
        except RuntimeError as exc:
            if "NOT_FOUND" in str(exc) or "404" in str(exc):
                return {}
            raise
        return _parse_firestore_fields(document.get("fields", {}))

    def update_optional_practice(
        self,
        session: AuthSession,
        change: Any,
    ) -> Dict[str, Any]:
        """Atomically replace only optionalPractice without losing web updates."""
        url = self._document_url(["users", session.uid, "settings", "grammarReview"])
        for attempt in range(4):
            try:
                document = self._request_json("GET", url, session=session)
                fields = _parse_firestore_fields(document.get("fields", {}))
                update_time = str(document.get("updateTime") or "")
            except RuntimeError as exc:
                if "NOT_FOUND" not in str(exc) and "404" not in str(exc):
                    raise
                fields = {}
                update_time = ""
            current = _clone_json(fields.get("optionalPractice") or {"tasks": [], "pools": {}})
            next_value = change(current)
            if next_value == current:
                return current
            query = [("updateMask.fieldPaths", "optionalPractice")]
            if update_time:
                query.append(("currentDocument.updateTime", update_time))
            try:
                updated = self._request_json(
                    "PATCH",
                    f"{url}?{parse.urlencode(query)}",
                    payload={"fields": {"optionalPractice": _to_firestore_value(next_value)}},
                    session=session,
                )
                return _parse_firestore_fields(updated.get("fields", {})).get("optionalPractice") or next_value
            except RuntimeError as exc:
                if attempt < 3 and ("HTTP 409" in str(exc) or "HTTP 412" in str(exc)):
                    continue
                raise
        raise RuntimeError("無法同步自選練習，請重新載入後再試")

    def save_grammar_review(
        self,
        session: AuthSession,
        note: GrammarNote,
        date_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        date_key = date_key or today_string()
        review = {
            "lastCompletedGrammarId": note.id,
            "lastCompletedCreatedAt": note.created_at,
            "completedDate": date_key,
            "updatedAt": utc_now_iso(),
        }
        payload = {"fields": {key: _to_firestore_value(value) for key, value in review.items()}}
        update_mask = parse.urlencode([("updateMask.fieldPaths", key) for key in review])
        self._request_json(
            "PATCH",
            self._document_url(["users", session.uid, "settings", "grammarReview"]) + "?" + update_mask,
            payload=payload,
            session=session,
        )
        return review

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
        if self.offline_mode:
            # Keep the current terminal session usable while Firestore has rejected reads.
            # These changes are intentionally not presented as persisted data.
            self._saved_state = _clone_json(state)
            return
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
        settings_changed = (
            previous.get("starred") != state.get("starred")
            or previous.get("recognition") != state.get("recognition")
        )
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


def mark_word_as_learned(
    client: FirebaseClient,
    session: AuthSession,
    state: Dict[str, Any],
    word_id: str,
) -> bool:
    """Persist a learned word once and keep the in-memory filters in sync."""
    learned_word_ids = list(state.get("learnedWordIds") or [])
    if word_id in learned_word_ids:
        return False
    client.add_word_to_folder(
        session,
        str(state.get("learnedFolderId") or SYSTEM_LEARNED_FOLDER_ID),
        word_id,
    )
    state["learnedWordIds"] = [*learned_word_ids, word_id]
    sync_state_folder_membership(
        state,
        str(state.get("learnedFolderId") or SYSTEM_LEARNED_FOLDER_ID),
        word_id,
        True,
    )
    return True


def mark_word_as_unfamiliar(
    client: FirebaseClient,
    session: AuthSession,
    state: Dict[str, Any],
    word_id: str,
) -> bool:
    """Persist an unfamiliar word without changing its review schedule."""
    unfamiliar_word_ids = list(state.get("unfamiliarWordIds") or [])
    if word_id in unfamiliar_word_ids:
        return False
    client.add_word_to_folder(
        session,
        str(state.get("unfamiliarFolderId") or SYSTEM_UNFAMILIAR_FOLDER_ID),
        word_id,
    )
    state["unfamiliarWordIds"] = [*unfamiliar_word_ids, word_id]
    sync_state_folder_membership(
        state,
        str(state.get("unfamiliarFolderId") or SYSTEM_UNFAMILIAR_FOLDER_ID),
        word_id,
        True,
    )
    return True


def sync_state_folder_membership(
    state: Dict[str, Any],
    folder_id: str,
    word_id: str,
    included: bool,
) -> None:
    for folder in state.get("folders") or []:
        if str(folder.get("id")) != folder_id:
            continue
        folder_word_ids = [str(item) for item in (folder.get("wordIds") or []) if item]
        folder["wordIds"] = list(dict.fromkeys(
            [*folder_word_ids, word_id] if included else [item for item in folder_word_ids if item != word_id]
        ))
        return


def toggle_word_as_unfamiliar(
    client: FirebaseClient,
    session: AuthSession,
    state: Dict[str, Any],
    word_id: str,
) -> bool:
    """Toggle unfamiliar membership and return the new membership state."""
    unfamiliar_word_ids = list(state.get("unfamiliarWordIds") or [])
    folder_id = str(state.get("unfamiliarFolderId") or SYSTEM_UNFAMILIAR_FOLDER_ID)
    if word_id in unfamiliar_word_ids:
        client.remove_word_from_folder(session, folder_id, word_id)
        state["unfamiliarWordIds"] = [item for item in unfamiliar_word_ids if item != word_id]
        now_unfamiliar = False
    else:
        client.add_word_to_folder(session, folder_id, word_id)
        state["unfamiliarWordIds"] = [*unfamiliar_word_ids, word_id]
        now_unfamiliar = True
    sync_state_folder_membership(state, folder_id, word_id, now_unfamiliar)
    return now_unfamiliar


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
                if not ko or not zh:
                    continue
                qid = str(example.get("id") or f"{card.id}-{meaning.get('id', 'meaning')}-ex-{ex_index}")
                questions.append(Question(qid, card.id, card.date, "example", ko, zh, card))
    cards.sort(key=lambda c: (c.date, c.order, c.id))
    for index, card in enumerate(cards):
        card.index = index
    return cards, order_questions(questions)


def normalize_grammar_notes(records: List[Dict[str, Any]]) -> List[GrammarNote]:
    notes: List[GrammarNote] = []
    for record in records:
        note_id = str(record.get("id") or record.get("_docId") or "")
        title = str(record.get("title") or "").strip()
        if not note_id or not title:
            continue
        examples = []
        for example in record.get("examples") or []:
            ko = str(example.get("ko") or "").strip()
            zh = str(example.get("zh") or "").strip()
            if ko and zh:
                examples.append({
                    "id": str(example.get("id") or f"{note_id}-example-{len(examples)}"),
                    "ko": ko,
                    "zh": zh,
                })
        notes.append(GrammarNote(
            id=note_id,
            title=title,
            notes=str(record.get("notes") or "").strip(),
            examples=examples,
            category=(
                NOTE_CATEGORY_VOCABULARY
                if record.get("category") == NOTE_CATEGORY_VOCABULARY
                else NOTE_CATEGORY_GRAMMAR
            ),
            created_at=str(record.get("createdAt") or ""),
        ))
    return sorted(notes, key=lambda note: (note.created_at, note.id))


def normalize_youtube_subtitles(records: List[Dict[str, Any]]) -> List[YoutubeSubtitle]:
    subtitles: List[YoutubeSubtitle] = []
    for record in records:
        subtitle_id = str(record.get("id") or record.get("_docId") or "")
        title = str(record.get("title") or "").strip()
        if not subtitle_id or not title:
            continue
        entries: List[Dict[str, Any]] = []
        for index, entry in enumerate(record.get("entries") or []):
            ko = str(entry.get("ko") or "").strip()
            zh = str(entry.get("zh") or "").strip()
            if not ko or not zh:
                continue
            start_ms = entry.get("startMs")
            end_ms = entry.get("endMs")
            entries.append({
                "id": str(entry.get("id") or f"{subtitle_id}-entry-{index}"),
                "ko": ko,
                "zh": zh,
                "startMs": int(start_ms) if isinstance(start_ms, (int, float)) else None,
                "endMs": int(end_ms) if isinstance(end_ms, (int, float)) else None,
            })
        subtitles.append(YoutubeSubtitle(
            id=subtitle_id,
            title=title,
            youtube_url=str(record.get("youtubeUrl") or "").strip(),
            mode=YT_SUBTITLE_MODE_SRT if record.get("mode") == YT_SUBTITLE_MODE_SRT else YT_SUBTITLE_MODE_JSON,
            entries=entries,
            created_at=str(record.get("createdAt") or ""),
            updated_at=str(record.get("updatedAt") or ""),
        ))
    return sorted(
        subtitles,
        key=lambda subtitle: (subtitle.updated_at or subtitle.created_at, subtitle.title, subtitle.id),
        reverse=True,
    )


def load_data(
    client: FirebaseClient,
    session: AuthSession,
) -> Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]]:
    with ThreadPoolExecutor(max_workers=6) as executor:
        state_future = executor.submit(client.load_review_state, session)
        records_future = executor.submit(client.list_records, session)
        folders_future = executor.submit(client.list_folders, session)
        grammar_notes_future = executor.submit(client.list_grammar_notes, session)
        youtube_subtitles_future = executor.submit(client.list_youtube_subtitles, session)
        grammar_review_future = executor.submit(client.load_grammar_review, session)
        state = state_future.result()
        records = records_future.result()
        folders = folders_future.result()
        grammar_note_records = grammar_notes_future.result()
        youtube_subtitle_records = youtube_subtitles_future.result()
        grammar_review = grammar_review_future.result()

    payload = {
        "state": state,
        "records": records,
        "folders": folders,
        "grammarNotes": grammar_note_records,
        "ytSubtitles": youtube_subtitle_records,
        "grammarReview": grammar_review,
    }
    _write_terminal_cache(session.uid, payload)
    return _hydrate_loaded_data(client, session, payload, ensure_system_folders=True)


def load_data_with_cache(
    client: FirebaseClient,
    session: AuthSession,
) -> Tuple[Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]], bool]:
    """Load Firebase data, falling back to the most recent local snapshot on quota exhaustion."""
    try:
        loaded = load_data(client, session)
    except RuntimeError as exc:
        if not _is_quota_exceeded_error(str(exc)):
            raise
        payload = _read_terminal_cache(session.uid)
        if payload is None:
            raise
        client.offline_mode = True
        return _hydrate_loaded_data(client, session, payload, ensure_system_folders=False), True
    client.offline_mode = False
    return loaded, False


def _hydrate_loaded_data(
    client: FirebaseClient,
    session: AuthSession,
    payload: Dict[str, Any],
    ensure_system_folders: bool,
) -> Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]]:
    state = _clone_json(payload.get("state") or empty_state())
    records = _clone_json(payload.get("records") or [])
    folders = _clone_json(payload.get("folders") or [])
    grammar_note_records = _clone_json(payload.get("grammarNotes") or [])
    youtube_subtitle_records = _clone_json(payload.get("ytSubtitles") or [])
    grammar_review = _clone_json(payload.get("grammarReview") or {})

    learned_folder = next((folder for folder in folders if folder.get("id") == SYSTEM_LEARNED_FOLDER_ID), None)
    unfamiliar_folder = next((folder for folder in folders if folder.get("id") == SYSTEM_UNFAMILIAR_FOLDER_ID), None)
    if ensure_system_folders:
        learned_folder = client.ensure_learned_folder(session, folders)
        unfamiliar_folder = client.ensure_unfamiliar_folder(session, folders)
    learned_folder = learned_folder or {"id": SYSTEM_LEARNED_FOLDER_ID, "wordIds": []}
    unfamiliar_folder = unfamiliar_folder or {"id": SYSTEM_UNFAMILIAR_FOLDER_ID, "wordIds": []}
    if not any(folder.get("id") == learned_folder.get("id") for folder in folders):
        folders.append(learned_folder)
    if not any(folder.get("id") == unfamiliar_folder.get("id") for folder in folders):
        folders.append(unfamiliar_folder)
    state["folders"] = folders
    state["learnedWordIds"] = learned_folder.get("wordIds") or []
    state["learnedFolderId"] = learned_folder.get("id") or SYSTEM_LEARNED_FOLDER_ID
    state["unfamiliarWordIds"] = unfamiliar_folder.get("wordIds") or []
    state["unfamiliarFolderId"] = unfamiliar_folder.get("id") or SYSTEM_UNFAMILIAR_FOLDER_ID

    records_by_id: Dict[str, Dict[str, Any]] = {}
    for record in records:
        record_id = record.get("id") or record.get("_docId")
        if record_id:
            record["id"] = record_id
            records_by_id[record_id] = record
    cards, questions = normalize_records(list(records_by_id.values()), state)
    grammar_notes = normalize_grammar_notes(grammar_note_records)
    youtube_subtitles = normalize_youtube_subtitles(youtube_subtitle_records)
    return state, cards, questions, grammar_notes, grammar_review, youtube_subtitles


def _terminal_cache_path(uid: str) -> Path:
    digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / f"{digest}.json"


def _write_terminal_cache(uid: str, payload: Dict[str, Any]) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = _terminal_cache_path(uid)
        temporary_path = cache_path.with_suffix(".tmp")
        temporary_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary_path.replace(cache_path)
    except OSError:
        # A cache failure must never block normal Firebase-backed practice.
        pass


def _read_terminal_cache(uid: str) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(_terminal_cache_path(uid).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


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


def order_questions(questions: Iterable[Question]) -> List[Question]:
    rank = {"term": 0, "example": 1}
    return sorted(questions, key=lambda q: (rank.get(q.kind, 99), q.date, q.source.index, q.id))


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
    wrong_ids = {
        str(attempt.get("questionId") or "")
        for attempt in (state.get("attempts") or [])
        if attempt_date(attempt) == date_key and attempt.get("correct") is False
    }
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


OPTIONAL_PRACTICE_LABELS = {
    "words": "單字練習",
    "listening": "單字例句聽力練習",
    "reading": "單字例句閱讀練習",
    "grammar": "文法例句練習",
}


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
    current: Dict[str, Any],
    task: Dict[str, Any],
    pool_ids: Iterable[str],
    count: int,
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
) -> None:
    now = utc_now_iso()
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
    previous_score = familiarity_score(old)
    next_score = familiarity_score(next_stats)
    remains_unfamiliar = next_score < 0
    if remains_unfamiliar:
        stage = 0
    elif correct:
        previous_stage = 0 if previous_score < 0 else int(previous.get("stage", 0))
        stage = min(previous_stage + 1, len(REVIEW_INTERVALS) - 1)
    else:
        stage = 0
    interval_days = 2 if remains_unfamiliar and correct else REVIEW_INTERVALS[stage]
    state.setdefault("progress", {})[question.id] = {
        "stage": stage,
        "nextDue": add_days(today_string(), interval_days),
        "lastAnsweredAt": now,
        "lastResult": "correct" if correct else "wrong",
    }
    attempts = state.setdefault("attempts", [])
    attempts.insert(0, {"id": str(uuid.uuid4()), "questionId": question.id, "correct": correct, "date": today_string(), "time": now})
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


def card_examples(card: Card) -> List[Dict[str, str]]:
    examples: List[Dict[str, str]] = []
    for meaning in card.meanings:
        for entry in meaning.get("examples", []) or []:
            ko = str(entry.get("ko", "")).strip()
            zh = str(entry.get("zh", "")).strip()
            if ko or zh:
                examples.append({"ko": ko, "zh": zh})
    return examples


def study_auto_audio_steps(card: Card, repeat_count: int) -> List[Tuple[str, int, str, int]]:
    repeats = min(3, max(1, int(repeat_count or 1)))
    examples = card_examples(card)
    cycle: List[Tuple[str, int, str]] = [("front", -1, card.ko)]
    if examples:
        cycle.extend(("back", index, example.get("ko", "")) for index, example in enumerate(examples))
    else:
        cycle.append(("back", -1, ""))
    return [
        (face, example_index, text, repeat_index)
        for repeat_index in range(1, repeats + 1)
        for face, example_index, text in cycle
    ]


def cards_in_folder(cards: List[Card], folder: Dict[str, Any]) -> List[Card]:
    word_ids = set(str(item) for item in (folder.get("wordIds") or []) if item)
    return [card for card in cards if card.id in word_ids]


def familiarity_score(stats: Dict[str, Any]) -> int:
    correct = int(stats.get("correct") or 0)
    wrong_value = stats.get("wrong")
    wrong = int(wrong_value) if wrong_value is not None else max(0, int(stats.get("total") or 0) - correct)
    return correct - wrong


def familiarity_level(score: int) -> str:
    if score < 0:
        return "不熟悉"
    if score >= 5:
        return "已熟悉"
    if score >= 3:
        return "熟悉"
    return "學習中"


def familiarity_filter_value(level: str, score: int) -> str:
    if level != "不熟悉":
        return level
    if score == -1:
        return "score-negative-1"
    if score == -2:
        return "score-negative-2"
    if score == -3:
        return "score-negative-3"
    return "score-negative-4-or-less"


def card_familiarity(state: Dict[str, Any], questions: List[Question], card_id: str) -> Tuple[int, str]:
    question_ids = [question.id for question in questions if question.item_id == card_id]
    question_stats = [(state.get("stats") or {}).get(question_id, {}) for question_id in question_ids]
    correct = sum(int(stats.get("correct") or 0) for stats in question_stats)
    wrong = sum(
        int(stats.get("wrong"))
        if stats.get("wrong") is not None
        else max(0, int(stats.get("total") or 0) - int(stats.get("correct") or 0))
        for stats in question_stats
    )
    score = familiarity_score({"correct": correct, "wrong": wrong})
    return score, familiarity_level(score)


def card_search_text(card: Card) -> str:
    details: List[str] = [card.ko, card.zh, card.pos, card.date, *card.notes, *card.related]
    for meaning in card.meanings:
        details.extend([str(meaning.get("zh") or ""), str(meaning.get("pattern") or "")])
        for example in meaning.get("examples") or []:
            details.extend([str(example.get("ko") or ""), str(example.get("zh") or "")])
    return unicodedata.normalize("NFC", " ".join(details)).casefold()


def card_word_search_text(card: Card) -> str:
    meanings = [str(meaning.get("zh") or "") for meaning in card.meanings]
    return unicodedata.normalize("NFC", " ".join([card.ko, *meanings])).casefold()


def filtered_notebook_cards(
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
    config: Dict[str, Any],
) -> List[Card]:
    query = unicodedata.normalize("NFC", str(config.get("query") or "").strip()).casefold()
    scope = str(config.get("search_scope") or "all")
    levels = set(config.get("levels") or [])
    selected_folder_ids = set(config.get("folder_ids") or [])
    learned_ids = set(state.get("learnedWordIds") or [])
    folder_word_ids: Optional[set[str]] = None
    if selected_folder_ids:
        folder_word_ids = {
            str(word_id)
            for folder in (state.get("folders") or [])
            if str(folder.get("id") or "") in selected_folder_ids
            for word_id in (folder.get("wordIds") or [])
            if word_id
        }

    result: List[Tuple[Card, int]] = []
    for card in cards:
        if not config.get("show_learned") and card.id in learned_ids:
            continue
        if folder_word_ids is not None and card.id not in folder_word_ids:
            continue
        score, level = card_familiarity(state, questions, card.id)
        if levels and familiarity_filter_value(level, score) not in levels and level not in levels:
            continue
        if query:
            search_value = card_word_search_text(card) if scope == "word" else card_search_text(card)
            if query not in search_value:
                continue
        result.append((card, score))

    sort_mode = str(config.get("sort") or "latest")
    if sort_mode == "alphabetical":
        result.sort(key=lambda entry: (unicodedata.normalize("NFC", entry[0].ko).casefold(), entry[0].zh, entry[0].id))
    elif sort_mode == "score":
        result.sort(key=lambda entry: (entry[1], -int(entry[0].order or 0), entry[0].id))
    else:
        result.sort(key=lambda entry: entry[0].id)
        result.sort(key=lambda entry: (entry[0].date, int(entry[0].order or 0)), reverse=True)
    return [card for card, _ in result]


def order_questions_by_cards(questions: List[Question], cards: List[Card]) -> List[Question]:
    rank = {card.id: index for index, card in enumerate(cards)}
    kind_rank = {"term": 0, "example": 1}
    return sorted(questions, key=lambda question: (
        rank.get(question.item_id, len(rank)),
        kind_rank.get(question.kind, 9),
        question.id,
    ))


def korean_speech_commands(text: str) -> List[List[str]]:
    commands: List[List[str]] = []
    if shutil.which("spd-say"):
        commands.append(["spd-say", "--wait", "--language", "ko", "--rate", "-10", text])
    if shutil.which("espeak-ng"):
        commands.append(["espeak-ng", "-v", "ko", "-s", "145", text])
    elif shutil.which("espeak"):
        commands.append(["espeak", "-v", "ko", "-s", "145", text])
    return commands


def korean_audio_players(audio_path: Path) -> List[List[str]]:
    commands: List[List[str]] = []
    if shutil.which("cvlc"):
        commands.append([
            "cvlc",
            "--intf", "dummy",
            "--play-and-exit",
            "--no-video",
            "--quiet",
            str(audio_path),
        ])
    if shutil.which("ffplay"):
        commands.append([
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-loglevel", "quiet",
            str(audio_path),
        ])
    return commands


def neural_korean_audio(text: str) -> Optional[Path]:
    edge_tts = shutil.which("edge-tts")
    if not edge_tts or not korean_audio_players(Path("probe.mp3")):
        return None
    cache_root = Path(os.getenv("XDG_CACHE_HOME", Path.home() / ".cache"))
    cache_dir = cache_root / "korean-review-web" / "tts"
    cache_key = hashlib.sha256(
        f"{KOREAN_NEURAL_VOICE}\0{KOREAN_NEURAL_RATE}\0{text}".encode("utf-8")
    ).hexdigest()
    audio_path = cache_dir / f"{cache_key}.mp3"
    if audio_path.exists() and audio_path.stat().st_size > 0:
        return audio_path

    cache_dir.mkdir(parents=True, exist_ok=True)
    temporary_path = cache_dir / f".{cache_key}-{uuid.uuid4().hex}.mp3"
    try:
        result = subprocess.run(
            [
                edge_tts,
                "--voice", KOREAN_NEURAL_VOICE,
                f"--rate={KOREAN_NEURAL_RATE}",
                "--text", text,
                "--write-media", str(temporary_path),
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        if result.returncode != 0 or not temporary_path.exists() or temporary_path.stat().st_size == 0:
            return None
        os.replace(temporary_path, audio_path)
        return audio_path
    except (OSError, subprocess.TimeoutExpired):
        return None
    finally:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass


def play_korean_audio(audio_path: Path) -> bool:
    for command in korean_audio_players(audio_path):
        try:
            result = subprocess.run(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            return True
    return False


def speak_korean(text: str) -> bool:
    if not text.strip():
        return False
    neural_audio = neural_korean_audio(text)
    if neural_audio and play_korean_audio(neural_audio):
        return True
    for command in korean_speech_commands(text):
        try:
            result = subprocess.run(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0:
            return True
    return False


def youtube_audio_cache_path(subtitle: YoutubeSubtitle) -> Path:
    url_hash = hashlib.sha256(subtitle.youtube_url.encode("utf-8")).hexdigest()[:16]
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", subtitle.id).strip("-.") or "subtitle"
    return CACHE_DIR / "youtube-audio" / f"{safe_id}-{url_hash}.mp3"


def youtube_audio_download_profiles() -> List[List[str]]:
    return [
        [],
        ["--format", "bestaudio[ext=m4a]/bestaudio/best"],
        [
            "--format", "bestaudio[ext=m4a]/bestaudio/best",
            "--extractor-args", "youtube:player_client=android_vr",
        ],
    ]


def download_youtube_audio(subtitle: YoutubeSubtitle) -> Tuple[Optional[Path], str]:
    if not subtitle.youtube_url:
        return None, "這篇字幕沒有 YouTube 連結。"
    audio_path = youtube_audio_cache_path(subtitle)
    if audio_path.exists() and audio_path.stat().st_size > 0:
        return audio_path, "已載入快取的 YouTube 原音。"
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        return None, "缺少 yt-dlp，請執行 python3 -m pip install -r requirements-terminal.txt。"
    if not shutil.which("ffmpeg"):
        return None, "缺少 ffmpeg，無法將 YouTube 音訊轉成 MP3。"

    audio_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = audio_path.parent / f".{audio_path.stem}-{uuid.uuid4().hex}"
    temporary_dir.mkdir(parents=True, exist_ok=True)
    try:
        errors: List[str] = []
        for attempt_index, profile in enumerate(youtube_audio_download_profiles(), start=1):
            attempt_dir = temporary_dir / f"attempt-{attempt_index}"
            attempt_dir.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                [
                    yt_dlp,
                    "--no-playlist",
                    "--no-progress",
                    "--retries", "3",
                    "--fragment-retries", "3",
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", "5",
                    "--output", str(attempt_dir / "audio.%(ext)s"),
                    *profile,
                    subtitle.youtube_url,
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=300,
            )
            generated = attempt_dir / "audio.mp3"
            if result.returncode == 0 and generated.exists() and generated.stat().st_size > 0:
                os.replace(generated, audio_path)
                strategy = "" if attempt_index == 1 else f"（使用備援策略 {attempt_index}）"
                return audio_path, f"YouTube 原音已下載並快取{strategy}。"
            error_lines = [line.strip() for line in (result.stderr or "").splitlines() if line.strip()]
            errors.append(error_lines[-1] if error_lines else f"策略 {attempt_index} 未產生音訊檔案")
        detail = errors[-1] if errors else "yt-dlp 未產生音訊檔案"
        return None, f"YouTube 音訊下載失敗：{detail}。請先更新 yt-dlp。"
    except subprocess.TimeoutExpired:
        return None, "YouTube 音訊下載逾時，請稍後再試。"
    except OSError as exc:
        return None, f"YouTube 音訊下載失敗：{exc}"
    finally:
        shutil.rmtree(temporary_dir, ignore_errors=True)


class TerminalYoutubeAudioPlayer:
    def __init__(self, audio_path: Path) -> None:
        self.audio_path = audio_path
        self.process: Optional[subprocess.Popen[Any]] = None
        self.base_position = 0.0
        self.started_at: Optional[float] = None
        self.paused = True

    @staticmethod
    def available() -> bool:
        return bool(shutil.which("ffplay") or shutil.which("cvlc"))

    def _command(self, position: float) -> Optional[List[str]]:
        if shutil.which("ffplay"):
            return [
                "ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet",
                "-ss", f"{position:.3f}", str(self.audio_path),
            ]
        if shutil.which("cvlc"):
            return [
                "cvlc", "--intf", "dummy", "--no-video", "--play-and-exit", "--quiet",
                f"--start-time={position:.3f}", str(self.audio_path),
            ]
        return None

    def position(self) -> float:
        if self.started_at is None or self.paused:
            return self.base_position
        current = self.base_position + max(0.0, time.monotonic() - self.started_at)
        if self.process and self.process.poll() is not None:
            self.base_position = current
            self.started_at = None
            self.process = None
            self.paused = True
        return current

    def play_from(self, position: float) -> bool:
        self.stop()
        self.base_position = max(0.0, float(position))
        command = self._command(self.base_position)
        if not command:
            return False
        try:
            self.process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            self.process = None
            return False
        self.started_at = time.monotonic()
        self.paused = False
        return True

    def pause(self) -> bool:
        if not self.process or self.process.poll() is not None or self.paused:
            return False
        self.base_position = self.position()
        try:
            self.process.send_signal(signal.SIGSTOP)
        except OSError:
            return False
        self.started_at = None
        self.paused = True
        return True

    def resume(self) -> bool:
        if self.process and self.process.poll() is None and self.paused:
            try:
                self.process.send_signal(signal.SIGCONT)
            except OSError:
                return False
            self.started_at = time.monotonic()
            self.paused = False
            return True
        return self.play_from(self.base_position)

    def toggle(self) -> bool:
        return self.resume() if self.paused else self.pause()

    def stop(self) -> None:
        process = self.process
        if not process:
            return
        if process.poll() is None:
            try:
                if self.paused:
                    process.send_signal(signal.SIGCONT)
                process.terminate()
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    process.kill()
                except OSError:
                    pass
        self.process = None
        self.started_at = None
        self.paused = True


def next_recognition_reveal_state(
    listening_mode: bool,
    word_visible: bool,
    revealed: bool,
) -> Tuple[bool, bool]:
    if revealed:
        return True, True
    if listening_mode and not word_visible:
        return True, False
    return True, True


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


def _split_by_cell_width(text: str, max_cells: int) -> List[str]:
    max_cells = max(1, max_cells)
    lines: List[str] = []
    current: List[str] = []
    current_width = 0
    for char in text:
        if char == "\n":
            lines.append("".join(current))
            current = []
            current_width = 0
            continue
        char_width = _cell_width(char)
        if current and current_width + char_width > max_cells:
            lines.append("".join(current))
            current = []
            current_width = 0
        current.append(char)
        current_width += char_width
    lines.append("".join(current))
    return lines or [""]


def folder_prompt_notice(message: str) -> Tuple[str, str]:
    match = re.match(r'(已加入|已移出|已移除)「(不熟悉|已學習)」', message)
    if match:
        return f" （{match.group(0)}）", ""
    match = re.match(r'這個單字已經在「(不熟悉|已學習)」資料夾中。', message)
    if match:
        return f" （已在「{match.group(1)}」）", ""
    return "", message


def draw_line(stdscr: curses.window, y: int, x: int, text: str, attr: int = 0) -> None:
    height, width = stdscr.getmaxyx()
    if y < 0 or y >= height or x >= width:
        return
    start_x = max(0, x)
    available_cells = max(0, width - start_x - 1)
    if not available_cells:
        return
    clipped = _split_by_cell_width(text, available_cells)[0]
    try:
        stdscr.addstr(y, start_x, clipped, attr)
    except curses.error:
        # A terminal resize can invalidate dimensions between getmaxyx/addstr.
        return


def draw_wrapped(stdscr: curses.window, y: int, x: int, width: int, text: str, attr: int = 0) -> int:
    height, screen_width = stdscr.getmaxyx()
    available_cells = max(1, min(width, screen_width - max(0, x) - 1))
    for line in _split_by_cell_width(text, available_cells):
        if y >= height:
            break
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


def set_cursor_visibility(visibility: int) -> int:
    try:
        return curses.curs_set(visibility)
    except curses.error:
        return 0


def read_terminal_key(stdscr: curses.window, *, wide: bool = False) -> Any:
    global _AUTO_PLAY_AUDIO
    key = stdscr.get_wch() if wide else stdscr.getch()
    is_audio_toggle = key == "." if isinstance(key, str) else key == ord(".")
    if is_audio_toggle:
        _AUTO_PLAY_AUDIO = not _AUTO_PLAY_AUDIO
        height, width = stdscr.getmaxyx()
        status = f"自動播放語音：{'開啟' if _AUTO_PLAY_AUDIO else '關閉'}"
        draw_line(stdscr, height - 1, max(0, width - _text_cell_width(status) - 3), status, curses.A_BOLD)
        stdscr.refresh()
        time.sleep(0.45)
        return curses.KEY_RESIZE
    return key


def read_terminal_key_with_timeout(
    stdscr: curses.window,
    timeout_ms: int,
    *,
    wide: bool = False,
) -> Any:
    stdscr.timeout(timeout_ms)
    try:
        return read_terminal_key(stdscr, wide=wide)
    except curses.error:
        return None
    finally:
        stdscr.timeout(-1)


def auto_audio_control_label() -> str:
    return f".=自動語音:{'開' if _AUTO_PLAY_AUDIO else '關'}"


def wait_message(stdscr: curses.window, title: str, message: str) -> None:
    while True:
        stdscr.clear()
        set_cursor_visibility(0)
        draw_line(stdscr, 1, 2, title, curses.A_BOLD)
        y = draw_wrapped(stdscr, 3, 2, stdscr.getmaxyx()[1] - 4, message)
        draw_line(stdscr, y + 1, 2, "Press any key to continue...", curses.A_DIM)
        stdscr.refresh()
        if read_terminal_key(stdscr) != curses.KEY_RESIZE:
            return


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
    if not options:
        return None
    selected = 0
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        stdscr.clear()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(selected - visible_count + 1, len(options) - visible_count))
        visible_options = options[start:start + visible_count]
        draw_line(stdscr, 1, 2, title, curses.A_BOLD)
        draw_line(stdscr, 2, 2, subtitle, curses.A_DIM)
        for row, (_, label) in enumerate(visible_options, 3):
            option_index = start + row - 3
            attr = curses.A_REVERSE if option_index == selected else curses.A_NORMAL
            draw_line(stdscr, row, 2, ("» " if option_index == selected else "  ") + label, attr)
        if len(options) > visible_count:
            draw_line(
                stdscr,
                height - 1,
                2,
                f"{selected + 1}/{len(options)}",
                curses.A_DIM,
            )
        stdscr.refresh()
        key = read_terminal_key(stdscr)
        if key == 27:
            return None
        if key in (curses.KEY_UP, curses.KEY_LEFT):
            selected = (selected - 1) % len(options)
        elif key in (curses.KEY_DOWN, curses.KEY_RIGHT):
            selected = (selected + 1) % len(options)
        elif key in (curses.KEY_ENTER, 10, 13):
            return options[selected][0]


def prompt_text_value(stdscr: curses.window, title: str, initial: str = "") -> Optional[str]:
    value = initial
    cursor = len(value)
    set_cursor_visibility(1)
    stdscr.keypad(True)
    try:
        while True:
            stdscr.erase()
            height, width = stdscr.getmaxyx()
            draw_line(stdscr, 1, 2, title, curses.A_BOLD)
            draw_line(stdscr, 2, 2, "輸入搜尋文字，Enter=套用 Esc=取消；留空代表不搜尋", curses.A_DIM)
            draw_line(stdscr, 4, 2, value)
            cursor_x = min(max(2, width - 2), 2 + _text_cell_width(value[:cursor]))
            if height > 4:
                try:
                    stdscr.move(4, cursor_x)
                except curses.error:
                    pass
            update_curses_screen(stdscr)
            key = read_terminal_key(stdscr, wide=True)
            if key == "\x1b" or key == 27:
                return None
            if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
                return value.strip()
            if key in (curses.KEY_BACKSPACE, "\b", "\x7f"):
                if cursor > 0:
                    value = value[:cursor - 1] + value[cursor:]
                    cursor -= 1
            elif key == curses.KEY_DC:
                value = value[:cursor] + value[cursor + 1:]
            elif key == curses.KEY_LEFT:
                cursor = max(0, cursor - 1)
            elif key == curses.KEY_RIGHT:
                cursor = min(len(value), cursor + 1)
            elif key == curses.KEY_HOME:
                cursor = 0
            elif key == curses.KEY_END:
                cursor = len(value)
            elif isinstance(key, str) and key.isprintable():
                value = value[:cursor] + key + value[cursor:]
                cursor += 1
    finally:
        set_cursor_visibility(0)


def multi_select_menu(
    stdscr: curses.window,
    title: str,
    options: List[Tuple[str, str]],
    initial: Iterable[str],
) -> Optional[set[str]]:
    selected_values = set(initial)
    cursor = 0
    set_cursor_visibility(0)
    while True:
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(cursor - visible_count + 1, len(options) - visible_count)) if options else 0
        draw_line(stdscr, 1, 2, f"{title} · 已選 {len(selected_values)} 項", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=移動 Space=勾選 Enter=完成 A=全選 C=清除 Esc=取消", curses.A_DIM)
        for row, (value, label) in enumerate(options[start:start + visible_count], 3):
            index = start + row - 3
            marker = "[✓]" if value in selected_values else "[ ]"
            draw_line(stdscr, row, 2, ("» " if index == cursor else "  ") + f"{marker} {label}", curses.A_REVERSE if index == cursor else 0)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b" or key == 27:
            return None
        if key == curses.KEY_UP and options:
            cursor = (cursor - 1) % len(options)
        elif key == curses.KEY_DOWN and options:
            cursor = (cursor + 1) % len(options)
        elif key == " " and options:
            value = options[cursor][0]
            if value in selected_values:
                selected_values.remove(value)
            else:
                selected_values.add(value)
        elif isinstance(key, str) and key.lower() == "a":
            selected_values = {value for value, _ in options}
        elif isinstance(key, str) and key.lower() == "c":
            selected_values.clear()
        elif key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            return selected_values


def folder_tag_label(folder: Dict[str, Any]) -> str:
    return str(folder.get("tag") or "").strip() or "無標籤"


def grouped_folder_select_menu(
    stdscr: curses.window,
    folders: List[Dict[str, Any]],
    initial: Iterable[str],
) -> Optional[set[str]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for folder in folders:
        groups.setdefault(folder_tag_label(folder), []).append(folder)
    group_entries = sorted(groups.items(), key=lambda entry: (entry[0] == "無標籤", entry[0]))
    selected_values = set(initial)
    expanded: set[str] = set()
    cursor = 0
    set_cursor_visibility(0)
    while True:
        rows: List[Tuple[str, str, Optional[Dict[str, Any]]]] = []
        for tag, tagged_folders in group_entries:
            rows.append(("tag", tag, None))
            if tag in expanded:
                rows.extend(("folder", tag, folder) for folder in tagged_folders)
        cursor = min(cursor, max(0, len(rows) - 1))
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(cursor - visible_count + 1, len(rows) - visible_count)) if rows else 0
        draw_line(stdscr, 1, 2, f"資料夾篩選 · 已選 {len(selected_values)} 個資料夾", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=移動 Enter/←→=展開 Space=勾選 F=完成 A=全選 C=清除 Esc=取消", curses.A_DIM)
        for screen_row, (row_type, tag, folder) in enumerate(rows[start:start + visible_count], 3):
            index = start + screen_row - 3
            if row_type == "tag":
                folder_ids = [str(entry.get("id") or "") for entry in groups[tag]]
                selected_count = sum(folder_id in selected_values for folder_id in folder_ids)
                marker = "[✓]" if selected_count == len(folder_ids) else "[-]" if selected_count else "[ ]"
                arrow = "▼" if tag in expanded else "▶"
                label = f"{marker} {arrow} {tag} · {len(folder_ids)} 個資料夾"
            else:
                folder_id = str(folder.get("id") or "")
                marker = "[✓]" if folder_id in selected_values else "[ ]"
                label = f"    {marker} {folder.get('name') or '未命名資料夾'} · {len(folder.get('wordIds') or [])} 張卡"
            draw_line(stdscr, screen_row, 2, ("» " if index == cursor else "  ") + label, curses.A_REVERSE if index == cursor else 0)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b" or key == 27:
            return None
        if key == curses.KEY_UP and rows:
            cursor = (cursor - 1) % len(rows)
        elif key == curses.KEY_DOWN and rows:
            cursor = (cursor + 1) % len(rows)
        elif rows and key in (curses.KEY_LEFT, curses.KEY_RIGHT, "\n", "\r", curses.KEY_ENTER, 10, 13):
            row_type, tag, _ = rows[cursor]
            if row_type == "tag":
                if key == curses.KEY_LEFT:
                    expanded.discard(tag)
                elif key == curses.KEY_RIGHT:
                    expanded.add(tag)
                elif tag in expanded:
                    expanded.remove(tag)
                else:
                    expanded.add(tag)
        elif key == " " and rows:
            row_type, tag, folder = rows[cursor]
            if row_type == "tag":
                folder_ids = {str(entry.get("id") or "") for entry in groups[tag]}
                if folder_ids and folder_ids.issubset(selected_values):
                    selected_values -= folder_ids
                else:
                    selected_values |= folder_ids
            else:
                folder_id = str(folder.get("id") or "")
                if folder_id in selected_values:
                    selected_values.remove(folder_id)
                else:
                    selected_values.add(folder_id)
        elif isinstance(key, str) and key.lower() == "a":
            selected_values = {str(folder.get("id") or "") for folder in folders}
        elif isinstance(key, str) and key.lower() == "c":
            selected_values.clear()
        elif isinstance(key, str) and key.lower() == "f":
            return selected_values


def date_menu(stdscr: curses.window, cards: List[Card]) -> Optional[str]:
    counts: Dict[str, int] = {}
    for card in cards:
        counts[card.date] = counts.get(card.date, 0) + 1
    options = [(date_key, f"{date_key} · {count} 張卡") for date_key, count in sorted(counts.items(), reverse=True)]
    if not options:
        wait_message(stdscr, "月曆", "目前沒有任何日期資料。")
        return None
    return menu(stdscr, "月曆 | 選擇日期", options)


def run_grammar_note_detail(
    stdscr: curses.window,
    notes: List[GrammarNote],
    start_index: int,
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    notebook_label: str = "文法筆記",
) -> None:
    note_index = start_index
    example_index = 0
    scroll_offset = 0
    message = ""
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        note = notes[note_index]
        examples = note.examples
        if examples:
            example_index %= len(examples)
        else:
            example_index = 0

        stdscr.erase()
        height, width = stdscr.getmaxyx()
        draw_line(
            stdscr,
            1,
            2,
            (
                f"{notebook_label} | {note_index + 1}/{len(notes)}  Esc=列表 "
                "P=練習 4/6=前後篇 7=播放例句 9=下一例句 ↑↓=捲動"
            ),
            curses.A_BOLD,
        )
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in _split_by_cell_width(text, line_width):
                detail_lines.append((line, indent, attr))

        append_detail(note.title, attr=curses.A_BOLD)
        if note.created_at:
            append_detail(f"建立時間: {note.created_at}", attr=curses.A_DIM)
        if note.notes:
            append_detail("筆記", attr=curses.A_BOLD)
            append_detail(note.notes, indent=2)
        if examples:
            append_detail(f"例句 · {len(examples)} 句", attr=curses.A_BOLD)
            for index, example in enumerate(examples):
                marker = "▶" if index == example_index else " "
                append_detail(f"{marker} {index + 1}. {example['ko']}", indent=2, attr=curses.A_BOLD if index == example_index else 0)
                append_detail(f"   {example['zh']}", indent=4, attr=curses.A_DIM)
        else:
            append_detail("目前沒有例句。", attr=curses.A_DIM)

        visible_rows = max(1, height - 4)
        scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
        for row, (line, indent, attr) in enumerate(
            detail_lines[scroll_offset:scroll_offset + visible_rows],
            2,
        ):
            draw_line(stdscr, row, 2 + indent, line, attr)
        footer = message
        if len(detail_lines) > visible_rows:
            range_text = (
                f"內容 {scroll_offset + 1}-"
                f"{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
            )
            footer = f"{footer}  {range_text}".strip()
        if footer:
            draw_line(stdscr, height - 1, 2, footer, curses.A_BOLD)
        update_curses_screen(stdscr)

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN:
            scroll_offset += 1
            continue
        if not isinstance(key, str):
            continue
        if key == "4":
            note_index = (note_index - 1) % len(notes)
            example_index = 0
            scroll_offset = 0
            message = ""
        elif key == "6":
            note_index = (note_index + 1) % len(notes)
            example_index = 0
            scroll_offset = 0
            message = ""
        elif key.lower() == "p":
            run_grammar_practice(stdscr, [note], state, client, session)
            set_cursor_visibility(0)
            message = ""
        elif key in ("7", "9"):
            if not examples:
                message = f"這篇{notebook_label}沒有韓文例句。"
                continue
            if key == "9":
                example_index = (example_index + 1) % len(examples)
            if speak_korean(examples[example_index]["ko"]):
                message = f"已播放例句 {example_index + 1}/{len(examples)}。"
            else:
                message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"


def run_grammar_notebook(
    stdscr: curses.window,
    grammar_notes: List[GrammarNote],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    category: str = NOTE_CATEGORY_GRAMMAR,
) -> None:
    notebook_label = "單字筆記" if category == NOTE_CATEGORY_VOCABULARY else "文法筆記"
    category_notes = [note for note in grammar_notes if note.category == category]
    if not category_notes:
        wait_message(stdscr, notebook_label, f"目前還沒有{notebook_label}。")
        return
    notes = sorted(category_notes, key=lambda note: (note.created_at, note.id), reverse=True)
    selected_ids: set[str] = set()
    cursor = 0
    message = ""
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 5)
        start = max(0, min(cursor - visible_count + 1, len(notes) - visible_count))
        visible_notes = notes[start:start + visible_count]
        selected_examples = sum(
            len(note.examples) for note in notes if note.id in selected_ids
        )
        draw_line(
            stdscr,
            1,
            2,
            f"{notebook_label} | 已選 {len(selected_ids)} 篇 · {selected_examples} 句",
            curses.A_BOLD,
        )
        draw_line(
            stdscr,
            2,
            2,
            "↑↓=移動 Enter=查看 Space=勾選 P=練習已選 A=全選 C=清除 Esc=返回",
            curses.A_DIM,
        )
        for row, note in enumerate(visible_notes, 3):
            note_index = start + row - 3
            marker = "[✓]" if note.id in selected_ids else "[ ]"
            label = f"{marker} {note.title} · {len(note.examples)} 個例句"
            draw_line(
                stdscr,
                row,
                2,
                ("» " if note_index == cursor else "  ") + label,
                curses.A_REVERSE if note_index == cursor else 0,
            )
        footer = message
        if len(notes) > visible_count:
            footer = f"{footer}  {cursor + 1}/{len(notes)}".strip()
        if footer:
            draw_line(stdscr, height - 1, 2, footer, curses.A_BOLD)
        update_curses_screen(stdscr)

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return
        if key == curses.KEY_UP:
            cursor = (cursor - 1) % len(notes)
            message = ""
            continue
        if key == curses.KEY_DOWN:
            cursor = (cursor + 1) % len(notes)
            message = ""
            continue
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            run_grammar_note_detail(stdscr, notes, cursor, state, client, session, notebook_label)
            set_cursor_visibility(0)
            message = ""
            continue
        if not isinstance(key, str):
            continue
        if key == " ":
            note_id = notes[cursor].id
            if note_id in selected_ids:
                selected_ids.remove(note_id)
            else:
                selected_ids.add(note_id)
            message = ""
        elif key.lower() == "a":
            selected_ids = {note.id for note in notes}
            message = f"已選取全部{notebook_label}。"
        elif key.lower() == "c":
            selected_ids.clear()
            message = "已清除選取。"
        elif key.lower() == "p":
            selected_notes = [note for note in notes if note.id in selected_ids]
            if not selected_notes:
                message = f"請先用 Space 勾選至少一篇{notebook_label}。"
                continue
            run_grammar_practice(stdscr, selected_notes, state, client, session)
            set_cursor_visibility(0)
            message = ""


def subtitle_time_label(milliseconds: Any) -> str:
    try:
        total_seconds = max(0, int(float(milliseconds or 0) // 1000))
    except (TypeError, ValueError):
        total_seconds = 0
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def subtitle_entry_index_at_time(entries: List[Dict[str, Any]], milliseconds: float) -> Optional[int]:
    timed_entries = [
        (index, float(entry["startMs"]))
        for index, entry in enumerate(entries)
        if isinstance(entry.get("startMs"), (int, float))
    ]
    if not timed_entries:
        return None
    active_index = timed_entries[0][0]
    for index, start_ms in timed_entries:
        if start_ms > milliseconds:
            break
        active_index = index
    return active_index


def run_youtube_subtitle_detail(
    stdscr: curses.window,
    subtitles: List[YoutubeSubtitle],
    start_index: int,
) -> None:
    subtitle_index = start_index
    entry_index = 0
    scroll_offset = 0
    show_chinese = True
    message = ""
    audio_player: Optional[TerminalYoutubeAudioPlayer] = None
    set_cursor_visibility(0)
    stdscr.keypad(True)

    def prepare_audio(subtitle: YoutubeSubtitle, start_ms: float = 0) -> str:
        nonlocal audio_player
        if audio_player:
            audio_player.stop()
            audio_player = None
        if not subtitle.youtube_url:
            return "這篇字幕沒有 YouTube 連結，7 仍可播放 TTS。"
        if not TerminalYoutubeAudioPlayer.available():
            return "缺少 ffplay 或 cvlc，無法播放 YouTube 原音。"
        stdscr.erase()
        draw_line(stdscr, 1, 2, f"YT字幕 | {subtitle.title}", curses.A_BOLD)
        draw_line(stdscr, 3, 2, "正在準備 YouTube 音訊；第一次開啟需要下載，請稍候...", curses.A_DIM)
        update_curses_screen(stdscr)
        audio_path, status = download_youtube_audio(subtitle)
        if not audio_path:
            return status
        audio_player = TerminalYoutubeAudioPlayer(audio_path)
        if not audio_player.play_from(max(0.0, start_ms / 1000)):
            audio_player = None
            return "音訊已下載，但 ffplay／cvlc 無法啟動。"
        return status

    first_entries = subtitles[subtitle_index].entries
    first_start = first_entries[0].get("startMs") if first_entries else 0
    message = prepare_audio(subtitles[subtitle_index], float(first_start or 0))
    try:
        while True:
            subtitle = subtitles[subtitle_index]
            entries = subtitle.entries
            if entries:
                entry_index %= len(entries)
            else:
                entry_index = 0

            if audio_player and not audio_player.paused and subtitle.mode == YT_SUBTITLE_MODE_SRT:
                synced_index = subtitle_entry_index_at_time(entries, audio_player.position() * 1000)
                if synced_index is not None:
                    entry_index = synced_index

            stdscr.erase()
            height, width = stdscr.getmaxyx()
            draw_line(
                stdscr,
                1,
                2,
                (
                    f"YT字幕 | {subtitle_index + 1}/{len(subtitles)} | {subtitle.title}  "
                    "Esc=列表 5=中文 4/6=上下篇 7/Space=播放暫停 Enter=跳至此句 ↑↓=上下句"
                ),
                curses.A_BOLD,
            )
            detail_lines: List[Tuple[str, int, int]] = []
            entry_line_offsets: List[int] = []

            def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
                line_width = max(1, width - 4 - indent)
                for line in _split_by_cell_width(text, line_width):
                    detail_lines.append((line, indent, attr))

            append_detail(subtitle.title, attr=curses.A_BOLD)
            mode_label = "SRT 時間字幕" if subtitle.mode == YT_SUBTITLE_MODE_SRT else "JSON 逐句字幕"
            append_detail(f"{mode_label} · {len(entries)} 句", attr=curses.A_DIM)
            if subtitle.youtube_url:
                append_detail(f"YouTube: {subtitle.youtube_url}", attr=curses.A_DIM)
            if not entries:
                append_detail("目前沒有可顯示的字幕。", attr=curses.A_DIM)
            for index, entry in enumerate(entries):
                entry_line_offsets.append(len(detail_lines))
                marker = "▶" if index == entry_index else " "
                timestamp = f" [{subtitle_time_label(entry['startMs'])}]" if entry.get("startMs") is not None else ""
                append_detail(f"{marker} {index + 1}.{timestamp} {entry['ko']}", attr=curses.A_BOLD if index == entry_index else 0)
                if show_chinese:
                    append_detail(entry["zh"], indent=4, attr=curses.A_DIM)

            visible_rows = max(1, height - 4)
            scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
            if entry_line_offsets:
                entry_start = entry_line_offsets[entry_index]
                scroll_offset = max(0, min(
                    entry_start - visible_rows // 2,
                    max(0, len(detail_lines) - visible_rows),
                ))
            for row, (line, indent, attr) in enumerate(
                detail_lines[scroll_offset:scroll_offset + visible_rows],
                2,
            ):
                draw_line(stdscr, row, 2 + indent, line, attr)
            footer_parts = [message] if message else []
            if audio_player:
                state_label = "暫停" if audio_player.paused else "播放中"
                footer_parts.append(f"原音 {subtitle_time_label(audio_player.position() * 1000)} · {state_label}")
            if len(detail_lines) > visible_rows:
                footer_parts.append(
                    f"內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
                )
            if footer_parts:
                draw_line(stdscr, height - 1, 2, "  ".join(footer_parts), curses.A_BOLD)
            update_curses_screen(stdscr)

            if audio_player and not audio_player.paused:
                key = read_terminal_key_with_timeout(stdscr, 200, wide=True)
            else:
                key = read_terminal_key(stdscr, wide=True)
            if key is None:
                continue
            if isinstance(key, int) and 0 <= key <= 255:
                key = chr(key)
            elif key == curses.KEY_ENTER:
                key = "\n"
            if key in ("\x1b", 27):
                return
            if key in (curses.KEY_UP, curses.KEY_DOWN):
                if entries:
                    step = -1 if key == curses.KEY_UP else 1
                    entry_index = (entry_index + step) % len(entries)
                    start_ms = entries[entry_index].get("startMs")
                    if audio_player and start_ms is not None:
                        audio_player.play_from(float(start_ms) / 1000)
                        message = f"已跳至第 {entry_index + 1} 句。"
                continue
            if not isinstance(key, str):
                continue
            if key == "5":
                show_chinese = not show_chinese
                message = f"中文：{'顯示' if show_chinese else '隱藏'}"
            elif key == "4" or key == "6":
                subtitle_index = (subtitle_index + (-1 if key == "4" else 1)) % len(subtitles)
                entry_index = 0
                scroll_offset = 0
                next_subtitle = subtitles[subtitle_index]
                next_entries = next_subtitle.entries
                next_start = next_entries[0].get("startMs") if next_entries else 0
                message = prepare_audio(next_subtitle, float(next_start or 0))
            elif key in ("7", " "):
                if audio_player:
                    if audio_player.paused and not audio_player.process and entries and entries[entry_index].get("startMs") is not None:
                        changed = audio_player.play_from(float(entries[entry_index]["startMs"]) / 1000)
                    else:
                        changed = audio_player.toggle()
                    if changed:
                        message = "原音已暫停。" if audio_player.paused else "原音繼續播放。"
                    else:
                        message = "無法切換原音播放狀態。"
                elif not entries:
                    message = "這篇字幕沒有可播放的韓文。"
                elif speak_korean(entries[entry_index]["ko"]):
                    message = f"已用 TTS 播放第 {entry_index + 1} 句。"
                else:
                    message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            elif key in ("\n", "\r"):
                if audio_player and entries and entries[entry_index].get("startMs") is not None:
                    audio_player.play_from(float(entries[entry_index]["startMs"]) / 1000)
                    message = f"已跳至第 {entry_index + 1} 句並播放。"
                elif subtitle.mode != YT_SUBTITLE_MODE_SRT:
                    message = "JSON 字幕沒有時間戳，無法跳轉音訊。"
    finally:
        if audio_player:
            audio_player.stop()


def run_youtube_subtitles(
    stdscr: curses.window,
    subtitles: List[YoutubeSubtitle],
) -> None:
    if not subtitles:
        wait_message(stdscr, "YT字幕", "目前還沒有字幕筆記。")
        return
    notes = subtitles
    cursor = 0
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(cursor - visible_count + 1, len(notes) - visible_count))
        visible_notes = notes[start:start + visible_count]
        draw_line(stdscr, 1, 2, f"YT字幕 | {len(notes)} 篇", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=移動 Enter=查看 Esc=返回", curses.A_DIM)
        for row, subtitle in enumerate(visible_notes, 3):
            subtitle_index = start + row - 3
            mode_label = "SRT" if subtitle.mode == YT_SUBTITLE_MODE_SRT else "逐句"
            label = f"{subtitle.title} · {mode_label} · {len(subtitle.entries)} 句"
            draw_line(
                stdscr,
                row,
                2,
                ("» " if subtitle_index == cursor else "  ") + label,
                curses.A_REVERSE if subtitle_index == cursor else 0,
            )
        if len(notes) > visible_count:
            draw_line(stdscr, height - 1, 2, f"{cursor + 1}/{len(notes)}", curses.A_DIM)
        update_curses_screen(stdscr)

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key in ("\x1b", 27):
            return
        if key == curses.KEY_UP:
            cursor = (cursor - 1) % len(notes)
        elif key == curses.KEY_DOWN:
            cursor = (cursor + 1) % len(notes)
        elif key in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            run_youtube_subtitle_detail(stdscr, notes, cursor)
            set_cursor_visibility(0)


def prompt_practice_count(stdscr: curses.window, initial: int) -> Optional[int]:
    while True:
        value = prompt_text_value(stdscr, "新增練習 | 題數（1 至 500）", str(initial))
        if value is None:
            return None
        try:
            count = int(value)
        except ValueError:
            count = 0
        if 1 <= count <= 500:
            return count
        wait_message(stdscr, "題數錯誤", "請輸入 1 至 500 的整數。")


def optional_word_practice_setup(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
) -> Optional[Tuple[List[Card], Dict[str, Any]]]:
    config: Dict[str, Any] = {
        "query": "", "search_scope": "all", "levels": set(), "folder_ids": set(),
        "show_learned": False, "sort": "latest", "count": 50,
        "direction": "ko-zh", "answer_mode": "self-grade",
    }
    level_options = [
        ("score-negative-1", "熟悉度 -1"), ("score-negative-2", "熟悉度 -2"),
        ("score-negative-3", "熟悉度 -3"), ("score-negative-4-or-less", "熟悉度 -4 以下"),
        ("學習中", "學習中"), ("熟悉", "熟悉"), ("已熟悉", "已熟悉"),
    ]
    folders = list(state.get("folders") or [])
    row = 0
    while True:
        active_cards = filtered_notebook_cards(cards, questions, state, config)
        level_summary = "全部" if not config["levels"] else f"已選 {len(config['levels'])} 項"
        folder_summary = "全部" if not config["folder_ids"] else f"已選 {len(config['folder_ids'])} 項"
        rows = [
            f"搜尋: {config['query'] or '未設定'}",
            f"搜尋範圍: {'全部內容' if config['search_scope'] == 'all' else '單字本身'}",
            f"熟悉度: {level_summary}",
            f"資料夾: {folder_summary}",
            f"題數: {config['count']}",
            f"作答方式: {'韓翻中 · 心中作答' if config['direction'] == 'ko-zh' else '中翻韓 · 打字輸入' if config['answer_mode'] == 'typing' else '中翻韓 · 心中作答'}",
            f"新增單字練習 · 可用 {len(active_cards)} 題",
        ]
        stdscr.erase()
        draw_line(stdscr, 1, 2, "新增練習 | 單字練習", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=項目 Enter=設定/新增 Esc=返回 · 已學習單字固定排除", curses.A_DIM)
        for index, label in enumerate(rows):
            draw_line(stdscr, 3 + index, 2, ("» " if index == row else "  ") + label, curses.A_REVERSE if index == row else 0)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b" or key == 27:
            return None
        if key == curses.KEY_UP:
            row = (row - 1) % len(rows)
            continue
        if key == curses.KEY_DOWN:
            row = (row + 1) % len(rows)
            continue
        if key not in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            continue
        if row == 0:
            value = prompt_text_value(stdscr, "新增練習 | 搜尋", str(config["query"]))
            if value is not None:
                config["query"] = value
        elif row == 1:
            config["search_scope"] = "word" if config["search_scope"] == "all" else "all"
        elif row == 2:
            value = multi_select_menu(stdscr, "新增練習 | 熟悉度", level_options, config["levels"])
            if value is not None:
                config["levels"] = value
        elif row == 3:
            value = grouped_folder_select_menu(stdscr, folders, config["folder_ids"])
            if value is not None:
                config["folder_ids"] = value
        elif row == 4:
            value = prompt_practice_count(stdscr, int(config["count"]))
            if value is not None:
                config["count"] = value
        elif row == 5:
            value = translation_answer_mode_menu(stdscr, "新增練習 | 單字作答方式")
            if value:
                config["direction"], config["answer_mode"] = value
        elif active_cards:
            return active_cards, config
        else:
            wait_message(stdscr, "無法新增", "目前篩選條件下沒有可練習的單字。")


def create_optional_practice(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    grammar_notes: List[GrammarNote],
    state: Dict[str, Any],
    grammar_review: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> bool:
    kind = menu(stdscr, "新增練習 | 選擇類型", [(key, label) for key, label in OPTIONAL_PRACTICE_LABELS.items()])
    if not kind:
        return False
    learned_ids = set(state.get("learnedWordIds") or [])
    task: Dict[str, Any] = {
        "id": str(uuid.uuid4()), "kind": kind, "title": OPTIONAL_PRACTICE_LABELS[kind],
        "direction": "ko-zh", "createdAt": utc_now_iso(),
    }
    if kind == "words":
        setup = optional_word_practice_setup(stdscr, cards, questions, state)
        if not setup:
            return False
        active_cards, config = setup
        active_ids = {card.id for card in active_cards}
        pool_ids = [question.id for question in questions if question.kind == "term" and question.item_id in active_ids]
        count = int(config["count"])
        task["direction"] = config["direction"]
        task["answerMode"] = config["answer_mode"]
    elif kind in ("listening", "reading"):
        pool_ids = [
            question.id for question in questions
            if question.kind == "example" and question.item_id not in learned_ids
        ]
        count = 10
    else:
        eligible_notes = [note for note in grammar_notes if note.category == NOTE_CATEGORY_GRAMMAR and note.examples]
        if not eligible_notes:
            wait_message(stdscr, "無法新增練習", "目前沒有包含完整例句的文法筆記。")
            return False
        selected_id = menu(stdscr, "新增練習 | 選擇文法筆記", [(note.id, f"{note.title} · {len(note.examples)} 題") for note in eligible_notes])
        if not selected_id:
            return False
        note = next(entry for entry in eligible_notes if entry.id == selected_id)
        pool_ids = [question.id for question in grammar_practice_questions([note])]
        count = len(pool_ids)
        task["title"] = f"文法例句練習 · {note.title}"
    try:
        updated = client.update_optional_practice(
            session,
            lambda current: add_optional_practice_task(current, task, pool_ids, count),
        )
    except ValueError as exc:
        wait_message(stdscr, "無法新增練習", str(exc))
        return False
    except RuntimeError as exc:
        wait_message(stdscr, "新增練習失敗", friendly_firebase_error(exc))
        return False
    grammar_review["optionalPractice"] = updated
    return True


def run_optional_practice_menu(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    grammar_notes: List[GrammarNote],
    state: Dict[str, Any],
    grammar_review: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    while True:
        optional_state = optional_practice_state(grammar_review)
        grammar_questions = grammar_practice_questions(
            note for note in grammar_notes if note.category == NOTE_CATEGORY_GRAMMAR
        )
        question_by_id = {question.id: question for question in [*questions, *grammar_questions]}
        learned_ids = set(state.get("learnedWordIds") or [])
        task_questions: Dict[str, List[Question]] = {}
        for task in optional_state["tasks"]:
            answered = set(task.get("answeredIds") or [])
            active = [question_by_id[item] for item in (task.get("ids") or []) if item not in answered and item in question_by_id]
            if task.get("kind") != "grammar":
                active = [question for question in active if question.item_id not in learned_ids]
            task_questions[str(task.get("id"))] = active
        options = [("create", "新增練習")]
        options.extend(
            (str(task.get("id")), f"{task.get('title') or OPTIONAL_PRACTICE_LABELS.get(task.get('kind'), '練習')} · 剩餘 {len(task_questions.get(str(task.get('id')), []))} 題")
            for task in optional_state["tasks"]
        )
        selected_id = menu(stdscr, "自選練習", options, "題組與網頁同步；未完成進度會保留。")
        if not selected_id:
            return
        if selected_id == "create":
            create_optional_practice(stdscr, cards, questions, grammar_notes, state, grammar_review, client, session)
            continue
        task = next((entry for entry in optional_state["tasks"] if str(entry.get("id")) == selected_id), None)
        if not task:
            continue
        action = menu(stdscr, str(task.get("title") or "自選練習"), [("start", "開始／繼續"), ("remove", "移除這組練習")])
        if action == "remove":
            try:
                grammar_review["optionalPractice"] = client.update_optional_practice(
                    session, lambda current: remove_optional_practice_task(current, selected_id)
                )
            except RuntimeError as exc:
                wait_message(stdscr, "移除失敗", friendly_firebase_error(exc))
            continue
        if action != "start":
            continue
        active_questions = task_questions.get(selected_id) or []
        if not active_questions:
            wait_message(stdscr, "沒有可練習題目", "題目可能已刪除或已加入「已學習」，請移除此題組後重新新增。")
            continue

        def save_result(question: Question, correct: bool) -> None:
            grammar_review["optionalPractice"] = client.update_optional_practice(
                session,
                lambda current: answer_optional_practice_task(current, selected_id, question.id, correct),
            )

        kind = str(task.get("kind") or "")
        if kind in ("listening", "grammar"):
            completed = run_daily_recognition(
                stdscr, active_questions, cards, state, client, session,
                grammar_mode=kind == "grammar", title_override=str(task.get("title") or "自選練習"),
                on_result=save_result,
            )
        else:
            completed = run_practice(
                stdscr,
                str(task.get("title") or "自選練習"),
                active_questions,
                {
                    "direction": "ko-zh" if kind == "reading" else str(task.get("direction") or "ko-zh"),
                    "answer_mode": "self-grade" if kind == "reading" else str(task.get("answerMode") or "self-grade"),
                    "source": "term" if kind == "words" else "example",
                    "starred": False, "random": False, "record_results": False,
                    "daily_review": False, "on_result": save_result,
                    "auto_prompt_audio": kind != "reading",
                    "auto_answer_audio": kind != "reading",
                    "enforce_answer_length": kind == "words" and task.get("direction") == "zh-ko" and task.get("answerMode") == "typing",
                    "require_answer_before_next": True,
                },
                state, client, session,
            )
        if completed and any(
            str(entry.get("id")) == selected_id
            for entry in optional_practice_state(grammar_review)["tasks"]
        ):
            try:
                grammar_review["optionalPractice"] = client.update_optional_practice(
                    session, lambda current: remove_optional_practice_task(current, selected_id)
                )
            except RuntimeError as exc:
                wait_message(stdscr, "完成狀態同步失敗", friendly_firebase_error(exc))


def due_task_menu(
    stdscr: curses.window,
    state: Dict[str, Any],
    questions: List[Question],
) -> Optional[Tuple[str, List[Question]]]:
    due = daily_due_questions(state, questions)
    wrong_review = [] if due else daily_wrong_term_questions(state, questions)
    grouped: Dict[str, List[Question]] = {}
    for question in due:
        grouped.setdefault(question.date, []).append(question)
    if not grouped and not wrong_review:
        wait_message(stdscr, "今日複習題", "今天的測驗已全部完成。")
        return None
    options = []
    if due:
        options.append((DAILY_MIXED_MODE, f"全部到期單字（混合隨機） · {len(due)} 題"))
    if wrong_review:
        options.append((DAILY_WRONG_REVIEW_MODE, f"今日答錯題目（不紀錄，可重複） · {len(wrong_review)} 題"))
    options.extend((date_key, f"{date_key} · {len(items)} 題") for date_key, items in sorted(grouped.items()))
    selected = menu(stdscr, "今日複習題 | 選擇任務", options)
    if not selected:
        return None
    if selected == DAILY_MIXED_MODE:
        shuffled = list(due)
        random.shuffle(shuffled)
        return selected, shuffled
    if selected == DAILY_WRONG_REVIEW_MODE:
        return selected, list(wrong_review)
    shuffled = list(grouped[selected])
    random.shuffle(shuffled)
    return selected, shuffled


def setup_menu(
    stdscr: curses.window,
    title: str,
    allow_examples: bool = True,
    allow_result_recording: bool = False,
) -> Optional[Dict[str, Any]]:
    direction = "zh-ko"
    source = "term"
    starred = False
    random_order = True
    answer_mode = "typing"
    record_results = False
    row = 0
    set_cursor_visibility(0)
    while True:
        source_label = {"term": "單字", "example": "例句", "all": "全部"}[source]
        rows = [
            f"方向: {'中翻韓' if direction == 'zh-ko' else '韓翻中'}",
            f"作答方式: {'打字輸入' if direction == 'zh-ko' and answer_mode == 'typing' else '心中作答後自評'}",
            f"內容: {source_label if direction == 'zh-ko' else '單字'}",
            f"篩選: {'有星號' if starred else '全部卡片'}",
            f"順序: {'隨機' if random_order else '依序'}",
        ]
        if allow_result_recording:
            rows.append(f"作答紀錄: {'紀錄答對答錯' if record_results else '不紀錄'}")
        rows.append("開始")
        stdscr.clear()
        draw_line(stdscr, 1, 2, f"設定 | {title}", curses.A_BOLD)
        recording_note = "可選擇是否紀錄" if allow_result_recording else "自主測驗不紀錄"
        draw_line(stdscr, 2, 2, f"↑↓=項目 ←→=切換 Enter=開始 Esc=返回 · {recording_note}", curses.A_DIM)
        for idx, label in enumerate(rows):
            draw_line(stdscr, 3 + idx, 2, ("» " if idx == row else "  ") + label, curses.A_REVERSE if idx == row else 0)
        stdscr.refresh()
        key = read_terminal_key(stdscr)
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
            elif row == 1 and direction == "zh-ko":
                answer_mode = "self-grade" if answer_mode == "typing" else "typing"
            elif row == 2 and direction == "zh-ko" and allow_examples:
                source = {"term": "example", "example": "all", "all": "term"}[source]
            elif row == 3:
                starred = not starred
            elif row == 4:
                random_order = not random_order
            elif row == 5 and allow_result_recording:
                record_results = not record_results
        elif key in (curses.KEY_ENTER, 10, 13):
            return {
                "direction": direction,
                "answer_mode": "self-grade" if direction == "ko-zh" else answer_mode,
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


def translation_answer_mode_menu(
    stdscr: curses.window,
    title: str,
) -> Optional[Tuple[str, str]]:
    choice = menu(
        stdscr,
        title,
        [
            ("zh-ko:typing", "中翻韓 · 打字輸入韓文"),
            ("zh-ko:self-grade", "中翻韓 · 心中作答後自行評分"),
            ("ko-zh:self-grade", "韓翻中 · 心中作答後自行評分"),
        ],
        "心中作答模式會先公佈答案，再使用 1（答錯）或 2（答對）自評。",
    )
    if not choice:
        return None
    direction, answer_mode = choice.split(":", 1)
    return direction, answer_mode


def grammar_practice_setup_menu(
    stdscr: curses.window,
    title: str,
    notebook_label: str = "文法筆記",
) -> Optional[Dict[str, Any]]:
    direction = "zh-ko"
    answer_mode = "typing"
    random_order = True
    row = 0
    set_cursor_visibility(0)
    while True:
        rows = [
            f"方向: {'中翻韓' if direction == 'zh-ko' else '韓翻中'}",
            f"作答方式: {'打字輸入' if direction == 'zh-ko' and answer_mode == 'typing' else '心中作答後自評'}",
            f"順序: {'隨機' if random_order else '依原順序'}",
            "開始",
        ]
        stdscr.erase()
        draw_line(stdscr, 1, 2, f"{notebook_label}例句練習設定 | {title}", curses.A_BOLD)
        draw_line(
            stdscr,
            2,
            2,
            "↑↓=項目 ←→=切換 Enter=開始 Esc=返回 · 自主練習不紀錄",
            curses.A_DIM,
        )
        for index, label in enumerate(rows):
            draw_line(
                stdscr,
                3 + index,
                2,
                ("» " if index == row else "  ") + label,
                curses.A_REVERSE if index == row else 0,
            )
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr)
        if key == 27:
            return None
        if key == curses.KEY_UP:
            row = (row - 1) % len(rows)
        elif key == curses.KEY_DOWN:
            row = (row + 1) % len(rows)
        elif key in (curses.KEY_LEFT, curses.KEY_RIGHT):
            if row == 0:
                direction = "ko-zh" if direction == "zh-ko" else "zh-ko"
            elif row == 1:
                if direction == "zh-ko":
                    answer_mode = "self-grade" if answer_mode == "typing" else "typing"
            elif row == 2:
                random_order = not random_order
        elif key in (curses.KEY_ENTER, 10, 13):
            return {
                "direction": direction,
                "answer_mode": "self-grade" if direction == "ko-zh" else answer_mode,
                "random": random_order,
            }


def run_grammar_recall_practice(
    stdscr: curses.window,
    title: str,
    questions: List[Question],
    notebook_label: str = "文法筆記",
) -> bool:
    if not questions:
        wait_message(stdscr, f"{notebook_label}例句練習", f"所選{notebook_label}沒有完整例句。")
        return False
    index = 0
    revealed = False
    graded: Dict[str, bool] = {}
    message = ""
    scroll_offset = 0
    spoken_question_id = ""
    wrong_result_attr = curses.A_BOLD
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(3, curses.COLOR_RED, -1)
            wrong_result_attr = curses.color_pair(3) | curses.A_BOLD
        except curses.error:
            pass
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        question = questions[index]
        is_graded = question.id in graded
        if is_graded:
            revealed = True
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        draw_line(
            stdscr,
            1,
            2,
            (
                f"韓翻中 · 不紀錄 | {title} | {index + 1}/{len(questions)}  "
                f"Esc=返回 {auto_audio_control_label()} 7=發音 8=答案 4/6=上下題 1=答錯 2=答對 ↑↓=捲動"
            ),
            curses.A_BOLD,
        )
        detail_start = draw_wrapped(stdscr, 2, 2, width - 4, f"題目: {question.ko}", curses.A_BOLD)
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in _split_by_cell_width(text, line_width):
                detail_lines.append((line, indent, attr))

        if not revealed:
            append_detail("請先在心中回答中文，再按 8 公佈答案。", attr=curses.A_DIM)
        else:
            append_detail(f"答案: {question.zh}", attr=curses.A_BOLD)
            append_detail(f"筆記: {question.source.ko}", attr=curses.A_BOLD)
            for note in question.source.notes:
                append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
            append_detail(f"韓文: {question.ko}", indent=2)
            append_detail(f"中文: {question.zh}", indent=2, attr=curses.A_DIM)
            if not is_graded:
                append_detail("請按 1（答錯）或 2（答對）自評。", attr=curses.A_BOLD)

        visible_rows = max(1, height - detail_start - 2)
        scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
        for row_number, (line, indent, attr) in enumerate(
            detail_lines[scroll_offset:scroll_offset + visible_rows],
            detail_start,
        ):
            draw_line(stdscr, row_number, 2 + indent, line, attr)
        footer = message
        if is_graded:
            footer = f"{'答對' if graded[question.id] else '答錯'}，未紀錄。按 Enter 或 6 進入下一題。"
        elif revealed and not footer:
            footer = "1=答錯  2=答對"
        if len(detail_lines) > visible_rows:
            footer = (
                f"{footer}  內容 {scroll_offset + 1}-"
                f"{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
            ).strip()
        if footer:
            draw_line(stdscr, height - 1, 2, footer, wrong_result_attr if graded and not graded[question.id] else curses.A_BOLD)
        update_curses_screen(stdscr)

        if _AUTO_PLAY_AUDIO and not revealed and spoken_question_id != question.id:
            spoken_question_id = question.id
            message = (
                "已自動播放韓文題目。"
                if speak_korean(question.ko)
                else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
            continue

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return False
        if key == curses.KEY_UP:
            scroll_offset = max(0, scroll_offset - 1)
            continue
        if key == curses.KEY_DOWN:
            scroll_offset += 1
            continue
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if not is_graded:
                message = "請先公佈答案並選擇答對或答錯。"
                continue
            if index == len(questions) - 1:
                wait_message(stdscr, "完成", f"這組{notebook_label}例句練習已完成。")
                return True
            index += 1
            revealed = questions[index].id in graded
            message = ""
            scroll_offset = 0
            continue
        if not isinstance(key, str):
            continue
        if key == "7":
            message = "已播放韓文例句。" if speak_korean(question.ko) else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
        elif key == "8":
            revealed = True
            message = ""
            scroll_offset = 0
        elif key in ("1", "2"):
            if not revealed:
                message = "請先按 8 公佈答案。"
            elif is_graded:
                message = "這題已完成評分。"
            else:
                graded[question.id] = key == "2"
                message = ""
        elif key == "4":
            index = max(0, index - 1)
            revealed = questions[index].id in graded
            message = ""
            scroll_offset = 0
        elif key == "6":
            if not is_graded:
                message = "請先公佈答案並選擇答對或答錯。"
            elif index == len(questions) - 1:
                wait_message(stdscr, "完成", f"這組{notebook_label}例句練習已完成。")
                return True
            else:
                index += 1
                revealed = questions[index].id in graded
                message = ""
                scroll_offset = 0


def run_grammar_practice(
    stdscr: curses.window,
    notes: List[GrammarNote],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    category = notes[0].category if notes else NOTE_CATEGORY_GRAMMAR
    notebook_label = "單字筆記" if category == NOTE_CATEGORY_VOCABULARY else "文法筆記"
    questions = grammar_practice_questions(notes)
    if not questions:
        wait_message(stdscr, f"{notebook_label}例句練習", f"所選{notebook_label}沒有完整例句。")
        return
    title = notes[0].title if len(notes) == 1 else f"已選 {len(notes)} 篇{notebook_label}"
    config = grammar_practice_setup_menu(stdscr, title, notebook_label)
    if not config:
        return
    active_questions = list(questions)
    if config["random"]:
        random.shuffle(active_questions)
    if config["direction"] == "ko-zh":
        run_grammar_recall_practice(stdscr, title, active_questions, notebook_label)
        return
    run_practice(
        stdscr,
        title,
        active_questions,
        {
            "direction": "zh-ko",
            "answer_mode": config["answer_mode"],
            "source": "all",
            "starred": False,
            "random": False,
            "record_results": False,
            "allow_star": False,
        },
        state,
        client,
        session,
    )


def run_study(stdscr: curses.window, title: str, cards: List[Card], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> None:
    idx = 0
    show_details = False
    show_chinese = False
    example_index = 0
    message = ""
    spoken_card_id = ""
    auto_playing = False
    repeat_count = 1
    auto_card_id = ""
    auto_steps: List[Tuple[str, int, str, int]] = []
    auto_step_index = 0
    set_cursor_visibility(0)
    while True:
        if not cards:
            wait_message(stdscr, "學習模式", "沒有可學習的卡片。")
            return
        card = cards[idx]
        examples = card_examples(card)
        if examples:
            example_index %= len(examples)
        else:
            example_index = 0
        if auto_playing and (auto_card_id != card.id or not auto_steps):
            auto_card_id = card.id
            auto_steps = study_auto_audio_steps(card, repeat_count)
            auto_step_index = 0
        auto_step = auto_steps[auto_step_index] if auto_playing and auto_steps else None
        auto_face = auto_step[0] if auto_step else ""
        if auto_step and auto_step[1] >= 0:
            example_index = auto_step[1]
        stdscr.clear()
        draw_line(
            stdscr,
            1,
            2,
            f"學習 | {title} | {idx + 1}/{len(cards)}  Esc=返回 A=自動:{'開' if auto_playing else '關'} 1/2/3=重複:{repeat_count} {auto_audio_control_label()} 0=星號 *=不熟悉 5=中文 9=單字 7=例句 +=下一例句 8=詳情 4/6=上下張",
            curses.A_BOLD,
        )
        folder_notice, display_message = folder_prompt_notice(message)
        y = draw_wrapped(stdscr, 2, 2, stdscr.getmaxyx()[1] - 4, f"{'★' if card.is_starred else '☆'} {card.ko}{folder_notice}", curses.A_BOLD)
        if show_chinese and auto_face != "front":
            y = draw_wrapped(stdscr, y, 2, stdscr.getmaxyx()[1] - 4, card.zh)
        if examples and auto_face != "front":
            draw_line(stdscr, y, 2, "例句:", curses.A_DIM)
            y += 1
            for current_index, example in enumerate(examples):
                visible_parts = [example.get("ko", "")]
                if show_chinese:
                    visible_parts.append(example.get("zh", ""))
                text = " / ".join(part for part in visible_parts if part)
                marker = "▶ " if current_index == example_index else "  "
                attr = curses.A_BOLD if current_index == example_index else curses.A_DIM
                y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, marker + text, attr)
        if show_details and auto_face != "front":
            for meaning in card.meanings:
                detail_parts = []
                if show_chinese and meaning.get("zh"):
                    detail_parts.append(str(meaning.get("zh")))
                if meaning.get("pattern"):
                    detail_parts.append(str(meaning.get("pattern")))
                if detail_parts:
                    y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, f"- {' · '.join(detail_parts)}")
            for note in card.notes:
                y = draw_wrapped(stdscr, y, 4, stdscr.getmaxyx()[1] - 6, f"筆記: {note}", curses.A_DIM)
        if display_message:
            draw_line(stdscr, y, 2, display_message, curses.A_BOLD)
        if auto_step:
            face_label = "正面" if auto_face == "front" else "反面"
            draw_line(
                stdscr,
                min(stdscr.getmaxyx()[0] - 2, y + 1),
                2,
                f"自動播放 · 第 {auto_step[3]}/{repeat_count} 次 · {face_label}",
                curses.A_DIM,
            )
        stdscr.refresh()
        if auto_step:
            spoken_card_id = card.id
            if auto_step[2]:
                played = speak_korean(auto_step[2])
                if auto_face == "front":
                    message = "已自動播放韓文單字。" if played else "無法播放韓文單字語音。"
                else:
                    message = (
                        f"已自動播放例句 {auto_step[1] + 1}/{len(examples)}。"
                        if played
                        else "無法播放韓文例句語音。"
                    )
            else:
                message = "這張卡片的反面沒有韓文例句。"
            key = read_terminal_key_with_timeout(stdscr, 420 if auto_step[2] else 900, wide=True)
            if key == "\x1b":
                return
            if key in ("a", "A"):
                auto_playing = False
                message = "已暫停完整自動播放。"
                continue
            if key in ("1", "2", "3"):
                repeat_count = int(key)
                auto_card_id = ""
                auto_steps = []
                message = f"每張卡片改為完整播放 {repeat_count} 次，從正面重新開始。"
                continue
            if key == "*":
                try:
                    now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, card.id)
                except RuntimeError as exc:
                    message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                else:
                    message = (
                        "已加入「不熟悉」。"
                        if now_unfamiliar
                        else "已移出「不熟悉」。"
                    )
                continue
            if key == "5":
                show_chinese = not show_chinese
                message = "已顯示中文。" if show_chinese else "已隱藏中文。"
            elif key == "4":
                idx = max(0, idx - 1)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                message = ""
                continue
            elif key == "6":
                idx = min(len(cards) - 1, idx + 1)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                message = ""
                continue
            elif key == curses.KEY_RESIZE and not _AUTO_PLAY_AUDIO:
                auto_playing = False
                message = "自動語音已關閉，完整自動播放已暫停。"
                continue
            auto_step_index += 1
            if auto_step_index >= len(auto_steps):
                idx = (idx + 1) % len(cards)
                show_details = False
                show_chinese = False
                example_index = 0
                auto_card_id = ""
                auto_steps = []
                auto_step_index = 0
                message = ""
            continue
        if _AUTO_PLAY_AUDIO and spoken_card_id != card.id:
            spoken_card_id = card.id
            message = (
                "已自動播放韓文單字。"
                if speak_korean(card.ko)
                else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
            continue
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b":
            return
        if key in ("a", "A"):
            if not _AUTO_PLAY_AUDIO:
                message = "請先按 . 開啟自動語音，再啟動完整自動播放。"
                continue
            auto_playing = True
            auto_card_id = ""
            auto_steps = []
            auto_step_index = 0
            message = "開始完整自動播放。"
        elif key in ("1", "2", "3"):
            repeat_count = int(key)
            message = f"每張卡片將完整播放 {repeat_count} 次。"
        elif key == "0":
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "*":
            try:
                now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, card.id)
            except RuntimeError as exc:
                message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                continue
            message = (
                "已加入「不熟悉」。"
                if now_unfamiliar
                else "已移出「不熟悉」。"
            )
        elif key == "8":
            show_details = not show_details
        elif key == "5":
            show_chinese = not show_chinese
            message = "已顯示中文。" if show_chinese else "已隱藏中文。"
        elif key == "9":
            message = (
                "已重播韓文單字。"
                if speak_korean(card.ko)
                else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
        elif key in ("7", "+"):
            if not examples:
                message = "這張單字卡沒有可播放的韓文例句。"
                continue
            if key == "+":
                example_index = (example_index + 1) % len(examples)
            if speak_korean(examples[example_index].get("ko", "")):
                message = f"已播放例句 {example_index + 1}/{len(examples)}。"
            else:
                message = "無法播放例句語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
        elif key == "4":
            idx = max(0, idx - 1)
            show_details = False
            show_chinese = False
            example_index = 0
            message = ""
        elif key == "6":
            idx = min(len(cards) - 1, idx + 1)
            show_details = False
            show_chinese = False
            example_index = 0
            message = ""


def run_daily_recognition(
    stdscr: curses.window,
    questions: List[Question],
    all_cards: List[Card],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    grammar_mode: bool = False,
    title_override: str = "",
    on_result: Optional[Any] = None,
) -> bool:
    title = title_override or ("每日文法例句聽力" if grammar_mode else "每日單字例句聽力")
    optional_mode = bool(on_result)
    if not questions:
        wait_message(stdscr, title, "這組題目已完成。" if optional_mode else "今天的題目已完成。")
        return False

    idx = 0
    revealed = False
    word_visible = False
    message = ""
    scroll_offset = 0
    results: Dict[str, bool] = {}
    spoken_question_id = ""
    cards_by_id = {card.id: card for card in all_cards}
    wrong_result_attr = curses.A_BOLD
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(3, curses.COLOR_RED, -1)
            wrong_result_attr = curses.color_pair(3) | curses.A_BOLD
        except curses.error:
            pass
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        question = questions[idx]
        card = question.source
        graded = question.id in results
        if graded:
            revealed = True
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        star_help = "" if grammar_mode else " 0=星號 *=不熟悉 -=已學習"
        audio_label = "例句"
        draw_line(
            stdscr,
            1,
            2,
            f"{'文法聽力' if grammar_mode else '例句聽力'} | {title} | {idx + 1}/{len(questions)}  Esc=返回 {auto_audio_control_label()}{star_help} 7={audio_label} 8=揭露 4/6=上下題 1=答錯 2=答對 ↑↓=捲動",
            curses.A_BOLD,
        )
        if grammar_mode:
            prompt_text = question.ko if revealed else question.zh if word_visible else "[韓文隱藏，請聆聽例句]"
            prompt_prefix = ""
        else:
            prompt_text = question.ko if revealed else "[韓文隱藏，請聆聽例句]"
            prompt_prefix = f"{'★' if card.is_starred else '☆'} "
        folder_notice, display_message = folder_prompt_notice(message)
        detail_start = draw_wrapped(stdscr, 2, 2, width - 4, f"{prompt_prefix}{prompt_text}{folder_notice}", curses.A_BOLD)
        detail_lines: List[Tuple[str, int, int]] = []

        def append_detail(text: str, indent: int = 0, attr: int = 0) -> None:
            line_width = max(1, width - 4 - indent)
            for line in textwrap.wrap(text, line_width) or [""]:
                detail_lines.append((line, indent, attr))

        if not revealed:
            if not word_visible:
                listening_help = f"按 7 重播{audio_label}"
                reveal_label = "中文" if grammar_mode else "完整答案"
                append_detail(f"{listening_help}；按 8 顯示{reveal_label}。", attr=curses.A_DIM)
            else:
                append_detail(
                    "按 8 公佈韓文答案。" if grammar_mode else "按 8 查看完整單字卡。",
                    attr=curses.A_DIM,
                )
        else:
            if grammar_mode:
                append_detail(f"文法: {card.ko}", attr=curses.A_BOLD)
                for note in card.notes:
                    append_detail(f"筆記: {note}", indent=2, attr=curses.A_DIM)
                append_detail(f"韓文: {question.ko}", indent=2)
                append_detail(f"中文: {question.zh}", indent=2, attr=curses.A_DIM)
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
        visible_rows = max(1, height - detail_start - 2)
        scroll_offset = min(scroll_offset, max(0, len(detail_lines) - visible_rows))
        for row, (line, indent, attr) in enumerate(detail_lines[scroll_offset:scroll_offset + visible_rows], detail_start):
            draw_line(stdscr, row, 2 + indent, line, attr)
        footer = display_message
        if graded:
            if results[question.id]:
                result_text = "答對"
            elif grammar_mode:
                result_text = "答錯"
            elif optional_mode:
                result_text = "答錯，會回到可抽題池"
            else:
                result_text = "答錯，已保留到明日題目"
            footer = f"{result_text}。按 Enter 或 6 進入下一題。"
        elif revealed and not footer:
            footer = "1=答錯  2=答對"
        if len(detail_lines) > visible_rows:
            footer = f"{footer}  內容 {scroll_offset + 1}-{min(len(detail_lines), scroll_offset + visible_rows)}/{len(detail_lines)}"
        if footer:
            draw_line(stdscr, height - 1, 2, footer, wrong_result_attr if graded and not results[question.id] else curses.A_BOLD)
        update_curses_screen(stdscr)
        if _AUTO_PLAY_AUDIO and not word_visible and not graded and spoken_question_id != question.id:
            spoken_question_id = question.id
            if not speak_korean(question.ko):
                message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            continue
        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key == "\x1b":
            return False
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                wait_message(stdscr, "完成", f"{title}已完成。" if optional_mode else f"今天的{title}已完成。")
                return True
            idx += 1
            revealed = questions[idx].id in results
            word_visible = revealed
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
        if key == "0" and not grammar_mode:
            snapshot = _clone_json(state)
            toggle_star(state, card)
            if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                card.is_starred = card.id in (state.get("starred") or [])
                message = ""
                continue
            message = "已打星號" if card.is_starred else "已取消星號"
        elif key == "8":
            was_revealed = revealed
            if not graded:
                if grammar_mode:
                    word_visible, revealed = next_recognition_reveal_state(True, word_visible, revealed)
                else:
                    word_visible, revealed = True, True
            message = ""
            if _AUTO_PLAY_AUDIO and not grammar_mode and not was_revealed and revealed:
                message = (
                    "已自動播放所屬韓文單字。"
                    if speak_korean(card.ko)
                    else "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
                )
            scroll_offset = 0
        elif key == "7":
            if not speak_korean(question.ko):
                message = "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            else:
                message = "已重播韓文發音。"
        elif key == "-" and not grammar_mode:
            if not revealed:
                message = "請先按 8 揭露答案，再加入「已學習」。"
                continue
            try:
                added = mark_word_as_learned(client, session, state, question.item_id)
            except RuntimeError as exc:
                message = f"加入已學習失敗：{friendly_firebase_error(exc)}"
                continue
            if added:
                questions = questions[:idx + 1] + [
                    candidate for candidate in questions[idx + 1:]
                    if candidate.item_id != question.item_id
                ]
                message = "已加入「已學習」，本次尚未出現的同卡例句也已略過。"
            else:
                message = "這個單字已經在「已學習」資料夾中。"
        elif key in ("*", "u", "U") and not grammar_mode:
            try:
                now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, question.item_id)
            except RuntimeError as exc:
                message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                continue
            message = (
                "已加入「不熟悉」，仍會照常出現在每日測驗。"
                if now_unfamiliar
                else "已移出「不熟悉」。"
            )
        elif key in ("1", "2"):
            if not revealed:
                message = "請先按 8 翻面查看答案。"
                continue
            if graded:
                message = "這題已完成評分。"
                continue
            correct = key == "2"
            if on_result:
                try:
                    on_result(question, correct)
                except RuntimeError as exc:
                    message = friendly_firebase_error(exc)
                    continue
            elif not grammar_mode:
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
            word_visible = revealed
            message = ""
            scroll_offset = 0
        elif key == "6":
            if not graded:
                message = "請先翻面並選擇答對或答錯。"
                continue
            if idx == len(questions) - 1:
                wait_message(stdscr, "完成", f"{title}已完成。" if optional_mode else f"今天的{title}已完成。")
                return True
            idx += 1
            revealed = questions[idx].id in results
            word_visible = revealed
            message = ""
            scroll_offset = 0


def run_practice(stdscr: curses.window, title: str, questions: List[Question], config: Dict[str, Any], state: Dict[str, Any], client: FirebaseClient, session: AuthSession) -> bool:
    idx = 0
    user_input = ""
    input_cursor = 0
    show_hint = False
    message = ""
    result_message = ""
    partial: Optional[PartialCheckResult] = None
    graded = False
    last_correct: Optional[bool] = None
    typed_attempts = 0
    retry_diff = False
    example_index = 0
    pending_example_audio = ""
    pending_word_audio = False
    spoken_question_id = ""
    ok_attr = curses.A_BOLD
    wrong_attr = curses.A_REVERSE | curses.A_BOLD
    wrong_result_attr = curses.A_BOLD
    self_grade_mode = config.get("direction") == "ko-zh" or config.get("answer_mode") == "self-grade"
    set_cursor_visibility(0 if self_grade_mode else 1)
    stdscr.keypad(True)
    should_record_results = config.get("record_results", False)
    enforce_answer_length = config.get("enforce_answer_length", False)
    allow_star = config.get("allow_star", True)
    require_answer_before_next = config.get("require_answer_before_next", False)
    daily_review = config.get("daily_review", False)
    on_result = config.get("on_result")
    auto_answer_audio = config.get("auto_answer_audio", True)
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            curses.init_pair(1, curses.COLOR_GREEN, -1)
            curses.init_pair(2, curses.COLOR_BLACK, curses.COLOR_RED)
            curses.init_pair(3, curses.COLOR_RED, -1)
            ok_attr = curses.color_pair(1) | curses.A_BOLD
            wrong_attr = curses.color_pair(2) | curses.A_BOLD
            wrong_result_attr = curses.color_pair(3) | curses.A_BOLD
        except curses.error:
            pass
    while True:
        if not questions:
            wait_message(stdscr, "測驗", "沒有可測驗的題目。")
            set_cursor_visibility(0)
            return False
        question = questions[idx]
        answer_word = question.source.ko if question.source.pos != "文法" else ""
        prompt = question.zh if config["direction"] == "zh-ko" else question.ko
        answer = question.ko if config["direction"] == "zh-ko" else question.zh
        if question.kind == "term":
            examples = card_examples(question.source)
        elif question.kind == "grammar-example":
            examples = [{"ko": question.ko, "zh": question.zh}]
        else:
            examples = []
        if examples:
            example_index %= len(examples)
        else:
            example_index = 0
        example_audio_enabled = bool(examples)
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        record_label = "" if should_record_results else " 不紀錄"
        star_help = " 0=星號" if allow_star else ""
        unfamiliar_help = " *=不熟悉" if question.source.pos != "文法" else ""
        answer_visible = show_hint or graded
        learned_help = " -=已學習" if answer_visible and daily_review and question.kind == "term" else ""
        self_grade_help = " 1=答錯 2=答對" if self_grade_mode and answer_visible and not graded else ""
        if answer_visible and example_audio_enabled:
            example_controls = "7=例句" if question.kind == "grammar-example" else "7=例句 +=下一句"
            controls = f"Esc=返回{star_help}{unfamiliar_help}{learned_help}{self_grade_help} {example_controls} 4/6=上下題 Enter={'下一題' if graded else '送出'}"
        else:
            prompt_audio_help = " 7=題目" if config["direction"] == "ko-zh" and not answer_visible else ""
            check_help = " +=檢查" if not self_grade_mode else ""
            controls = f"Esc=返回{star_help}{unfamiliar_help}{learned_help}{self_grade_help}{prompt_audio_help} 8=答案 4/6=上下題{check_help} Enter={'下一題' if graded else '送出'}"
        draw_line(stdscr, 1, 2, f"測驗{record_label} | {title} | {idx + 1}/{len(questions)}  {auto_audio_control_label()} {controls}", curses.A_BOLD)
        length_hint = f"  ({count_korean_letters(answer)} 個韓文字)" if config["direction"] == "zh-ko" else ""
        star_prefix = f"{'★' if question.source.is_starred else '☆'} " if allow_star else ""
        folder_notice, display_message = folder_prompt_notice(message)
        y = draw_wrapped(stdscr, 2, 2, width - 4, f"{star_prefix}題目: {prompt}{length_hint}{folder_notice}")
        draw_line(stdscr, y, 2, f"答案: {answer}" if show_hint else "答案: hidden (press 8)")
        input_y = y + 1
        if self_grade_mode:
            record_status = "已記錄" if should_record_results else "未紀錄"
            self_grade_status = (
                f"自評: 答對，{record_status}" if graded and last_correct is True
                else f"自評: 答錯，{record_status}" if graded
                else "自評: 1=答錯  2=答對" if show_hint
                else "自評: 請先按 8 公佈答案"
            )
            draw_line(
                stdscr,
                input_y,
                2,
                self_grade_status,
                ok_attr if graded and last_correct is True else wrong_result_attr if graded else 0,
            )
            positions = [2]
        else:
            answered_attr = ok_attr if graded and last_correct is True else 0
            positions = draw_answer_with_feedback(stdscr, input_y, 2, "輸入: ", user_input, partial, ok_attr, wrong_attr, answered_attr)
            count_x = max(positions[-1] + 2, width - 18)
            draw_line(stdscr, input_y, count_x, f"{count_korean_letters(user_input)} 個韓文字", curses.A_DIM)
        message_y = input_y + 1
        if (show_hint or graded) and question.kind == "grammar-example":
            draw_line(stdscr, message_y, 2, f"筆記: {question.source.ko}", curses.A_BOLD)
            message_y += 1
            for note in question.source.notes:
                message_y = draw_wrapped(stdscr, message_y, 4, width - 6, f"筆記: {note}", curses.A_DIM)
            message_y = draw_wrapped(stdscr, message_y, 4, width - 6, f"韓文: {question.ko}")
            message_y = draw_wrapped(stdscr, message_y, 4, width - 6, f"中文: {question.zh}", curses.A_DIM)
        elif (show_hint or graded) and question.kind == "term":
            if examples:
                draw_line(stdscr, message_y, 2, "例句:", curses.A_DIM)
                message_y += 1
                for index, example in enumerate(examples):
                    marker = "▶" if index == example_index else " "
                    text = " / ".join(part for part in (example.get("ko"), example.get("zh")) if part)
                    message_y = draw_wrapped(
                        stdscr,
                        message_y,
                        4,
                        width - 6,
                        f"{marker} {index + 1}. {text}",
                        curses.A_BOLD if index == example_index else curses.A_DIM,
                    )
        if not self_grade_mode and (retry_diff or (graded and last_correct is False)):
            draw_answer_diff(stdscr, message_y, 2, user_input, answer, wrong_attr)
            message_y += 1
        if display_message:
            draw_line(
                stdscr,
                message_y,
                2,
                display_message,
                wrong_result_attr if retry_diff or (graded and last_correct is False) else curses.A_BOLD,
            )
        if not self_grade_mode:
            cursor_x = positions[min(input_cursor, len(positions) - 1)]
            stdscr.move(min(height - 1, input_y), min(width - 1, cursor_x))
        update_curses_screen(stdscr)
        if pending_word_audio:
            pending_word_audio = False
            if speak_korean(answer_word):
                word_audio_message = "已自動播放韓文單字。"
            else:
                word_audio_message = "無法播放單字語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            message = " ".join(part for part in (result_message, word_audio_message) if part)
            continue
        if pending_example_audio:
            audio_action = pending_example_audio
            pending_example_audio = ""
            if speak_korean(examples[example_index]["ko"]):
                action_label = {
                    "replay": "已重播",
                    "next": "已切換並播放",
                }[audio_action]
                audio_message = f"{action_label}例句 {example_index + 1}/{len(examples)}。"
            else:
                audio_message = "無法播放例句語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            message = " ".join(part for part in (result_message, audio_message) if part)
            continue
        if config.get("auto_prompt_audio", True) and _AUTO_PLAY_AUDIO and config["direction"] == "ko-zh" and not answer_visible and spoken_question_id != question.id:
            spoken_question_id = question.id
            message = (
                "已自動播放韓文題目。"
                if speak_korean(question.ko)
                else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
            )
            continue
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b":
            set_cursor_visibility(0)
            return False
        if key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13):
            if graded:
                if idx == len(questions) - 1:
                    wait_message(stdscr, "完成", "這組題目已完成。")
                    set_cursor_visibility(0)
                    return True
                idx += 1
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
                continue
            if self_grade_mode:
                message = "請先按 8 公佈答案，再按 1 或 2 自評。"
                continue
            user_input = user_input.strip()
            input_cursor = min(input_cursor, len(user_input))
            if enforce_answer_length:
                length_warning = korean_length_warning(user_input, answer)
                if length_warning:
                    partial = None
                    retry_diff = False
                    message = length_warning
                    continue
            correct = normalize_text(user_input) == normalize_text(answer)
            if not correct and question.kind in ("example", "grammar-example") and config["direction"] == "zh-ko" and typed_attempts == 0:
                typed_attempts = 1
                retry_diff = True
                partial = None
                show_hint = False
                message = (
                    "例句第一次答錯：先看提示再試一次，第二次答錯才會記錄。"
                    if should_record_results
                    else "例句第一次答錯：先看提示再試一次，第二次答錯才會公佈答案。"
                )
                continue
            if on_result:
                try:
                    on_result(question, correct)
                except RuntimeError as exc:
                    message = friendly_firebase_error(exc)
                    continue
            elif should_record_results:
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
                message = "答對，已記錄。按 Enter 或 6 進入下一題。" if correct else "答錯，已記錄。按 Enter 或 6 進入下一題。"
            else:
                message = "答對，未紀錄。按 Enter 或 6 進入下一題。" if correct else "答錯，未紀錄。按 Enter 或 6 進入下一題。"
            result_message = message
            pending_word_audio = auto_answer_audio and _AUTO_PLAY_AUDIO and bool(answer_word)
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
            if key == "0" and allow_star:
                snapshot = _clone_json(state)
                toggle_star(state, question.source)
                if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                    question.source.is_starred = question.source.id in (state.get("starred") or [])
                    message = ""
                    continue
                message = "已打星號" if question.source.is_starred else "已取消星號"
            elif key == "*" and question.source.pos != "文法":
                try:
                    now_unfamiliar = toggle_word_as_unfamiliar(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"更新不熟悉失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「不熟悉」，仍會照常出現在每日測驗。"
                    if now_unfamiliar
                    else "已移出「不熟悉」。"
                )
                result_message = message
            elif key == "-" and daily_review and question.kind == "term":
                if not answer_visible:
                    message = "請先公佈答案，再加入「已學習」。"
                    continue
                try:
                    added = mark_word_as_learned(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"加入已學習失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「已學習」，未來每日測驗不再出現。"
                    if added
                    else "這個單字已經在「已學習」資料夾中。"
                )
                result_message = message
            elif key in ("u", "U") and daily_review and question.kind == "term":
                if not answer_visible:
                    message = "請先公佈答案，再加入「不熟悉」。"
                    continue
                try:
                    added = mark_word_as_unfamiliar(client, session, state, question.item_id)
                except RuntimeError as exc:
                    message = f"加入不熟悉失敗：{friendly_firebase_error(exc)}"
                    continue
                message = (
                    "已加入「不熟悉」，仍會照常出現在每日測驗。"
                    if added
                    else "這個單字已經在「不熟悉」資料夾中。"
                )
                result_message = message
            elif key == "8":
                revealing_answer = not show_hint
                show_hint = revealing_answer
                if revealing_answer:
                    pending_word_audio = auto_answer_audio and _AUTO_PLAY_AUDIO and bool(answer_word)
            elif key in ("1", "2") and self_grade_mode:
                if not show_hint:
                    message = "請先按 8 公佈答案。"
                    continue
                if graded:
                    message = "這題已完成評分。"
                    continue
                correct = key == "2"
                if on_result:
                    try:
                        on_result(question, correct)
                    except RuntimeError as exc:
                        message = friendly_firebase_error(exc)
                        continue
                elif should_record_results:
                    snapshot = _clone_json(state)
                    record_answer(state, question, correct)
                    if not save_review_state_or_restore(stdscr, client, session, state, snapshot):
                        message = ""
                        continue
                graded = True
                last_correct = correct
                result_label = "答對" if correct else "答錯"
                record_suffix = "已記錄" if should_record_results else "未紀錄"
                message = f"{result_label}，{record_suffix}。按 Enter 或 6 進入下一題。"
                result_message = message
            elif key == "7" and (
                (answer_visible and example_audio_enabled)
                or (config["direction"] == "ko-zh" and not answer_visible)
            ):
                if answer_visible and example_audio_enabled:
                    pending_example_audio = "replay"
                elif config["direction"] == "ko-zh" and not answer_visible:
                    message = (
                        "已重播韓文題目。"
                        if speak_korean(question.ko)
                        else "無法播放語音：請確認 edge-tts 與 cvlc／ffplay 可用。"
                    )
            elif key == "+":
                if answer_visible and example_audio_enabled and question.kind != "grammar-example":
                    example_index = (example_index + 1) % len(examples)
                    pending_example_audio = "next"
                    continue
                if graded:
                    message = "這張單字卡沒有其他可播放的例句。"
                    continue
                if self_grade_mode:
                    message = "心中作答模式請先公佈答案，再按 1 或 2 自評。"
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
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
            elif key == "6":
                if require_answer_before_next and not graded:
                    message = "請先送出這一題的答案。"
                    continue
                if idx == len(questions) - 1 and graded:
                    wait_message(stdscr, "完成", "這組題目已完成。")
                    set_cursor_visibility(0)
                    return True
                idx = min(len(questions) - 1, idx + 1)
                user_input = ""
                input_cursor = 0
                show_hint = False
                partial = None
                graded = False
                last_correct = None
                typed_attempts = 0
                retry_diff = False
                example_index = 0
                pending_example_audio = ""
                pending_word_audio = False
                message = ""
                result_message = ""
            elif key.isprintable():
                if graded or self_grade_mode:
                    continue
                user_input = user_input[:input_cursor] + key + user_input[input_cursor:]
                input_cursor += 1
                partial = None
                retry_diff = False


def run_collection(
    stdscr: curses.window,
    title: str,
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
    allow_result_recording: bool = False,
) -> None:
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
        config = setup_menu(stdscr, title, allow_result_recording=allow_result_recording)
        if not config:
            return
        active_questions = filtered_questions(questions, config)
        run_practice(stdscr, title, active_questions, config, state, client, session)


def run_notebook(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    config: Dict[str, Any] = {
        "query": "",
        "search_scope": "all",
        "levels": set(),
        "folder_ids": set(),
        "show_learned": False,
        "sort": "latest",
    }
    row = 0
    sort_modes = ["latest", "alphabetical", "score"]
    level_options = [
        ("score-negative-1", "熟悉度 -1"),
        ("score-negative-2", "熟悉度 -2"),
        ("score-negative-3", "熟悉度 -3"),
        ("score-negative-4-or-less", "熟悉度 -4 以下"),
        ("學習中", "學習中"),
        ("熟悉", "熟悉"),
        ("已熟悉", "已熟悉"),
    ]
    folders = list(state.get("folders") or [])
    folder_names = {str(folder.get("id") or ""): str(folder.get("name") or "未命名資料夾") for folder in folders}
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        active_cards = filtered_notebook_cards(cards, questions, state, config)
        level_values = set(config["levels"])
        folder_values = set(config["folder_ids"])
        level_summary = "全部" if not level_values else next(iter(level_values)) if len(level_values) == 1 else f"已選 {len(level_values)} 項"
        folder_summary = "全部" if not folder_values else folder_names.get(next(iter(folder_values)), "1 個資料夾") if len(folder_values) == 1 else f"已選 {len(folder_values)} 項"
        sort_label = {"latest": "最新加入優先", "alphabetical": "韓文字母順序", "score": "熟悉分數低優先"}[config["sort"]]
        rows = [
            f"搜尋: {config['query'] or '未設定'}",
            f"搜尋範圍: {'全部內容' if config['search_scope'] == 'all' else '單字本身'}",
            f"熟悉度: {level_summary}",
            f"資料夾: {folder_summary}",
            f"已學習: {'顯示' if config['show_learned'] else '隱藏'}",
            f"排序: {sort_label}",
            f"開始學習篩選結果 · {len(active_cards)} 張卡",
            f"開始測驗篩選結果 · {len(active_cards)} 張卡",
        ]
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(row - visible_count + 1, len(rows) - visible_count))
        visible_rows = rows[start:start + visible_count]
        draw_line(stdscr, 1, 2, f"單字本 | 篩選結果 {len(active_cards)}/{len(cards)} 張卡", curses.A_BOLD)
        draw_line(stdscr, 2, 2, "↑↓=項目 ←→=切換 Enter=設定/開始 R=重設 Esc=返回", curses.A_DIM)
        for screen_row, label in enumerate(visible_rows, 3):
            index = start + screen_row - 3
            attr = curses.A_REVERSE if index == row else curses.A_BOLD if index >= 6 else 0
            draw_line(stdscr, screen_row, 2, ("» " if index == row else "  ") + label, attr)
        if len(rows) > visible_count:
            draw_line(stdscr, height - 1, 2, f"{row + 1}/{len(rows)} · 繼續按 ↓ 可看到開始選項", curses.A_DIM)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if key == "\x1b" or key == 27:
            return
        if key == curses.KEY_UP:
            row = (row - 1) % len(rows)
            continue
        if key == curses.KEY_DOWN:
            row = (row + 1) % len(rows)
            continue
        if isinstance(key, str) and key.lower() == "r":
            config.update({"query": "", "search_scope": "all", "levels": set(), "folder_ids": set(), "show_learned": False, "sort": "latest"})
            continue
        activate = key in ("\n", "\r") or key in (curses.KEY_ENTER, 10, 13)
        cycle = key in (curses.KEY_LEFT, curses.KEY_RIGHT)
        if not activate and not cycle:
            continue
        if row == 0 and activate:
            query = prompt_text_value(stdscr, "單字本 | 搜尋", str(config["query"]))
            if query is not None:
                config["query"] = query
        elif row == 1:
            config["search_scope"] = "word" if config["search_scope"] == "all" else "all"
        elif row == 2 and activate:
            selected = multi_select_menu(stdscr, "熟悉度篩選", level_options, config["levels"])
            if selected is not None:
                config["levels"] = selected
        elif row == 3 and activate:
            selected = grouped_folder_select_menu(stdscr, folders, config["folder_ids"])
            if selected is not None:
                config["folder_ids"] = selected
        elif row == 4:
            config["show_learned"] = not config["show_learned"]
        elif row == 5:
            current_index = sort_modes.index(config["sort"])
            direction = -1 if key == curses.KEY_LEFT else 1
            config["sort"] = sort_modes[(current_index + direction) % len(sort_modes)]
        elif row in (6, 7) and activate:
            if not active_cards:
                wait_message(stdscr, "單字本", "目前篩選條件下沒有單字。")
                continue
            active_ids = {card.id for card in active_cards}
            active_questions = [question for question in questions if question.item_id in active_ids]
            title = f"單字本篩選結果 ({len(active_cards)} 張)"
            if row == 6:
                starred = menu(stdscr, f"{title} | 學習篩選", [("all", "全部卡片"), ("starred", "有星號")])
                if starred:
                    study_cards = [card for card in active_cards if starred == "all" or card.is_starred]
                    run_study(stdscr, title, study_cards, state, client, session)
            else:
                practice_config = setup_menu(stdscr, title, allow_result_recording=True)
                if practice_config:
                    practice_questions = filtered_questions(active_questions, practice_config)
                    if not practice_config["random"]:
                        practice_questions = order_questions_by_cards(practice_questions, active_cards)
                    run_practice(stdscr, title, practice_questions, practice_config, state, client, session)
            set_cursor_visibility(0)


def run_folder_notebook(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    folders = sorted(
        state.get("folders") or [],
        key=lambda folder: (
            0
            if folder.get("id") == state.get("learnedFolderId")
            else 1
            if folder.get("id") == state.get("unfamiliarFolderId")
            else 2,
            str(folder.get("name") or ""),
        ),
    )
    if not folders:
        wait_message(stdscr, "資料夾", "目前還沒有資料夾。")
        return
    while True:
        folder_cards = {str(folder.get("id")): cards_in_folder(cards, folder) for folder in folders}
        selected_id = menu(
            stdscr,
            "資料夾 | 選擇資料夾",
            [
                (str(folder.get("id")), f"{folder.get('name') or '未命名資料夾'} · {len(folder_cards[str(folder.get('id'))])} 張卡")
                for folder in folders
            ],
        )
        if selected_id is None:
            return
        folder = next((entry for entry in folders if str(entry.get("id")) == selected_id), None)
        if not folder:
            continue
        selected_cards = folder_cards[selected_id]
        selected_card_ids = {card.id for card in selected_cards}
        selected_questions = [question for question in questions if question.item_id in selected_card_ids]
        run_collection(
            stdscr,
            str(folder.get("name") or "資料夾"),
            selected_cards,
            selected_questions,
            state,
            client,
            session,
            allow_result_recording=True,
        )


def run_terminal_ui(stdscr: curses.window, client: FirebaseClient, session: AuthSession) -> None:
    try:
        (state, cards, questions, grammar_notes, grammar_review, youtube_subtitles), using_cached_data = load_data_with_cache(client, session)
    except RuntimeError as exc:
        wait_message(stdscr, "載入失敗", friendly_firebase_error(exc))
        return
    while True:
        today = today_string()
        completed = state.setdefault("completedReviewDates", [])
        if not daily_due_questions(state, questions) and today not in completed:
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
        choice = menu(
            stdscr,
            f"韓文筆記 Terminal | {session.email}{' | 離線快取（不會同步）' if using_cached_data else ''}",
            [
                ("due", "今日複習題"),
                ("optional_practice", "自選練習"),
                ("calendar", "月曆"),
                ("notebook", "單字本"),
                ("folders", "資料夾"),
                ("grammar", "文法筆記"),
                ("vocabulary_notes", "單字筆記"),
                ("youtube_subtitles", "YT字幕"),
                ("refresh", "重新同步"),
                ("quit", "離開"),
            ],
            "↑↓=移動 Enter=選擇 .=切換自動語音 Esc=離開",
        )
        if choice in (None, "quit"):
            return
        if choice == "refresh":
            try:
                (state, cards, questions, grammar_notes, grammar_review, youtube_subtitles), using_cached_data = load_data_with_cache(client, session)
            except RuntimeError as exc:
                wait_message(stdscr, "同步失敗", friendly_firebase_error(exc))
            continue
        if choice == "optional_practice":
            if using_cached_data:
                wait_message(stdscr, "自選練習", "目前使用離線快取，無法新增或同步練習進度。請在額度恢復後重新同步。")
                continue
            run_optional_practice_menu(
                stdscr, cards, questions, grammar_notes, state, grammar_review, client, session,
            )
            continue
        if choice == "due":
            task = due_task_menu(stdscr, state, questions)
            if task:
                task_type, selected = task
                if task_type == DAILY_WRONG_REVIEW_MODE:
                    answer_setup = translation_answer_mode_menu(stdscr, "今日答錯題目 | 選擇測驗方式")
                    if not answer_setup:
                        continue
                    direction, answer_mode = answer_setup
                    order_mode = menu(
                        stdscr,
                        "今日答錯題目 | 選擇出題順序",
                        [("alphabetical", "韓文字母順序"), ("random", "隨機打亂順序")],
                    )
                    if not order_mode:
                        continue
                    active_wrong_review = list(selected)
                    if order_mode == "random":
                        random.shuffle(active_wrong_review)
                    while True:
                        completed_wrong_review = run_practice(
                            stdscr,
                            "今日答錯題目",
                            active_wrong_review,
                            {
                                "direction": direction,
                                "answer_mode": answer_mode,
                                "source": "term",
                                "starred": False,
                                "random": False,
                                "record_results": False,
                                "enforce_answer_length": direction == "zh-ko" and answer_mode == "typing",
                                "daily_review": False,
                            },
                            state,
                            client,
                            session,
                        )
                        if not completed_wrong_review:
                            break
                        replay = menu(
                            stdscr,
                            "今日答錯題目已完成",
                            [("again", "再練一次"), ("back", "返回主選單")],
                            "這組練習不會寫入熟悉分數或間隔排程。",
                        )
                        if replay != "again":
                            break
                        if order_mode == "random":
                            random.shuffle(active_wrong_review)
                else:
                    answer_setup = translation_answer_mode_menu(stdscr, "每日單字測驗 | 選擇測驗方式")
                    if not answer_setup:
                        continue
                    direction, answer_mode = answer_setup
                    run_practice(
                        stdscr,
                        "今日全部複習" if task_type == DAILY_MIXED_MODE else f"{task_type} 複習",
                        selected,
                        {
                            "direction": direction,
                            "answer_mode": answer_mode,
                            "source": "term",
                            "starred": False,
                            "random": True,
                            "record_results": True,
                            "enforce_answer_length": direction == "zh-ko" and answer_mode == "typing",
                            "daily_review": True,
                        },
                        state,
                        client,
                        session,
                    )
                if not daily_due_questions(state, questions):
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
            run_notebook(stdscr, cards, questions, state, client, session)
        elif choice == "folders":
            run_folder_notebook(stdscr, cards, questions, state, client, session)
        elif choice == "grammar":
            run_grammar_notebook(
                stdscr, grammar_notes, state, client, session, NOTE_CATEGORY_GRAMMAR
            )
        elif choice == "vocabulary_notes":
            run_grammar_notebook(
                stdscr, grammar_notes, state, client, session, NOTE_CATEGORY_VOCABULARY
            )
        elif choice == "youtube_subtitles":
            run_youtube_subtitles(stdscr, youtube_subtitles)


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
