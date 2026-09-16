import { writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  isBrowserOffline,
  queueOfflineWrite,
  trackOfflineWrite,
} from '../offlineSupport.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let writesBlockedUntil = 0;
let quotaError = null;

function isFirestoreQuotaExceeded(error) {
  return /quota exceeded/i.test(error?.message || '');
}

export function isTransientFirestoreError(error) {
  if (isFirestoreQuotaExceeded(error)) return false;
  const code = String(error?.code || '').replace(/^firestore\//, '');
  return ['aborted', 'deadline-exceeded', 'resource-exhausted', 'unavailable'].includes(code)
    || /quota|too many requests|temporar|network|offline/i.test(error?.message || '');
}

export async function retryFirestoreWrite(operation, maxAttempts = 4) {
  if (isBrowserOffline()) return queueOfflineWrite(operation, 'Firebase 資料');
  if (Date.now() < writesBlockedUntil && quotaError) throw quotaError;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let timeoutId;
    try {
      const pendingWrite = Promise.resolve().then(operation);
      const result = await Promise.race([
        pendingWrite,
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ timedOut: true }), 8000);
        }),
      ]);
      if (result?.timedOut) return trackOfflineWrite(pendingWrite, 'Firebase 資料');
      writesBlockedUntil = 0;
      quotaError = null;
      return result;
    } catch (error) {
      lastError = error;
      if (isFirestoreQuotaExceeded(error)) {
        writesBlockedUntil = Date.now() + 60_000;
        quotaError = error;
        throw error;
      }
      if (!isTransientFirestoreError(error) || attempt === maxAttempts) throw error;
      await wait(500 * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

export async function commitFirestoreOperations(operations, chunkSize = 400) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const chunk = operations.slice(start, start + chunkSize);
    await retryFirestoreWrite(async () => {
      const batch = writeBatch(db);
      chunk.forEach((operation) => operation(batch));
      await batch.commit();
    });
  }
}
