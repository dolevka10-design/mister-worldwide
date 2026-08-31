# Mister Worldwide

Interactive **3D travel globe** with Google Maps saved places, fine-grained categories, **Travel Planner** (multi-city / multi-country), and **Maps import**.

**Live:** [Netlify](https://www.netlify.com/) — see [SETUP.md](SETUP.md)

## Features

- **Mobile-first UI** — compact topbar, full-screen globe, bottom-sheet panels on phone
- **3D globe** — flag pins, steady or auto-rotate
- **Country strip** — touch scroll + arrows
- **Fine-grained categories** — pizza, burgers, sushi, ramen, bagels, museums, landmarks, parks, etc.
- **Place browser** — filter by city & category, sort, group by category/city/list
- **Travel Planner** — multi-city & multi-country trips with date ranges per segment; day-by-day slots; local + AI suggestions
- **Import Maps tab** — paste Google My Maps CSV; auto-creates countries, cities, categories
- **AI assistant** — Gemini / Groq / OpenRouter with tool-calling
- **Cloud sync** — Firestore per-user data + planner + assistant chat

## Google Maps import

In **Planner → Import Maps**, paste CSV:

```text
Name,Description,Latitude,Longitude,Url
Joe's Pizza,"Rome | Italy | https://...",41.89,12.49,https://...
```

Or ask the AI: *"Import this CSV into my globe: Name,Description,..."*

## Travel Planner

1. **Planner** → create trip with start/end dates
2. **+ City** to add segments (country, city, date range)
3. Each day uses places from that segment's city
4. **Quick suggest** (zero tokens) or **AI suggest** per day
5. **+ Trip** on any place in a country page

## Data

```bash
node scripts/build-data.js path/to/by-country-mymaps
```

~6,287 places / 37 countries in `data/places.json`. Categories refined at runtime via `js/categorize.js`.

## Quick start

```bash
npx serve .
```

Open `http://localhost:3000` — local mode works without Firebase. For cloud sync, see [SETUP.md](SETUP.md).

## License

Private project — Dolev Kaiser.
