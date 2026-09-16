from datetime import datetime
from typing import Any, Dict, Iterable, List, Tuple

from .models import Card, GrammarNote, Question, YoutubeSubtitle


def item_zh(item: Dict[str, Any]) -> str:
    return "；".join(str(meaning.get("zh", "")).strip() for meaning in item.get("meanings", []) if meaning.get("zh"))


def record_order(record: Dict[str, Any]) -> int:
    value = record.get("order")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    try:
        return int(datetime.fromisoformat(str(record.get("createdAt", "")).replace("Z", "+00:00")).timestamp() * 1_000_000)
    except ValueError:
        return 0


def order_questions(questions: Iterable[Question]) -> List[Question]:
    rank = {"term": 0, "example": 1}
    return sorted(questions, key=lambda question: (rank.get(question.kind, 99), question.date, question.source.index, question.id))


def normalize_records(records: List[Dict[str, Any]], state: Dict[str, Any]) -> Tuple[List[Card], List[Question]]:
    starred = set(state.get("starred") or [])
    cards: List[Card] = []
    questions: List[Question] = []
    for index, record in enumerate(records):
        item = record.get("item", {}) or {}
        record_id = record.get("id") or record.get("_docId")
        record_date = record.get("date")
        if not record_id or not record_date:
            raise ValueError(f"Record {index + 1} is missing its required id or date")
        meanings = item.get("meanings", []) or []
        card = Card(
            id=record_id,
            date=record_date,
            ko=str(item.get("ko", "")).strip(),
            zh=item_zh(item),
            pos=str(item.get("pos", "")).strip(),
            meanings=meanings,
            notes=[str(note) for note in (item.get("notes", []) or [])],
            related=[str(entry) for entry in (item.get("related", []) or [])],
            created_at=str(record.get("createdAt", "")),
            order=record_order(record),
            index=index,
            is_starred=record_id in starred,
        )
        if not card.ko:
            continue
        cards.append(card)
        questions.append(Question(card.id, card.id, card.date, "term", card.ko, card.zh, card))
        for meaning in meanings:
            for example_index, example in enumerate(meaning.get("examples", []) or []):
                ko = str(example.get("ko", "")).strip()
                zh = str(example.get("zh", "")).strip()
                if not ko or not zh:
                    continue
                question_id = str(example.get("id") or f"{card.id}-{meaning.get('id', 'meaning')}-ex-{example_index}")
                questions.append(Question(question_id, card.id, card.date, "example", ko, zh, card))
    cards.sort(key=lambda card: (card.date, card.order, card.id))
    for index, card in enumerate(cards):
        card.index = index
    return cards, order_questions(questions)


def normalize_grammar_notes(records: List[Dict[str, Any]]) -> List[GrammarNote]:
    notes: List[GrammarNote] = []
    for record in records:
        note_id = str(record.get("id") or record.get("_docId") or "")
        title = str(record.get("title") or "").strip()
        if not note_id or not title:
            continue
        examples = []
        for example in record.get("examples") or []:
            ko = str(example.get("ko") or "").strip()
            zh = str(example.get("zh") or "").strip()
            if ko and zh:
                examples.append({"id": str(example.get("id") or f"{note_id}-example-{len(examples)}"), "ko": ko, "zh": zh})
        notes.append(GrammarNote(
            id=note_id,
            title=title,
            notes=str(record.get("notes") or "").strip(),
            examples=examples,
            category="vocabulary" if record.get("category") == "vocabulary" else "grammar",
            created_at=str(record.get("createdAt") or ""),
        ))
    return sorted(notes, key=lambda note: (note.created_at, note.id))


def normalize_youtube_subtitles(records: List[Dict[str, Any]]) -> List[YoutubeSubtitle]:
    subtitles: List[YoutubeSubtitle] = []
    for record in records:
        subtitle_id = str(record.get("id") or record.get("_docId") or "")
        title = str(record.get("title") or "").strip()
        if not subtitle_id or not title:
            continue
        entries = []
        for index, entry in enumerate(record.get("entries") or []):
            ko = str(entry.get("ko") or "").strip()
            zh = str(entry.get("zh") or "").strip()
            if not ko or not zh:
                continue
            start_ms = entry.get("startMs")
            end_ms = entry.get("endMs")
            entries.append({
                "id": str(entry.get("id") or f"{subtitle_id}-entry-{index}"),
                "ko": ko,
                "zh": zh,
                "startMs": int(start_ms) if isinstance(start_ms, (int, float)) else None,
                "endMs": int(end_ms) if isinstance(end_ms, (int, float)) else None,
            })
        subtitles.append(YoutubeSubtitle(
            id=subtitle_id,
            title=title,
            youtube_url=str(record.get("youtubeUrl") or "").strip(),
            mode="srt" if record.get("mode") == "srt" else "json",
            entries=entries,
            created_at=str(record.get("createdAt") or ""),
            updated_at=str(record.get("updatedAt") or ""),
        ))
    return sorted(subtitles, key=lambda subtitle: (subtitle.updated_at or subtitle.created_at, subtitle.title, subtitle.id), reverse=True)
