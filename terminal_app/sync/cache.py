import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Optional


def cache_path(cache_dir: Path, uid: str) -> Path:
    digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:24]
    return cache_dir / f"{digest}.json"


def write_cache(cache_dir: Path, uid: str, payload: Dict[str, Any]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_path(cache_dir, uid)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(target)


def read_cache(cache_dir: Path, uid: str) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(cache_path(cache_dir, uid).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None
