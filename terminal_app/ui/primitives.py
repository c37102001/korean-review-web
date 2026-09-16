import unicodedata
from typing import List


def cell_width(character: str) -> int:
    if unicodedata.combining(character):
        return 0
    return 2 if unicodedata.east_asian_width(character) in ("W", "F") else 1


def text_cell_width(text: str) -> int:
    return sum(cell_width(character) for character in text)


def split_by_cell_width(text: str, max_cells: int) -> List[str]:
    max_cells = max(1, max_cells)
    lines: List[str] = []
    current: List[str] = []
    current_width = 0
    for character in str(text):
        if character == "\n":
            lines.append("".join(current))
            current = []
            current_width = 0
            continue
        char_width = cell_width(character)
        if current and current_width + char_width > max_cells:
            lines.append("".join(current))
            current = []
            current_width = 0
        current.append(character)
        current_width += char_width
    lines.append("".join(current))
    return lines or [""]
