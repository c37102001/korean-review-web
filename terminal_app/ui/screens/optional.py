
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.session_setup import *

def _run_practice(*args, **kwargs):
    from terminal_app.ui.screens.practice import run_practice
    return run_practice(*args, **kwargs)

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
            draw_line(stdscr, 3 + index, 2, ("» " if index == row else "  ") + label, curses.A_BOLD if index == row else 0)
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
    while True:
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
                continue
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
                continue
            selected_id = menu(stdscr, "新增練習 | 選擇文法筆記", [(note.id, f"{note.title} · {len(note.examples)} 題") for note in eligible_notes])
            if not selected_id:
                continue
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
            continue
        except RuntimeError as exc:
            wait_message(stdscr, "新增練習失敗", friendly_firebase_error(exc))
            continue
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
        while True:
            action = menu(stdscr, str(task.get("title") or "自選練習"), [("start", "開始／繼續"), ("remove", "移除這組練習")])
            if action == "remove":
                try:
                    grammar_review["optionalPractice"] = client.update_optional_practice(
                        session, lambda current: remove_optional_practice_task(current, selected_id)
                    )
                except RuntimeError as exc:
                    wait_message(stdscr, "移除失敗", friendly_firebase_error(exc))
                break
            if action != "start":
                break
            current_task = next(
                (entry for entry in optional_practice_state(grammar_review)["tasks"] if str(entry.get("id")) == selected_id),
                None,
            )
            if not current_task:
                break
            answered = set(current_task.get("answeredIds") or [])
            active_questions = [
                question_by_id[item]
                for item in (current_task.get("ids") or [])
                if item not in answered and item in question_by_id
            ]
            if current_task.get("kind") != "grammar":
                active_questions = [question for question in active_questions if question.item_id not in learned_ids]
            if not active_questions:
                wait_message(stdscr, "沒有可練習題目", "題目可能已刪除或已加入「已學習」，請移除此題組後重新新增。")
                continue

            def save_result(question: Question, correct: bool) -> None:
                grammar_review["optionalPractice"] = client.update_optional_practice(
                    session,
                    lambda current: answer_optional_practice_task(current, selected_id, question.id, correct),
                )

            kind = str(current_task.get("kind") or "")
            if kind in ("listening", "grammar"):
                completed = run_daily_recognition(
                    stdscr, active_questions, cards, state, client, session,
                    grammar_mode=kind == "grammar", title_override=str(current_task.get("title") or "自選練習"),
                    on_result=save_result,
                )
            else:
                completed = _run_practice(
                    stdscr,
                    str(current_task.get("title") or "自選練習"),
                    active_questions,
                    {
                        "direction": "ko-zh" if kind == "reading" else str(current_task.get("direction") or "ko-zh"),
                        "answer_mode": "self-grade" if kind == "reading" else str(current_task.get("answerMode") or "self-grade"),
                        "source": "term" if kind == "words" else "example",
                        "starred": False, "random": False, "record_results": False,
                        "daily_review": False, "on_result": save_result,
                        "auto_prompt_audio": kind != "reading",
                        "auto_answer_audio": kind != "reading",
                        "enforce_answer_length": kind == "words" and current_task.get("direction") == "zh-ko" and current_task.get("answerMode") == "typing",
                        "require_answer_before_next": True,
                    },
                    state, client, session,
                )
            if completed:
                if any(
                    str(entry.get("id")) == selected_id
                    for entry in optional_practice_state(grammar_review)["tasks"]
                ):
                    try:
                        grammar_review["optionalPractice"] = client.update_optional_practice(
                            session, lambda current: remove_optional_practice_task(current, selected_id)
                        )
                    except RuntimeError as exc:
                        wait_message(stdscr, "完成狀態同步失敗", friendly_firebase_error(exc))
                break



__all__ = [name for name in globals() if not name.startswith("__")]
