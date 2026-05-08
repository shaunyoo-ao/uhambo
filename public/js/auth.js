import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'firebase/auth';

const ALLOWED = ['yooyoopd@gmail.com', '2yeonsoo@gmail.com'];

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Redirect-based sign-in — works reliably on mobile/PWA standalone mode
export function signInWithGoogle() {
  return signInWithRedirect(auth, provider);
}

// Must be called on every page load to capture the result after redirect
export async function handleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    return result; // null if no pending redirect
  } catch (e) {
    console.error('Redirect result error:', e);
    throw e;
  }
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
