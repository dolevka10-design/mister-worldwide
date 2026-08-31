/**
 * Merge Google Takeout ZIP into data/places.json
 * Usage: node scripts/import-takeout.js [path/to/takeout.zip]
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ZIP = process.argv[2] || path.join(__dirname, "..", "uploads", "takeout.zip");
const OUT = path.join(__dirname, "..", "data", "places.json");
const TMP = path.join("/tmp", "takeout-import-" + Date.now());

const FILE_HINTS = [
  [/^NYC /i, { country: "United States", city: "New York City" }],
  [/Budapest/i, { country: "Hungary", city: "Budapest" }],
  [/Catania/i, { country: "Italy", city: "Catania" }],
  [/Rio De Janeiro/i, { country: "Brazil", city: "Rio de Janeiro" }],
  [/Lisbon/i, { country: "Portugal", city: "Lisbon" }],
  [/Norway/i, { country: "Norway", city: "Other" }],
  [/Slovenia/i, { country: "Slovenia", city: "Other" }],
  [/Hong Kong/i, { country: "Hong Kong", city: "Hong Kong" }],
];

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = []; let buf = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { q = !q; buf += ch; }
    else if ((ch === "\n" || ch === "\r") && !q) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (buf.trim()) lines.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) lines.push(buf);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, idx) => { row[h.trim()] = cols[idx] ?? ""; });
    return row;
  }).filter((r) => Object.values(r).some((v) => String(v).trim()));
}

function norm(s) { return String(s || "").trim().toLowerCase(); }
function slug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function urlFingerprint(url) {
  const m = String(url || "").match(/1s(0x[a-f0-9]+:0x[a-f0-9]+)/i);
  return m ? m[1].toLowerCase() : norm(url);
}
function nameFromUrl(url) {
  const m = String(url || "").match(/\/place\/([^/]+)/);
  if (!m?.[1]) return "";
  try { return decodeURIComponent(m[1].replace(/\+/g, " ")).trim(); } catch { return m[1].replace(/\+/g, " ").trim(); }
}
function hintFromFilename(filename) {
  const base = path.basename(filename, ".csv");
  for (const [re, hint] of FILE_HINTS) if (re.test(base)) return { ...hint };
  if (base && !/מקומות|רוצה|רשימת|תמונות|PMTS|Gemini/i.test(base)) return { country: base.replace(/_/g, " "), city: base.replace(/_/g, " ") };
  return { country: "", city: "" };
}

async function geocode(name, city, country) {
  const q = [name, city, country].filter(Boolean).join(", ");
  if (!q) return null;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "MisterWorldwide/1.0 (travel-app)" },
  });
  const data = await res.json();
  if (!data?.[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

function resolveCountry(state, countryName, lat, lng) {
  const n = norm(countryName);
  if (n) {
    let c = state.countries.find((x) => norm(x.name) === n || norm(x.id) === slug(countryName));
    if (c) return c.id;
    c = state.countries.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
    if (c) return c.id;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best = null, bestD = Infinity;
    for (const c of state.countries) {
      if (c.lat == null || c.lng == null) continue;
      const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < 400) return best.id;
  }
  const id = slug(countryName || `region-${lat}-${lng}`);
  state.countries.push({ id, name: countryName || id, iso: id.slice(0, 2), lat: lat || 0, lng: lng || 0, placeCount: 0 });
  return id;
}

async function main() {
  if (!fs.existsSync(ZIP)) {
    console.error("ZIP not found:", ZIP);
    process.exit(1);
  }
  fs.mkdirSync(TMP, { recursive: true });
  execSync(`unzip -q -o "${ZIP}" -d "${TMP}"`);

  const data = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const byUrl = new Map();
  for (const p of data.places) {
    const fp = urlFingerprint(p.url);
    if (fp) byUrl.set(fp, p);
  }
  const keys = new Set(data.places.map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));
  let nextId = Math.max(0, ...data.places.map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10) || 0)) + 1;

  const csvFiles = [];
  function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".csv")) csvFiles.push(p);
    }
  }
  walk(TMP);

  let added = 0, skipped = 0, geocoded = 0;
  const pending = [];

  for (const file of csvFiles) {
    const rows = parseCsv(fs.readFileSync(file, "utf8"));
    const hint = hintFromFilename(file);
    for (const row of rows) {
      const title = (row["כותרת"] || row.Name || "").trim();
      const url = (row["כתובת אתר"] || row.Url || "").trim();
      const note = (row["הערה"] || row.Description || "").trim();
      if (!url && !title) continue;
      const name = title || nameFromUrl(url);
      if (!name) continue;
      const fp = urlFingerprint(url);
      if (fp && byUrl.has(fp)) { skipped++; continue; }

      let lat = parseFloat(row.Latitude);
      let lng = parseFloat(row.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        pending.push({ name, url, note, hint, file: path.basename(file) });
        continue;
      }

      const countryId = resolveCountry(data, hint.country, lat, lng);
      const key = `${norm(name)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (keys.has(key)) { skipped++; continue; }
      const place = {
        id: `p${nextId++}`, countryId, name,
        city: hint.city || "Other",
        category: "place", lat, lng, url,
        description: note || `${hint.city} | ${hint.country} | ${url}`,
      };
      data.places.push(place);
      keys.add(key);
      if (fp) byUrl.set(fp, place);
      added++;
    }
  }

  console.log(`Pending geocode: ${pending.length}`);
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    const coords = await geocode(p.name, p.hint.city, p.hint.country);
    await new Promise((r) => setTimeout(r, 1100));
    if (!coords) { console.warn("No geocode:", p.name); continue; }
    const countryId = resolveCountry(data, p.hint.country, coords.lat, coords.lng);
    const place = {
      id: `p${nextId++}`, countryId, name: p.name,
      city: p.hint.city || "Other",
      category: "place", lat: coords.lat, lng: coords.lng, url: p.url,
      description: p.note || `${p.hint.city} | ${p.hint.country} | ${p.url}`,
    };
    data.places.push(place);
    const fp = urlFingerprint(p.url);
    if (fp) byUrl.set(fp, place);
    added++;
    geocoded++;
    if ((i + 1) % 10 === 0) console.log(`Geocoded ${i + 1}/${pending.length}`);
  }

  for (const c of data.countries) {
    c.placeCount = data.places.filter((p) => p.countryId === c.id).length;
  }

  const orphans = data.places.filter((p) => !data.countries.find((c) => c.id === p.countryId));
  if (orphans.length) console.warn("Orphans:", orphans.length);

  data.builtAt = new Date().toISOString();
  data.version = 1.2;
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`Done: ${added} added, ${skipped} skipped, ${geocoded} geocoded → ${data.places.length} total places, ${data.countries.length} countries`);
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
