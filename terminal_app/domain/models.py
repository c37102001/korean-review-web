from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class AuthSession:
    email: str
    uid: str
    id_token: str
    refresh_token: str


@dataclass
class Card:
    id: str
    date: str
    ko: str
    zh: str
    pos: str = ""
    meanings: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    related: List[str] = field(default_factory=list)
    created_at: str = ""
    order: int = 0
    index: int = 0
    is_starred: bool = False


@dataclass
class Question:
    id: str
    item_id: str
    date: str
    kind: str
    ko: str
    zh: str
    source: Card


@dataclass
class GrammarNote:
    id: str
    title: str
    notes: str
    examples: List[Dict[str, str]]
    category: str = "grammar"
    created_at: str = ""


@dataclass
class YoutubeSubtitle:
    id: str
    title: str
    youtube_url: str
    mode: str
    entries: List[Dict[str, Any]]
    created_at: str = ""
    updated_at: str = ""


@dataclass
class ReadingTest:
    id: str
    passage: Dict[str, str]
    question: Dict[str, str]
    options: List[Dict[str, str]]
    answer: str
    learned: bool = False
    order: int = 0
    created_at: str = ""
    updated_at: str = ""


@dataclass
class PartialCheckResult:
    all_correct_prefix: bool
    wrong_raw_indices: set[int]
    missing_space_before_raw_indices: set[int]
