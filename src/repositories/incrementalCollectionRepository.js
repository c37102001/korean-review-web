import {
  collection,
  getDocsFromCache,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';

import {
  activeCollectionDocuments,
  collectionSyncCheckpoint,
  mergeCollectionDocuments,
  updateCollectionSyncCheckpoint,
} from '../firestoreSync.js';
import { markOfflineSectionReady } from '../offlineSupport.js';

export function subscribeToIncrementalCollection({
  db,
  uid,
  collectionName,
  section = collectionName,
  onData,
  onError,
}) {
  let cancelled = false;
  let unsubscribe = () => {};
  let documents = [];

  const applySnapshot = (snapshot, incremental) => {
    documents = incremental
      ? mergeCollectionDocuments(documents, snapshot.docs)
      : activeCollectionDocuments(snapshot.docs);
    onData(documents, snapshot.metadata);
  };

  const start = async () => {
    const reference = collection(db, 'users', uid, collectionName);
    const checkpoint = collectionSyncCheckpoint(uid, collectionName);
    let incremental = false;

    if (checkpoint) {
      try {
        const cachedSnapshot = await getDocsFromCache(reference);
        if (cachedSnapshot.size) {
          documents = activeCollectionDocuments(cachedSnapshot.docs);
          onData(documents, cachedSnapshot.metadata);
          incremental = true;
        }
      } catch {
        // A missing or evicted baseline must be rebuilt from the server.
      }
    }
    if (cancelled) return;

    const target = incremental
      ? query(reference, where('updatedAt', '>', new Timestamp(checkpoint.seconds, checkpoint.nanoseconds)))
      : reference;
    unsubscribe = onSnapshot(target, { includeMetadataChanges: true }, (snapshot) => {
      if (cancelled) return;
      applySnapshot(snapshot, incremental);
      if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
        markOfflineSectionReady(uid, section);
        updateCollectionSyncCheckpoint(uid, collectionName, snapshot.docs);
      }
    }, (error) => {
      if (!cancelled) onError(error);
    });
  };

  start().catch((error) => {
    if (!cancelled) onError(error);
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}
