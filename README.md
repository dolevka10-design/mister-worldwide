# Mister Worldwide

Interactive **3D travel globe** with your Google Maps saved places, organized by country, city, and category — plus an AI assistant to add, remove, and revise locations.

**Live:** Deploy to [Netlify](https://www.netlify.com/) (see [SETUP.md](SETUP.md))

## Features

- **3D hollow globe** — black wireframe country borders, auto-rotating globe
- **Country pins** — flag tooltips for each country in your list
- **Place browser** — filter by category (museums, restaurants, parks, street food, skyscrapers, amusement parks, etc.) or by city
- **Google Maps data** — seeded from your My Maps CSV exports (`Name,Description,Latitude,Longitude,Url`)
- **AI assistant** — Gemini / Groq / OpenRouter with tool-calling to manage countries & places
- **Google sign-in** — Firebase Auth with email allowlist
- **Cloud sync** — Firestore per-user data + assistant chat persistence
- **Mobile-ready** — responsive layout for phone and desktop
- **Import / Export** — JSON full backup, CSV per country (Google My Maps compatible)

## Data

Seed data is built from `want-to-go-by-country/by-country-mymaps/*.csv`:

```bash
node scripts/build-data.js path/to/by-country-mymaps
```

Output: `data/places.json` (2,994 places across 38 countries).

## Project structure

```
mister-worldwide/
├── index.html          # SPA shell
├── css/styles.css      # Dark theme, mobile responsive
├── data/places.json    # Compiled seed data
├── js/
│   ├── globe.js        # Three.js / globe.gl 3D map
│   ├── store.js        # State + CSV import/export
│   ├── app.js          # UI + auth gate
│   ├── cloud.js        # Firebase sync
│   ├── assistant.js    # AI tool-calling agent
│   └── ...
├── netlify/functions/llm.js   # Groq/OpenRouter proxy
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

## AI assistant examples

- "How many restaurants do I have in Japan?"
- "Add the Eiffel Tower to France"
- "Remove all places in North Korea"
- "Import this CSV into Italy: Name,Description,..."

## License

Private project — Dolev Kaiser.
