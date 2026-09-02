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

  function seedPlaceMap() {
    return new Map((seed?.places || []).map((p) => [p.id, p]));
  }

  function seedCountryMap() {
    return new Map((seed?.countries || []).map((c) => [c.id, c]));
  }

  function isCompactPayload(data) {
    return !!(data && (data.v === 2 || (Array.isArray(data.userPlaces) && !data.places)));
  }

  function placeCoreEqual(a, b) {
    if (!a || !b) return false;
    const lat = (n) => (Number.isFinite(n) ? n.toFixed(5) : "");
    return a.name === b.name
      && (a.city || "") === (b.city || "")
      && (a.countryId || "") === (b.countryId || "")
      && (a.url || "") === (b.url || "")
      && lat(a.lat) === lat(b.lat)
      && lat(a.lng) === lat(b.lng);
  }

  function stripPlace(p) {
    return {
      id: p.id,
      countryId: p.countryId,
      name: p.name,
      city: p.city || "",
      category: p.category || "",
      lat: p.lat,
      lng: p.lng,
      url: p.url || "",
      description: p.description || "",
    };
  }

  function compactUserData(state) {
    if (isCompactPayload(state) && !state.places) {
      return {
        v: 2,
        planner: state.planner || emptyPlanner(),
        plannerUpdatedAt: state.plannerUpdatedAt || state.planner?.updatedAt || null,
        userPlaces: state.userPlaces || [],
        deletedPlaceIds: state.deletedPlaceIds || [],
        extraCountries: state.extraCountries || [],
        overrides: state.overrides || {},
        updatedAt: state.updatedAt || new Date().toISOString(),
      };
    }
    const seedPlaces = seedPlaceMap();
    const seedCountries = seedCountryMap();
    const planner = state?.planner || emptyPlanner();
    const plannerOut = {
      trips: planner.trips || [],
      activeTripId: planner.activeTripId || null,
      view: planner.view || "list",
      activeDayNum: planner.activeDayNum || 1,
      updatedAt: planner.updatedAt || null,
    };
    if (!seedPlaces.size) {
      return {
        v: 2,
        planner: plannerOut,
        plannerUpdatedAt: state?.plannerUpdatedAt || planner.updatedAt || null,
        userPlaces: [],
        deletedPlaceIds: [],
        extraCountries: (state?.countries || []).filter((c) => c?.id && !seedCountries.has(c.id)),
        overrides: state?.overrides || {},
        updatedAt: state?.updatedAt || new Date().toISOString(),
      };
    }
    const userPlaces = [];
    const seen = new Set();
    for (const p of state?.places || []) {
      if (!p?.id) continue;
      seen.add(p.id);
      const seedP = seedPlaces.get(p.id);
      if (!seedP || !placeCoreEqual(p, seedP)) userPlaces.push(stripPlace(p));
    }
    const deletedPlaceIds = [];
    if (seen.size >= Math.max(50, seedPlaces.size * 0.5)) {
      for (const id of seedPlaces.keys()) {
        if (!seen.has(id)) deletedPlaceIds.push(id);
      }
    }
    const extraCountries = (state?.countries || []).filter((c) => c?.id && !seedCountries.has(c.id));
    return {
      v: 2,
      planner: plannerOut,
      plannerUpdatedAt: state?.plannerUpdatedAt || planner.updatedAt || null,
      userPlaces,
      deletedPlaceIds,
      extraCountries,
      overrides: state?.overrides || {},
      updatedAt: state?.updatedAt || new Date().toISOString(),
    };
  }

  function hydrateUserData(data) {
    const state = defaultState();
    if (!data) return state;
    if (data.planner) state.planner = { ...emptyPlanner(), ...data.planner };
    state.plannerUpdatedAt = data.plannerUpdatedAt || data.planner?.updatedAt || null;
    state.overrides = data.overrides || {};
    state.updatedAt = data.updatedAt || state.updatedAt;

    const byId = new Map(state.places.map((p) => [p.id, { ...p }]));
    for (const p of data.userPlaces || []) {
      if (!p?.id) continue;
      byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
    }
    for (const id of data.deletedPlaceIds || []) byId.delete(id);
    state.places = [...byId.values()];

    const cById = new Map(state.countries.map((c) => [c.id, { ...c }]));
    for (const c of data.extraCountries || []) {
      if (c?.id) cById.set(c.id, { ...(cById.get(c.id) || {}), ...c });
    }
    state.countries = [...cById.values()];
    return reconcileState(state);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const state = isCompactPayload(parsed)
        ? hydrateUserData(parsed)
        : reconcileState({
          ...defaultState(),
          ...parsed,
          countries: parsed.countries?.length ? parsed.countries : (seed?.countries || []).map((c) => ({ ...c })),
          places: parsed.places?.length ? parsed.places : (seed?.places || []).map((p) => ({ ...p })),
          planner: parsed.planner || emptyPlanner(),
          plannerUpdatedAt: parsed.plannerUpdatedAt || parsed.planner?.updatedAt || null,
        });
      if (!isCompactPayload(parsed)) {
        try { saveState(state); } catch { /* compact rewrite best-effort */ }
      }
      return state;
    } catch {
      return defaultState();
    }
  }

  function saveState(state) {
    if (!state) return false;
    state.updatedAt = new Date().toISOString();
    const payload = compactUserData(state);
    const json = JSON.stringify(payload);
    try {
      localStorage.setItem(storageKey(), json);
      return true;
    } catch (e) {
      console.warn("Local save failed", e);
      try {
        const slim = {
          v: 2,
          planner: payload.planner,
          plannerUpdatedAt: payload.plannerUpdatedAt,
          userPlaces: payload.userPlaces,
          deletedPlaceIds: [],
          extraCountries: payload.extraCountries,
          overrides: {},
          updatedAt: payload.updatedAt,
        };
        localStorage.setItem(storageKey(), JSON.stringify(slim));
        return true;
      } catch (e2) {
        console.warn("Planner-only save failed", e2);
        return false;
      }
    }
  }

  async function loadSeed() {
    const v = window.__APP_VERSION__ || "";
    const url = v ? `data/places.json?v=${encodeURIComponent(v)}` : "data/places.json";
    const res = await fetch(url);
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
    const seedIds = seedPlaceMap();
    for (const p of state.places) {
      if (seedIds.has(p.id)) continue;
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
    const activeId = (lMs >= rMs ? l.activeTripId : r.activeTripId) || l.activeTripId || r.activeTripId || trips[0]?.id || null;
    const viewPick = (lMs >= rMs ? l.view : r.view) || l.view || r.view;
    return {
      trips,
      activeTripId: activeId,
      view: viewPick || (activeId ? "trip" : (trips.length ? "list" : "create")),
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
    const compact = compactUserData(state);
    return {
      v: 2,
      planner: {
        trips: compact.planner.trips,
        activeTripId: compact.planner.activeTripId || null,
        updatedAt: compact.planner.updatedAt || null,
      },
      plannerUpdatedAt: compact.plannerUpdatedAt,
      userPlaces: compact.userPlaces,
      deletedPlaceIds: compact.deletedPlaceIds,
      extraCountries: compact.extraCountries,
      overrides: compact.overrides,
      updatedAt: compact.updatedAt,
    };
  }

  function applyCloudPayload(local, remote) {
    if (!remote) return local;
    const remoteCompact = isCompactPayload(remote) ? remote : compactUserData(remote);
    const localCompact = compactUserData(local);
    const userById = new Map();
    for (const p of remoteCompact.userPlaces || []) if (p?.id) userById.set(p.id, p);
    for (const p of localCompact.userPlaces || []) if (p?.id) userById.set(p.id, p);
    const deleted = [...new Set([
      ...(remoteCompact.deletedPlaceIds || []),
      ...(localCompact.deletedPlaceIds || []),
    ])];
    const extraById = new Map();
    for (const c of remoteCompact.extraCountries || []) if (c?.id) extraById.set(c.id, c);
    for (const c of localCompact.extraCountries || []) if (c?.id) extraById.set(c.id, c);
    const hydrated = hydrateUserData({
      v: 2,
      planner: mergePlannerKeepNav(local?.planner, remoteCompact.planner),
      plannerUpdatedAt: localCompact.plannerUpdatedAt || remoteCompact.plannerUpdatedAt,
      userPlaces: [...userById.values()],
      deletedPlaceIds: deleted,
      extraCountries: [...extraById.values()],
      overrides: { ...(remoteCompact.overrides || {}), ...(localCompact.overrides || {}) },
      updatedAt: localCompact.updatedAt || remoteCompact.updatedAt,
    });
    if (local?.planner && hydrated.planner) {
      hydrated.planner.view = local.planner.view || hydrated.planner.view;
      hydrated.planner.activeTripId = local.planner.activeTripId || hydrated.planner.activeTripId;
      hydrated.planner.activeDayNum = local.planner.activeDayNum || hydrated.planner.activeDayNum;
    }
    return hydrated;
  }

  function hasCloudData(remote) {
    return !!(
      remote?.planner?.trips?.length
      || remote?.userPlaces?.length
      || remote?.places?.length
      || remote?.countries?.length
    );
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
    emptyPlanner, touchPlanner, mergePlanner, mergePlannerKeepNav, packCloudPayload, applyCloudPayload,
    compactUserData, hydrateUserData, isCompactPayload, hasCloudData,
    setSeed(data) { seed = data; }, getSeed() { return seed; },
  };
})();
