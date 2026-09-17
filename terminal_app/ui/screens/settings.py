"""Terminal-local appearance settings screen."""

from __future__ import annotations

import curses
from pathlib import Path

from terminal_app.ui.curses_helpers import menu
from terminal_app.ui.theme import (
    TEXT_STYLE_DIM,
    TEXT_STYLE_NORMAL,
    get_text_style,
    save_text_style,
)


def run_terminal_settings(stdscr: curses.window, cache_dir: Path, uid: str) -> None:
    while True:
        current = get_text_style()
        choice = menu(
            stdscr,
            "設定 | 字體顏色",
            [
                (TEXT_STYLE_NORMAL, f"{'●' if current == TEXT_STYLE_NORMAL else '○'} 正常"),
                (TEXT_STYLE_DIM, f"{'●' if current == TEXT_STYLE_DIM else '○'} 灰色"),
            ],
            "↑↓=移動 Enter=套用 Esc=返回",
        )
        if choice is None:
            return
        save_text_style(cache_dir, uid, choice)
