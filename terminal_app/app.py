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

import argparse
import curses
import fcntl
import getpass
import json
import os
import signal
import sys
from types import ModuleType

from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.content import *
from terminal_app.ui.screens.setup import *
from terminal_app.ui.screens.study import *
from terminal_app.ui.screens.practice import *
from terminal_app.ui.screens.library import *

from terminal_app import runtime as _runtime_module
from terminal_app.ui import curses_helpers as _curses_helpers_module
from terminal_app.ui.screens import content as _content_module
from terminal_app.ui.screens import setup as _setup_module
from terminal_app.ui.screens import study as _study_module
from terminal_app.ui.screens import practice as _practice_module
from terminal_app.ui.screens import library as _library_module
from terminal_app.ui.screens import notes as _notes_module
from terminal_app.ui.screens import subtitles as _subtitles_module
from terminal_app.ui.screens import reading as _reading_module
from terminal_app.ui.screens import optional as _optional_module
from terminal_app.ui.screens import session_setup as _session_setup_module
from terminal_app.ui.screens import grammar as _grammar_module
from terminal_app.ui.screens import recognition as _recognition_module
from terminal_app.ui.screens import practice_session as _practice_session_module

_OWNER_MODULES = (
    _runtime_module,
    _curses_helpers_module,
    _content_module,
    _setup_module,
    _study_module,
    _practice_module,
    _library_module,
    _notes_module,
    _subtitles_module,
    _reading_module,
    _optional_module,
    _session_setup_module,
    _grammar_module,
    _recognition_module,
    _practice_session_module,
)


class _CompatibilityModule(ModuleType):
    """Forward historical monkeypatches to extracted symbol owners."""

    def __setattr__(self, name, value):
        for owner in _OWNER_MODULES:
            if hasattr(owner, name):
                setattr(owner, name, value)
        super().__setattr__(name, value)


sys.modules[__name__].__class__ = _CompatibilityModule

def run_terminal_ui(stdscr: curses.window, client: FirebaseClient, session: AuthSession) -> None:
    initialize_terminal_appearance(stdscr)
    try:
        (state, cards, questions, grammar_notes, grammar_review, youtube_subtitles), using_cached_data = load_data_with_cache(client, session)
    except RuntimeError as exc:
        wait_message(stdscr, "載入失敗", friendly_firebase_error(exc))
        return
    if getattr(client, 'offline_sync_error', ''):
        wait_message(stdscr, '同步未完成，改用本機備份', client.offline_sync_error)
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
            f"韓文筆記 Terminal | {session.email}{' | 離線（已保存，待同步）' if client.offline_mode else ''}",
            [
                ("due", "今日複習題"),
                ("optional_practice", "自選練習"),
                ("calendar", "月曆"),
                ("notebook", "單字本"),
                ("folders", "資料夾"),
                ("grammar", "文法筆記"),
                ("vocabulary_notes", "單字筆記"),
                ("youtube_subtitles", "YT字幕"),
                ("reading_tests", "閱讀測驗"),
                ("refresh", "同步最新變更"),
                ("full_refresh", "完整重新下載（維修）"),
                ("offline", "切換至離線模式（使用本機備份）"),
                ("quit", "離開"),
            ],
            "↑↓=移動 Enter=選擇 .=切換自動語音 Esc=離開",
        )
        if choice in (None, "quit"):
            return
        if choice == "refresh":
            try:
                client.sync_offline(session)
                (state, cards, questions, grammar_notes, grammar_review, youtube_subtitles), using_cached_data = load_data_with_cache(client, session)
            except RuntimeError as exc:
                wait_message(stdscr, "同步失敗", friendly_firebase_error(exc))
            continue
        if choice == "full_refresh":
            try:
                client.sync_offline(session)
                state, cards, questions, grammar_notes, grammar_review, youtube_subtitles = load_data(client, session)
                using_cached_data = False
            except RuntimeError as exc:
                wait_message(stdscr, "完整下載失敗", friendly_firebase_error(exc))
            continue
        if choice == 'offline':
            if client.offline_mode:
                wait_message(stdscr, '離線模式', '已使用本機備份，變更已保存；選擇重新同步即可上傳')
                continue
            try:
                client.start_offline(session)
                client.offline_payload['state'] = _clone_json(state)
                client.offline_payload['folders'] = _clone_json(state.get('folders') or [])
                client.offline_payload['grammarReview'] = _clone_json(grammar_review)
                client.offline_payload['pending']['baseState'] = _clone_json(state)
                client.offline_payload['pending']['baseGrammarReview'] = _clone_json(grammar_review)
                client.persist_offline(session)
                using_cached_data = True
            except RuntimeError as exc:
                wait_message(stdscr, '離線模式失敗', str(exc))
            continue
        if choice == "optional_practice":
            run_optional_practice_menu(
                stdscr, cards, questions, grammar_notes, state, grammar_review, client, session,
            )
            continue
        if choice == "due":
            run_due_reviews(stdscr, state, questions, client, session)
        elif choice == "calendar":
            run_calendar(stdscr, cards, questions, state, client, session)
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
        elif choice == "reading_tests":
            run_reading_tests(stdscr, state, client, session)


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
    parser = argparse.ArgumentParser(description='韓文筆記 Terminal')
    parser.add_argument('--offline', action='store_true', help='只使用本機備份，不連線登入或讀寫 Firebase')
    parser.add_argument('--sync', action='store_true', help='登入並同步本機變更後退出')
    parser.add_argument('--email', default=os.getenv('TERMINAL_PRACTICE_EMAIL', ''), help='離線備份所屬帳號')
    args = parser.parse_args()
    if args.offline and args.sync:
        parser.error('--offline 與 --sync 不能同時使用')
    client = FirebaseClient(API_KEY, PROJECT_ID)
    if args.offline:
        matches = []
        for path in CACHE_DIR.glob('*.json'):
            try:
                payload = json.loads(path.read_text(encoding='utf-8'))
                account = payload.get('account') or {}
                if account.get('email', '').lower() == args.email.lower() and account.get('uid'):
                    matches.append(account)
            except (OSError, ValueError):
                continue
        if len(matches) != 1:
            parser.error('找不到此帳號的本機備份，請先線上登入一次；可用 --email 指定帳號')
        account = matches[0]
        session = AuthSession(account['email'], account['uid'], '', '')
    else:
        session = prompt_login(client)
    lock_path = _terminal_cache_path(session.uid).with_suffix('.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('此帳號已有另一個 terminal 執行中，請先關閉，避免本機備份互相覆蓋')
        if args.offline:
            client.start_offline(session)
        if args.sync:
            try:
                client.sync_offline(session)
                load_data_with_cache(client, session)
            except RuntimeError as exc:
                parser.exit(1, f'同步失敗，待同步資料仍保留：{exc}\n')
            print('同步完成，本機備份已更新。')
            return
        curses.wrapper(run_terminal_ui, client, session)


if __name__ == "__main__":
    main()
