/**
 * Google My Maps CSV paste import — auto country, city, category.
 * Format: Name,Description,Latitude,Longitude,Url
 * Description: "City | Country | https://..."
 */
window.WorldMapsImport = (() => {
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
    if (!lines.length) return [];
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      header.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });
      return row;
    }).filter((r) => Object.values(r).some((v) => String(v).trim()));
  }

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function slug(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function parseDesc(desc) {
    const parts = String(desc || "").split("|").map((p) => p.trim());
    return { city: parts[0] || "", country: parts[1] || "", url: parts[2] || "" };
  }

  function resolveCountryId(state, countryName, lat, lng) {
    const n = norm(countryName);
    if (!n) return null;
    let c = (state.countries || []).find((x) => norm(x.name) === n || norm(x.id) === slug(countryName));
    if (c) return c.id;
    c = (state.countries || []).find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
    if (c) return c.id;
    const id = slug(countryName);
    const iso = id.slice(0, 2) || "xx";
    state.countries.push({
      id,
      name: countryName.trim(),
      iso,
      lat: Number(lat) || 0,
      lng: Number(lng) || 0,
      placeCount: 0,
    });
    CountryMeta.init(state.countries);
    return id;
  }

  function importText(state, text, { dedupe = true } = {}) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("No CSV rows found — paste Google My Maps export (Name,Description,Latitude,Longitude,Url)");

    const existing = new Set((state.places || []).map((p) => `${norm(p.name)}|${p.lat?.toFixed(4)}|${p.lng?.toFixed(4)}`));
    const added = [];
    const skipped = [];
    const newCountries = new Set();

    for (const row of rows) {
      const name = (row.Name || row.name || "").trim();
      const desc = (row.Description || row.description || "").trim();
      const lat = parseFloat(row.Latitude ?? row.latitude);
      const lng = parseFloat(row.Longitude ?? row.longitude);
      const url = (row.Url || row.url || "").trim();
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const key = `${norm(name)}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (dedupe && existing.has(key)) { skipped.push(name); continue; }

      const { city, country: countryFromDesc, url: urlFromDesc } = parseDesc(desc);
      const countryName = countryFromDesc || "Unknown";
      const countryId = resolveCountryId(state, countryName, lat, lng);
      if (!countryId) continue;

      const country = state.countries.find((c) => c.id === countryId);
      const wasNew = newCountries.has(countryId);
      if (!state.countries.find((c) => c.id === countryId && c.placeCount > 0)) newCountries.add(countryId);

      const place = {
        id: WorldStore.nextPlaceId(state),
        countryId,
        name,
        city: city && city !== country?.name ? city : PlaceCategorize.parseCity(desc, country?.name),
        category: PlaceCategorize.categorize(name, desc),
        lat, lng,
        url: url || urlFromDesc || "",
        description: desc || `${city} | ${country?.name || countryName} | ${url || urlFromDesc}`,
      };
      state.places.push(place);
      existing.add(key);
      added.push(place);
      WorldStore.recalcCountry(state, countryId);
    }

    WorldStore.recategorizePlaces(state);
    return { added, skipped, newCountries: [...newCountries] };
  }

  return { parseCsv, importText };
})();
