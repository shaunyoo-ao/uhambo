# Uhambo — Project Handoff

**Live URL:** https://yonke-uhambo.web.app/  
**Firebase Project:** yonke-uhambo  
**Current Version:** 1.2.0 (sw.js v20)  
**Stack:** Vanilla JS ES Modules · Firebase Firestore/Auth/Hosting · GitHub Actions CI/CD  
**Allowed Users:** yooyoopd@gmail.com, 2yeonsoo@gmail.com

---

## Version History & What Was Built

### v1.0.0 — Foundation
- App shell HTML, full CSS dark-theme design system, PWA manifest + icons
- Firebase init, Google Auth with email whitelist, hash-based SPA router
- Core utilities: i18n (EN/KO), currency (KRW/USD/EUR + live rates via open.er-api.com), weather (open-meteo), Firestore CRUD helpers
- Service worker (PWA offline caching), OpenLayers map module
- Dashboard, Itinerary, Accommodation, Activities, Expenses pages with full CRUD
- Archive stats dashboard
- Firestore rules: UID-path + email whitelist guard

### v1.0.1 — UX Overhaul
- External links on Accommodation/Activity cards (Google Maps, website)
- Stay ↔ Activity sync: adding stay auto-creates matching Activity item
- Mileage tracker (trip distance via Nominatim geocoding)
- Weather filtered to trip date range
- Trip deletion with confirmation
- SW cache bump to v3; removed composite Firestore index dependency

### v1.0.2 — Polish
- UI polish pass, i18n improvements, Archive cleanup

### v1.0.6 — Weather & i18n
- Weather geocoding fallback (future trip date range fix)
- Mileage geocoding improvements (sequential fetch, lat/lng saved at write time)
- Edit Trip modal
- i18n content expansion

### v1.0.7 — Calculator & Itinerary types
- Built-in calculator overlay (triggered from expense/activity amount fields)
- Clickable stat cards on Archive page
- Shopping type added to Itinerary
- Home type added to Itinerary (used to mark departure/return events)
- Modal saving/adding progress bar + button dim on all modals
- Bug fixes

### v1.1.0 — Branch Strategy
- Formalised `main` + `claude-code-work` two-branch strategy in CLAUDE.md

### v1.1.1 — Bug Fixes
- Various bug fixes; Home itinerary type improvements

### v1.1.2 — Mileage Fixes
- Mileage geocoding wrong-country errors fixed (sequential geocoding, country context)
- Failed segment UI shown when geocoding fails

### v1.1.3 — Year Tabs & Status
- Archive year tabs (filter stats by year)
- Trip Status field (Planning / Active / Completed)
- Trip Country field (used to scope mileage geocoding)
- Korean UI translation complete (modal titles, toast messages)
- Category bar chart in Expenses
- Food → Meal rename

### v1.1.4 — Performance & Charts
- Page caching (re-render skipped if data unchanged)
- Bar chart on Expenses page
- Archive improvements

### v1.1.5 — Image Uploads
- Trip & Accommodation image uploads via ImgBB free API
- Mobile image preview constrained to viewport width

### v1.1.6 — Itinerary Map
- Itinerary page split into Schedule tab + Map tab
- OpenLayers markers for itinerary events, accommodation, activities
- Popup on marker tap (title, date, location)
- Map auto-fits to all marker bounds

### v1.1.7 — Map Pin Fixes
- Hide `home`-type itinerary events from map markers
- Add Stay (accommodation) and Activity markers to the map
- Map pin visibility improvements

### v1.2.0 — Guest Access Code *(current)*
- Guest Mode: read-only trip sharing via 6-character code
- Anonymous Firebase Auth (`signInAnonymously()`)
- `guest_codes/{code}` Firestore collection: maps code → `{ ownerUid, tripId }`
- Trip doc gets `guestCode` field; owner generates/regenerates/deletes from Settings
- Guest context persisted in localStorage (survives reload)
- All write actions (FAB, edit/delete buttons, completion toggles) hidden for guests
- Archive tab hidden for guests; Guest Settings shows Language/Currency/Exit only
- Map filter: travel-type items on first/last day of itinerary excluded from map view (home airport focus fix)
- Guest code generate/regen/delete shows modal progress bar (same as Saving pattern)
- Firestore rules hardened: `trips/{tripId}` guest access split to `get` only (no list); `guest_codes` split to `get` + `list: if false`

---

## Architecture Quick Reference

### File Map
```
public/
  index.html           SPA shell, importmap, PWA meta
  sw.js                Service worker — cache-first app shell
  css/app.css          All styles (CSS custom properties)
  js/
    app.js             Router, modal utils, global state, guest logic
    auth.js            Google Sign-In + Anonymous auth, email whitelist
    db.js              All Firestore CRUD + onSnapshot helpers
    i18n.js            EN/KO translations
    currency.js        Exchange rates + formatCurrency()
    weather.js         open-meteo 7-day forecast
    map.js             OpenLayers wrapper (lazy-loaded)
    mileage.js         Trip distance via Nominatim
    imgbb.js           ImgBB image upload helper
    calculator.js      Calculator overlay logic
    pages/
      dashboard.js     Trip overview + weather
      itinerary.js     Timeline + Map tabs
      accommodation.js Stay cards
      activities.js    Activity list + completion toggle
      expenses.js      Expenses + category chart
      archive.js       Stats dashboard
firestore.rules        Auth rules
firebase.json          Hosting + cache headers
.github/workflows/deploy.yml  CI/CD
```

### Version Naming Formula
```
sw.js VERSION = 'vN'  →  display "Version 1.X.Y"
  X = floor(N / 10),  Y = N % 10
  v20 → 1.2.0,  v21 → 1.2.1
```
Bump sw.js VERSION on **every** commit; update `index.html` footer and `app.js APP_VERSION` to match.

### Key Patterns
- **Routing:** hash-based (`#dashboard`, `#itinerary`, etc.)
- **Auth:** `onAuthStateChange` in auth.js → email whitelist check → guest branch for `isAnonymous`
- **Page lifecycle:** `render(container, ctx)` + `destroy()` per page module
- **Modal:** `openModal(config)` / `closeModal()` / `setModalSaving(bool)` in app.js
- **Guest context:** `isGuest`, `_guestOwnerUid`, `_guestTripId` in app.js; `navigate()` passes `{ userId, tripId, isGuest }` to every page
- **Guest page rule:** store `ctx` as `_ctx = ctx` at module level; check `_ctx.isGuest` in all subscription callbacks; suppress all write actions

---

## Known Issues / Not Fixed

| Issue | Notes |
|-------|-------|
| Firebase App Check (brute-force/DoW on guest_codes) | Must be enabled in Firebase Console → App Check → reCAPTCHA v3. Cannot be done in code alone. |
| Anonymous account accumulation | `signInAnonymously()` creates a new anonymous account each time unless localStorage persists the session. Cleanup requires a Firebase Cloud Functions scheduled batch job (`admin.auth().deleteUsers()`). |
| Firestore index for some list queries | Composite indexes were removed to avoid deploy dependency. Complex sort/filter queries are done client-side. |

---

## Manual Setup Required (Firebase Console)

1. **Anonymous Authentication** — Firebase Console → Build → Authentication → Sign-in method → Anonymous → Enable  
2. **App Check** (optional, recommended) — Firebase Console → App Check → Register app with reCAPTCHA Enterprise → enforce on Firestore  
3. **ImgBB API key** — stored as `IMGBB_KEY` in `public/js/imgbb.js` (free tier, no server needed)

---

## CI/CD

Push to `main` → GitHub Actions runs `firebase deploy --only hosting` automatically.  
Branch strategy: develop on `claude-code-work` (or `claude/family-trip-webapp-m3MGb` for current session), PR → squash merge → `main`.

---

## Attempts That Failed / Were Reverted

| What | Why it failed |
|------|--------------|
| `signInWithRedirect` for Google auth | Mobile/PWA redirect flow caused auth state race conditions; reverted to `signInWithPopup` |
| Firestore composite index for itinerary sorting | Deployment dependency caused CI to fail if index wasn't deployed first; removed, sort done client-side |
| `allow read` on `guest_codes` (v1.2.0 initial) | Allowed collection enumeration; replaced with `allow get` + `allow list: if false` |
| Version displayed as 1.2.1 for sw v19 | Violated naming formula (v19 → 1.1.9); corrected to bump sw to v20 → 1.2.0 |
