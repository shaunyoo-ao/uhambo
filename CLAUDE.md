# Uhambo — Family Trip Manager

## Overview
Mobile-first PWA for planning and tracking family trips. Single-page app with vanilla HTML5/CSS/JavaScript (ES modules), Firebase Hosting + Firestore, Google Authentication, and GitHub Actions CI/CD.

**Live URL:** https://yonke-uhambo.web.app/  
**Firebase Project:** yonke-uhambo  
**Allowed Users:** yooyoopd@gmail.com, 2yeonsoo@gmail.com

---

## Git Workflow

**Push all completed changes directly to `main`.** No PRs or approval needed.
- Commit to the session's feature branch, then immediately push to `main` as well (or commit directly to `main`).
- CI/CD deploys automatically on push to `main` via GitHub Actions.

---

## Tech Stack
- **Frontend:** Vanilla HTML5, CSS3, ES Modules (no bundler)
- **Backend:** Firebase Firestore (Spark plan)
- **Auth:** Firebase Google Sign-In (email whitelist)
- **Hosting:** Firebase Hosting
- **Maps:** OpenLayers + OpenStreetMap (free, no API key)
- **Weather:** open-meteo API (free, no API key)
- **Currency:** open.er-api.com (free, no API key)
- **CI/CD:** GitHub Actions → Firebase deploy on push to main

---

## File Structure
```
public/
  index.html          # SPA shell, importmap, PWA meta tags
  manifest.json       # PWA manifest
  sw.js               # Service worker (cache-first app shell)
  css/app.css         # All styles, CSS custom properties
  js/
    firebase-init.js  # Firebase SDK init (exports db, auth)
    auth.js           # Google Sign-In, email whitelist
    app.js            # Router, modal utils, trip selector, global state
    i18n.js           # EN/KO translations, t(key), setLang()
    currency.js       # Exchange rates, convert(), formatCurrency()
    weather.js        # open-meteo 7-day forecast
    map.js            # OpenLayers wrapper (lazy-loaded)
    db.js             # All Firestore CRUD + onSnapshot helpers
    pages/
      dashboard.js    # Trip overview, weather, upcoming items
      itinerary.js    # Date-grouped timeline, add/edit events
      accommodation.js# Accommodation cards, check-in/out
      activities.js   # Activity list, completion toggle
      expenses.js     # Expense list, category chart, currency conversion
      archive.js      # Stats dashboard (computed from Firestore data)
  icons/
    icon-192.svg
    icon-512.svg
    icon-192.png      # iOS fallback
firebase.json         # Hosting config (SPA rewrite, cache headers)
firestore.rules       # Auth + email-whitelist security rules
.firebaserc           # Project alias
.github/workflows/deploy.yml
```

---

## Navigation (6-tab bottom bar)
| Tab | Route | Description |
|-----|-------|-------------|
| Dashboard | #dashboard | Trip overview, weather, quick stats |
| Itinerary | #itinerary | Timeline grouped by date |
| Accommodation | #accommodation | Hotels/stays, check-in/out dates |
| Activities | #activities | Activities with completion toggle |
| Expenses | #expenses | Costs with currency conversion |
| Archive | #archive | Stats dashboard (computed) |

---

## Firestore Data Model
```
users/{userId}/
  trips/{tripId}
    name, description, destination, startDate, endDate
    baseCurrency (KRW|USD|EUR), destLat, destLng

  trips/{tripId}/itinerary/{itemId}
    date (YYYY-MM-DD), time (HH:MM), title, description
    location (string), type (travel|meal|activity|rest), lat, lng

  trips/{tripId}/accommodation/{itemId}
    name, checkIn, checkOut (YYYY-MM-DD), address
    cost (number), currency, notes, lat, lng

  trips/{tripId}/activities/{activityId}
    name, date, time, location, category
    cost, currency, notes, completed (bool), lat, lng

  trips/{tripId}/expenses/{expenseId}
    title, amount (number), currency, date, category, notes
```

---

## Design System
Based on dark-theme prototype (ebc28922-uhambo__standalone_.html):
- **Background:** `#0c0d0f` (--ink)
- **Surface:** `#16181c` / `#1d2026` / `#232730`
- **Primary text:** `#f3f0ea` (--cream)
- **Muted text:** `#7c8089` (--muted)
- **Accent:** `#ee6c3a` (warm orange)
- **Blue:** `#6ea6e8` (--sky)
- **Green:** `#5fb88c` (--mint)
- **Yellow:** `#e8c87c` (--sun)
- **Red:** `#d97a7a` (--rose)
- **Fonts:** Instrument Serif (display), Geist (UI), Geist Mono (data)

---

## Key Patterns
- **Routing:** Hash-based (`location.hash`) — no server rewrite needed
- **Auth flow:** `onAuthStateChanged` → email whitelist check → show login or app
- **Page lifecycle:** each page exports `render(container, ctx)` + `destroy()` for Firestore listener cleanup
- **Modal:** single `#modal-root` bottom-sheet, `openModal(config)` / `closeModal()` in app.js
- **Trip selector:** `<select id="trip-selector">` in header; dispatches `tripchange` custom event
- **Currency:** stored in original currency, converted at display time
- **i18n:** nav labels stay English; content keys translate to KO

---

## Security
- Firestore rules require `request.auth.uid == userId` AND email in allowed list
- Client-side email whitelist is UX-only; rules are the real gate
- No secrets in client code (Firebase config is public by design)

---

## PWA
- `manifest.json`: standalone display, dark theme color, both icon sizes
- iOS: `apple-mobile-web-app-capable`, `apple-touch-icon` meta tags required
- SW: precaches app shell on install, Network-First for APIs, Cache-First for OSM tiles
- `firebase.json`: `Cache-Control: no-cache` on sw.js so browser always re-evaluates

---

## Updating This File
Update CLAUDE.md when:
- New pages or routes are added
- Data model fields change
- New external APIs are integrated
- Design system tokens change
