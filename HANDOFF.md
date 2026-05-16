# Uhambo — Project Handoff

**Live URL:** https://yonke-uhambo.web.app/  
**Firebase Project:** yonke-uhambo  
**Current Version:** 1.2.3 (sw.js v37)  
**Stack:** Vanilla JS ES Modules · Firebase Firestore/Auth/Hosting · GitHub Actions CI/CD  
**Allowed Users:** yooyoopd@gmail.com, 2yeonsoo@gmail.com

---

## Version History & What Was Built

### v1.2.3 — Trip Members + AI Trip Assistant *(current)*

Two new features added to the app:

**Trip Members (여행객 정보):**
- New/Edit Trip forms now include a "Travelers" section for entering traveler profiles
- Each traveler: relation (Self/Spouse/Child/Relative/Friend/Acquaintance), nationality, gender,
  age, travel preference (optional: Adventure/Relaxation/Culture/Food & Dining/Shopping/Nature/Photography)
- Travelers are added one at a time via a form row + "Add Traveler" button; displayed as
  removable tag cards
- Stored as `travelers: []` array in the trip Firestore document alongside existing trip fields
- Module-level `_tripTravelers` state (like `_tripImageSlot`) manages the list between renders
- Both EN and KO labels fully translated; `_travelersFormSection(isKo)` helper generates the HTML
- Edit Trip pre-populates `_tripTravelers` from `trip.travelers` on open

**AI Trip Assistant Prompt Generator:**
- New "AI Trip Assistant" section added to owner Settings (not shown to guests)
- "📋 Generate AI Prompt" button fetches all trip data (trip info + travelers + itinerary +
  bookings + activities + expenses) in parallel and composes a JSON prompt
- The instruction field tells the AI to review the data and proactively ask what to help with;
  language is set based on current app language (`getLang()`)
- Firestore internal fields (`id`, `createdAt`, `updatedAt`) stripped before JSON output
- Prompt displayed in a scrollable code block modal with "Copy Prompt" button (clipboard API)
- New db.js imports in app.js: `getItinerary`, `getBookings`, `getActivities`, `getExpenses`

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

### v1.2.15 — Remove broken Firestore CI step (real root cause: IAM) *(current)*

Three consecutive main builds (3e11bbc, edfa0e7, 13a64b7) failed in the Firestore deploy step added in v1.2.12. After eliminating credential-format and auth-method theories, the real root cause was IAM:

The `FIREBASE_SERVICE_ACCOUNT` GitHub secret was generated by `firebase init hosting:github` and contains a service account with **only `roles/firebasehosting.admin`**. The Firebase CLI call `firebase deploy --only firestore` authenticates successfully but is rejected by the Firebase Rules and Firestore APIs with `403 PERMISSION_DENIED` because the account lacks `roles/firebaserules.admin` and `roles/datastore.indexAdmin`. No YAML change can fix this — it's a Google Cloud IAM binding problem.

The CI step was also unnecessary. The rules in `firestore.rules` are functionally identical to what was manually deployed at v1.2.0. The original Dashboard/Archive bug was a code issue (reading the wrong collection name) and was fully fixed by v1.2.11's code revert plus v1.2.12's SW `cache: 'reload'` precache. There is no rules change that needs to ship.

**Fix:** Reverted `.github/workflows/deploy.yml` to the pre-v1.2.12 hosting-only workflow (the same one that successfully shipped v1.0.0–v1.2.11). Documented manual rules-deploy procedure in `CLAUDE.md`. Kept the *useful* v1.2.12 changes (single-source-of-truth version string in `app.js`, SW cache:reload precache).

### v1.2.14 — google-github-actions/auth for Firestore deploy (failed)
Attempt 3 to deploy Firestore rules from CI. Replaced the manual credential-file approach with the official `google-github-actions/auth@v2` action. Still failed — the real problem is IAM permissions on the service account, not auth method. See v1.2.15.

### v1.2.13 — Direct Firebase CLI for Firestore deploy (failed)
Attempt 2. Replaced `w9jds/firebase-action` with `npm install -g firebase-tools` + manual `GOOGLE_APPLICATION_CREDENTIALS` file. Still failed for the same IAM reason. See v1.2.15.

### v1.2.12 — Root-cause fixes for version mismatch + Firestore rules deploy

Three persistent issues that returned in v1.2.11 traced to deeper root causes:

1. **Version mismatch (login footer vs Settings).** The version string lived in two separate places: hardcoded in `public/index.html` AND as `APP_VERSION` in `public/js/app.js`. The service worker's `cache.addAll(PRECACHE)` uses regular fetches that honor the browser's HTTP cache (`max-age=86400` set in `firebase.json`). After a deploy, the SW could precache STALE `index.html` (still in browser HTTP cache) while loading FRESH `app.js`, displaying two different version strings to the user.
   - **Fix:** Single source of truth — `index.html` now has `<span id="login-version">…</span>` which `app.js` populates at runtime from `APP_VERSION`. Both screens always show the same value (even if files are stale).
   - **Defense-in-depth:** SW precache now uses `new Request(url, { cache: 'reload' })` to bypass the browser HTTP cache and always fetch fresh files from the CDN.

2. **"Missing or insufficient permissions" on Dashboard/Archive.** The GitHub Actions workflow `.github/workflows/deploy.yml` used `FirebaseExtended/action-hosting-deploy@v0` which deploys ONLY hosting — **Firestore rules were NEVER deployed automatically**. Every rules change since the project began was either deployed manually or never took effect. When client code expected a rule that wasn't live, Firestore denied the read.
   - **Fix:** Added a second step to the workflow using `w9jds/firebase-action@v13.0.0` running `firebase deploy --only firestore`. This deploys both `firestore.rules` and `firestore.indexes.json` on every push to `main`.

3. **Booking page infinite spinner.** Compound effect of (a) the SW serving cached v1.2.1 code that subscribed to the (non-existent in live rules) `bookings` collection, and (b) live rules not actually matching the repo's rules file (Issue 2). The subscription was silently rejected → spinner forever.
   - **Fix:** This is auto-resolved by the combined fixes above — the SW now invalidates aggressively, the code in v1.2.11 already reads `accommodation`, and rules are now auto-deployed so the live rules will match the repo.

Also documents this in `CLAUDE.md` (new "Deployment" section, updated "Version Naming Rule").

### v1.2.11 — Bug fixes for v1.2.1 STAY→BOOKING migration
Fixes three regressions introduced by v1.2.1:
1. **Dashboard / Itinerary failed to load** — both still imported `getAccommodation` from db.js (removed in v1.2.1). Replaced with `getBookings`.
2. **Archive: "Missing or insufficient permissions"** — `getAllTripsData()` tried to read the new `bookings` collection, which the deployed Firestore rules did not allow.
3. **Booking page infinite spinner** — existing accommodation entries lived in the `accommodation` collection but new code subscribed to `bookings`.

**Fix strategy: keep the Firestore collection named `accommodation`** and only treat the rename as a JS-API / UI concept. JS helper names (`getBookings`, `addBooking`, etc.) are preserved. All booking categories (accommodation, travel, rent) live in the same `accommodation` Firestore collection distinguished by the `category` field. No data migration needed; existing user data is preserved transparently.

Also introduced a new versioning rule in `CLAUDE.md`: bug-fix-only commits append a digit (`1.2.1 → 1.2.11 → 1.2.12`) instead of incrementing the patch number.

### v1.2.1 — Coordinates Input + BOOKING Tab
- **Coordinates input**: optional lat/lng override field below every Location input (Itinerary, Activities, Booking). Comma-separated format `-25.989, 28.005`. When filled, skips Nominatim geocoding; when empty, geocodes as before. Pre-fills on edit with stored coordinates.
- **STAY → BOOKING tab**: renamed with briefcase icon. Three sub-categories:
  - **Accommodation**: identical to old Stay (check-in/out dates, times, address, photos, cost, expense sync, itinerary sync)
  - **Travel (Flight)**: airline, flight no., cabin class, departure/arrival airport + coordinates, departure/arrival date+time, PNR, cost. Expense → transport. Itinerary → travel type, **only if time is filled**. Departure + arrival events synced independently.
  - **Rent (Car)**: rental company, vehicle type, pickup/dropoff location + coordinates, pickup/dropoff date+time, booking ref, cost. Expense → transport. Itinerary → travel type, **only if time is filled**. Pickup + dropoff events synced independently.
- **Firestore**: renamed collection `accommodation` → `bookings`. `sourceType` changed from `'accommodation'` to `'booking'` for linked items.
- **db.js**: new exports `subscribeBookings`, `addBooking`, `updateBooking`, `deleteBooking`, `deleteLinkedItinItem` (singular, by subType)

### v1.2.0 — Guest Access Code
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
      accommodation.js Booking page (Accommodation/Travel/Rent categories)
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
