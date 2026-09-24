
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.setup import *
from terminal_app.ui.screens.study import *
from terminal_app.ui.screens.practice import *

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
    while True:
        mode = menu(stdscr, f"{title} | 模式", [("study", "學習模式"), ("practice", "測驗模式")])
        if not mode:
            return
        if mode == "study":
            starred = menu(stdscr, f"{title} | 學習篩選", [("all", "全部卡片"), ("starred", "有星號")])
            if not starred:
                continue
            active = [card for card in cards if starred == "all" or card.is_starred]
            run_study(stdscr, title, active, state, client, session)
        else:
            config = setup_menu(stdscr, title, allow_result_recording=allow_result_recording)
            if not config:
                continue
            active_questions = filtered_questions(questions, config)
            if run_practice(stdscr, title, active_questions, config, state, client, session):
                return


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
        "pos": "",
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
            f"詞性: {config['pos'] or '全部'}",
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
            attr = curses.A_BOLD if index == row or index >= 7 else 0
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
            config.update({"query": "", "search_scope": "all", "levels": set(), "folder_ids": set(), "pos": "", "show_learned": False, "sort": "latest"})
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
            pos_options = ["", *WORD_POS_OPTIONS]
            if activate:
                selected = menu(
                    stdscr,
                    "詞性篩選",
                    [(pos, "全部" if not pos else pos) for pos in pos_options],
                )
                if selected is not None:
                    config["pos"] = selected
            else:
                current_index = pos_options.index(config["pos"])
                direction = -1 if key == curses.KEY_LEFT else 1
                config["pos"] = pos_options[(current_index + direction) % len(pos_options)]
        elif row == 5:
            config["show_learned"] = not config["show_learned"]
        elif row == 6:
            current_index = sort_modes.index(config["sort"])
            direction = -1 if key == curses.KEY_LEFT else 1
            config["sort"] = sort_modes[(current_index + direction) % len(sort_modes)]
        elif row in (7, 8) and activate:
            if not active_cards:
                wait_message(stdscr, "單字本", "目前篩選條件下沒有單字。")
                continue
            active_ids = {card.id for card in active_cards}
            active_questions = [question for question in questions if question.item_id in active_ids]
            title = f"單字本篩選結果 ({len(active_cards)} 張)"
            if row == 7:
                while True:
                    starred = menu(stdscr, f"{title} | 學習篩選", [("all", "全部卡片"), ("starred", "有星號")])
                    if not starred:
                        break
                    study_cards = [card for card in active_cards if starred == "all" or card.is_starred]
                    run_study(stdscr, title, study_cards, state, client, session)
            else:
                while True:
                    practice_config = setup_menu(stdscr, title, allow_result_recording=True)
                    if not practice_config:
                        break
                    practice_questions = filtered_questions(active_questions, practice_config)
                    if not practice_config["random"]:
                        practice_questions = order_questions_by_cards(practice_questions, active_cards)
                    if run_practice(stdscr, title, practice_questions, practice_config, state, client, session):
                        break
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


def run_calendar(
    stdscr: curses.window,
    cards: List[Card],
    questions: List[Question],
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    while True:
        selected_date = date_menu(stdscr, cards)
        if not selected_date:
            return
        day_cards = [card for card in cards if card.date == selected_date]
        day_questions = [question for question in questions if question.date == selected_date]
        run_collection(stdscr, selected_date, day_cards, day_questions, state, client, session)


def run_due_reviews(
    stdscr: curses.window,
    state: Dict[str, Any],
    questions: List[Question],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    def mark_today_complete() -> None:
        if daily_due_questions(state, questions):
            return
        completed = state.setdefault("completedReviewDates", [])
        today = today_string()
        if today in completed:
            return
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

    while True:
        task = due_task_menu(stdscr, state, questions)
        if not task:
            return
        task_type, selected = task
        if task_type == DAILY_WRONG_REVIEW_MODE:
            def save_wrong_review_result(question: Question, correct: bool) -> None:
                snapshot = _clone_json(state)
                record_daily_wrong_review_answer(state, question, correct)
                try:
                    client.save_review_state(session, state)
                except RuntimeError:
                    state.clear()
                    state.update(snapshot)
                    raise

            leave_task = False
            while not leave_task:
                wrong_mode = menu(
                    stdscr,
                    "今日答錯題目 | 模式",
                    [("study", "學習錯題"), ("practice", "測驗錯題")],
                )
                if not wrong_mode:
                    break
                if wrong_mode == "study":
                    front_side = menu(
                        stdscr,
                        "今日答錯題目 | 學習正面",
                        [("ko", "韓文正面"), ("zh", "中文正面")],
                    )
                    if not front_side:
                        continue
                    study_order = menu(
                        stdscr,
                        "今日答錯題目 | 學習順序",
                        [
                            ("original", "原本順序"),
                            ("alphabetical", "韓文字母順序"),
                            ("random", "隨機打亂順序"),
                        ],
                    )
                    if not study_order:
                        continue
                    wrong_cards_by_id = {
                        question.source.id: question.source
                        for question in selected
                        if question.source and question.source.id
                    }
                    run_study(
                        stdscr,
                        "今日答錯題目",
                        ordered_study_cards(list(wrong_cards_by_id.values()), study_order),
                        state,
                        client,
                        session,
                        front_side=front_side,
                    )
                    continue

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
                while True:
                    active_wrong_review = list(selected)
                    if order_mode == "random":
                        random.shuffle(active_wrong_review)
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
                            "on_result": save_wrong_review_result,
                            "allow_mistake_retry": False,
                            "show_mistake_review": False,
                            "enforce_answer_length": direction == "zh-ko" and answer_mode == "typing",
                            "daily_review": False,
                        },
                        state,
                        client,
                        session,
                    )
                    if not completed_wrong_review:
                        break
                    remaining_wrong = daily_wrong_term_questions(state, questions)
                    if not remaining_wrong:
                        wait_message(stdscr, "今日答錯題目", "所有錯題都已經答對。")
                        leave_task = True
                        break
                    replay = menu(
                        stdscr,
                        "今日答錯題目已完成",
                        [
                            ("again", f"只重測仍答錯的 {len(remaining_wrong)} 題"),
                            ("back", "返回今日複習題"),
                        ],
                        "這組練習不會寫入熟悉分數或間隔排程。",
                    )
                    if replay == "again":
                        selected = remaining_wrong
                        continue
                    leave_task = True
                    break
        else:
            while True:
                answer_setup = translation_answer_mode_menu(stdscr, "每日單字測驗 | 選擇測驗方式")
                if not answer_setup:
                    break
                direction, answer_mode = answer_setup
                completed_review = run_practice(
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
                if completed_review:
                    break
        mark_today_complete()



__all__ = [name for name in globals() if not name.startswith("__")]
