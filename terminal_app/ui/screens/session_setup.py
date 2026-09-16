
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *

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
    direction = "ko-zh"
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
            draw_line(stdscr, 3 + idx, 2, ("» " if idx == row else "  ") + label, curses.A_BOLD if idx == row else 0)
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
            ("ko-zh:self-grade", "韓翻中 · 心中作答後自行評分"),
            ("zh-ko:typing", "中翻韓 · 打字輸入韓文"),
            ("zh-ko:self-grade", "中翻韓 · 心中作答後自行評分"),
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
    direction = "ko-zh"
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
                curses.A_BOLD if index == row else 0,
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



__all__ = [name for name in globals() if not name.startswith("__")]
