
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *


def _run_grammar_practice(*args, **kwargs):
    from terminal_app.ui.screens.grammar import run_grammar_practice
    return run_grammar_practice(*args, **kwargs)

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
            _run_grammar_practice(stdscr, [note], state, client, session)
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
                curses.A_BOLD if note_index == cursor else 0,
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
            _run_grammar_practice(stdscr, selected_notes, state, client, session)
            set_cursor_visibility(0)
            message = ""



__all__ = [name for name in globals() if not name.startswith("__")]
