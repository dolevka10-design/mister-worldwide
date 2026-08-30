/**
 * World travel data store — seed from data/places.json, user edits in localStorage + Firestore.
 */
window.WorldStore = (() => {
  const LS_PREFIX = "mister-worldwide-v1:";
  let seed = null;
  let userEmail = "local";

  function storageKey() {
    return LS_PREFIX + (userEmail || "local").toLowerCase();
  }

  function defaultState() {
    const countries = (seed?.countries || []).map((c) => ({ ...c }));
    const places = (seed?.places || []).map((p) => ({ ...p }));
    return {
      version: seed?.version || 1,
      countries,
      places,
      categories: seed?.categories || [],
      overrides: {},
      updatedAt: new Date().toISOString(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        countries: parsed.countries?.length ? parsed.countries : base.countries,
        places: parsed.places?.length ? parsed.places : base.places,
      };
    } catch {
      return defaultState();
    }
  }

  function saveState(state) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(storageKey(), JSON.stringify(state));
  }

  async function loadSeed() {
    const res = await fetch("data/places.json");
    if (!res.ok) throw new Error("Failed to load places.json");
    seed = await res.json();
    return seed;
  }

  function setUserEmail(email) {
    userEmail = email || "local";
  }

  function nextPlaceId(state) {
    let max = 0;
    for (const p of state.places) {
      const n = parseInt(String(p.id).replace(/\D/g, ""), 10);
      if (n > max) max = n;
    }
    return `p${max + 1}`;
  }

  function recalcCountry(state, countryId) {
    const pts = state.places.filter((p) => p.countryId === countryId);
    const c = state.countries.find((x) => x.id === countryId);
    if (!c) return;
    c.placeCount = pts.length;
    if (pts.length) {
      c.lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      c.lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    }
  }

  function placesByCountry(state, countryId, opts = {}) {
    let list = state.places.filter((p) => p.countryId === countryId);
    if (opts.category) list = list.filter((p) => p.category === opts.category);
    if (opts.city) list = list.filter((p) => p.city === opts.city);
    if (opts.query) {
      const q = opts.query.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q)
      );
    }
    const sort = opts.sort || "name";
    if (sort === "city") list.sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  function groupByCity(places) {
    const map = {};
    for (const p of places) {
      if (!map[p.city]) map[p.city] = [];
      map[p.city].push(p);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }

  function groupByCategory(places) {
    const map = {};
    for (const p of places) {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    }
    return Object.entries(map).sort(([a], [b]) =>
      PlaceCategorize.label(a).localeCompare(PlaceCategorize.label(b))
    );
  }

  function placeToCsvRow(p, countryName) {
    const desc = `${p.city} | ${countryName} | ${p.url || ""}`;
    return [p.name, desc, p.lat, p.lng, p.url || ""].map((v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",");
  }

  function exportCountryCsv(state, countryId) {
    const country = state.countries.find((c) => c.id === countryId);
    if (!country) return "";
    const header = "Name,Description,Latitude,Longitude,Url";
    const rows = placesByCountry(state, countryId).map((p) => placeToCsvRow(p, country.name));
    return [header, ...rows].join("\n");
  }

  function importCsvPlaces(state, countryId, csvText) {
    const country = state.countries.find((c) => c.id === countryId);
    if (!country) throw new Error("Country not found");
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error("CSV needs header + rows");
    const parseLine = (line) => {
      const out = []; let cur = ""; let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === "," && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const header = parseLine(lines[0]);
    const added = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      const row = {};
      header.forEach((h, idx) => { row[h] = cols[idx] ?? ""; });
      const lat = parseFloat(row.Latitude);
      const lng = parseFloat(row.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const name = (row.Name || "").trim();
      const desc = (row.Description || "").trim();
      const place = {
        id: nextPlaceId(state),
        countryId,
        name,
        city: PlaceCategorize.parseCity(desc, country.name),
        category: PlaceCategorize.categorize(name, desc),
        lat, lng,
        url: (row.Url || "").trim(),
        description: desc,
      };
      state.places.push(place);
      added.push(place);
    }
    recalcCountry(state, countryId);
    return added;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    loadSeed, loadState, saveState, defaultState, setUserEmail, uid,
    nextPlaceId, recalcCountry, placesByCountry, groupByCity, groupByCategory,
    exportCountryCsv, importCsvPlaces,
  };
})();
