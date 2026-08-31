# Mister Worldwide

Interactive **3D travel globe** with Google Maps saved places, fine-grained categories, **Travel Planner**, and **Google Takeout import**.

**Live:** [Netlify](https://www.netlify.com/) — see [SETUP.md](SETUP.md)

## Features

- **Mobile-first UI** — compact topbar, full-screen globe, bottom-sheet panels
- **3D globe** — flag pins, steady or auto-rotate
- **Country strip** — touch scroll + arrows; all ~6,300 places assigned to countries
- **Fine-grained categories** — pizza, burgers, sushi, ramen, bagels, museums, landmarks, etc.
- **Place browser** — filter by city & category, sort, group views
- **Travel Planner** — multi-city / multi-country trips, date ranges per segment, day itinerary, AI suggestions
- **Import (standalone)** — Google Takeout ZIP or My Maps CSV paste; auto country, city, category
- **AI assistant** — Gemini / Groq / OpenRouter with tool-calling
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

Rebuild seed from Takeout locally:
```bash
node scripts/import-takeout.js path/to/takeout.zip
```

## Travel Planner

1. **Planner** → create trip with dates
2. Add **city/country segments** with date ranges
3. Use **day chips** to switch days; suggestions follow each segment's city
4. **+ Trip** on any place in a country page

## Data

```bash
node scripts/build-data.js path/to/by-country-mymaps
node scripts/import-takeout.js path/to/takeout.zip
```

~6,323 places / 40 countries in `data/places.json`. Categories refined at runtime via `js/categorize.js`.

## Quick start

```bash
npx serve .
```

Open `http://localhost:3000` — local mode works without Firebase. For cloud sync, see [SETUP.md](SETUP.md).

## License

Private project — Dolev Kaiser.
