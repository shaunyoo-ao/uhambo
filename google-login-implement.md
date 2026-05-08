# Firebase Google Sign-In — Definitive Implementation Guide

> Compiled from repeated real-world debugging on Firebase Hosting + Vanilla JS PWAs.
> Follow this guide to implement Google auth once, correctly, without loop bugs.

---

## The 3 Bugs That Cause "Login Loop"

Every time this goes wrong, one or more of these three bugs is responsible.

### Bug 1 — `getRedirectResult` error triggers `showLogin()` after `initApp`

```javascript
// ❌ WRONG — causes login screen to flash back even after successful sign-in
handleRedirectResult().catch(e => {
  showToast(e.message);
  showLogin();  // ← fires AFTER initApp's hideLogin(), overriding it
});
```

Firebase persists redirect errors in IndexedDB. If a previous redirect failed, **every subsequent page load** calls `getRedirectResult`, which throws the stale error, which calls `showLogin()` — even if the user is already authenticated.

```javascript
// ✅ CORRECT — swallow ALL errors silently, let onAuthStateChanged drive the UI
handleRedirectResult().catch(e => {
  console.warn('[auth] getRedirectResult error (stale/irrelevant):', e.code);
  // Do NOT call showLogin() here
});
```

---

### Bug 2 — `onAuthStateChanged(null)` shows login screen even after app is running

```javascript
// ❌ WRONG — any transient null auth state re-shows the login screen
onAuthStateChanged(auth, user => {
  if (!user) {
    showLogin();  // ← runs even if the app has been initialized
    return;
  }
  initApp(user);
});
```

`onAuthStateChanged` can fire `null` during token refresh, brief SDK resets, or after a `signOut` that wasn't explicit. Once the app is running, a null firing must not log the user out unexpectedly.

```javascript
// ✅ CORRECT — guard with _appInitialized flag
let _appInitialized = false;

onAuthStateChanged(auth, user => {
  if (!user) {
    if (!_appInitialized) {     // only show login before app has ever started
      showLogin();
    }
    return;
  }
  if (_appInitialized) return;  // ignore re-fires once running
  _appInitialized = true;
  initApp(user);
});
```

To handle explicit sign-out, reset the flag and reload:
```javascript
async function doSignOut() {
  _appInitialized = false;
  await signOut(auth);
  location.reload();
}
```

---

### Bug 3 — `signInWithRedirect` breaks on Chrome 115+ / Safari 17+

Chrome 115 and Safari 17 introduced **storage partitioning**: cross-origin
`localStorage` and `IndexedDB` are isolated per top-level frame. Firebase's
redirect flow stores auth state while on `firebaseapp.com`, then tries to read
it back when the browser returns to `web.app`. The isolation breaks this read,
so `getRedirectResult` returns `null` or throws — the user is never authenticated.

```javascript
// ❌ WRONG — breaks silently on modern browsers
export function signInWithGoogle() {
  return signInWithRedirect(auth, provider);
}
```

```javascript
// ✅ CORRECT — popup is not affected by storage partitioning
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') {
      // Only use redirect when the browser explicitly blocks the popup
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
```

---

## Complete Reference Implementation

### `firebase-init.js`

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = { /* your config */ };
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

---

### `auth.js`

```javascript
import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth';

const ALLOWED_EMAILS = ['user1@example.com', 'user2@example.com'];

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Primary: popup. Redirect only if popup is explicitly blocked.
export async function signInWithGoogle() {
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

// Must be called on every page load.
// Silently clears any stale redirect state — NEVER drives UI from its errors.
export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult (stale):', e.code);
    return null;
  }
}

export function signOut() {
  return fbSignOut(auth);
}

// Wraps onAuthStateChanged with email-whitelist check.
export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, user => {
    if (user && !ALLOWED_EMAILS.includes(user.email)) {
      fbSignOut(auth);
      callback(null, 'access_denied');
      return;
    }
    callback(user, null);
  });
}
```

---

### `app.js` — Bootstrap Section

```javascript
import { signInWithGoogle, handleRedirectResult, signOut, onAuthStateChange } from './auth.js';

let _appInitialized = false;

// ── Login button ─────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Opening Google Sign-In…';
  try {
    await signInWithGoogle();
    // On popup success: onAuthStateChanged fires → initApp.
    // On redirect: page navigates away, nothing more to do here.
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    if (e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') {
      return; // user closed popup — silent
    }
    showToast('Sign-in failed (' + (e.code || 'unknown') + ')');
    console.error('[auth] signInWithGoogle:', e.code, e.message);
  }
});

// ── Clear stale redirect state on every page load ─────────────────
// Do NOT chain .catch(showLogin) — see Bug 1 above.
handleRedirectResult();

// ── Auth state driver ─────────────────────────────────────────────
onAuthStateChange((user, err) => {
  if (err === 'access_denied') {
    _appInitialized = false;
    showLogin();
    showToast('Access denied.');
    return;
  }
  if (!user) {
    if (!_appInitialized) showLogin(); // only before first login
    return;
  }
  if (_appInitialized) return;
  _appInitialized = true;
  initApp(user);
});

// ── Sign-out ──────────────────────────────────────────────────────
async function doSignOut() {
  _appInitialized = false; // allow login screen on next null fire
  await signOut();
  location.reload();       // cleanest: full reset
}
```

---

## Firebase Console Checklist

Before testing, verify in Firebase Console:

1. **Authentication → Sign-in method → Google**: Enabled
2. **Authentication → Settings → Authorized domains**: must include  
   - `localhost` (for local dev)  
   - `your-project.web.app`  
   - `your-project.firebaseapp.com`  
   - Any custom domain
3. **Firestore → Rules**: deployed and correct (run `firebase deploy --only firestore:rules`)
4. **OAuth consent screen** (Google Cloud Console): app is not in test mode if adding new users

---

## importmap for Firebase v10 ESM (no bundler)

```html
<script type="importmap">
{
  "imports": {
    "firebase/app":       "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js",
    "firebase/auth":      "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js",
    "firebase/firestore": "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
  }
}
</script>
<script type="module" src="js/app.js"></script>
```

- Pin the version number (`10.12.2`) — do not use `latest`
- The `type="importmap"` script **must appear before** `type="module"` scripts
- Safari 16.4+ supports importmap; for older iOS, a shim is needed (`es-module-shims`)

---

## PWA / Service Worker Notes

If your app registers a service worker, ensure it does **not** intercept Firebase auth requests:

```javascript
// sw.js — skip all Firebase/Google auth traffic
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;
  if (url.hostname.includes('accounts.google.com')) return;
  if (url.hostname.includes('firebaseapp.com')) return;
  // ... your caching strategy here
});
```

Also ensure `sw.js` itself is served with `Cache-Control: no-cache` so stale service worker code never blocks an auth fix from deploying.

---

## Quick Diagnosis Checklist

When auth doesn't work, check in order:

| Symptom | Likely cause |
|---|---|
| Login screen reappears after successful popup | Bug 1 or Bug 2 above |
| Login screen reappears after Google redirect | Bug 3 (storage partitioning) or Bug 1 |
| Toast shows `auth/unauthorized-domain` | Domain not in Firebase Console authorized list |
| Toast shows `auth/popup-blocked` | Browser blocked popup; redirect fallback should kick in |
| Popup opens, closes, nothing happens | `onAuthStateChanged` not firing; check Firebase init |
| Works on desktop, fails on iOS | iOS Safari PWA blocks `signInWithPopup` in some modes; use redirect fallback |
| Works once, fails after reload | Stale redirect error in IndexedDB (Bug 1) |
