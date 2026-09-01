# Planner & app notes (for later, smaller models)

This is the current behavior of **Mister Worldwide** as of the compact-cloud + day-page work. Prefer this over older chat history.

## What the product is

Static SPA: 3D globe of saved places + **Travel Planner** (trips/days/activities) + country place browser + AI assistant. Live on Netlify. Firebase Auth (allowlisted emails) + Firestore sync.

Key files:

| File | Role |
|------|------|
| `js/planner.js` | Planner UI, day page, import into trips, globe-for-day |
| `js/import-planner.js` | Excel/CSV/PDF parse → trip draft |
| `js/store.js` | Seed places + **compact** local/cloud user data |
| `js/cloud.js` | Firestore save/load (compact payload only) |
| `js/app.js` | Shell, persist flags, country panel, day-on-globe |
| `index.html` | Modals: activity detail, **delete trip confirm**, **import page picker**, **import summary**, add-to-trip |
| `css/styles.css` | Planner/day/activity/modal styles |
| `data/places.json` | ~6.3k seed places (~2.5MB). **Never write this to Firestore.** |

## Critical: do not save the full place dump

`data/places.json` is **2.5MB**. Firestore docs max **1MB**. Writing all places on every tap caused **quota / resource-exhausted**, which aborted button handlers (Save, open trip, Timeline, days).

**Correct model:**

- Seed stays in `places.json` (memory after `loadSeed()`).
- `WorldStore.compactUserData()` / `packCloudPayload()` store only:
  - `planner` (trips)
  - `userPlaces` (added/changed vs seed)
  - `deletedPlaceIds`, `extraCountries`, `overrides`
- `saveState` writes that compact JSON to localStorage (`v: 2`).
- Cloud `worldData/{uid}` is **replaced** (`merge: false`) with the compact payload. Never merge the old dump back in.
- UI-only actions use `WorldApp.persistNav()` — **no cloud write**.

Do **not** `JSON.stringify(state)` with `state.places` into localStorage or Firestore.

Tests: `node scripts/test-store-compact.js`

## Persist API (`js/app.js`)

```js
persist({ touchPlanner, cloud, refreshUi })
persistNav()                    // local only, no cloud, no globe refresh
persistPlanner({ flush, skipPlannerRender, cloud })
```

| Action | What to call |
|--------|----------------|
| Open trip, ← Trips, change day, Categories/Timeline | `persistNav()` then `render()` |
| Add/reorder/remove activities, import, Save trip, delete trip | `persistPlanner` / `persistLive` with `cloud: true` |
| Save trip button | `persistLive({ flush: true, toast: "Trip saved" })` |

Cloud writes are debounced (~2.5s). Quota errors pause cloud; **local planner must still work**.

## Planner views (`plannerView`)

`state.planner.view` is the source of truth: `"list"` | `"trip"` | `"create"`.

**Bug that was fixed:** `plannerView` used to treat any `activeTripId` as “inside the trip”, so **← Trips** set `view: "list"` then immediately showed the trip again.

Correct:

- `"list"` → trip chips (even if `activeTripId` is still set for highlight)
- `"trip"` + matching trip → day page
- `"create"` → create form

`render()` must **not** call `restorePlannerNav()` every time (that reset the day/view from sessionStorage). Restore only in `toggle(true)`.

`rememberNav(state)` writes `sessionStorage.plannerNav` `{ view, tripId, dayNum }`.

## Day page

- Sequential day index (`days[0]` = Day 1). PDF “Day 4” is `importDay`, shown as extra text only.
- Date chips: horizontal scroll (`touch-action: pan-x`). Swipe is not a tap (`touchTrack.moved`).
- **Categories** vs **Timeline** (`trip.dayListMode`). Timeline = PDF row order, numbered. **Press the 3 dotted lines** on the left (~70ms, not a long iOS press), then drag up/down. Selection/callout is disabled on the row so iOS does not highlight the name.
- Each row: grip · name · time · **Maps** · **ⓘ** · **✕**. A short tap on the name rectangle **copies the activity name**. ✕ opens `#activity-delete-modal` (Cancel / Delete). Only ⓘ opens details.
- **Map this day on globe**: close planner, `WorldGlobe.showDayPlaces`, `WorldApp.showDayPlacesOnCountry` (country panel filtered to that day’s `placeId`s).

## Delete trip

- List: ✕ on each chip.
- Inside a trip: **Delete** in the top nav next to ← Trips.
- Both open `#trip-delete-modal` (Cancel / Delete). No `window.confirm`.
- After delete: go to trip **list** (or create if none left), persist + cloud flush.

## PDF / CSV / ZIP import

`parseItineraryPages` in `js/import-planner.js`:

- Keep **itinerary pages** (city header, table header, or dated rows). Skip cover / table-of-contents / total-days pages that have **no** dates or itinerary table.
- **Continuation pages** (no header) reuse the previous page’s columns + city + date/day.
- Same **date** (or same day number when a date is missing) across pages → **one day** with **all cities** (`Istanbul · Cappadocia`) and **all rows**, including **empty placeholder** activity rows.
- Cities such as Istanbul / Cappadocia map to **Turkey** (`locationCountryHint` + `countryIso`). Missing countries are **created** and persisted as `extraCountries`. Maps URLs and planner categories are stored on the place.
- Accepts `.xlsx`, `.xls`, `.csv`, `.pdf`, **`.zip`** (CSV/PDF/Excel inside).
- After parse, `#import-pages-modal` lists **every page** with a checkbox. Itinerary / continuation pages are pre-checked; cover, TOC, and **getting-around** pages are not. Import only the checked pages, then `#import-summary-modal` lists cities and new places.
- **Export** (`buildExportPack` / `exportCsv` / `exportXlsx` / `exportPdf`) is the inverse: cover + `{City} Itinerary` pages/sheets + Getting Around guides, same 8 columns (`Date, Day, Location, Time/Order, Place/Activity, Notes, Category, Google Maps Link`). Downloads a ZIP of CSV + XLSX + PDF. A ZIP that is only those three formats re-imports the **PDF** pages so the picker matches.

Tests: `node scripts/test-import-planner.js`

Re-import after parser changes (delete the old trip first).

## Buttons on mobile

`panelPointer` on the planner panel (click + touch). Footer/nav buttons also have `onclick="WorldPlanner.act(event)"`. Skip `a[href]`, inputs, selects. Debounce duplicate touchend+click (~250–400ms). **Never let persist throw** — wrap saves; always `render()` after data changes.

## Cloud merge

`WorldStore.applyCloudPayload` hydrates seed + deltas. While the planner is **open**, snapshot listeners must **not** overwrite `view` / `activeTripId` / `activeDayNum` or re-render the planner (that made buttons feel dead).

## Don’t regress

1. Don’t pack `places`/`countries` seed into Firestore.
2. Don’t make `plannerView` return `"trip"` just because `activeTripId` is set.
3. Don’t restore session nav on every `render()`.
4. Don’t persist-to-cloud on day chip / timeline toggle / open trip.
5. Don’t make the whole activity row a button (accidental popups).
