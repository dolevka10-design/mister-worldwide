# Mister Worldwide

Interactive **3D travel globe** with your Google Maps saved places, organized by country, city, and fine-tuned category — plus an AI assistant and **Travel Planner** for day-by-day trips.

**Live:** Deploy to [Netlify](https://www.netlify.com/) (see [SETUP.md](SETUP.md))

## Features

- **3D globe** — textured Earth with country flag pins at geographic centers; steady or auto-rotate
- **Country strip** — horizontal scroll bar with all countries (touch + arrow scroll on mobile)
- **Place browser** — filter by city, category, search; sort by name/city/category; group by category, city, or flat list
- **Fine-tuned categories** — bagels, Asian/Italian restaurants, museums, landmarks, parks, bars, hotels, shows, and more
- **Travel Planner** — pick country & city, plan multi-day trips with breakfast/lunch/dinner/activity slots; quick local or compact AI suggestions
- **AI assistant** — Gemini / Groq / OpenRouter with tool-calling (places, countries, planner, CSV import)
- **Google sign-in** — Firebase Auth with email allowlist
- **Cloud sync** — Firestore per-user data + assistant chat + planner trips
- **Mobile-ready** — compact topbar, bottom-sheet country panel & planner, safe-area insets
- **Import / Export** — JSON full backup, CSV per country (Google My Maps compatible)

## Data

Seed data is built from `want-to-go-by-country/by-country-mymaps/*.csv`:

```bash
node scripts/build-data.js path/to/by-country-mymaps
```

Output: `data/places.json` (~6,287 places across 37 countries). Categories are refined at runtime via `js/categorize.js`.

## Project structure

```
mister-worldwide/
├── index.html          # SPA shell
├── css/styles.css      # Dark theme, mobile responsive
├── data/places.json    # Compiled seed data
├── js/
│   ├── globe.js        # globe.gl 3D map + pins
│   ├── store.js        # State + CSV import/export
│   ├── categorize.js   # Fine-tuned place categories
│   ├── planner.js      # Travel planner (trips, days, suggestions)
│   ├── app.js          # UI + auth gate
│   ├── cloud.js        # Firebase sync
│   ├── assistant.js    # AI tool-calling agent
│   └── ...
├── netlify/functions/llm.js   # Groq/OpenRouter proxy (compact AI for planner)
├── firestore.rules
└── SETUP.md            # Firebase + Netlify deploy guide
```

## Quick start (local)

1. Serve the folder (any static server):

   ```bash
   npx serve .
   ```

2. Open `http://localhost:3000` — works in **local mode** without Firebase.

3. For cloud sync + Google login, follow [SETUP.md](SETUP.md).

## Travel Planner

1. Tap **Planner** in the top bar (or ask the AI assistant).
2. Create a trip: pick country, city, number of days.
3. Use **Quick suggest** (local, zero tokens) or **AI suggest day** (compact ~280 token call).
4. Add places from any country page with **+ Trip** (pick day + slot: breakfast, drinks, show, etc.).
5. Ask the AI: *"Plan 3 days in Tokyo with museums and ramen"* — it uses `planner_create_trip`, `planner_suggest_day`, `planner_add_to_day`.

## AI assistant examples

- "How many Asian restaurants do I have in Japan?"
- "Add the Eiffel Tower to France"
- "Create a 4-day trip in Rome and suggest day 1"
- "Add place p123 to day 2 dinner with note: romantic dinner"

## License

Private project — Dolev Kaiser.
