"""Compatibility exports for content-oriented terminal screens."""

from .notes import *
from .reading import *
from .subtitles import *

__all__ = [name for name in globals() if not name.startswith("__")]
