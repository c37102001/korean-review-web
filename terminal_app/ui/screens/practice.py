"""Compatibility exports for practice and recognition screens."""

from .practice_session import *
from .recognition import *

__all__ = [name for name in globals() if not name.startswith("__")]
