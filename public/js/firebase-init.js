import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyD2a3pxKZAsJwr8dadPz0xbGe9m4KWrfHQ",
  authDomain: "yonke-uhambo.firebaseapp.com",
  projectId: "yonke-uhambo",
  storageBucket: "yonke-uhambo.firebasestorage.app",
  messagingSenderId: "1093456667640",
  appId: "1:1093456667640:web:58a05cb3ff9e5525536c0d"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
