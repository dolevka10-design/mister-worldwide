# Mister Worldwide

Interactive **3D travel globe** with Google Maps saved places, fine-grained categories, **Travel Planner**, and **Google Takeout / itinerary import**.

**Live:** deploy via [Netlify](https://www.netlify.com/) — see [SETUP.md](SETUP.md). Implementation notes for the planner, compact cloud sync, and day page: [docs/PLANNER.md](docs/PLANNER.md).

## Features

- **Mobile-first UI** — compact topbar, full-screen globe, full-width iOS panels
- **3D globe** — flag pins, steady or auto-rotate
- **Country strip** — touch scroll + arrows
- **Fine-grained categories** — pizza, burgers, sushi, ramen, bagels, museums, landmarks, etc.
- **Place browser** — filter by city & category, sort, group views
- **Travel Planner**
  - Trip list (open / delete with confirm) and inner day page (← Trips, delete trip)
  - Each day: **Categories** or **Timeline** (PDF order; press the 3 dotted lines to drag-reorder)
  - Activity rows: left grip, tap name to copy, **Maps**, **ⓘ**, and **✕** (delete with confirm)
  - **Map this day on globe** — globe pins + country panel of that day’s places
- **Import itinerary** — Excel / PDF / CSV / ZIP; after import, a popup lists locations and **each new place** (city, country, category, link)
- **Import places** — Google Takeout ZIP, My Maps CSV, or Maps URLs (`Name | City | Country | URL`)
- **AI assistant** — full-screen iPhone chat (Gemini / Groq / OpenRouter)
- **Cloud sync** — compact Firestore payload (trips + places you added). Seed places stay in `data/places.json` and are **not** uploaded (avoids quota errors)

## Import places

Tap **Import** in the top bar (not inside Planner):

### Google Takeout ZIP
1. Google Takeout → Saved → export as ZIP (CSV lists)
2. Upload the ZIP in **Import → Takeout ZIP**
3. Places are matched by Google URL, geocoded when needed, assigned to countries & categories

### My Maps CSV paste
```text
Name,Description,Latitude,Longitude,Url
Joe's Pizza,"Rome | Italy | https://...",41.89,12.49,https://...
```

### Maps URL
One per line. Short `maps.app.goo.gl` links are resolved when possible. If a link has no coordinates, add:

```text
Junior's Restaurant | New York | United States | https://maps.app.goo.gl/...
```

From a country page, **Add URL** uses that country as fallback so the place is still saved.

Rebuild seed from Takeout locally:
```bash
node scripts/import-takeout.js path/to/takeout.zip
```

## Travel Planner

1. **Planner** — trip chips, **+ New trip**, **Import Excel/PDF/ZIP**. ✕ deletes a trip after a confirm popup.
2. **Create trip** — countries + date ranges; itinerary opens on the same page.
3. **Inside a trip**
   - **← Trips** returns to the list (does not close Planner)
   - **Delete** in the trip header (same confirm popup)
   - Day chips scroll horizontally; dropdown + arrows change day
   - **Timeline**: numbered PDF order; press the **3 dotted lines** to drag; **tap the name** to copy it; **Maps** + **ⓘ** + **✕** (delete confirm) on each row
   - **Categories**: grouped by type; same grip + Maps + ⓘ + delete
   - **Map this day on globe** closes Planner and shows that day’s places
4. **+ Trip** on any saved place in a country page
5. **Save trip** / **Export CSV / PDF / Excel** at the bottom of the trip document

### Import a trip planner (xlsx / pdf / csv / zip)

In Planner, tap **Import Excel/PDF/ZIP**. Expected columns:

| Date | Day | Location | Time/Order | Place/Activity | Notes | Category | Google Maps Link |
|------|-----|----------|------------|----------------|-------|----------|------------------|
| 17.09.26 | Day 1 | New York | 05:15 | Landing in LGA | Flight LY027 | Transportation / Flight | https://maps.google.com/… |

PDF import lists **every page** in a checkbox popup. Itinerary city pages are pre-checked; cover and getting-around pages are not. Import only what you mark. Same-day rows across selected pages still merge. After that, a second popup lists locations and **every new place** on the globe.

**Export** writes the same structure the importer reads: a ZIP with CSV, Excel, and PDF. Cover page (`Trip Planner Total Days N`), one itinerary page/sheet per city (`New York Itinerary` + the 8 columns), continuation pages if a city is long, and **Getting Around** pages for guides. Re-import the PDF (or the ZIP) and pick the same city pages.

New places from the file are added to the correct country (e.g. Turkey) with category and Maps link.

## Data

```bash
node scripts/build-data.js path/to/by-country-mymaps
node scripts/import-takeout.js path/to/takeout.zip
node scripts/test-import-planner.js
node scripts/test-store-compact.js
```

Places live in `data/places.json`. Categories are refined at runtime via `js/categorize.js`. User trips and extra places sync compactly; see [docs/PLANNER.md](docs/PLANNER.md).

## Quick start

```bash
npx serve .
```

Open `http://localhost:3000` — local mode works without Firebase. For cloud sync, see [SETUP.md](SETUP.md).

## License

Private project — Dolev Kaiser.
