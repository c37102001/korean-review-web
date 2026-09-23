
from terminal_app.runtime import *
from terminal_app.ui.theme import apply_text_style

_cursor_visibility = 1

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
        stdscr.addstr(y, start_x, clipped, apply_text_style(attr))
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


def clear_with_default_background(stdscr: curses.window) -> None:
    """Clear attributes inherited from the previously highlighted menu row."""
    try:
        stdscr.attrset(curses.A_NORMAL)
        stdscr.bkgdset(" ", curses.A_NORMAL)
    except curses.error:
        pass
    stdscr.erase()


def initialize_terminal_appearance(stdscr: curses.window) -> None:
    """Use the terminal's own background instead of curses' ANSI black."""
    if curses.has_colors():
        try:
            curses.start_color()
            curses.use_default_colors()
        except curses.error:
            pass
    clear_with_default_background(stdscr)


def set_cursor_visibility(visibility: int) -> int:
    global _cursor_visibility
    _cursor_visibility = visibility
    try:
        return curses.curs_set(visibility)
    except curses.error:
        return 0


def _is_character_key(key: Any, character: str) -> bool:
    return key == character if isinstance(key, str) else key == ord(character)


def _hide_terminal_until_toggled(stdscr: curses.window, *, wide: bool) -> None:
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    stdscr.timeout(-1)
    while True:
        clear_with_default_background(stdscr)
        stdscr.refresh()
        key = stdscr.get_wch() if wide else stdscr.getch()
        if _is_character_key(key, "3"):
            break
    try:
        curses.curs_set(_cursor_visibility)
    except curses.error:
        pass


def read_terminal_key(stdscr: curses.window, *, wide: bool = False) -> Any:
    key = stdscr.get_wch() if wide else stdscr.getch()
    stop_korean_speech()
    if _is_character_key(key, "3"):
        _hide_terminal_until_toggled(stdscr, wide=wide)
        return curses.KEY_RESIZE
    if _is_character_key(key, "."):
        enabled = toggle_auto_audio_enabled()
        height, width = stdscr.getmaxyx()
        status = f"自動播放語音：{'開啟' if enabled else '關閉'}"
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


def read_terminal_key_after_speech(
    stdscr: curses.window,
    trailing_delay_ms: int,
    *,
    wide: bool = False,
) -> Any:
    """Keep accepting cancellation keys while speech plays, then apply the card delay."""
    while is_korean_speech_playing():
        key = read_terminal_key_with_timeout(stdscr, 50, wide=wide)
        if key is not None:
            return key
    return read_terminal_key_with_timeout(stdscr, trailing_delay_ms, wide=wide)


def auto_audio_control_label() -> str:
    return f".=自動語音:{'開' if is_auto_audio_enabled() else '關'}"


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
            attr = curses.A_BOLD if option_index == selected else curses.A_NORMAL
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
            draw_line(stdscr, row, 2, ("» " if index == cursor else "  ") + f"{marker} {label}", curses.A_BOLD if index == cursor else 0)
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
            draw_line(stdscr, screen_row, 2, ("» " if index == cursor else "  ") + label, curses.A_BOLD if index == cursor else 0)
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



__all__ = [name for name in globals() if not name.startswith("__")]
