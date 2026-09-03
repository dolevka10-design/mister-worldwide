# Setup — Mister Worldwide

## 1. Firebase

Project: **`mister-worldwide-d0e1e`** (not Money Planner).

1. [Firebase Console](https://console.firebase.google.com/project/mister-worldwide-d0e1e) → add a **Web app** → copy config into `js/firebase-config.js`
2. **Authentication** → Enable **Google** and **Email/Password**
3. **Firestore** → Create database → paste `firestore.rules` → Publish
4. **Authentication → [Settings → Authorized domains](https://console.firebase.google.com/project/mister-worldwide-d0e1e/authentication/settings)** — add every hostname you open the app from:
   - `localhost`
   - `mister-worldwide.dolevka10.workers.dev` (Cloudflare Workers)
   - `mister-worldwide.netlify.app` (if using Netlify)
   - Any custom domain you use
5. Update `ALLOWED_EMAILS` in `js/firebase-config.js` **and** `firestore.rules` (same emails)

If Google sign-in shows `auth/unauthorized-domain`, copy the hostname from the error (or your browser address bar) and add it as an authorized domain in step 4.

### Cloudflare Workers build env (optional)

`npm run build` can inject Firebase config from environment variables (useful so secrets stay out of git). Set in Cloudflare Workers → Settings → Variables:

- `MW_FIREBASE_API_KEY`
- `MW_FIREBASE_PROJECT_ID` (default: `mister-worldwide-d0e1e`)
- `MW_FIREBASE_AUTH_DOMAIN`
- `MW_FIREBASE_STORAGE_BUCKET`
- `MW_FIREBASE_MESSAGING_SENDER_ID`
- `MW_FIREBASE_APP_ID`
- `MW_FIREBASE_MEASUREMENT_ID` (optional)

Values are in Firebase Console → Project settings → Your apps → Web app → Config.

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

Travel planner trips sync via compact Firestore docs at `worldData/{uid}` (`v: 2`: `planner`, `userPlaces`, not the 2.5MB seed dump). See [docs/PLANNER.md](docs/PLANNER.md). Changing day or Timeline does not hit the cloud; **Save trip** and import do.

If you still see **quota exceeded** after this compact format, wait for the Spark daily reset or upgrade the Firebase project to Blaze. Local trips keep working.

### Import Google Maps / Takeout

**In the app:** tap **Import** in the top bar (standalone panel, not in Planner).

1. **Takeout ZIP** — upload `takeout-*.zip` (Saved places CSV lists)
2. **Paste CSV** — My Maps format with lat/lng
3. **Maps URL** — one URL per line, or `Place name | City | Country | URL` when a short link has no coordinates

**Planner itinerary import:** open **Planner** → **Import Excel/PDF/ZIP**. Accepts `.xlsx`, `.xls`, `.csv`, `.pdf`, and `.zip` with columns Date, Day, Location, Time/Order, Place/Activity, Notes, Category, Google Maps Link. New places go to the matching country (Turkey for Istanbul/Cappadocia, etc.). A summary popup lists locations added.

**CLI merge into seed:**
```bash
node scripts/import-takeout.js path/to/takeout.zip
```

Takeout CSV format (Hebrew headers): `כותרת,הערה,כתובת אתר` — title, note, Google Maps URL. Country/city inferred from list filename and geocoding.

Or use the AI assistant: `import_google_maps_csv` / `import_maps_urls` tools.

## 5. Mobile

The app is a responsive SPA sized for iOS Safari (viewport-fit, 44px+ targets, dark `input[type=date]`, full-width planner and assistant sheets). Add to home screen after deploy.
No native build required.

## 6. Troubleshooting

- **`auth/unauthorized-domain`** — the site hostname is not in Firebase Auth authorized domains. Open [Authentication settings](https://console.firebase.google.com/project/mister-worldwide-d0e1e/authentication/settings) → **Authorized domains** → **Add domain** → paste the hostname from the sign-in error (e.g. `mister-worldwide.dolevka10.workers.dev`).
- **Sign-in shows Money Planner** — `js/firebase-config.js` still points at the wrong Firebase project; replace it with the **Mister Worldwide** web app config from Project settings.
- **Empty country bar / 0 stats on load** — hard refresh; ensure you are on the latest deploy.
- **Globe blank** — check browser console; ensure `globe.gl` CDN is reachable.
- **Planner AI** — requires a Groq/OpenRouter key in the assistant; use **Quick suggest** for zero-token local picks.
- **“Quota exceeded” on import / open trip / Timeline / days** — the app used to upload all ~6k seed places (over Firestore’s 1MB limit). Current builds save only trips + new places. Hard-refresh; first successful save replaces the old oversized document. See [docs/PLANNER.md](docs/PLANNER.md).
- **← Trips does nothing** — hard-refresh this deploy. That button returns to the trip list; it must not reopen the trip just because one is still “active”.
- **Trip chip / Save / layout buttons dead until close** — same quota throw; current persist never blocks the UI. Hard-refresh after deploy.
- **Maps URL “quota” / not found** — paste `Name | City | Country | URL`, or a full `maps.google.com` link with `@lat,lng`. Country-page Add URL still saves the place on that country if the short link cannot be expanded.
- **Trip chip does nothing** — hard refresh after deploy; trips are tappable chips on the planner home list and open the itinerary on the same page.
