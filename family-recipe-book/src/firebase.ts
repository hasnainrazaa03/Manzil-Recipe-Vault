import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// A missing config produces an opaque Firebase error deep inside a sign-in call;
// saying so at boot is far easier to act on.
if (!firebaseConfig.apiKey && import.meta.env.MODE !== 'test') {
  console.error(
    'Firebase is not configured. Copy .env.example to .env and fill in the VITE_FIREBASE_* values.',
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
