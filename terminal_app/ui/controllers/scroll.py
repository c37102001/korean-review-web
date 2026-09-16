"""Viewport-independent scrolling state shared by terminal screens."""

from dataclasses import dataclass


@dataclass
class ScrollModel:
    offset: int = 0

    def clamp(self, content_height: int, viewport_height: int) -> int:
        self.offset = min(max(0, self.offset), max(0, content_height - viewport_height))
        return self.offset

    def move(self, delta: int, content_height: int, viewport_height: int) -> int:
        self.offset += delta
        return self.clamp(content_height, viewport_height)

    def reset(self) -> None:
        self.offset = 0
