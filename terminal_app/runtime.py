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
  7 play an example, 9 replay the word, 8 show/hide answer or details, 4 previous, 6 next,
  + partial check, Enter submit answer, Esc back.
"""

from __future__ import annotations

import curses
import argparse
import fcntl
import sys
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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib import error, parse, request
import terminal_offline
from terminal_app.audio.tts import korean_audio_players, korean_speech_commands
from terminal_app.audio.youtube import TerminalYoutubeAudioPlayer
from terminal_app.audio.youtube import download_youtube_audio as _download_youtube_audio
from terminal_app.audio.youtube import youtube_audio_cache_path as _youtube_audio_cache_path
from terminal_app.audio.youtube import youtube_audio_download_profiles
from terminal_app.api.auth import FirebaseAuthService
from terminal_app.api.firestore_codec import document_id as _doc_id
from terminal_app.api.firestore_codec import parse_fields as _parse_firestore_fields
from terminal_app.api.firestore_codec import parse_value as _parse_firestore_value
from terminal_app.api.firestore_codec import to_value as _to_firestore_value
from terminal_app.api.transport import JsonHttpTransport
from terminal_app.domain.models import AuthSession, Card, GrammarNote, PartialCheckResult, Question, ReadingTest, YoutubeSubtitle
from terminal_app.domain.content import item_zh, normalize_grammar_notes, normalize_reading_tests, normalize_records, normalize_youtube_subtitles, order_questions, record_order
from terminal_app.domain.practice import (
    add_optional_practice_task,
    answer_optional_practice_task,
    draw_optional_practice_ids,
    optional_practice_state,
    remove_optional_practice_task,
)
from terminal_app.domain.review import (
    REVIEW_INTERVALS,
    count_korean_letters,
    daily_due_questions,
    daily_grammar_questions,
    daily_recognition_questions,
    daily_round_questions,
    daily_wrong_term_questions,
    due_questions,
    familiarity_score,
    get_progress,
    grammar_practice_questions,
    korean_length_warning,
    next_review_transition,
    normalize_text,
    record_answer as _record_answer,
    record_daily_recognition_answer,
    record_daily_round_answer,
    record_daily_wrong_review_answer,
    seed_from_string,
    shuffle_items,
    toggle_star,
)
from terminal_app.repositories import FirestoreCollectionRepository
from terminal_app.sync.cache import cache_path, read_cache, write_cache
from terminal_app.sync.incremental import active_records, latest_updated_at, merge_record_changes
from terminal_app.sync.service import TerminalSyncService
from terminal_app.ui.primitives import cell_width, split_by_cell_width, text_cell_width


API_KEY = "AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU"
PROJECT_ID = "korean-review-web"
FIRESTORE_SCHEMA_VERSION = 3
PROGRESS_SHARD_COUNT = 16
REVIEW_ATTEMPT_SEGMENT_COUNT = 16
REVIEW_DAY_STORAGE_VERSION = 2
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
TERMINAL_SYNC_VERSION = 1


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


_AUTO_PLAY_AUDIO = True


def is_auto_audio_enabled() -> bool:
    return _AUTO_PLAY_AUDIO


def set_auto_audio_enabled(enabled: bool) -> bool:
    global _AUTO_PLAY_AUDIO
    _AUTO_PLAY_AUDIO = bool(enabled)
    return _AUTO_PLAY_AUDIO


def toggle_auto_audio_enabled() -> bool:
    return set_auto_audio_enabled(not is_auto_audio_enabled())


class FirebaseClient:
    def __init__(self, api_key: str, project_id: str, transport=None) -> None:
        self.api_key = api_key
        self.project_id = project_id
        self.transport = transport or JsonHttpTransport()
        self.auth_service = FirebaseAuthService(api_key, self.transport)
        self._saved_state: Dict[str, Any] = empty_state()
        self._writes_blocked_until = 0.0
        self.offline_mode = False
        self.offline_payload = None

    def start_offline(self, session, payload=None):
        payload = payload or _read_terminal_cache(session.uid)
        if not payload:
            raise RuntimeError('此帳號沒有本機備份，請先連線載入一次')
        self.offline_payload = terminal_offline.begin(payload)
        self.offline_payload['account'] = {'uid': session.uid, 'email': session.email}
        self.offline_mode = True
        self.persist_offline(session)

    def persist_offline(self, session):
        try:
            terminal_offline.persist(_terminal_cache_path(session.uid), self.offline_payload)
        except OSError as exc:
            raise RuntimeError(f'本機備份寫入失敗：{exc}') from exc

    def sync_offline(self, session):
        payload = self.offline_payload or _read_terminal_cache(session.uid)
        if not payload or not payload.get('pending'):
            self.offline_mode = False
            return
        self.offline_mode = False
        try:
            if not session.id_token:
                password = os.getenv('TERMINAL_PRACTICE_PASSWORD', '')
                if not password:
                    raise RuntimeError('同步需要登入，請退出後不帶 --offline 重新啟動並登入')
                authenticated = self.sign_in(session.email, password)
                if authenticated.uid != session.uid:
                    raise RuntimeError('登入帳號與本機備份不同，拒絕同步')
                session.id_token = authenticated.id_token
                session.refresh_token = authenticated.refresh_token
            terminal_offline.synchronize(self, session, payload, sys.modules[__name__])
            synchronized_payload = _clone_json(payload)
            synchronized_payload.pop('pending', None)
            terminal_offline.persist(_terminal_cache_path(session.uid), synchronized_payload)
            self.offline_payload = None
        except Exception as exc:
            self.offline_mode = True
            self.offline_payload = payload
            if isinstance(exc, OSError):
                raise RuntimeError(f'本機備份寫入失敗，待同步資料仍保留：{exc}') from exc
            raise

    def offline_folder_change(self, session, folder_id, word_id, included):
        payload = _clone_json(self.offline_payload)
        payload['pending']['folders'].setdefault(folder_id, {})[word_id] = included
        sync_state_folder_membership({'folders': payload['folders']}, folder_id, word_id, included)
        previous = self.offline_payload
        self.offline_payload = payload
        try:
            self.persist_offline(session)
        except RuntimeError:
            self.offline_payload = previous
            raise

    def sign_in(self, email: str, password: str) -> AuthSession:
        return self.auth_service.sign_in(email, password)

    def list_records(self, session: AuthSession) -> List[Dict[str, Any]]:
        return FirestoreCollectionRepository(self, "records").list_all(session)

    def list_records_updated_since(self, session: AuthSession, updated_at: str) -> List[Dict[str, Any]]:
        return FirestoreCollectionRepository(self, "records").updated_since(session, updated_at)

    def _list_documents_updated_since(self, session: AuthSession, collection_id: str, updated_at: str) -> List[Dict[str, Any]]:
        url = f"{self._document_url(['users', session.uid])}:runQuery"
        response = self._request_json("POST", url, payload={
            "structuredQuery": {
                "from": [{"collectionId": collection_id}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": "updatedAt"},
                        "op": "GREATER_THAN",
                        "value": {"timestampValue": updated_at},
                    },
                },
            },
        }, session=session)
        return [
            _parse_firestore_fields(row["document"].get("fields", {}))
            | {
                "id": _doc_id(row["document"].get("name", "")),
                "_docId": _doc_id(row["document"].get("name", "")),
            }
            for row in response
            if row.get("document")
        ]

    def list_folders(self, session: AuthSession) -> List[Dict[str, Any]]:
        return FirestoreCollectionRepository(self, "folders").list_all(session)

    def ensure_system_folder(
        self,
        session: AuthSession,
        folders: List[Dict[str, Any]],
        folder_id: str,
        folder_name: str,
        system_key: str,
    ) -> Any:
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
        document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/folders/{folder_id}"
        self._request_json(
            "POST",
            f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit",
            payload={"writes": [{
                "update": {
                    "name": document_name,
                    "fields": {
                        key: _to_firestore_value(value)
                        for key, value in folder.items()
                        if key != "updatedAt"
                    },
                },
                "updateTransforms": [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}],
            }]},
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
        if self.offline_mode:
            self.offline_folder_change(session, folder_id, word_id, True)
            return
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
        if self.offline_mode:
            self.offline_folder_change(session, folder_id, word_id, False)
            return
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
        return FirestoreCollectionRepository(self, "grammarNotes").list_all(session)

    def list_youtube_subtitles(self, session: AuthSession) -> List[Dict[str, Any]]:
        return FirestoreCollectionRepository(self, "ytSubtitles").list_all(session)

    def list_reading_tests(self, session: AuthSession) -> List[Dict[str, Any]]:
        return FirestoreCollectionRepository(self, "readingTests").list_all(session)

    def set_reading_test_learned(self, session: AuthSession, test_id: str, learned: bool) -> None:
        if self.offline_mode:
            payload = self.offline_payload
            previous = _clone_json(payload)
            pending = payload.setdefault("pending", {})
            pending.setdefault("readingTests", {})[test_id] = bool(learned)
            for record in payload.setdefault("readingTests", []):
                if str(record.get("id") or record.get("_docId") or "") == test_id:
                    record["learned"] = bool(learned)
                    record["updatedAt"] = utc_now_iso()
                    break
            try:
                self.persist_offline(session)
            except RuntimeError:
                self.offline_payload = previous
                raise
            return
        document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/readingTests/{test_id}"
        self._request_json(
            "POST",
            f"https://firestore.googleapis.com/v1/projects/{self.project_id}/databases/(default)/documents:commit",
            payload={"writes": [{
                "update": {
                    "name": document_name,
                    "fields": {"learned": _to_firestore_value(bool(learned))},
                },
                "updateMask": {"fieldPaths": ["learned"]},
                "updateTransforms": [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}],
                "currentDocument": {"exists": True},
            }]},
            session=session,
        )

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
        if self.offline_mode:
            review = self.offline_payload.setdefault('grammarReview', {})
            previous = _clone_json(review)
            next_value = change(_clone_json(review.get('optionalPractice') or {'tasks': [], 'pools': {}}))
            review['optionalPractice'] = next_value
            try:
                self.persist_offline(session)
            except RuntimeError:
                self.offline_payload['grammarReview'] = previous
                raise
            return next_value
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
        if self.offline_mode:
            previous_review = _clone_json(self.offline_payload.get('grammarReview') or {})
            self.offline_payload.setdefault('grammarReview', {}).update(review)
            try:
                self.persist_offline(session)
            except RuntimeError:
                self.offline_payload['grammarReview'] = previous_review
                raise
            return review
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
        for segment in self._list_documents(["users", session.uid, "reviewDays", today_string(), "attemptSegments"], session):
            attempts.extend((_parse_firestore_fields(segment.get("fields", {})).get("attempts") or []))
        state["attempts"] = merge_review_attempts(attempts)
        state["completedReviewDates"] = settings.get("completedReviewDates") or []
        state["starred"] = settings.get("starred") or []
        state["recognition"] = settings.get("recognition")
        self._saved_state = _clone_json(state)
        return state

    def save_review_state(self, session: AuthSession, state: Dict[str, Any]) -> None:
        if self.offline_mode:
            previous = self.offline_payload['state']
            previous_attempts = _clone_json(self.offline_payload['pending'].get('attempts') or {})
            base_ids = {attempt['id'] for attempt in self.offline_payload['pending']['baseState'].get('attempts', [])}
            journal = self.offline_payload['pending'].setdefault('attempts', {})
            for attempt in state.get('attempts', []):
                if attempt['id'] not in base_ids:
                    journal[attempt['id']] = _clone_json(attempt)
            self.offline_payload['state'] = _clone_json(state)
            try:
                self.persist_offline(session)
            except RuntimeError:
                self.offline_payload['state'] = previous
                self.offline_payload['pending']['attempts'] = previous_attempts
                raise
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
        cached = _read_terminal_cache(session.uid)
        if cached and not cached.get('pending'):
            cached['state'] = _clone_json(state)
            cached['folders'] = _clone_json(state.get('folders') or cached.get('folders') or [])
            _write_terminal_cache(session.uid, cached)

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
        previous_attempt_dates = {attempt_date(attempt) for attempt in (previous.get("attempts") or [])}
        initialized_dates = set()
        for date_key, attempts in _attempts_by_date(added_attempts).items():
            if date_key not in previous_attempt_dates and date_key not in initialized_dates:
                initialized_dates.add(date_key)
                document_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/reviewDays/{date_key}"
                writes.append({
                    "update": {"name": document_name, "fields": {
                        "date": _to_firestore_value(date_key),
                        "attemptStorageVersion": _to_firestore_value(REVIEW_DAY_STORAGE_VERSION),
                    }},
                    "updateMask": {"fieldPaths": ["date", "attemptStorageVersion"]},
                })
            for segment_id, segment_attempts in _attempts_by_segment(attempts).items():
                segment_name = f"projects/{self.project_id}/databases/(default)/documents/users/{session.uid}/reviewDays/{date_key}/attemptSegments/{segment_id}"
                writes.append({
                    "update": {"name": segment_name, "fields": {
                        "date": _to_firestore_value(date_key),
                        "segmentId": _to_firestore_value(segment_id),
                    }},
                    "updateMask": {"fieldPaths": ["date", "segmentId"]},
                    "updateTransforms": [
                        {"fieldPath": "attempts", "appendMissingElements": {"values": [_to_firestore_value(attempt) for attempt in segment_attempts]}},
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
        self.auth_service.refresh(session)

    def _request_json(
        self,
        method: str,
        url: str,
        payload: Optional[Dict[str, Any]] = None,
        session: Optional[AuthSession] = None,
        _retry: bool = True,
    ) -> Dict[str, Any]:
        if self.offline_mode:
            raise RuntimeError('目前為離線模式，這項操作需要連線；沒有存取 Firebase')
        return self.transport.request_json(
            method,
            url,
            payload=payload,
            token=session.id_token if session else "",
            refresh=(lambda: self.auth_service.refresh(session)) if session and _retry else None,
            allow_retry=_retry,
        )


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


def _attempts_by_segment(attempts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for attempt in attempts:
        attempt_id = str(attempt.get("id") or "")
        if attempt_id:
            groups.setdefault(_review_attempt_segment_id(attempt_id), []).append(attempt)
    return groups


def merge_review_attempts(attempts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id = {str(attempt.get("id")): attempt for attempt in attempts if attempt.get("id")}
    return sorted(by_id.values(), key=lambda attempt: attempt.get("time", ""), reverse=True)[:5000]


def attempt_date(attempt: Dict[str, Any]) -> str:
    return str(attempt.get("date") or str(attempt.get("time") or "")[:10])


def _progress_shard_id(question_id: str) -> str:
    return str(sum(ord(character) for character in question_id) % PROGRESS_SHARD_COUNT).zfill(2)


def _review_attempt_segment_id(attempt_id: str) -> str:
    hash_value = 2166136261
    for character in str(attempt_id):
        hash_value ^= ord(character)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return str(hash_value % REVIEW_ATTEMPT_SEGMENT_COUNT).zfill(2)


def _extract_http_error_message(body: str) -> str:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body
    err = parsed.get("error")
    return str(err.get("message", body)) if isinstance(err, dict) else body


def _is_quota_exceeded_error(message: str) -> bool:
    return "quota exceeded" in message.casefold()


def today_string() -> str:
    return date.today().isoformat()


def add_days(date_key: str, days: int) -> str:
    return (date.fromisoformat(date_key) + timedelta(days=days)).isoformat()


def load_data(
    client: FirebaseClient,
    session: AuthSession,
) -> Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]]:
    baseline_started_at = utc_now_iso()
    with ThreadPoolExecutor(max_workers=7) as executor:
        state_future = executor.submit(client.load_review_state, session)
        records_future = executor.submit(client.list_records, session)
        folders_future = executor.submit(client.list_folders, session)
        grammar_notes_future = executor.submit(client.list_grammar_notes, session)
        youtube_subtitles_future = executor.submit(client.list_youtube_subtitles, session)
        reading_tests_future = executor.submit(client.list_reading_tests, session)
        grammar_review_future = executor.submit(client.load_grammar_review, session)
        state = state_future.result()
        all_record_documents = records_future.result()
        all_folder_documents = folders_future.result()
        all_grammar_note_documents = grammar_notes_future.result()
        all_youtube_subtitle_documents = youtube_subtitles_future.result()
        all_reading_test_documents = reading_tests_future.result()
        grammar_review = grammar_review_future.result()

    payload = {
        'account': {'uid': session.uid, 'email': session.email},
        "state": state,
        "records": active_records(all_record_documents),
        "folders": active_records(all_folder_documents),
        "grammarNotes": active_records(all_grammar_note_documents),
        "ytSubtitles": active_records(all_youtube_subtitle_documents),
        "readingTests": active_records(all_reading_test_documents),
        "grammarReview": grammar_review,
        "sync": {
            "version": TERMINAL_SYNC_VERSION,
            "recordsUpdatedAt": latest_updated_at(all_record_documents, baseline_started_at),
            "foldersUpdatedAt": latest_updated_at(all_folder_documents, baseline_started_at),
            "grammarNotesUpdatedAt": latest_updated_at(all_grammar_note_documents, baseline_started_at),
            "ytSubtitlesUpdatedAt": latest_updated_at(all_youtube_subtitle_documents, baseline_started_at),
            "readingTestsUpdatedAt": latest_updated_at(all_reading_test_documents, baseline_started_at),
        },
    }
    loaded = _hydrate_loaded_data(client, session, payload, ensure_system_folders=True)
    payload['state'] = _clone_json(loaded[0])
    payload['folders'] = _clone_json(loaded[0]['folders'])
    _write_terminal_cache(session.uid, payload)
    return loaded


def load_data_incrementally(
    client: FirebaseClient,
    session: AuthSession,
    cached: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]]:
    sync = cached.get("sync") or {}
    checkpoints = {
        "records": str(sync.get("recordsUpdatedAt") or ""),
        "folders": str(sync.get("foldersUpdatedAt") or ""),
        "grammarNotes": str(sync.get("grammarNotesUpdatedAt") or ""),
        "ytSubtitles": str(sync.get("ytSubtitlesUpdatedAt") or ""),
        "readingTests": str(sync.get("readingTestsUpdatedAt") or ""),
    }
    if not all(checkpoints.values()):
        return load_data(client, session)
    with ThreadPoolExecutor(max_workers=7) as executor:
        state_future = executor.submit(client.load_review_state, session)
        records_future = executor.submit(client._list_documents_updated_since, session, "records", checkpoints["records"])
        folders_future = executor.submit(client._list_documents_updated_since, session, "folders", checkpoints["folders"])
        grammar_notes_future = executor.submit(client._list_documents_updated_since, session, "grammarNotes", checkpoints["grammarNotes"])
        youtube_subtitles_future = executor.submit(client._list_documents_updated_since, session, "ytSubtitles", checkpoints["ytSubtitles"])
        reading_tests_future = executor.submit(client._list_documents_updated_since, session, "readingTests", checkpoints["readingTests"])
        grammar_review_future = executor.submit(client.load_grammar_review, session)
        state = state_future.result()
        record_changes = records_future.result()
        folder_changes = folders_future.result()
        grammar_note_changes = grammar_notes_future.result()
        youtube_subtitle_changes = youtube_subtitles_future.result()
        reading_test_changes = reading_tests_future.result()
        grammar_review = grammar_review_future.result()

    records = merge_record_changes(cached.get("records") or [], record_changes)
    folders = merge_record_changes(cached.get("folders") or [], folder_changes)
    grammar_note_records = merge_record_changes(cached.get("grammarNotes") or [], grammar_note_changes)
    youtube_subtitle_records = merge_record_changes(cached.get("ytSubtitles") or [], youtube_subtitle_changes)
    reading_test_records = merge_record_changes(cached.get("readingTests") or [], reading_test_changes)
    payload = {
        "account": {"uid": session.uid, "email": session.email},
        "state": state,
        "records": records,
        "folders": folders,
        "grammarNotes": grammar_note_records,
        "ytSubtitles": youtube_subtitle_records,
        "readingTests": reading_test_records,
        "grammarReview": grammar_review,
        "sync": {
            "version": TERMINAL_SYNC_VERSION,
            "recordsUpdatedAt": latest_updated_at(record_changes, checkpoints["records"]),
            "foldersUpdatedAt": latest_updated_at(folder_changes, checkpoints["folders"]),
            "grammarNotesUpdatedAt": latest_updated_at(grammar_note_changes, checkpoints["grammarNotes"]),
            "ytSubtitlesUpdatedAt": latest_updated_at(youtube_subtitle_changes, checkpoints["ytSubtitles"]),
            "readingTestsUpdatedAt": latest_updated_at(reading_test_changes, checkpoints["readingTests"]),
        },
    }
    loaded = _hydrate_loaded_data(client, session, payload, ensure_system_folders=True)
    payload["state"] = _clone_json(loaded[0])
    payload["folders"] = _clone_json(loaded[0]["folders"])
    _write_terminal_cache(session.uid, payload)
    return loaded


def load_data_with_cache(
    client: FirebaseClient,
    session: AuthSession,
) -> Tuple[Tuple[Dict[str, Any], List[Card], List[Question], List[GrammarNote], Dict[str, Any], List[YoutubeSubtitle]], bool]:
    """Use the local record baseline, sync deltas, and fall back fully offline when needed."""
    cached = _read_terminal_cache(session.uid)
    if not client.offline_mode and cached and cached.get('pending'):
        client.offline_payload = cached
        try:
            client.sync_offline(session)
        except RuntimeError as exc:
            client.offline_sync_error = str(exc)
            client.start_offline(session, cached)
            return load_data_with_cache(client, session)
    service = TerminalSyncService(
        TERMINAL_SYNC_VERSION,
        _read_terminal_cache,
        _hydrate_loaded_data,
        _is_quota_exceeded_error,
    )
    return service.load(
        client,
        session,
        cached,
        full_loader=lambda: load_data(client, session),
        incremental_loader=lambda payload: load_data_incrementally(client, session, payload),
    )


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
    reading_test_records = _clone_json(payload.get("readingTests") or [])
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
    state["readingTests"] = reading_test_records
    return state, cards, questions, grammar_notes, grammar_review, youtube_subtitles


def _terminal_cache_path(uid: str) -> Path:
    return cache_path(CACHE_DIR, uid)


def _write_terminal_cache(uid: str, payload: Dict[str, Any]) -> None:
    try:
        write_cache(CACHE_DIR, uid, payload)
    except OSError:
        # A cache failure must never block normal Firebase-backed practice.
        pass


def _read_terminal_cache(uid: str) -> Optional[Dict[str, Any]]:
    return read_cache(CACHE_DIR, uid)


OPTIONAL_PRACTICE_LABELS = {
    "words": "單字練習",
    "listening": "單字例句聽力練習",
    "reading": "單字例句閱讀練習",
    "grammar": "文法例句練習",
}


def record_answer(state: Dict[str, Any], question: Question, correct: bool) -> None:
    _record_answer(state, question, correct, date_key=today_string(), now=utc_now_iso())


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
    return _youtube_audio_cache_path(subtitle, CACHE_DIR)


def download_youtube_audio(subtitle: YoutubeSubtitle) -> Tuple[Optional[Path], str]:
    return _download_youtube_audio(subtitle, CACHE_DIR)


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
    return cell_width(ch)


def _text_cell_width(text: str) -> int:
    return text_cell_width(text)


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
    return split_by_cell_width(text, max_cells)


def folder_prompt_notice(message: str) -> Tuple[str, str]:
    match = re.match(r'(已加入|已移出|已移除)「(不熟悉|已學習)」', message)
    if match:
        return f" （{match.group(0)}）", ""
    match = re.match(r'這個單字已經在「(不熟悉|已學習)」資料夾中。', message)
    if match:
        return f" （已在「{match.group(1)}」）", ""
    return "", message



__all__ = [name for name in globals() if not name.startswith("__")]
