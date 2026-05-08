import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'firebase/auth';

const ALLOWED = ['yooyoopd@gmail.com', '2yeonsoo@gmail.com'];

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  try {
    // Popup works on all modern browsers when triggered by user gesture
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // Only fall back to redirect if popup is explicitly blocked by the browser
    if (e.code === 'auth/popup-blocked') {
      sessionStorage.setItem('pendingRedirect', '1');
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

// Called on every page load — clears any stale redirect state silently
export async function handleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    sessionStorage.removeItem('pendingRedirect');
    return result;
  } catch (e) {
    // Swallow — stale redirect errors must not affect app startup
    console.warn('[auth] getRedirectResult error (stale or irrelevant):', e.code);
    sessionStorage.removeItem('pendingRedirect');
    return null;
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
