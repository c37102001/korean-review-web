import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Firebase Web config is not a secret — access is controlled by Firestore
// security rules + Auth, not by hiding these values. Safe to commit.
// Replace these placeholder values with your own project's config
// (Firebase Console → Project settings → General → Your apps → SDK setup).
const firebaseConfig = {
  apiKey: 'AIzaSyCfy63R72H6LDCb-bR7L7RwkKNnGCTHPgU',
  authDomain: 'korean-review-web.firebaseapp.com',
  projectId: 'korean-review-web',
  storageBucket: 'korean-review-web.firebasestorage.app',
  messagingSenderId: '340404658075',
  appId: '1:340404658075:web:cf77a3d166613cba930b3e',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
