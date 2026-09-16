"""Terminal screen contracts.

Screen implementations are composed by ``terminal_app.app`` while navigation
and viewport behavior remain independently testable here.
"""

from .base import Screen

__all__ = ["Screen"]
