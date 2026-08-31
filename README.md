# Mister Worldwide

Interactive **3D travel globe** with Google Maps saved places, fine-grained categories, **Travel Planner**, and **Google Takeout / itinerary import**.

**Live:** [Netlify](https://www.netlify.com/) — see [SETUP.md](SETUP.md)

## Features

- **Mobile-first UI** — compact topbar, full-screen globe, full-width iOS panels
- **3D globe** — flag pins, steady or auto-rotate
- **Country strip** — touch scroll + arrows
- **Fine-grained categories** — pizza, burgers, sushi, ramen, bagels, museums, landmarks, etc.
- **Place browser** — filter by city & category, sort, group views
- **Travel Planner** — one scrollable itinerary document: locations → days → places with time, notes, category, and Maps links (Excel/PDF columns)
- **Import itinerary** — Excel (xlsx), PDF, or CSV in the planner (Party-in-the-USA style)
- **Import places** — Google Takeout ZIP, My Maps CSV, or Maps URLs (`Name | City | Country | URL`)
- **AI assistant** — persistent full-screen chat (Gemini / Groq / OpenRouter) with tool-calling
- **Cloud sync** — Firestore per-user data + planner + assistant chat

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

Opens as a **single page**: trip list at the top, selected trip document below.

1. **Planner** — all trips as tappable chips, **+ New trip**, **Import Excel/PDF**
2. **Create trip** — countries + date ranges; after save the itinerary document opens on the same page
3. **Trip document** (Excel columns):
   - Date · Day · Location · Time/Order · Place/Activity · Notes · Category · Google Maps
   - Grouped by location (New York, Niagara Falls, …) then day
   - Add / remove / reorder locations and places live
   - Getting-around guides (transit writeups) when imported
4. **+ Trip** on any saved place in a country page
5. **Export Excel** — CSV with the same columns

### Import a trip planner (xlsx / pdf / csv)

In Planner, tap **Import Excel/PDF**. Expected columns:

| Date | Day | Location | Time/Order | Place/Activity | Notes | Category | Google Maps Link |
|------|-----|----------|------------|----------------|-------|----------|------------------|
| 17.09.26 | Day 1 | New York | 05:15 | Landing in LGA | Flight LY027 | Transportation / Flight | https://maps.google.com/… |

New places and cities that are not in the saved bank are added and categorized from the trip row (Food & Dining, Sightseeing, Coffee & Snacks, Accommodation, Nightlife, Transportation, Guide / Info, Shopping).

## Data

```bash
node scripts/build-data.js path/to/by-country-mymaps
node scripts/import-takeout.js path/to/takeout.zip
```

Places live in `data/places.json`. Categories are refined at runtime via `js/categorize.js`.

## Quick start

```bash
npx serve .
```

Open `http://localhost:3000` — local mode works without Firebase. For cloud sync, see [SETUP.md](SETUP.md).

## License

Private project — Dolev Kaiser.
