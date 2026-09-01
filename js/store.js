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
      planner: { trips: [], activeTripId: null, updatedAt: null },
      plannerUpdatedAt: null,
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
        planner: parsed.planner || base.planner,
        plannerUpdatedAt: parsed.plannerUpdatedAt || parsed.planner?.updatedAt || null,
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
  }

  function isRegionCountry(c) {
    if (!c) return true;
    if (String(c.id || "").startsWith("region-")) return true;
    if (/^region\b/i.test(String(c.name || ""))) return true;
    if (String(c.name || "").trim() === "Unknown") return true;
    return false;
  }

  function countriesForUi(state) {
    if (!state?.places?.length) {
      return (state?.countries || []).filter((c) => (c.placeCount || 0) > 0 && !isRegionCountry(c));
    }

    const counts = new Map();
    for (const p of state.places) {
      counts.set(p.countryId, (counts.get(p.countryId) || 0) + 1);
    }

    const byId = new Map((state.countries || []).map((c) => [c.id, { ...c }]));
    for (const sc of seed?.countries || []) {
      if (!byId.has(sc.id)) byId.set(sc.id, { ...sc });
    }

    const out = [];
    for (const [countryId, placeCount] of counts) {
      if (!placeCount) continue;
      const base = byId.get(countryId);
      const country = {
        ...(base || {
          id: countryId,
          name: countryId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          iso: countryId.slice(0, 2),
        }),
        placeCount,
      };
      if (!isRegionCountry(country)) out.push(country);
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function recategorizePlaces(state) {
    if (!state?.places?.length || typeof PlaceCategorize === "undefined") return;
    for (const p of state.places) {
      p.category = PlaceCategorize.categorize(p.name, p.description);
    }
    const cats = new Set(state.places.map((p) => p.category));
    state.categories = [...cats].sort((a, b) =>
      PlaceCategorize.label(a).localeCompare(PlaceCategorize.label(b))
    );
  }

  function reconcileState(state) {
    if (!state?.places) return state;
    const byId = new Map((state.countries || []).map((c) => [c.id, { ...c }]));

    for (const sc of seed?.countries || []) {
      if (!byId.has(sc.id)) byId.set(sc.id, { ...sc });
    }

    for (const p of state.places) {
      if (byId.has(p.countryId)) continue;
      const seedC = seed?.countries?.find((c) => c.id === p.countryId);
      byId.set(
        p.countryId,
        seedC || {
          id: p.countryId,
          name: p.countryId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          iso: p.countryId.slice(0, 2),
          placeCount: 0,
          lat: p.lat,
          lng: p.lng,
        }
      );
    }

    state.countries = [...byId.values()];
    for (const c of state.countries) recalcCountry(state, c.id);
    recategorizePlaces(state);
    if (!state.planner) state.planner = { trips: [], activeTripId: null };
    return state;
  }

  function emptyPlanner() {
    return { trips: [], activeTripId: null, view: "list", activeDayNum: 1, updatedAt: null };
  }

  function touchPlanner(state) {
    if (!state) return state;
    if (!state.planner) state.planner = emptyPlanner();
    const ts = new Date().toISOString();
    state.planner.updatedAt = ts;
    state.plannerUpdatedAt = ts;
    return state;
  }

  function plannerTimestamp(planner, fallback) {
    const t = planner?.updatedAt || fallback;
    const ms = Date.parse(t || "");
    return Number.isFinite(ms) ? ms : 0;
  }

  function tripStamp(trip) {
    return Date.parse(trip?.updatedAt || trip?.createdAt || "") || 0;
  }

  function mergePlanner(local, remote) {
    const l = local || emptyPlanner();
    const r = remote || emptyPlanner();
    const lTrips = Array.isArray(l.trips) ? l.trips : [];
    const rTrips = Array.isArray(r.trips) ? r.trips : [];
    if (!lTrips.length && !rTrips.length) return emptyPlanner();

    const byId = new Map();
    for (const trip of rTrips) if (trip?.id) byId.set(trip.id, { ...trip });
    for (const trip of lTrips) {
      if (!trip?.id) continue;
      const prev = byId.get(trip.id);
      if (!prev) {
        byId.set(trip.id, { ...trip });
        continue;
      }
      byId.set(trip.id, tripStamp(trip) >= tripStamp(prev) ? { ...prev, ...trip } : { ...trip, ...prev });
    }
    const trips = [...byId.values()].sort((a, b) => tripStamp(b) - tripStamp(a) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const lMs = plannerTimestamp(l, null);
    const rMs = plannerTimestamp(r, null);
    const updatedAt = new Date(Math.max(lMs, rMs, Date.now())).toISOString();
    return {
      trips,
      activeTripId: (lMs >= rMs ? l.activeTripId : r.activeTripId) || l.activeTripId || r.activeTripId || trips[0]?.id || null,
      view: (lMs >= rMs ? l.view : r.view) || l.view || r.view || (trips.length ? "list" : "create"),
      activeDayNum: (lMs >= rMs ? l.activeDayNum : r.activeDayNum) || l.activeDayNum || r.activeDayNum || 1,
      updatedAt,
    };
  }

  function mergePlannerKeepNav(local, remote) {
    const merged = mergePlanner(local, remote);
    try {
      const raw = sessionStorage.getItem("plannerNav");
      if (!raw) return merged;
      const nav = JSON.parse(raw);
      if (nav.view === "trip" && nav.tripId && merged.trips.some((t) => t.id === nav.tripId)) {
        merged.view = "trip";
        merged.activeTripId = nav.tripId;
        merged.activeDayNum = nav.dayNum || 1;
      }
    } catch { /* */ }
    return merged;
  }

  function packCloudPayload(state) {
    return {
      countries: state.countries,
      places: state.places,
      overrides: state.overrides || {},
      planner: state.planner || emptyPlanner(),
      plannerUpdatedAt: state.plannerUpdatedAt || state.planner?.updatedAt || null,
      updatedAt: state.updatedAt,
    };
  }

  function hasCloudData(remote) {
    return !!(remote?.places?.length || remote?.planner?.trips?.length || remote?.countries?.length);
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
    else if (sort === "category") {
      list.sort(
        (a, b) =>
          PlaceCategorize.label(a.category).localeCompare(PlaceCategorize.label(b.category)) ||
          a.city.localeCompare(b.city) ||
          a.name.localeCompare(b.name)
      );
    } else list.sort((a, b) => a.name.localeCompare(b.name));
    if (opts.order === "desc") list.reverse();
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
    nextPlaceId, recalcCountry, reconcileState, recategorizePlaces, countriesForUi, placesByCountry, groupByCity, groupByCategory,
    exportCountryCsv, importCsvPlaces,
    emptyPlanner, touchPlanner, mergePlanner, mergePlannerKeepNav, packCloudPayload, hasCloudData,
  };
})();
