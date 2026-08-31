/**
 * Google Maps import — My Maps CSV + Google Takeout saved-place lists.
 */
window.WorldMapsImport = (() => {
  const FILE_HINTS = [
    [/^NYC /i, { country: "United States", city: "New York City" }],
    [/Budapest/i, { country: "Hungary", city: "Budapest" }],
    [/Catania/i, { country: "Italy", city: "Catania" }],
    [/Rio De Janeiro/i, { country: "Brazil", city: "Rio de Janeiro" }],
    [/Lisbon/i, { country: "Portugal", city: "Lisbon" }],
    [/Norway/i, { country: "Norway", city: "Other" }],
    [/Slovenia/i, { country: "Slovenia", city: "Other" }],
    [/Hong Kong/i, { country: "Hong Kong", city: "Hong Kong" }],
    [/Macau/i, { country: "Macao", city: "Macao" }],
    [/Hotel/i, { country: "", city: "" }],
  ];

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
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
      if (ch === '"') { q = !q; buf += ch; }
      else if ((ch === "\n" || ch === "\r") && !q) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (buf.trim()) lines.push(buf);
        buf = "";
      } else buf += ch;
    }
    if (buf.trim()) lines.push(buf);
    if (!lines.length) return { rows: [], header: [] };
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      header.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });
      return row;
    }).filter((r) => Object.values(r).some((v) => String(v).trim()));
    return { rows, header };
  }

  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function slug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  function urlFingerprint(url) {
    const m = String(url || "").match(/1s(0x[a-f0-9]+:0x[a-f0-9]+)/i);
    return m ? m[1].toLowerCase() : norm(url);
  }

  function nameFromUrl(url) {
    const m = String(url || "").match(/\/place\/([^/]+)/);
    if (!m || !m[1]) return "";
    try { return decodeURIComponent(m[1].replace(/\+/g, " ")).trim(); } catch { return m[1].replace(/\+/g, " ").trim(); }
  }

  function parseDesc(desc) {
    const parts = String(desc || "").split("|").map((p) => p.trim());
    return { city: parts[0] || "", country: parts[1] || "", url: parts[2] || "" };
  }

  function hintFromFilename(filename) {
    const base = String(filename || "").replace(/\.csv$/i, "");
    for (const [re, hint] of FILE_HINTS) {
      if (re.test(base)) return { ...hint };
    }
    if (base && !/מקומות|רוצה|רשימת|תמונות|PMTS|Gemini/i.test(base)) {
      return { country: base.replace(/_/g, " "), city: base.replace(/_/g, " ") };
    }
    return { country: "", city: "" };
  }

  function takeoutRowFields(row) {
    const title = (row["כותרת"] || row.Name || row.name || row.title || "").trim();
    const note = (row["הערה"] || row.Description || row.description || row.note || "").trim();
    const url = (row["כתובת אתר"] || row.Url || row.url || "").trim();
    const tags = (row["תגיות"] || row.tags || "").trim();
    const lat = parseFloat(row.Latitude ?? row.latitude);
    const lng = parseFloat(row.Longitude ?? row.longitude);
    return { title, note, url, tags, lat, lng };
  }

  function isMyMapsCsv(header) {
    const h = header.map((x) => norm(x));
    return h.includes("latitude") && h.includes("longitude");
  }

  function buildUrlIndex(state) {
    const byUrl = new Map();
    for (const p of state.places || []) {
      const fp = urlFingerprint(p.url);
      if (fp) byUrl.set(fp, p);
    }
    return byUrl;
  }

  function resolveCountryId(state, countryName, lat, lng) {
    const n = norm(countryName);
    if (n && n !== "unknown") {
      let c = (state.countries || []).find((x) => norm(x.name) === n || norm(x.id) === slug(countryName));
      if (c) return { id: c.id, created: false };
      c = (state.countries || []).find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
      if (c) return { id: c.id, created: false };
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      let best = null;
      let bestD = Infinity;
      for (const c of state.countries || []) {
        if (c.lat == null || c.lng == null) continue;
        const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best && bestD < 400) return { id: best.id, created: false };
    }
    const name = (countryName && n !== "unknown") ? countryName.trim() : "Unknown";
    const id = slug(name === "Unknown" ? `region-${lat?.toFixed(1)}-${lng?.toFixed(1)}` : name);
    state.countries.push({
      id,
      name: name === "Unknown" ? `Region ${lat?.toFixed(1)},${lng?.toFixed(1)}` : name,
      iso: id.slice(0, 2) || "xx",
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,
      placeCount: 0,
    });
    CountryMeta.init(state.countries);
    return { id, created: true };
  }

  function addPlace(state, { name, desc, lat, lng, url, countryName, city, categoryHint, byUrl, existingKeys }) {
    const fp = urlFingerprint(url);
    if (fp && byUrl.has(fp)) return { status: "skipped", reason: "duplicate_url" };

    let placeLat = lat;
    let placeLng = lng;
    if ((!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) && fp && byUrl.has(fp)) {
      const prev = byUrl.get(fp);
      placeLat = prev.lat;
      placeLng = prev.lng;
    }
    if (!Number.isFinite(placeLat) || !Number.isFinite(placeLng)) {
      return { status: "needs_geocode", name, url, countryName, city, desc, categoryHint };
    }

    const key = `${norm(name)}|${placeLat.toFixed(4)}|${placeLng.toFixed(4)}`;
    if (existingKeys.has(key)) return { status: "skipped", reason: "duplicate_coords" };

    const { id: countryId, created } = resolveCountryId(state, countryName, placeLat, placeLng);
    const country = state.countries.find((c) => c.id === countryId);
    const parsed = parseDesc(desc);
    const place = {
      id: WorldStore.nextPlaceId(state),
      countryId,
      name,
      city: city || parsed.city || PlaceCategorize.parseCity(desc, country?.name),
      category: categoryHint || PlaceCategorize.categorize(name, desc || noteFrom(desc, parsed)),
      lat: placeLat,
      lng: placeLng,
      url: url || parsed.url || "",
      description: desc || `${city || parsed.city} | ${country?.name || countryName} | ${url || ""}`,
    };
    state.places.push(place);
    existingKeys.add(key);
    if (fp) byUrl.set(fp, place);
    WorldStore.recalcCountry(state, countryId);
    return { status: "added", place, created };
  }

  function noteFrom(desc, parsed) { return desc || `${parsed.city} ${parsed.country}`; }

  function importText(state, text, { dedupe = true } = {}) {
    const { rows, header } = parseCsv(text);
    if (!rows.length) throw new Error("No CSV rows found");

    const byUrl = buildUrlIndex(state);
    const existingKeys = new Set((state.places || []).map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));
    const added = [];
    const skipped = [];
    const newCountries = new Set();
    const pending = [];

    if (isMyMapsCsv(header)) {
      for (const row of rows) {
        const name = (row.Name || row.name || "").trim();
        const desc = (row.Description || row.description || "").trim();
        const lat = parseFloat(row.Latitude ?? row.latitude);
        const lng = parseFloat(row.Longitude ?? row.longitude);
        const url = (row.Url || row.url || "").trim();
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const { city, country } = parseDesc(desc);
        const r = addPlace(state, { name, desc, lat, lng, url, countryName: country, city, byUrl, existingKeys });
        if (r.status === "added") { added.push(r.place); if (r.created) newCountries.add(r.place.countryId); }
        else if (r.status === "skipped") skipped.push(name);
        else pending.push(r);
      }
    } else {
      throw new Error("Use My Maps CSV (Name,Description,Latitude,Longitude,Url) or upload a Google Takeout ZIP");
    }

    WorldStore.recategorizePlaces(state);
    return { added, skipped, newCountries: [...newCountries], pending };
  }

  function importTakeoutCsv(state, text, filename, { byUrl, existingKeys } = {}) {
    const { rows } = parseCsv(text);
    const hint = hintFromFilename(filename);
    const added = [];
    const skipped = [];
    const newCountries = new Set();
    const pending = [];

    const urlIndex = byUrl || buildUrlIndex(state);
    const keys = existingKeys || new Set((state.places || []).map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));

    for (const row of rows) {
      const { title, note, url, tags, lat, lng } = takeoutRowFields(row);
      if (!url && !title) continue;
      const name = title || nameFromUrl(url);
      if (!name) continue;
      const desc = note || tags || "";
      const r = addPlace(state, {
        name,
        desc,
        lat,
        lng,
        url,
        countryName: hint.country,
        city: hint.city,
        categoryHint: PlaceCategorize.categorize(name, `${desc} ${filename}`),
        byUrl: urlIndex,
        existingKeys: keys,
      });
      if (r.status === "added") { added.push(r.place); if (r.created) newCountries.add(r.place.countryId); }
      else if (r.status === "skipped") skipped.push(name);
      else pending.push({ ...r, filename });
    }
    return { added, skipped, newCountries: [...newCountries], pending, byUrl: urlIndex, existingKeys: keys };
  }

  async function geocodePlace(name, city, country) {
    const q = [name, city, country].filter(Boolean).join(", ");
    if (!q) return null;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json", "User-Agent": "MisterWorldwide/1.0" },
      });
      if (res.status === 429 || res.status === 503) {
        const err = new Error("Geocoding rate limit reached — try again in a minute or use a Maps URL with coordinates.");
        err.code = "GEOCODE_QUOTA";
        throw err;
      }
      const data = await res.json();
      if (!data?.[0]) return null;
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch (e) {
      if (e.code === "GEOCODE_QUOTA") throw e;
      return null;
    }
  }

  async function resolvePending(state, pending, onProgress) {
    const added = [];
    let quotaHit = false;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      onProgress?.(i + 1, pending.length, p.name);
      let coords = null;
      try {
        coords = await geocodePlace(p.name, p.city, p.countryName);
      } catch (e) {
        if (e.code === "GEOCODE_QUOTA") {
          quotaHit = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1100));
      if (!coords) continue;
      const byUrl = buildUrlIndex(state);
      const existingKeys = new Set((state.places || []).map((x) => `${norm(x.name)}|${x.lat?.toFixed(4)}|${x.lng?.toFixed(4)}`));
      const r = addPlace(state, {
        name: p.name,
        desc: p.desc || "",
        lat: coords.lat,
        lng: coords.lng,
        url: p.url,
        countryName: p.countryName,
        city: p.city,
        categoryHint: p.categoryHint,
        byUrl,
        existingKeys,
      });
      if (r.status === "added") added.push(r.place);
    }
    if (quotaHit && !added.length) {
      throw new Error("Geocoding limit reached. Open the link in Google Maps, copy a full maps.google.com URL with coordinates, or try again later.");
    }
    WorldStore.recategorizePlaces(state);
    return added;
  }

  async function importTakeoutZip(state, file, onProgress) {
    if (typeof JSZip === "undefined") throw new Error("JSZip not loaded");
    const zip = await JSZip.loadAsync(file);
    const csvFiles = Object.keys(zip.files).filter((n) => n.endsWith(".csv") && !zip.files[n].dir);
    if (!csvFiles.length) throw new Error("No CSV files found in ZIP");

    let totalAdded = [];
    let totalSkipped = [];
    const newCountries = new Set();
    let allPending = [];
    let byUrl = buildUrlIndex(state);
    let existingKeys = new Set((state.places || []).map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));

    for (let i = 0; i < csvFiles.length; i++) {
      const path = csvFiles[i];
      const filename = path.split("/").pop();
      onProgress?.(`Reading ${filename} (${i + 1}/${csvFiles.length})`);
      const text = await zip.files[path].async("string");
      const r = importTakeoutCsv(state, text, filename, { byUrl, existingKeys });
      totalAdded = totalAdded.concat(r.added);
      totalSkipped = totalSkipped.concat(r.skipped);
      r.newCountries.forEach((c) => newCountries.add(c));
      allPending = allPending.concat(r.pending);
      byUrl = r.byUrl;
      existingKeys = r.existingKeys;
    }

    let geocoded = [];
    if (allPending.length) {
      onProgress?.(`Geocoding ${allPending.length} new places…`);
      geocoded = await resolvePending(state, allPending, (n, t, name) => {
        onProgress?.(`Geocoding ${n}/${t}: ${name}`);
      });
      totalAdded = totalAdded.concat(geocoded);
    }

    WorldStore.recategorizePlaces(state);
    return {
      added: totalAdded,
      skipped: totalSkipped,
      geocoded: geocoded.length,
      newCountries: [...newCountries],
      files: csvFiles.length,
    };
  }

  function parseCoordsFromUrl(url) {
    const s = String(url || "");
    let m = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/i);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,|\?|\/|$)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = s.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    m = s.match(/!8m2!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/i);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return null;
  }

  function isMapsUrl(text) {
    return /google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(String(text || ""));
  }

  function normalizeImportText(text) {
    return String(text || "")
      .split(/\n/)
      .map((line) => line.replace(/^\s*add\s+/i, "").trim())
      .join("\n");
  }

  async function resolveMapsUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return { url: raw, lat: null, lng: null, name: null };
    try {
      const res = await fetch(`/.netlify/functions/resolve-maps?url=${encodeURIComponent(raw)}`);
      if (res.ok) {
        const data = await res.json();
        return {
          url: data.url || raw,
          lat: Number.isFinite(data.lat) ? data.lat : null,
          lng: Number.isFinite(data.lng) ? data.lng : null,
          name: data.name || null,
        };
      }
    } catch { /* fall through */ }
    return { url: raw, lat: null, lng: null, name: nameFromUrl(raw) || null };
  }

  async function expandMapsUrl(url) {
    const r = await resolveMapsUrl(url);
    return r.url;
  }

  async function importMapsUrls(state, text, { countryId, countryName, city } = {}) {
    const cleaned = normalizeImportText(text);
    const lines = cleaned.split(/\n/).map((s) => s.trim()).filter(Boolean);
    const rawUrls = lines.filter((l) => isMapsUrl(l) || l.startsWith("http"));
    if (!rawUrls.length) throw new Error("Paste one or more Google Maps URLs");

    const resolved = [];
    for (const u of rawUrls) {
      resolved.push(await resolveMapsUrl(u));
    }

    const byUrl = buildUrlIndex(state);
    const existingKeys = new Set((state.places || []).map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));
    const added = [];
    const skipped = [];
    const pending = [];
    const country = countryId ? state.countries.find((c) => c.id === countryId) : null;
    const defaultCountry = countryName || country?.name || "";

    for (const item of resolved) {
      const url = item.url;
      if (!isMapsUrl(url)) continue;
      const name = item.name || nameFromUrl(url) || "Saved place";
      let coords = null;
      if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
        coords = { lat: item.lat, lng: item.lng };
      } else {
        coords = parseCoordsFromUrl(url);
      }
      if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        const r = addPlace(state, {
          name,
          desc: `${city || ""} | ${defaultCountry} | ${url}`,
          lat: coords.lat,
          lng: coords.lng,
          url,
          countryName: defaultCountry,
          city: city || "",
          byUrl,
          existingKeys,
        });
        if (r.status === "added") added.push(r.place);
        else if (r.status === "skipped") skipped.push(name);
      } else {
        pending.push({ name, url, countryName: defaultCountry, city: city || "", desc: "" });
      }
    }

    if (pending.length) {
      const before = added.length;
      const geocoded = await resolvePending(state, pending);
      added.push(...geocoded);
      WorldStore.recategorizePlaces(state);
      const failed = pending.length - geocoded.length;
      if (!added.length && failed) {
        throw new Error("Could not resolve coordinates from this link. Open it in Google Maps, share the full URL (with @lat,lng), or import via Takeout CSV.");
      }
      return { added, skipped, geocoded: added.length - before, pending: failed };
    }

    WorldStore.recategorizePlaces(state);
    if (!added.length && skipped.length) {
      throw new Error("Place already saved (duplicate URL).");
    }
    if (!added.length) {
      throw new Error("Could not import — no coordinates found in URL. Try the full Google Maps link.");
    }
    return { added, skipped, geocoded: 0, pending: 0 };
  }

  return {
    parseCsv, importText, importTakeoutCsv, importTakeoutZip, importMapsUrls, expandMapsUrl, resolveMapsUrl,
    urlFingerprint, nameFromUrl, hintFromFilename, geocodePlace, parseCoordsFromUrl, isMapsUrl,
  };
})();
