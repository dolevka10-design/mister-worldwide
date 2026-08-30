/**
 * Import ONLY new places from Google Takeout Saved / נשמרו CSVs into data/places.json.
 *
 * Usage:
 *   node scripts/import-new-takeout.js [takeout-saved-dir]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

/** Optional — improves 0x hex Google Maps URLs; not required for forward geocoding. */
let S2 = null;
try { S2 = require("s2-geometry").S2; } catch { /* run: npm install s2-geometry */ }

const ARGS = process.argv.slice(2);
const TAKEOUT_DIR =
  ARGS.find((a) => !a.startsWith("--")) ||
  path.join(process.env.USERPROFILE || "", "Downloads", "takeout-20260830T123651Z-1-001", "Takeout", "נשמרו");
const PLACES_JSON = path.join(__dirname, "..", "data", "places.json");
const PROGRESS_FILE = path.join(__dirname, "..", "data", "import-progress.jsonl");
const LEGACY_RESULTS_CACHE = path.join(__dirname, "..", "..", "want-to-go-by-country", "results.jsonl");
const LOCAL_RESULTS_CACHE = path.join(__dirname, "..", "data", "geocode-cache.jsonl");

const CONCURRENCY = 8;
const REVERSE_INTERVAL_MS = 280;
const SKIP_FILES = new Set(["תמונות.csv", "Photos.csv"]);

const ISO_TO_COUNTRY = {
  AR: "Argentina", AT: "Austria", BR: "Brazil", BG: "Bulgaria", CL: "Chile", CN: "China",
  HR: "Croatia", CY: "Cyprus", CZ: "Czechia", FI: "Finland", FR: "France", GE: "Georgia",
  DE: "Germany", GR: "Greece", HK: "Hong Kong", HU: "Hungary", IS: "Iceland", IL: "Israel",
  IT: "Italy", JP: "Japan", LV: "Latvia", LT: "Lithuania", MO: "Macao", NL: "Netherlands",
  KP: "North Korea", NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania",
  SG: "Singapore", SI: "Slovenia", KR: "South Korea", ES: "Spain", CH: "Switzerland",
  TW: "Taiwan", TH: "Thailand", GB: "United Kingdom", US: "United States",
  KZ: "Kazakhstan", MY: "Malaysia", ID: "Indonesia", VN: "Vietnam", PH: "Philippines",
  AU: "Australia", CA: "Canada", MX: "Mexico", TR: "Turkey", EG: "Egypt", MA: "Morocco",
  AE: "United Arab Emirates", IN: "India", NZ: "New Zealand", IE: "Ireland", BE: "Belgium",
  DK: "Denmark", SE: "Sweden", LU: "Luxembourg", SK: "Slovakia", RS: "Serbia", ME: "Montenegro",
  BA: "Bosnia and Herzegovina", MK: "North Macedonia", AL: "Albania", EE: "Estonia", MT: "Malta",
};

const COUNTRY_ID = Object.fromEntries(
  Object.values(ISO_TO_COUNTRY).map((n) => [n, n.toLowerCase().replace(/ /g, "-")])
);
const ISO_FLAG = Object.fromEntries(
  Object.entries(ISO_TO_COUNTRY).map(([cc, n]) => [n, cc.toLowerCase()])
);

const LIST_HINTS = {
  "רוצה להגיע לשם.csv": { country: "", city: "" },
  "Want to go.csv": { country: "", city: "" },
  "מקומות מועדפים.csv": { country: "", city: "" },
  "Starred places.csv": { country: "", city: "" },
  "Budapest.csv": { country: "Hungary", city: "Budapest" },
  "Catania.csv": { country: "Italy", city: "Catania" },
  "Lisbon.csv": { country: "Portugal", city: "Lisbon" },
  "Norway.csv": { country: "Norway", city: "" },
  "Rio De Janeiro.csv": { country: "Brazil", city: "Rio de Janeiro" },
  "Slovenia.csv": { city: "" },
  "Croatia.csv": { city: "" },
  "Hong Kong - Macau.csv": { country: "Hong Kong", city: "Hong Kong" },
  "NYC Bagels.csv": { country: "United States", city: "New York" },
  "NYC Burgers.csv": { country: "United States", city: "New York" },
  "NYC Chinese.csv": { country: "United States", city: "New York" },
  "NYC Diners.csv": { country: "United States", city: "New York" },
  "NYC Donuts.csv": { country: "United States", city: "New York" },
  "NYC Hot Dogs.csv": { country: "United States", city: "New York" },
  "NYC Pizza.csv": { country: "United States", city: "New York" },
  "NYC Tacos.csv": { country: "United States", city: "New York" },
  "🍽️ NYC Restaurants.csv": { country: "United States", city: "New York" },
};

const LIST_CATEGORY = {
  "NYC Pizza.csv": "restaurant", "NYC Burgers.csv": "restaurant", "NYC Bagels.csv": "cafe",
  "NYC Donuts.csv": "cafe", "NYC Chinese.csv": "restaurant", "NYC Diners.csv": "restaurant",
  "NYC Hot Dogs.csv": "street_food", "NYC Tacos.csv": "restaurant",
  "🍽️ NYC Restaurants.csv": "restaurant",
  "Creating a Hotel List with Dates.csv": "hotel", "Hotel Bookings Organized By City.csv": "hotel",
};

const CATEGORY_RULES = [
  { cat: "museum", re: /\b(museum|gallery|exhibit|memorial|monument)\b/i },
  { cat: "skyscraper", re: /\b(tower|skyscraper|observation deck|observatory|spire)\b/i },
  { cat: "amusement", re: /\b(disney|universal|theme park|amusement|roller|water park|legoland)\b/i },
  { cat: "park", re: /\b(park|garden|botanical|national park|reserve|forest|trail)\b/i },
  { cat: "beach", re: /\b(beach|coast|shore|bay)\b/i },
  { cat: "restaurant", re: /\b(restaurant|bistro|brasserie|steakhouse|diner|eatery|izakaya|ramen|sushi|pizza|burger|grill|bagel|donut|taco)\b/i },
  { cat: "street_food", re: /\b(street food|food stall|night market|hawker|food court)\b/i },
  { cat: "cafe", re: /\b(cafe|café|coffee|bakery|patisserie|starbucks|espresso)\b/i },
  { cat: "bar", re: /\b(bar|pub|tavern|cocktail|brewery|winery|distillery)\b/i },
  { cat: "shopping", re: /\b(mall|shopping|outlet|boutique|department store)\b/i },
  { cat: "temple", re: /\b(temple|shrine|mosque|synagogue|church|cathedral|chapel|monastery)\b/i },
  { cat: "landmark", re: /\b(palace|castle|fort|bridge|square|plaza|gate|ruins|historic)\b/i },
  { cat: "zoo", re: /\b(zoo|aquarium|safari|wildlife)\b/i },
  { cat: "stadium", re: /\b(stadium|arena|sports|football|soccer|baseball)\b/i },
  { cat: "hotel", re: /\b(hotel|hostel|resort|inn|ryokan|booking)\b/i },
  { cat: "transport", re: /\b(station|airport|terminal|metro|subway|train)\b/i },
];

const failureStats = new Map();
let reverseChain = Promise.resolve();

function bumpFailure(reason) {
  failureStats.set(reason, (failureStats.get(reason) || 0) + 1);
}

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}

function parseCsv(text) {
  const lines = []; let buf = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { q = !q; buf += ch; }
    else if ((ch === "\n" || ch === "\r") && !q) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (buf.trim()) lines.push(buf); buf = "";
    } else buf += ch;
  }
  if (buf.trim()) lines.push(buf);
  if (!lines.length) return [];
  let start = 0;
  if (/saved from gemini/i.test(lines[0])) start = 1;
  const header = parseCsvLine(lines[start]);
  return lines.slice(start + 1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {}; header.forEach((h, idx) => { row[h] = cols[idx] ?? ""; }); return row;
  });
}

function pickField(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim()) return String(row[name]).trim();
  }
  return "";
}

function urlKey(url) {
  const m = String(url || "").match(/1s(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/i);
  if (m) return `${m[1]}:${m[2]}`.toLowerCase();
  const ft = String(url || "").match(/ftid=(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/i);
  if (ft) return `${ft[1]}:${ft[2]}`.toLowerCase();
  const c = String(url || "").match(/cid=(\d+)/i);
  if (c) return `cid:${c[1]}`;
  const ch = String(url || "").match(/1s(ChIJ[\w-]+)/i);
  if (ch) return ch[1].toLowerCase();
  return String(url || "").toLowerCase().replace(/\?entry=.*$/, "");
}

function categorize(name, desc, listFile) {
  if (LIST_CATEGORY[listFile]) return LIST_CATEGORY[listFile];
  const text = `${name} ${desc} ${listFile}`;
  for (const { cat, re } of CATEGORY_RULES) if (re.test(text)) return cat;
  return "place";
}

function httpGetJson(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = https.get(url, { headers: { "User-Agent": "MisterWorldwideImport/1.0" } }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          if (res.statusCode === 429 && left > 0) {
            setTimeout(() => attempt(left - 1), 1200);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            if (left > 0) setTimeout(() => attempt(left - 1), 600);
            else reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      });
      req.on("error", (e) => {
        if (left > 0) setTimeout(() => attempt(left - 1), 600);
        else reject(e);
      });
      req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    };
    attempt(retries);
  });
}

function extractCoordsFromUrl(url) {
  const u = decodeURIComponent(String(url || ""));

  let m = u.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = u.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = u.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = u.match(/!8m2!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  return null;
}

function extractCellHex(url) {
  const u = String(url || "");
  const m = u.match(/1s(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/i) || u.match(/ftid=(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function cellToLatLng(cellHex) {
  if (!S2 || !cellHex || cellHex.replace(/^0x/i, "").length < 15) return null;
  try {
    const ll = S2.idToLatLng(BigInt(cellHex).toString());
    if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return null;
    if (Math.abs(ll.lat) > 90 || Math.abs(ll.lng) > 180) return null;
    return { lat: ll.lat, lng: ll.lng };
  } catch { return null; }
}

function placeNameFromUrl(url) {
  const m = decodeURIComponent(String(url || "")).match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return "";
  return m[1].replace(/\+/g, " ").trim();
}

function ensureCountry(name, isoCode) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  if (!COUNTRY_ID[clean]) {
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    COUNTRY_ID[clean] = id;
    ISO_FLAG[clean] = String(isoCode || "un").toLowerCase().slice(0, 2);
  }
  return COUNTRY_ID[clean];
}

const reverseCache = new Map();
const forwardCache = new Map();

async function throttleReverse(fn) {
  const run = reverseChain.then(async () => {
    await new Promise((r) => setTimeout(r, REVERSE_INTERVAL_MS));
    return fn();
  });
  reverseChain = run.catch(() => {});
  return run;
}

async function reverseCountry(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);

  const info = await throttleReverse(async () => {
    try {
      const data = await httpGetJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
      const f = (data.features || [])[0];
      if (!f) return null;
      const p = f.properties || {};
      const cc = (p.countrycode || "").toUpperCase();
      let out = {
        countryCode: cc,
        country: ISO_TO_COUNTRY[cc] || p.country || "",
        city: p.city || p.locality || p.town || p.village || p.district || p.state || "",
      };
      if (cc === "CN" && lat > 22.15 && lat < 22.6 && lng > 113.8 && lng < 114.5) {
        out = { countryCode: "HK", country: "Hong Kong", city: out.city || "Hong Kong" };
      }
      if (cc === "CN" && lat > 22.05 && lat < 22.25 && lng > 113.5 && lng < 113.65) {
        out = { countryCode: "MO", country: "Macao", city: out.city || "Macao" };
      }
      return out;
    } catch {
      try {
        const data = await httpGetJson(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
          2
        );
        const cc = (data.address?.country_code || "").toUpperCase();
        return {
          countryCode: cc,
          country: ISO_TO_COUNTRY[cc] || data.address?.country || "",
          city: data.address?.city || data.address?.town || data.address?.village || data.address?.state || "",
        };
      } catch {
        return null;
      }
    }
  });

  reverseCache.set(key, info);
  return info;
}

async function forwardGeocode(query) {
  const q = String(query || "").trim();
  if (!q || q.length < 2) return null;
  if (forwardCache.has(q)) return forwardCache.get(q);

  const info = await throttleReverse(async () => {
    try {
      const data = await httpGetJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
      const f = (data.features || [])[0];
      if (!f?.geometry?.coordinates) return null;
      const [lng, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      const cc = (p.countrycode || "").toUpperCase();
      return {
        lat, lng,
        country: ISO_TO_COUNTRY[cc] || p.country || "",
        countryCode: cc,
        city: p.city || p.locality || p.town || p.village || p.district || "",
      };
    } catch {
      return null;
    }
  });

  forwardCache.set(q, info);
  return info;
}

function loadGeocodeCache() {
  const cache = new Map();
  for (const file of [LOCAL_RESULTS_CACHE, LEGACY_RESULTS_CACHE]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.url) cache.set(urlKey(r.url), r);
      } catch { /* skip */ }
    }
  }
  return cache;
}

function loadTakeoutPlaces(dir) {
  const all = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
    if (SKIP_FILES.has(file)) continue;
    for (const row of parseCsv(fs.readFileSync(path.join(dir, file), "utf8"))) {
      const title = pickField(row, ["כותרת", "Title", "title", "Name", "name"]);
      const note = pickField(row, ["הערה", "Note", "note", "Comment", "comment"]);
      const address = pickField(row, ["כתובת", "Address", "address"]);
      const url =
        pickField(row, ["כתובת אתר", "URL", "Url", "url", "Link", "link"]) ||
        Object.values(row).find((v) => String(v).includes("google.com/maps") || String(v).includes("maps.google")) ||
        "";
      if (!url || !title || /^כותרת$/i.test(title) || /^title$/i.test(title)) continue;
      all.push({ title, note, address, url, list: file, key: urlKey(url) });
    }
  }
  const seen = new Set();
  return all.filter((p) => { if (seen.has(p.key)) return false; seen.add(p.key); return true; });
}

async function resolvePlace(place, geocodeCache) {
  const cached = geocodeCache.get(place.key);
  const hint = LIST_HINTS[place.list] || {};

  let lat = cached?.lat ?? cached?.latitude ?? null;
  let lng = cached?.lon ?? cached?.lng ?? cached?.longitude ?? null;
  let country = cached?.country || hint.country || "";
  if (/^unresolved$/i.test(country) || /^unknown$/i.test(country)) country = "";
  let city = cached?.city || hint.city || "";

  if (lat == null || lng == null) {
    const direct = extractCoordsFromUrl(place.url);
    if (direct) { lat = direct.lat; lng = direct.lng; }
    else {
      const ll = cellToLatLng(extractCellHex(place.url));
      if (ll) { lat = ll.lat; lng = ll.lng; }
    }
  }

  if ((lat == null || lng == null) && (place.title || place.address)) {
    const query = [place.title, place.address, place.note].filter(Boolean).join(", ");
    const fwd = await forwardGeocode(query);
    if (fwd) {
      lat = fwd.lat; lng = fwd.lng;
      if (!country && fwd.country) country = fwd.country;
      if (!city && fwd.city) city = fwd.city;
    }
  }

  if (lat == null || lng == null) {
    const urlName = placeNameFromUrl(place.url);
    if (urlName && urlName !== place.title) {
      const fwd = await forwardGeocode(`${urlName}, ${place.address || ""}`.trim());
      if (fwd) {
        lat = fwd.lat; lng = fwd.lng;
        if (!country && fwd.country) country = fwd.country;
        if (!city && fwd.city) city = fwd.city;
      }
    }
  }

  if (lat == null || lng == null) return { ok: false, reason: "no_coordinates" };

  const rev = await reverseCountry(lat, lng);
  if (rev?.country) {
    country = rev.country;
    if (!city && rev.city) city = rev.city;
  } else if (!country && hint.country) {
    country = hint.country;
  }

  const countryId = ensureCountry(country);
  if (!countryId) return { ok: false, reason: "no_country" };
  if (!city) city = "Other";

  return {
    ok: true,
    place: {
      countryId,
      name: place.title,
      city,
      category: categorize(place.title, `${place.note} ${place.address}`, place.list),
      lat, lng,
      url: place.url,
      description: `${city} | ${country} | ${place.url}`,
    },
  };
}

function recalcCountries(data) {
  const map = new Map(data.countries.map((c) => [c.id, { ...c }]));
  for (const p of data.places) {
    if (!map.has(p.countryId)) {
      const name = Object.entries(COUNTRY_ID).find(([, id]) => id === p.countryId)?.[0] || p.countryId;
      map.set(p.countryId, { id: p.countryId, name, iso: ISO_FLAG[name] || "un", placeCount: 0, lat: 0, lng: 0 });
    }
  }
  for (const c of map.values()) {
    const pts = data.places.filter((p) => p.countryId === c.id);
    c.placeCount = pts.length;
    if (pts.length) {
      c.lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      c.lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    }
  }
  data.countries = [...map.values()].filter((c) => c.placeCount > 0).sort((a, b) => a.name.localeCompare(b.name));
}

async function mapPool(items, concurrency, worker) {
  let i = 0;
  let done = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
      done++;
      if (done % 50 === 0 || done === items.length) process.stdout.write(`\rResolved ${done}/${items.length}`);
    }
  }));
  console.log("");
  return results;
}

function loadProgress() {
  const map = new Map();
  if (!fs.existsSync(PROGRESS_FILE)) return map;
  for (const line of fs.readFileSync(PROGRESS_FILE, "utf8").trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.key) map.set(row.key, row);
    } catch { /* skip */ }
  }
  return map;
}

function writeProgress(map) {
  const lines = [...map.values()].map((r) => JSON.stringify(r));
  fs.writeFileSync(PROGRESS_FILE, lines.join("\n") + (lines.length ? "\n" : ""));
}

function appendGeocodeCache(row) {
  fs.appendFileSync(LOCAL_RESULTS_CACHE, JSON.stringify(row) + "\n");
}

async function main() {
  if (!fs.existsSync(TAKEOUT_DIR)) { console.error("Not found:", TAKEOUT_DIR); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(PLACES_JSON, "utf8"));
  const existKeys = new Set(data.places.map((p) => urlKey(p.url)));
  let maxId = Math.max(0, ...data.places.map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10) || 0));
  const geocodeCache = loadGeocodeCache();
  const progress = loadProgress();

  const takeout = loadTakeoutPlaces(TAKEOUT_DIR);
  const newRaw = takeout.filter((p) => {
    if (existKeys.has(p.key)) return false;
    if (progress.get(p.key)?.ok) return false;
    return true;
  });

  const fromProgress = [...progress.values()].filter((r) => r.ok && r.place && !existKeys.has(r.key));
  console.log(`Takeout: ${takeout.length} | existing: ${existKeys.size} | NEW pending: ${newRaw.length} | resumed: ${fromProgress.length}`);

  const added = fromProgress.map((r) => {
    maxId++;
    return { ...r.place, id: `p${maxId}` };
  });

  const results = await mapPool(newRaw, CONCURRENCY, async (place) => {
    try {
      const resolved = await resolvePlace(place, geocodeCache);
      if (!resolved.ok) {
        bumpFailure(resolved.reason);
        progress.set(place.key, { key: place.key, ok: false, reason: resolved.reason, title: place.title });
        return null;
      }
      progress.set(place.key, { key: place.key, ok: true, place: resolved.place });
      appendGeocodeCache({
        url: place.url,
        lat: resolved.place.lat,
        lon: resolved.place.lng,
        country: Object.entries(COUNTRY_ID).find(([, id]) => id === resolved.place.countryId)?.[0] || "",
        city: resolved.place.city,
      });
      return resolved.place;
    } catch (e) {
      bumpFailure("exception");
      progress.set(place.key, { key: place.key, ok: false, reason: "exception", title: place.title });
      return null;
    }
  });

  for (const place of results.filter(Boolean)) {
    maxId++;
    added.push({ ...place, id: `p${maxId}` });
  }

  const failed = newRaw.length - results.filter(Boolean).length;

  if (added.length) {
    data.places.push(...added);
    data.places.sort((a, b) => {
      const ca = data.countries.find((c) => c.id === a.countryId)?.name || a.countryId;
      const cb = data.countries.find((c) => c.id === b.countryId)?.name || b.countryId;
      return ca.localeCompare(cb) || a.city.localeCompare(b.city) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });
    recalcCountries(data);
    data.builtAt = new Date().toISOString();
    fs.writeFileSync(PLACES_JSON, JSON.stringify(data));
  }

  writeProgress(progress);
  const allDone = [...progress.values()].every((r) => r.ok) || failed === 0;
  if (allDone && fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

  console.log(`Added ${added.length} new places (failed ${failed})`);
  console.log(`Total: ${data.places.length} places in ${data.countries.length} countries`);

  if (failureStats.size) {
    console.log("Failure reasons:", [...failureStats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", "));
  }
  if (failed > 0) {
    console.log(`Progress saved to ${PROGRESS_FILE} — re-run the same command to continue.`);
  }

  const byCountry = {};
  for (const p of added) byCountry[p.countryId] = (byCountry[p.countryId] || 0) + 1;
  console.log("By country:", Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
