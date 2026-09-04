import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
  authDomain: 'korean-review-web.firebaseapp.com',
  projectId: 'korean-review-web',
  storageBucket: 'korean-review-web.firebasestorage.app',
  messagingSenderId: '340404658075',
  appId: '1:340404658075:web:cf77a3d166613cba930b3e',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Reuse the same IndexedDB-backed cache across browser tabs to avoid re-reading
// the complete notebook whenever this trusted-device app is reopened.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
