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

// iOS PWA (standalone mode) blocks window.open(), so signInWithPopup silently
// fails — the popup opens in a separate Safari tab that never resolves the
// Promise. Must use redirect instead.
function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

export async function signInWithGoogle() {
  if (isIOSPWA()) {
    return signInWithRedirect(auth, provider);
  }
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

// Called once on every page load, BEFORE onAuthStateChanged is registered.
// Processes any pending redirect result and clears stale redirect state.
// All errors are swallowed — never drive UI from this function's errors.
export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult (stale/irrelevant):', e.code);
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
