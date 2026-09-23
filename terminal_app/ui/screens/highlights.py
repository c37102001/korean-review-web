import curses
from typing import Any, Callable, Dict, List

from terminal_app.ui.clipboard import copy_to_clipboard
from terminal_app.ui.curses_helpers import draw_line, read_terminal_key, set_cursor_visibility, update_curses_screen
from terminal_app.ui.primitives import cell_width


def highlight_lines(highlights: List[Dict[str, Any]]) -> List[str]:
    return [str(item.get("text") or "").strip() for item in highlights if str(item.get("text") or "").strip()]


def render_highlight_markers(text: str, entry_id: str, highlights: List[Dict[str, Any]]) -> str:
    rendered = str(text)
    ranges = sorted(
        ((item["start"], item["end"]) for item in highlights if item.get("entryId") == entry_id),
        reverse=True,
    )
    for start, end in ranges:
        if 0 <= start < end <= len(rendered):
            rendered = f"{rendered[:start]}⟦{rendered[start:end]}⟧{rendered[end:]}"
    return rendered


def run_highlight_export(stdscr: curses.window, highlights: List[Dict[str, Any]]) -> None:
    lines = highlight_lines(highlights)
    offset = 0
    while True:
        stdscr.erase()
        height, _ = stdscr.getmaxyx()
        draw_line(stdscr, 0, 2, f"匯出劃線 | {len(lines)} 筆", curses.A_BOLD)
        draw_line(stdscr, 1, 2, "↑↓=捲動 C=複製 Esc=返回", curses.A_DIM)
        visible = max(1, height - 4)
        offset = max(0, min(offset, max(0, len(lines) - visible)))
        if not lines:
            draw_line(stdscr, 3, 2, "目前沒有劃線內容。", curses.A_DIM)
        for row, line in enumerate(lines[offset:offset + visible], 2):
            draw_line(stdscr, row, 2, line)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key in ("\x1b", 27):
            return
        if key == curses.KEY_UP:
            offset -= 1
        elif key == curses.KEY_DOWN:
            offset += 1
        elif isinstance(key, str) and key.lower() == "c":
            copied = bool(lines) and copy_to_clipboard("\n".join(lines))
            draw_line(stdscr, height - 1, 2, "已複製劃線。" if copied else "無法存取系統剪貼簿。", curses.A_BOLD)
            update_curses_screen(stdscr)
            curses.napms(900)


def run_highlight_editor(
    stdscr: curses.window,
    entries: List[Dict[str, str]],
    highlights: List[Dict[str, Any]],
    save: Callable[[List[Dict[str, Any]]], None],
    initial_index: int = 0,
) -> List[Dict[str, Any]]:
    if not entries:
        return highlights
    entry_index = max(0, min(initial_index, len(entries) - 1))
    cursor = 0
    anchor = None
    message = ""
    set_cursor_visibility(0)
    while True:
        entry = entries[entry_index]
        text = str(entry.get("ko") or "")
        cursor = max(0, min(cursor, max(0, len(text) - 1)))
        selected_start = min(anchor, cursor) if anchor is not None else None
        selected_end = max(anchor, cursor) + 1 if anchor is not None else None
        entry_highlights = [item for item in highlights if item.get("entryId") == entry.get("id")]
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        draw_line(stdscr, 0, 2, f"劃線 | {entry_index + 1}/{len(entries)}", curses.A_BOLD)
        draw_line(stdscr, 1, 2, "↑↓=切換段落 ←→=移動/調整 Space=開始/儲存 D=刪除 E=匯出 Esc=返回", curses.A_DIM)
        x, y = 2, 3
        max_x = max(4, width - 2)
        for index, character in enumerate(text):
            character_width = cell_width(character)
            if x + character_width >= max_x:
                y += 1
                x = 2
            if y >= height - 2:
                break
            attr = 0
            if any(item["start"] <= index < item["end"] for item in entry_highlights):
                attr |= curses.A_UNDERLINE
            if selected_start is not None and selected_start <= index < selected_end:
                attr |= curses.A_REVERSE
            elif index == cursor:
                attr |= curses.A_STANDOUT
            draw_line(stdscr, y, x, character, attr)
            x += character_width
        if message:
            draw_line(stdscr, height - 1, 2, message, curses.A_DIM)
        update_curses_screen(stdscr)
        key = read_terminal_key(stdscr, wide=True)
        if isinstance(key, int) and 0 <= key <= 255:
            key = chr(key)
        if key in ("\x1b", 27):
            return highlights
        if key == curses.KEY_UP:
            entry_index = (entry_index - 1) % len(entries)
            cursor, anchor = 0, None
        elif key == curses.KEY_DOWN:
            entry_index = (entry_index + 1) % len(entries)
            cursor, anchor = 0, None
        elif key == curses.KEY_LEFT:
            cursor = max(0, cursor - 1)
        elif key == curses.KEY_RIGHT:
            cursor = min(max(0, len(text) - 1), cursor + 1)
        elif key == " ":
            if not text:
                continue
            if anchor is None:
                anchor = cursor
                message = "已開始選取；用左右鍵調整，再按 Space 儲存。"
                continue
            start, end = min(anchor, cursor), max(anchor, cursor) + 1
            candidate = {"id": f"terminal-{entry['id']}-{start}-{end}", "entryId": entry["id"], "text": text[start:end], "start": start, "end": end}
            if not any(item.get("entryId") == entry["id"] and item.get("start") == start and item.get("end") == end for item in highlights):
                next_highlights = [*highlights, candidate]
                try:
                    save(next_highlights)
                    highlights = next_highlights
                    message = f"已儲存劃線：{candidate['text']}"
                except RuntimeError as exc:
                    message = str(exc)
            anchor = None
        elif isinstance(key, str) and key.lower() == "d":
            target = next((item for item in entry_highlights if item["start"] <= cursor < item["end"]), None)
            if target:
                next_highlights = [item for item in highlights if item.get("id") != target.get("id")]
                try:
                    save(next_highlights)
                    highlights = next_highlights
                    message = f"已刪除劃線：{target['text']}"
                except RuntimeError as exc:
                    message = str(exc)
            else:
                message = "游標位置沒有劃線。"
        elif isinstance(key, str) and key.lower() == "e":
            run_highlight_export(stdscr, highlights)


__all__ = [name for name in globals() if not name.startswith("__")]
