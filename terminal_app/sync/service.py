from typing import Any, Callable, Dict, Optional, Tuple


class TerminalSyncService:
    """Coordinates cache-first loading without knowing Firestore or UI details."""

    def __init__(
        self,
        sync_version: int,
        read_cache: Callable[[str], Optional[Dict[str, Any]]],
        hydrate: Callable[..., tuple],
        quota_error: Callable[[str], bool],
    ) -> None:
        self.sync_version = sync_version
        self.read_cache = read_cache
        self.hydrate = hydrate
        self.quota_error = quota_error

    def load(
        self,
        client,
        session,
        cached: Optional[Dict[str, Any]],
        full_loader: Callable[[], tuple],
        incremental_loader: Callable[[Dict[str, Any]], tuple],
    ) -> Tuple[tuple, bool]:
        if client.offline_mode:
            payload = client.offline_payload or cached or self.read_cache(session.uid)
            if not payload:
                raise RuntimeError('此帳號沒有本機備份，請先連線載入一次')
            client.start_offline(session, payload)
            loaded = self.hydrate(client, session, client.offline_payload, ensure_system_folders=False)
            client._saved_state = loaded[0]
            return loaded, True

        try:
            sync = cached.get("sync") if cached else None
            loaded = (
                incremental_loader(cached)
                if sync and sync.get("version") == self.sync_version
                else full_loader()
            )
        except RuntimeError as exc:
            message = str(exc)
            if not self.quota_error(message) and 'Network error' not in message:
                raise
            payload = self.read_cache(session.uid)
            if payload is None:
                raise
            client.start_offline(session, payload)
            loaded = self.hydrate(client, session, client.offline_payload, ensure_system_folders=False)
            client._saved_state = loaded[0]
            return loaded, True
        client.offline_mode = False
        return loaded, False
