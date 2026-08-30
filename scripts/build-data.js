/**
 * Build data/places.json from Google My Maps CSV exports (by-country-mymaps).
 * Usage: node scripts/build-data.js [sourceDir]
 */
const fs = require("fs");
const path = require("path");

const SOURCE = process.argv[2] || path.join(__dirname, "..", "..", "want-to-go-by-country", "by-country-mymaps");
const OUT = path.join(__dirname, "..", "data", "places.json");

const ISO = {
  Argentina: "ar", Austria: "at", Brazil: "br", Bulgaria: "bg", Chile: "cl", China: "cn",
  Croatia: "hr", Cyprus: "cy", Czechia: "cz", Finland: "fi", France: "fr", Georgia: "ge",
  Germany: "de", Greece: "gr", Hong_Kong: "hk", Hungary: "hu", Iceland: "is", Israel: "il",
  Italy: "it", Japan: "jp", Latvia: "lv", Lithuania: "lt", Macao: "mo", Netherlands: "nl",
  North_Korea: "kp", Norway: "no", Poland: "pl", Portugal: "pt", Romania: "ro",
  Singapore: "sg", Slovenia: "si", South_Korea: "kr", Spain: "es", Switzerland: "ch",
  Taiwan: "tw", Thailand: "th", United_Kingdom: "gb", United_States: "us",
};

const CATEGORY_RULES = [
  { cat: "museum", re: /\b(museum|gallery|exhibit|memorial|monument)\b/i },
  { cat: "skyscraper", re: /\b(tower|skyscraper|observation deck|observatory|spire)\b/i },
  { cat: "amusement", re: /\b(disney|universal|theme park|amusement|roller|water park|legoland)\b/i },
  { cat: "park", re: /\b(park|garden|botanical|national park|reserve|forest|trail)\b/i },
  { cat: "beach", re: /\b(beach|coast|shore|bay)\b/i },
  { cat: "restaurant", re: /\b(restaurant|bistro|brasserie|steakhouse|diner|eatery|izakaya|ramen|sushi|pizza|burger|grill)\b/i },
  { cat: "street_food", re: /\b(street food|food stall|night market|hawker|food court|market)\b/i },
  { cat: "cafe", re: /\b(cafe|café|coffee|bakery|patisserie|starbucks|espresso)\b/i },
  { cat: "bar", re: /\b(bar|pub|tavern|cocktail|brewery|winery|distillery)\b/i },
  { cat: "shopping", re: /\b(mall|shopping|outlet|boutique|department store|market)\b/i },
  { cat: "temple", re: /\b(temple|shrine|mosque|synagogue|church|cathedral|chapel|monastery)\b/i },
  { cat: "landmark", re: /\b(palace|castle|fort|bridge|square|plaza|gate|ruins|historic)\b/i },
  { cat: "zoo", re: /\b(zoo|aquarium|safari|wildlife)\b/i },
  { cat: "stadium", re: /\b(stadium|arena|sports|football|soccer|baseball)\b/i },
  { cat: "hotel", re: /\b(hotel|hostel|resort|inn|ryokan)\b/i },
  { cat: "transport", re: /\b(station|airport|terminal|metro|subway|train)\b/i },
];

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = [];
  let buf = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      q = !q;
      buf += ch;
    } else if ((ch === "\n" || ch === "\r") && !q) {
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
    header.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });
    return row;
  }).filter((row) => Object.values(row).some((v) => String(v).trim()));
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function categorize(name, desc) {
  const text = `${name} ${desc}`;
  for (const { cat, re } of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return "place";
}

function parseCity(desc, countryName) {
  const parts = String(desc || "").split("|").map((p) => p.trim());
  if (parts.length >= 1 && parts[0] && parts[0] !== countryName) return parts[0];
  return "Other";
}

function fileToCountry(file) {
  const base = path.basename(file, ".csv");
  const name = base.replace(/_/g, " ");
  return { id: slugify(base), name, iso: ISO[base] || base.slice(0, 2).toLowerCase(), file: base };
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error("Source not found:", SOURCE);
    process.exit(1);
  }
  const files = fs.readdirSync(SOURCE).filter((f) => f.endsWith(".csv"));
  const countries = [];
  const places = [];
  let id = 1;

  for (const file of files.sort()) {
    const meta = fileToCountry(file);
    const raw = fs.readFileSync(path.join(SOURCE, file), "utf8");
    const rows = parseCsv(raw);
    let sumLat = 0, sumLng = 0, n = 0;
    const countryPlaces = [];

    for (const row of rows) {
      const lat = parseFloat(row.Latitude);
      const lng = parseFloat(row.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const name = (row.Name || "").trim();
      const desc = (row.Description || "").trim();
      const city = parseCity(desc, meta.name);
      const category = categorize(name, desc);
      const place = {
        id: `p${id++}`,
        countryId: meta.id,
        name,
        city,
        category,
        lat,
        lng,
        url: (row.Url || "").trim(),
        description: desc,
      };
      countryPlaces.push(place);
      places.push(place);
      sumLat += lat; sumLng += lng; n++;
    }

    countries.push({
      ...meta,
      placeCount: countryPlaces.length,
      lat: n ? sumLat / n : 0,
      lng: n ? sumLng / n : 0,
    });
  }

  const out = {
    version: 1,
    builtAt: new Date().toISOString(),
    countries: countries.sort((a, b) => a.name.localeCompare(b.name)),
    places,
    categories: [
      "place", "museum", "skyscraper", "amusement", "park", "beach",
      "restaurant", "street_food", "cafe", "bar", "shopping", "temple",
      "landmark", "zoo", "stadium", "hotel", "transport",
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${places.length} places in ${countries.length} countries → ${OUT}`);
}

main();
