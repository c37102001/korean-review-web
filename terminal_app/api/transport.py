import json
import time
from typing import Any, Callable, Dict, Optional
from urllib import error, request


def http_error_message(details: str) -> str:
    try:
        payload = json.loads(details)
        return str(payload.get("error", {}).get("message") or details)
    except (json.JSONDecodeError, TypeError):
        return details or "Unknown error"


class JsonHttpTransport:
    """Small injectable JSON transport with bounded retries and token refresh."""

    def __init__(self, opener=None, sleeper: Callable[[float], None] = time.sleep) -> None:
        self._opener = opener or request.urlopen
        self._sleeper = sleeper

    def request_json(
        self,
        method: str,
        url: str,
        payload: Optional[Dict[str, Any]] = None,
        token: str = "",
        refresh: Optional[Callable[[], str]] = None,
        allow_retry: bool = True,
    ) -> Dict[str, Any]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        transient_attempt = 0
        can_refresh = bool(refresh and allow_retry)
        while True:
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            http_request = request.Request(url, method=method, headers=headers, data=body)
            try:
                with self._opener(http_request, timeout=25) as response:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw) if raw else {}
            except error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace")
                message = http_error_message(details)
                if exc.code == 401 and can_refresh:
                    can_refresh = False
                    token = refresh() or token
                    continue
                quota_exceeded = exc.code == 429 and "quota" in message.lower()
                if not quota_exceeded and exc.code in (429, 500, 502, 503, 504) and transient_attempt < 3:
                    retry_after = exc.headers.get("Retry-After") if exc.headers else None
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.5 * (2 ** transient_attempt)
                    transient_attempt += 1
                    self._sleeper(delay)
                    continue
                raise RuntimeError(f"HTTP {exc.code}: {message}") from None
            except error.URLError as exc:
                if transient_attempt < 3:
                    self._sleeper(0.5 * (2 ** transient_attempt))
                    transient_attempt += 1
                    continue
                raise RuntimeError(f"Network error: {exc.reason}") from None
