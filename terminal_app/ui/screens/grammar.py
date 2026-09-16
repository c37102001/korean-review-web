
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.session_setup import *
from terminal_app.ui.screens.recognition import practice_mistake_questions, practice_mistake_review_menu


def _run_practice(*args, **kwargs):
    from terminal_app.ui.screens.practice import run_practice
    return run_practice(*args, **kwargs)

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

    def finish_round() -> bool:
        mistakes = practice_mistake_questions(
            questions,
            (question_id for question_id, correct in graded.items() if not correct),
        )
        while practice_mistake_review_menu(stdscr, title, mistakes):
            if run_grammar_recall_practice(
                stdscr,
                f"{title} | 錯題重測",
                list(mistakes),
                notebook_label,
            ):
                return True
        return True

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
                return finish_round()
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
                return finish_round()
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
    while True:
        config = grammar_practice_setup_menu(stdscr, title, notebook_label)
        if not config:
            return
        active_questions = list(questions)
        if config["random"]:
            random.shuffle(active_questions)
        if config["direction"] == "ko-zh":
            if run_grammar_recall_practice(stdscr, title, active_questions, notebook_label):
                return
            continue
        completed = _run_practice(
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
        if completed:
            return



__all__ = [name for name in globals() if not name.startswith("__")]
