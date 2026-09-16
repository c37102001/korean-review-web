from datetime import datetime
from typing import Any, Dict, List


def active_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [record for record in records if not record.get("deletedAt")]


def latest_updated_at(records: List[Dict[str, Any]], fallback: str = "") -> str:
    values = [fallback, *(str(record.get("updatedAt") or "") for record in records)]

    def timestamp(value: str) -> float:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return float("-inf")

    return max(values, key=timestamp)


def merge_record_changes(records: List[Dict[str, Any]], changes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_id = {
        str(record.get("id") or record.get("_docId")): record
        for record in active_records(records)
        if record.get("id") or record.get("_docId")
    }
    for change in changes:
        record_id = str(change.get("id") or change.get("_docId") or "")
        if not record_id:
            continue
        if change.get("deletedAt"):
            by_id.pop(record_id, None)
        else:
            by_id[record_id] = change
    return list(by_id.values())
