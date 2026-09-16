from typing import Any, Dict, List

from terminal_app.api.firestore_codec import document_id, parse_fields


class FirestoreCollectionRepository:
    """Maps Firestore REST documents into stable domain dictionaries."""

    def __init__(self, client, collection_id: str) -> None:
        self.client = client
        self.collection_id = collection_id

    @staticmethod
    def decode(document: Dict[str, Any]) -> Dict[str, Any]:
        doc_id = document_id(document.get("name", ""))
        return parse_fields(document.get("fields", {})) | {"id": doc_id, "_docId": doc_id}

    def list_all(self, session) -> List[Dict[str, Any]]:
        documents = self.client._list_documents(["users", session.uid, self.collection_id], session)
        return [self.decode(document) for document in documents]

    def updated_since(self, session, updated_at: str) -> List[Dict[str, Any]]:
        return self.client._list_documents_updated_since(session, self.collection_id, updated_at)
