import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyD2a3pxKZAsJwr8dadPz0xbGe9m4KWrfHQ",
  authDomain: "yonke-uhambo.web.app",
  projectId: "yonke-uhambo",
  storageBucket: "yonke-uhambo.firebasestorage.app",
  messagingSenderId: "1093456667640",
  appId: "1:1093456667640:web:58a05cb3ff9e5525536c0d"
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const auth = getAuth(app);
