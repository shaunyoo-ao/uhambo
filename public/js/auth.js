import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'firebase/auth';

const ALLOWED = ['yooyoopd@gmail.com', '2yeonsoo@gmail.com'];

const provider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, user => {
    if (user && !ALLOWED.includes(user.email)) {
      fbSignOut(auth);
      callback(null, 'access_denied');
      return;
    }
    callback(user, null);
  });
}

export function getCurrentUser() {
  return auth.currentUser;
}
