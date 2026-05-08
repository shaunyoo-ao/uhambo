# Firebase Google Sign-In — Definitive Implementation Guide

> Compiled from repeated real-world debugging on Firebase Hosting + Vanilla JS PWAs.
> Follow this guide to implement Google auth once, correctly, without loop bugs.

---

## The 5 Bugs That Cause "Login Loop"

Every time this goes wrong, one or more of these bugs is responsible.

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
export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult (stale/irrelevant):', e.code);
    return null;  // never throw, never call showLogin() from here
  }
}
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
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
```

---

### Bug 4 — Wrong `authDomain` causes cross-origin redirect failure

When Firebase Hosting hosts your app at `your-project.web.app` but `authDomain`
is set to `your-project.firebaseapp.com`, the redirect goes cross-origin.
Storage partitioning (Bug 3) then breaks the auth state read.

Firebase Hosting provides a **same-origin auth handler** at `/__/auth/handler`
when `authDomain` matches your hosting domain.

```javascript
// ❌ WRONG — cross-origin; broken by storage partitioning on redirect fallback
const firebaseConfig = {
  authDomain: "your-project.firebaseapp.com",
  ...
};
```

```javascript
// ✅ CORRECT — same-origin; redirect handler served from your own domain
const firebaseConfig = {
  authDomain: "your-project.web.app",
  ...
};
```

> **Note:** Ensure `your-project.web.app` is listed in Firebase Console →
> Authentication → Settings → Authorized domains.

---

### Bug 5 — iOS PWA standalone mode blocks `signInWithPopup`

When your app is installed to the iOS home screen (standalone mode),
`window.open()` opens a **separate Safari tab** that never resolves the Promise
back to the PWA. `signInWithPopup` hangs — the user sees the Google sign-in
page, authenticates, but the app never receives the result.

```javascript
// ❌ WRONG — popup silently fails in iOS standalone mode
export async function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}
```

```javascript
// ✅ CORRECT — detect iOS standalone, use redirect instead
function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

export async function signInWithGoogle() {
  if (isIOSPWA()) {
    // Redirect works in iOS standalone; popup does not.
    // Requires authDomain fix (Bug 4) to work without storage partitioning.
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
```

---

### Bug 6 (bonus) — Not awaiting `handleRedirectResult()` before `onAuthStateChanged`

If `handleRedirectResult()` is not awaited, `onAuthStateChanged` can fire
`null` before Firebase has finished processing the pending redirect result.
This triggers `showLogin()` even though the user is about to be authenticated.

```javascript
// ❌ WRONG — race condition; null fires before redirect is processed
handleRedirectResult();  // not awaited
onAuthStateChange(callback);
```

```javascript
// ✅ CORRECT — sequential; redirect fully processed before listener fires
(async () => {
  await handleRedirectResult();
  onAuthStateChange(callback);
})();
```

---

### Bug 7 (bonus) — Service worker intercepts Firebase auth requests

If your service worker intercepts requests to `accounts.google.com` or
`firebaseapp.com`, it can corrupt the redirect flow or block the Google
sign-in page from loading.

```javascript
// ✅ CORRECT — skip ALL auth-related traffic in sw.js
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

---

## Complete Reference Implementation

### `firebase-init.js`

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.web.app",   // ← MUST be web.app, not firebaseapp.com
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};

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

// iOS PWA (standalone mode) blocks window.open(), so signInWithPopup silently
// fails — the popup opens in a separate Safari tab that never resolves back.
function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

// Primary: popup. iOS standalone → redirect. Redirect-blocked → redirect.
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

// Must be called (and awaited) on every page load BEFORE onAuthStateChanged.
// Clears any stale redirect state silently.
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

// ── Login button ──────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Opening Google Sign-In…';
  try {
    await signInWithGoogle();
    // Popup success: onAuthStateChanged fires → initApp().
    // Redirect: page navigates away — nothing more to do here.
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    if (e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') {
      return;
    }
    showToast('Sign-in failed (' + (e.code || 'unknown') + ')');
    console.error('[auth] signInWithGoogle:', e.code, e.message);
  }
});

// ── Auth bootstrap ────────────────────────────────────────────────
// MUST await handleRedirectResult() before registering onAuthStateChanged.
// Without the await, Firebase fires an initial null auth state before the
// redirect result is processed, causing showLogin() to flash even after a
// successful redirect sign-in.
(async () => {
  await handleRedirectResult();

  onAuthStateChange((user, err) => {
    if (err === 'access_denied') {
      _appInitialized = false;
      showLogin();
      showToast('Access denied.');
      return;
    }
    if (!user) {
      if (!_appInitialized) showLogin();  // only before first login
      return;
    }
    if (_appInitialized) return;
    _appInitialized = true;
    initApp(user);
  });
})();

// ── Sign-out ──────────────────────────────────────────────────────
async function doSignOut() {
  _appInitialized = false;
  await signOut();
  location.reload();
}
```

---

## Firebase Console Checklist

Before testing, verify in Firebase Console:

1. **Authentication → Sign-in method → Google**: Enabled
2. **Authentication → Settings → Authorized domains**: must include
   - `localhost`
   - `your-project.web.app`
   - `your-project.firebaseapp.com`
   - Any custom domain
3. **Firestore → Rules**: deployed (`firebase deploy --only firestore:rules`)
4. **OAuth consent screen** (Google Cloud Console): not in test mode if adding new users

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

- Pin the version number — do not use `latest`
- `type="importmap"` must appear **before** `type="module"` scripts
- Safari 16.4+ supports importmap; for older iOS use `es-module-shims`

---

## PWA / Service Worker Notes

Skip ALL Firebase and Google auth traffic in your service worker:

```javascript
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;
  if (url.hostname.includes('accounts.google.com')) return;    // ← don't forget
  if (url.hostname.includes('firebaseapp.com')) return;        // ← don't forget
  // ... caching strategy
});
```

Serve `sw.js` with `Cache-Control: no-cache` so auth fixes deploy immediately.

---

## Quick Diagnosis Checklist

| Symptom | Likely cause |
|---|---|
| Login screen reappears after successful popup | Bug 2 (`_appInitialized` missing) |
| Login screen flashes then disappears | Bug 6 (not awaiting `handleRedirectResult`) |
| Login screen reappears after Google redirect | Bug 3 (storage partitioning) + Bug 4 (`authDomain`) |
| Works on desktop, broken on iOS home screen | Bug 5 (iOS PWA standalone) |
| Works once, fails after reload | Stale redirect error in IndexedDB (Bug 1) |
| `auth/unauthorized-domain` toast | Domain not in Firebase Console authorized list |
| `auth/popup-blocked` toast | Browser blocked popup; redirect fallback should activate |
| Popup opens, closes, nothing happens | `onAuthStateChanged` not firing; check Firebase init |
