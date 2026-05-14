import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  signInAnonymously as fbSignInAnon,
  onAuthStateChanged
} from 'firebase/auth';

const ALLOWED = ['yooyoopd@gmail.com', '2yeonsoo@gmail.com'];

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function log(msg) {
  if (window._alog) window._alog(msg);
  else console.log('[auth]', msg);
}

// iOS PWA (standalone mode) blocks window.open(), so signInWithPopup silently
// fails — the popup opens in a separate Safari tab that never resolves the
// Promise. Must use redirect instead.
function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

export async function signInWithGoogle() {
  const iosPWA = isIOSPWA();
  log('signInWithGoogle() — isIOSPWA=' + iosPWA + ' userAgent=' + navigator.userAgent.slice(0, 80));
  if (iosPWA) {
    log('iOS PWA detected → signInWithRedirect');
    return signInWithRedirect(auth, provider);
  }
  log('attempting signInWithPopup...');
  try {
    const result = await signInWithPopup(auth, provider);
    log('signInWithPopup SUCCESS — ' + result.user.email);
    return result;
  } catch (e) {
    log('signInWithPopup ERROR: ' + e.code + ' — ' + e.message);
    if (e.code === 'auth/popup-blocked') {
      log('popup blocked → falling back to signInWithRedirect');
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export async function signInAnonymously() {
  log('signInAnonymously()');
  return fbSignInAnon(auth);
}

// Called once on every page load, BEFORE onAuthStateChanged is registered.
// Processes any pending redirect result and clears stale redirect state.
// All errors are swallowed — never drive UI from this function's errors.
export async function handleRedirectResult() {
  log('getRedirectResult() called...');
  try {
    const result = await getRedirectResult(auth);
    log('getRedirectResult() → ' + (result ? result.user.email : 'null'));
    return result;
  } catch (e) {
    log('getRedirectResult() ERROR (swallowed): ' + e.code + ' — ' + e.message);
    return null;
  }
}

export function signOut() {
  return fbSignOut(auth);
}

export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, user => {
    // Allow anonymous users through — guest mode verification happens in app.js
    if (user && user.isAnonymous) {
      log('onAuthStateChanged → anonymous guest');
      callback(user, null);
      return;
    }
    if (user && !ALLOWED.includes(user.email)) {
      log('onAuthStateChanged → ' + user.email + ' NOT in allowlist → signing out');
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
