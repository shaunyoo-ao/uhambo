# Firebase Google Sign-In — Definitive Implementation Guide

> Reference for Claude Code. When implementing Google auth on a new Firebase project,
> follow every step in order. Most login loop bugs come from skipping Step 1 or Step 2.

---

## Step 1 — Firebase Console Setup

Do this before writing any code.

**Authentication → Sign-in method → Add provider → Google → Enable**

- Set a support email
- Click Save

**Authentication → Settings → Authorized domains**

Verify these are listed (Firebase adds them automatically when Hosting is enabled):
- `localhost`
- `your-project.web.app`
- `your-project.firebaseapp.com`

---

## Step 2 — Google Cloud Console: Register OAuth Redirect URIs

This is the most commonly missed step. Even after enabling Google Sign-In in Firebase
Console, you must verify the redirect URIs in Google Cloud Console.

1. Open: **console.cloud.google.com → APIs & Services → Credentials**
2. Click the OAuth 2.0 Client ID named **"Web client (auto created by Google Service)"**
3. Under **Authorized redirect URIs**, ensure BOTH of these are present:
   - `https://your-project.firebaseapp.com/__/auth/handler`
   - `https://your-project.web.app/__/auth/handler`
4. If either is missing, add it and click **Save**
5. Wait ~2 minutes for Google to propagate the change

> **Why both?** Firebase opens the auth popup at `firebaseapp.com/__/auth/handler`.
> If your app is hosted at `web.app` and a browser blocks popups (triggering redirect
> fallback), the redirect lands at `web.app/__/auth/handler`. Google rejects any URI
> not in this list with `Error 400: redirect_uri_mismatch`.

---

## Step 3 — Firebase Config (`firebase-init.js`)

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",  // always firebaseapp.com
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

## Step 4 — Auth Module (`auth.js`)

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

const ALLOWED = ['user1@example.com', 'user2@example.com'];

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// iOS installed PWA (home screen): window.open() opens a detached Safari tab
// that never resolves back → signInWithPopup silently hangs. Use redirect.
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

// Must be called (and awaited) on every page load BEFORE onAuthStateChanged.
// Clears stale redirect state silently — never throw or call showLogin() from here.
export async function handleRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.warn('[auth] getRedirectResult stale error:', e.code);
    return null;
  }
}

export function signOut() { return fbSignOut(auth); }

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
```

---

## Step 5 — Bootstrap (`app.js`)

```javascript
let _appInitialized = false;

// Login button
document.getElementById('login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('login-btn');
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Opening Google Sign-In…';
  try {
    await signInWithGoogle();
    // popup success → onAuthStateChanged fires → initApp()
    // redirect → page navigates away, nothing more to do
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = html;
    if (e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') return;
    showToast('Sign-in failed: ' + (e.code || 'unknown'));
    console.error('[auth]', e.code, e.message);
  }
});

// MUST await handleRedirectResult() before registering onAuthStateChanged.
// Without await, Firebase fires an initial null state before the redirect
// result is processed → showLogin() is called even after a valid redirect sign-in.
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
      // Guard: onAuthStateChanged fires null on token refresh too.
      // Only show login before the app has ever initialized.
      if (!_appInitialized) showLogin();
      return;
    }
    if (_appInitialized) return;
    _appInitialized = true;
    initApp(user);
  });
})();

// Sign-out: reset flag so login screen shows correctly after reload
async function doSignOut() {
  _appInitialized = false;
  await signOut();
  location.reload();
}
```

---

## Step 6 — Service Worker (`sw.js`)

Skip all Firebase and Google auth traffic so the SW never interferes with sign-in:

```javascript
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firestore.googleapis.com')) return;
  if (url.hostname.includes('identitytoolkit.googleapis.com')) return;
  if (url.hostname.includes('securetoken.googleapis.com')) return;
  if (url.hostname.includes('accounts.google.com')) return;
  if (url.hostname.includes('firebaseapp.com')) return;
  // ... rest of caching strategy
});
```

Also serve `sw.js` with no-cache so auth fixes deploy immediately:

```json
// firebase.json
{
  "hosting": {
    "headers": [{ "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }]
  }
}
```

---

## Diagnosis Table

| Error / Symptom | Cause | Fix |
|---|---|---|
| `Error 400: redirect_uri_mismatch` | OAuth redirect URI not registered in Google Cloud Console | Add both `firebaseapp.com/__/auth/handler` and `web.app/__/auth/handler` (Step 2) |
| Login screen returns immediately after button click | Google Sign-In not enabled in Firebase Console | Enable Google provider (Step 1) |
| Login screen flashes, then stays | `handleRedirectResult()` not awaited before `onAuthStateChanged` | Use async IIFE (Step 5) |
| Login screen re-appears after sign-in succeeds | `onAuthStateChanged` null fires show login after `initApp` | Add `_appInitialized` guard (Step 5) |
| Works on desktop, broken on iOS home screen | `signInWithPopup` fails in iOS standalone PWA | Add `isIOSPWA()` redirect (Step 4) |
| `auth/popup-blocked` and no fallback | Browser blocked popup, no redirect fallback | Catch `auth/popup-blocked` → `signInWithRedirect` (Step 4) |
| `auth/unauthorized-domain` | Domain not in Firebase authorized domains | Add domain in Firebase Console → Auth → Settings |
| Login worked once, fails after reload | Stale redirect error persists in IndexedDB | Swallow all `getRedirectResult` errors (Step 4) |

---

## importmap (Firebase v10, no bundler)

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

- Pin the version — never use `latest`
- `type="importmap"` must appear **before** any `type="module"` script
- Safari 16.4+ supports importmap natively; older iOS needs `es-module-shims`
