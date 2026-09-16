"""Protocol implemented by stack-driven terminal screens."""

from typing import Any, Protocol

from terminal_app.ui.navigation import ScreenResult


class Screen(Protocol):
    def handle_key(self, key: Any) -> ScreenResult["Screen"]: ...

    def draw(self, window: Any) -> None: ...
