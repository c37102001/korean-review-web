"""Terminal text appearance preferences shared by every screen."""

from __future__ import annotations

import curses
import hashlib
import json
from pathlib import Path
from typing import Any


TEXT_STYLE_NORMAL = "normal"
TEXT_STYLE_DIM = "dim"
TEXT_STYLE_OPTIONS = {TEXT_STYLE_NORMAL, TEXT_STYLE_DIM}

_text_style = TEXT_STYLE_NORMAL


def normalize_text_style(value: Any) -> str:
    return value if value in TEXT_STYLE_OPTIONS else TEXT_STYLE_NORMAL


def get_text_style() -> str:
    return _text_style


def set_text_style(value: Any) -> str:
    global _text_style
    _text_style = normalize_text_style(value)
    return _text_style


def apply_text_style(attr: int = 0) -> int:
    if _text_style != TEXT_STYLE_DIM:
        return attr
    return (attr & ~curses.A_BOLD) | curses.A_DIM


def preference_path(cache_dir: Path, uid: str) -> Path:
    account_key = hashlib.sha256(str(uid).encode("utf-8")).hexdigest()[:24]
    return Path(cache_dir) / f"preferences-{account_key}.json"


def load_text_style(cache_dir: Path, uid: str) -> str:
    path = preference_path(cache_dir, uid)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        payload = {}
    return set_text_style(payload.get("textStyle"))


def save_text_style(cache_dir: Path, uid: str, value: Any) -> str:
    style = set_text_style(value)
    path = preference_path(cache_dir, uid)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"schemaVersion": 1, "textStyle": style}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)
    return style
