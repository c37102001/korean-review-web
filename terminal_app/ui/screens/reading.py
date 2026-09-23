
from terminal_app.runtime import *
from terminal_app.ui.curses_helpers import *
from terminal_app.ui.screens.highlights import render_highlight_markers, run_highlight_editor, run_highlight_export


def _reading_highlight_entries(test: ReadingTest) -> List[Dict[str, str]]:
    return [
        {"id": f"{test.id}-passage", "ko": test.passage["ko"]},
        {"id": f"{test.id}-question", "ko": test.question["ko"]},
        *({"id": f"{test.id}-option-{option['id']}", "ko": option["ko"]} for option in test.options),
    ]

def _reading_content_lines(
    test: ReadingTest,
    width: int,
    selected_id: str,
    submitted: bool,
) -> Tuple[List[Tuple[str, int]], Dict[str, int]]:
    lines: List[Tuple[str, int]] = []
    option_rows: Dict[str, int] = {}

    def append(text: str = "", attr: int = 0, indent: str = "") -> None:
        wrapped = _split_by_cell_width(text, max(1, width - _text_cell_width(indent)))
        lines.extend((indent + part, attr) for part in wrapped)

    append(render_highlight_markers(test.passage["ko"], f"{test.id}-passage", test.highlights))
    if submitted and test.passage.get("zh"):
        append(test.passage["zh"], curses.A_DIM)
    append()
    append(render_highlight_markers(test.question["ko"], f"{test.id}-question", test.highlights), curses.A_BOLD)
    if submitted and test.question.get("zh"):
        append(test.question["zh"], curses.A_DIM)
    append()
    for index, option in enumerate(test.options):
        option_rows[option["id"]] = len(lines)
        marker = "●" if option["id"] == selected_id else "○"
        if submitted:
            if option["id"] == test.answer:
                marker = "✓"
            elif option["id"] == selected_id:
                marker = "✗"
        attr = curses.A_BOLD if option["id"] in (selected_id, test.answer if submitted else "") else 0
        option_text = render_highlight_markers(option["ko"], f"{test.id}-option-{option['id']}", test.highlights)
        append(f"{marker} {index + 1}. {option_text}", attr)
        if submitted and option.get("zh"):
            append(option["zh"], curses.A_DIM, "    ")
        append()
    if submitted:
        correct = selected_id == test.answer
        append("答對" if correct else f"答錯，正確答案是 {test.answer}", curses.A_BOLD)
    return lines, option_rows


def _update_cached_reading_learned(uid: str, test_id: str, learned: bool) -> None:
    cached = _read_terminal_cache(uid)
    if not cached:
        return
    for container in (cached.get("readingTests") or [], (cached.get("state") or {}).get("readingTests") or []):
        for record in container:
            if str(record.get("id") or record.get("_docId") or "") == test_id:
                record["learned"] = bool(learned)
    _write_terminal_cache(uid, cached)


def _update_reading_highlights(state: Dict[str, Any], uid: str, test_id: str, highlights: List[Dict[str, Any]], update_cache: bool) -> None:
    for record in state.get("readingTests") or []:
        if str(record.get("id") or record.get("_docId") or "") == test_id:
            record["highlights"] = _clone_json(highlights)
    if not update_cache:
        return
    cached = _read_terminal_cache(uid)
    if not cached:
        return
    for container in (cached.get("readingTests") or [], (cached.get("state") or {}).get("readingTests") or []):
        for record in container:
            if str(record.get("id") or record.get("_docId") or "") == test_id:
                record["highlights"] = _clone_json(highlights)
    _write_terminal_cache(uid, cached)


def run_reading_test_detail(
    stdscr: curses.window,
    test: ReadingTest,
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    selected_index = 0
    selected_id = test.options[0]["id"]
    submitted = False
    scroll_offset = 0
    message = ""
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        content_width = max(10, width - 4)
        lines, option_rows = _reading_content_lines(test, content_width, selected_id, submitted)
        viewport_height = max(1, height - 5)
        scroll_offset = max(0, min(scroll_offset, max(0, len(lines) - viewport_height)))
        status = "已學習" if test.learned else "未學習"
        draw_line(stdscr, 0, 2, f"閱讀測驗 | {status}", curses.A_BOLD)
        controls = "↑↓=捲動 ←→=選項 Enter=作答" if not submitted else "↑↓=捲動 R=再做一次"
        draw_line(stdscr, 1, 2, f"{controls} H=劃線 E=匯出 L=已學習 Esc=返回", curses.A_DIM)
        for row, (line, attr) in enumerate(lines[scroll_offset:scroll_offset + viewport_height], 2):
            draw_line(stdscr, row, 2, line, attr)
        if message:
            draw_line(stdscr, height - 2, 2, message, curses.A_DIM)
        draw_line(stdscr, height - 1, 2, f"{scroll_offset + 1}-{min(len(lines), scroll_offset + viewport_height)}/{len(lines)}", curses.A_DIM)
        update_curses_screen(stdscr)

        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        key_text = key.lower() if isinstance(key, str) else ""
        if key in ("\x1b", 27):
            return
        if key_text == "h":
            entries = _reading_highlight_entries(test)
            def save_highlights(next_highlights):
                client.set_content_highlights(session, "readingTests", test.id, next_highlights)
                test.highlights = _clone_json(next_highlights)
                _update_reading_highlights(state, session.uid, test.id, next_highlights, not client.offline_mode)
            test.highlights = run_highlight_editor(stdscr, entries, test.highlights, save_highlights, 0)
            continue
        if key_text == "e":
            run_highlight_export(stdscr, test.highlights, _reading_highlight_entries(test))
            continue
        if key_text == "l":
            previous = test.learned
            try:
                client.set_reading_test_learned(session, test.id, not previous)
                test.learned = not previous
                for record in state.get("readingTests") or []:
                    if str(record.get("id") or record.get("_docId") or "") == test.id:
                        record["learned"] = test.learned
                if not client.offline_mode:
                    _update_cached_reading_learned(session.uid, test.id, test.learned)
                message = "已標記為已學習" if test.learned else "已取消已學習"
            except RuntimeError as exc:
                message = friendly_firebase_error(exc)
            continue
        if submitted:
            if key == curses.KEY_UP:
                scroll_offset -= 1
            elif key == curses.KEY_DOWN:
                scroll_offset += 1
            elif key in (curses.KEY_PPAGE, "4"):
                scroll_offset -= viewport_height
            elif key in (curses.KEY_NPAGE, "6"):
                scroll_offset += viewport_height
            elif key_text == "r":
                submitted = False
                selected_id = test.options[0]["id"]
                selected_index = 0
                scroll_offset = 0
                message = ""
            continue
        if key == curses.KEY_UP:
            scroll_offset -= 1
        elif key == curses.KEY_DOWN:
            scroll_offset += 1
        elif key == curses.KEY_LEFT:
            selected_index = (selected_index - 1) % len(test.options)
            selected_id = test.options[selected_index]["id"]
        elif key == curses.KEY_RIGHT:
            selected_index = (selected_index + 1) % len(test.options)
            selected_id = test.options[selected_index]["id"]
        elif isinstance(key, str) and key.isdigit() and 1 <= int(key) <= len(test.options):
            selected_index = int(key) - 1
            selected_id = test.options[selected_index]["id"]
            submitted = True
        elif key in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            selected_id = test.options[selected_index]["id"]
            submitted = True
        if key in (curses.KEY_LEFT, curses.KEY_RIGHT):
            target_row = option_rows.get(selected_id, 0)
            if target_row < scroll_offset:
                scroll_offset = target_row
            elif target_row >= scroll_offset + viewport_height:
                scroll_offset = target_row - viewport_height + 1


def run_reading_tests(
    stdscr: curses.window,
    state: Dict[str, Any],
    client: FirebaseClient,
    session: AuthSession,
) -> None:
    show_learned = False
    cursor = 0
    set_cursor_visibility(0)
    stdscr.keypad(True)
    while True:
        tests = normalize_reading_tests(state.get("readingTests") or [])
        visible = tests if show_learned else [test for test in tests if not test.learned]
        if not visible:
            action = menu(
                stdscr,
                "閱讀測驗",
                [("show", "顯示已學習題目")] if tests and not show_learned else [("back", "返回")],
                "Enter=選擇 Esc=返回",
            )
            if action == "show":
                show_learned = True
                cursor = 0
                continue
            return
        cursor = min(cursor, len(visible) - 1)
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        visible_count = max(1, height - 4)
        start = max(0, min(cursor - visible_count + 1, len(visible) - visible_count))
        draw_line(stdscr, 0, 2, f"閱讀測驗 | {len(visible)}/{len(tests)} 題", curses.A_BOLD)
        draw_line(stdscr, 1, 2, f"↑↓=移動 Enter=作答 H={'隱藏' if show_learned else '顯示'}已學習 Esc=返回", curses.A_DIM)
        for row, test in enumerate(visible[start:start + visible_count], 2):
            index = start + row - 2
            status = " [已學習]" if test.learned else ""
            label = f"閱讀題 {index + 1}{status}"
            draw_line(stdscr, row, 2, ("» " if index == cursor else "  ") + label, curses.A_BOLD if index == cursor else 0)
        draw_line(stdscr, height - 1, 2, f"{cursor + 1}/{len(visible)}", curses.A_DIM)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        key_text = key.lower() if isinstance(key, str) else ""
        if key in ("\x1b", 27):
            return
        if key == curses.KEY_UP:
            cursor = (cursor - 1) % len(visible)
        elif key == curses.KEY_DOWN:
            cursor = (cursor + 1) % len(visible)
        elif key_text == "h":
            show_learned = not show_learned
            cursor = 0
        elif key in ("\n", "\r", curses.KEY_ENTER, 10, 13):
            run_reading_test_detail(stdscr, visible[cursor], state, client, session)
            cursor = min(cursor, max(0, len(visible) - 1))



__all__ = [name for name in globals() if not name.startswith("__")]
