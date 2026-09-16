"""Explicit navigation results and stack for terminal screens."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Generic, List, Optional, TypeVar


class ScreenAction(str, Enum):
    STAY = "stay"
    PUSH = "push"
    BACK = "back"
    COMPLETE = "complete"
    EXIT = "exit"


T = TypeVar("T")


@dataclass(frozen=True)
class ScreenResult(Generic[T]):
    action: ScreenAction
    target: Optional[T] = None

    @classmethod
    def stay(cls) -> "ScreenResult[T]":
        return cls(ScreenAction.STAY)

    @classmethod
    def push(cls, target: T) -> "ScreenResult[T]":
        return cls(ScreenAction.PUSH, target)

    @classmethod
    def back(cls) -> "ScreenResult[T]":
        return cls(ScreenAction.BACK)

    @classmethod
    def complete(cls) -> "ScreenResult[T]":
        return cls(ScreenAction.COMPLETE)

    @classmethod
    def exit(cls) -> "ScreenResult[T]":
        return cls(ScreenAction.EXIT)


@dataclass
class NavigationStack(Generic[T]):
    """A stack where BACK always removes exactly one screen."""

    root: T
    _items: List[T] = field(init=False)

    def __post_init__(self) -> None:
        self._items = [self.root]

    @property
    def current(self) -> T:
        return self._items[-1]

    @property
    def depth(self) -> int:
        return len(self._items)

    def apply(self, result: ScreenResult[T]) -> bool:
        if result.action is ScreenAction.PUSH:
            if result.target is None:
                raise ValueError("PUSH requires a target")
            self._items.append(result.target)
        elif result.action in (ScreenAction.BACK, ScreenAction.COMPLETE):
            if len(self._items) > 1:
                self._items.pop()
        elif result.action is ScreenAction.EXIT:
            return False
        return True
