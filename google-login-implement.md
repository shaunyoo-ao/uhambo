# Firebase Google Sign-In — Definitive Implementation Guide

> Compiled from repeated real-world debugging on Firebase Hosting + Vanilla JS PWAs.
> Follow this guide to implement Google auth once, correctly, without loop bugs.

---

## Step 0 — Firebase Console Setup (DO THIS FIRST)

Before writing a single line of auth code, complete all four of these in the
Firebase Console. Skipping any one will cause a broken or looping login.

### 0-A. Enable Google Sign-In
Firebase Console → **Authentication → Sign-in method → Add provider → Google → Enable**

Set a project support email. Save.

> **This is the most commonly missed step.** Without it, every auth attempt silently
> fails or returns `redirect_uri_mismatch`.

### 0-B. Verify authorized domains
Firebase Console → **Authentication → Settings → Authorized domains**

Must include:
- `localhost` (local dev)
- `your-project.web.app` (Firebase Hosting)
- `your-project.firebaseapp.com` (Firebase default)
- Any custom domain

Firebase adds the first two automatically when you enable Hosting.

### 0-C. Use the correct `authDomain`

```javascript
// ✅ CORRECT — firebaseapp.com is the OAuth redirect URI registered by Firebase
const firebaseConfig = {
  authDomain: "your-project.firebaseapp.com",  // ← ALWAYS firebaseapp.com
  ...
};
```

```javascript
// ❌ WRONG — web.app is NOT registered as an OAuth redirect URI
const firebaseConfig = {
  authDomain: "your-project.web.app",  // ← causes redirect_uri_mismatch
  ...
};
```

**Why:** When Google Sign-In is enabled in Firebase Console, Firebase registers
`https://your-project.firebaseapp.com/__/auth/handler` as an OAuth redirect URI
in Google Cloud Console. It does NOT register `web.app`. Using `web.app` as
`authDomain` causes Google to reject the popup with
`Error 400: redirect_uri_mismatch`.

### 0-D. Firestore rules deployed
```bash
firebase deploy --only firestore:rules
```

---

## The 5 Bugs That Cause "Login Loop"

After the console setup is correct, these code bugs are the remaining causes.

### Bug 1 — `getRedirectResult` error triggers `showLogin()` after `initApp`

Firebase persists redirect errors in IndexedDB. If a previous redirect failed,
**every subsequent page load** calls `getRedirectResult`, throws a stale error,
and calls `showLogin()` — even if the user is already authenticated.

```javascript
// ❌ WRONG
handleRedirectResult().catch(e => {
  showLogin();  // fires AFTER initApp's hideLogin(), overriding it
});

// ✅ CORRECT — swallow all errors, never call showLogin() from here
export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult (stale):', e.code);
    return null;
  }
}
```

---

### Bug 2 — `onAuthStateChanged(null)` shows login screen after app is running

`onAuthStateChanged` fires `null` during token refresh or brief SDK resets.
Once the app is running, this must not log the user out.

```javascript
// ❌ WRONG
onAuthStateChanged(auth, user => {
  if (!user) showLogin();  // fires even when already logged in
  else initApp(user);
});

// ✅ CORRECT
let _appInitialized = false;
onAuthStateChanged(auth, user => {
  if (!user) {
    if (!_appInitialized) showLogin();  // only before first login
    return;
  }
  if (_appInitialized) return;
  _appInitialized = true;
  initApp(user);
});
```

---

### Bug 3 — `signInWithRedirect` breaks on Chrome 115+ / Safari 17+

Chrome 115 and Safari 17 introduced storage partitioning. Firebase's redirect
flow stores auth state on `firebaseapp.com`, then reads it back from `web.app`.
Storage partitioning isolates these — `getRedirectResult` returns null.

```javascript
// ❌ WRONG — redirect primary
export function signInWithGoogle() {
  return signInWithRedirect(auth, provider);
}

// ✅ CORRECT — popup primary, redirect only when popup is blocked
export async function signInWithGoogle() {
  if (isIOSPWA()) return signInWithRedirect(auth, provider);
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
    throw e;
  }
}
```

---

### Bug 4 — iOS PWA standalone mode silently breaks `signInWithPopup`

When installed to the iOS home screen, `window.open()` opens a separate Safari
tab that never resolves back to the PWA. `signInWithPopup` hangs silently.

```javascript
// ✅ CORRECT — detect and use redirect for iOS PWA
function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

export async function signInWithGoogle() {
  if (isIOSPWA()) return signInWithRedirect(auth, provider);
  // ... popup flow
}
```

---

### Bug 5 — Not awaiting `handleRedirectResult()` before `onAuthStateChanged`

Without `await`, Firebase fires an initial null auth state before the redirect
result is processed, showing the login screen even after a successful redirect.

```javascript
// ❌ WRONG — race condition
handleRedirectResult();  // not awaited
onAuthStateChange(callback);

// ✅ CORRECT
(async () => {
  await handleRedirectResult();
  onAuthStateChange(callback);
})();
```

---

### Bug 6 — Service worker intercepts Firebase/Google auth traffic

```javascript
// ✅ CORRECT — skip auth traffic in sw.js
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;
  if (url.hostname.includes('accounts.google.com')) return;
  if (url.hostname.includes('firebaseapp.com')) return;
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
  authDomain: "your-project.firebaseapp.com",   // ← ALWAYS firebaseapp.com
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

### `auth.js`

```javascript
import { auth } from './firebase-init.js';
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut as fbSignOut, onAuthStateChanged,
} from 'firebase/auth';

const ALLOWED_EMAILS = ['user1@example.com', 'user2@example.com'];
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function isIOSPWA() {
  return ('standalone' in navigator) && navigator.standalone === true;
}

export async function signInWithGoogle() {
  if (isIOSPWA()) return signInWithRedirect(auth, provider);
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
    throw e;
  }
}

export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult (stale):', e.code);
    return null;
  }
}

export function signOut() { return fbSignOut(auth); }

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

### `app.js` — Bootstrap

```javascript
let _appInitialized = false;

document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Opening Google Sign-In…';
  try {
    await signInWithGoogle();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = html;
    if (e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') return;
    showToast('Sign-in failed: ' + (e.code || 'unknown'));
  }
});

(async () => {
  await handleRedirectResult();  // must await before registering listener
  onAuthStateChange((user, err) => {
    if (err === 'access_denied') {
      _appInitialized = false; showLogin(); showToast('Access denied.');
      return;
    }
    if (!user) {
      if (!_appInitialized) showLogin();
      return;
    }
    if (_appInitialized) return;
    _appInitialized = true;
    initApp(user);
  });
})();

async function doSignOut() {
  _appInitialized = false;
  await signOut();
  location.reload();
}
```

---

## Firebase Console Checklist (run before first deploy)

| Step | Where | What to check |
|---|---|---|
| 1 | Authentication → Sign-in method | Google: **Enabled** |
| 2 | Authentication → Settings → Authorized domains | `localhost`, `project.web.app`, `project.firebaseapp.com` listed |
| 3 | `authDomain` in code | Must be `project.firebaseapp.com`, never `project.web.app` |
| 4 | Firestore → Rules | Deployed via `firebase deploy --only firestore:rules` |
| 5 | Google Cloud Console → OAuth consent screen | Not in test mode if adding new users |

---

## Quick Diagnosis Table

| Symptom | Root cause |
|---|---|
| `Error 400: redirect_uri_mismatch` | Step 0-A not done (Google Sign-In not enabled) OR `authDomain` is `web.app` not `firebaseapp.com` |
| Login screen reappears after popup | Bug 2 (`_appInitialized` guard missing) |
| Login screen flashes then stays | Bug 5 (not awaiting `handleRedirectResult`) |
| Redirect returns to login | Bug 3 (storage partitioning) or Bug 1 (stale redirect error) |
| Works desktop, broken iOS home screen | Bug 4 (iOS PWA standalone) |
| `auth/unauthorized-domain` | Domain missing from Firebase authorized domains list |
| `auth/popup-blocked` | Browser blocked popup; redirect fallback activates automatically |

---

## importmap (Firebase v10 ESM, no bundler)

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

- Pin the version number — never use `latest`
- `type="importmap"` must come **before** any `type="module"` scripts
- Safari 16.4+ supports importmap natively; older iOS needs `es-module-shims`
