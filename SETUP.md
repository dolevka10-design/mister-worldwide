# Setup — Mister Worldwide

## 1. Firebase

1. Create a project at [Firebase Console](https://console.firebase.google.com/)
2. Add a **Web app** → copy config into `js/firebase-config.js`
3. **Authentication** → Enable **Google** and **Email/Password**
4. **Firestore** → Create database → paste `firestore.rules` → Publish
5. **Auth → Settings → Authorized domains** → add `localhost` and your Netlify domain
6. Update `ALLOWED_EMAILS` in `js/firebase-config.js` **and** `firestore.rules` (same emails)

## 2. Netlify deploy

1. Push this repo to GitHub
2. [Netlify](https://app.netlify.com/) → New site from Git → select repo
3. Build settings (from `netlify.toml`):
   - Build command: `echo 'static site'`
   - Publish directory: `.`
4. Deploy — Functions auto-deploy from `netlify/functions/`

## 3. Rebuild seed data

When you update CSV files in `want-to-go-by-country`:

```bash
node scripts/build-data.js C:\Users\dolevk\Downloads\want-to-go-by-country\by-country-mymaps
git add data/places.json
git commit -m "chore: rebuild places seed data"
```

## 4. AI keys (per user)

Each signed-in user adds their own free API key in the assistant:

- `key gemini AIza...` — [Google AI Studio](https://aistudio.google.com/apikey)
- `key groq gsk_...` — [Groq Console](https://console.groq.com/keys)
- `key openrouter sk-or-...` — [OpenRouter](https://openrouter.ai/keys)

Keys sync via Firestore `assistantChats/{uid}`.

Travel planner trips sync in `worldData/{uid}.planner` alongside places and countries.

### Import Google Maps CSV

1. Open **Planner → Import Maps**
2. Paste exported CSV (`Name,Description,Latitude,Longitude,Url`)
3. Description should be `City | Country | URL` — new countries are created automatically

Or use the AI assistant: `import_google_maps_csv` tool with pasted `csv_text`.

## 5. Mobile

The app is a responsive PWA-ready SPA. Add to home screen on iOS/Android after deploy.
No native build required.

## 6. Troubleshooting

- **Empty country bar / 0 stats on load** — hard refresh; ensure you are on the latest deploy.
- **Globe blank** — check browser console; ensure `globe.gl` CDN is reachable.
- **Planner AI** — requires a Groq/OpenRouter key in the assistant; use **Quick suggest** for zero-token local picks.
