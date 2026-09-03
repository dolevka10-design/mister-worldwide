/**
 * Mister Worldwide — main app shell
 */
window.WorldApp = (() => {
  let state = null;
  let user = null;
  let ready = false;
  let selectedCountry = null;
  let viewMode = "category"; // category | city | list | trip
  let filterCategory = "";
  let filterCity = "";
  let filterQuery = "";
  let sortBy = "name";
  let sortOrder = "asc";
  let tripDayFilter = "";
  let tripCityFilter = "";
  let tripActivityCategoryFilter = "";
  let placeIdFilter = null;
  let dayPanelLabel = "";
  let placeIdOrder = [];
  const CITY_CENTER_KEY = "mister-worldwide-city-centers-v8";
  const KNOWN_CITY_CENTERS = {
    "united-states|Brooklyn": { lat: 40.6782, lng: -73.9442 },
    "united-states|Manhattan": { lat: 40.7831, lng: -73.9712 },
    "united-states|Queens": { lat: 40.7282, lng: -73.7949 },
    "united-states|Bronx": { lat: 40.8448, lng: -73.8648 },
    "united-states|Staten Island": { lat: 40.5795, lng: -74.1502 },
    "united-states|New York": { lat: 40.7128, lng: -74.006 },
    "united-states|Jersey City": { lat: 40.7282, lng: -74.0776 },
    "united-states|Hoboken": { lat: 40.7439, lng: -74.0324 },
  };
  const cityCenterCache = new Map();
  let cityCenterResolveGen = 0;
  const overlayPanels = new Set();

  function syncGlobeOverlay() {
    const countryOpen = document.body.classList.contains("country-panel-open");
    const overlayOpen = overlayPanels.size > 0;
    document.body.classList.toggle("overlay-panel-open", overlayOpen);
    WorldGlobe.setPinsVisible?.(!(countryOpen || overlayOpen));
  }

  function setOverlayPanel(id, open) {
    if (open) overlayPanels.add(id);
    else overlayPanels.delete(id);
    syncGlobeOverlay();
  }


  function isLatinLabel(text) {
    const s = String(text || "").trim();
    if (!s) return false;
    if (/[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u1100-\u11FF\u3100-\u312F\u3130-\u318F]/.test(s)) {
      return false;
    }
    return /[A-Za-z]/.test(s);
  }

  function normalizeCityLabel(text) {
    return String(text || "")
      .replace(/\s+(District|Municipality|Subdistrict|County|Province)$/i, "")
      .trim();
  }

  function isDisplayableCityLabel(text) {
    const s = String(text || "").trim();
    return s.length > 0 && s !== "Other";
  }

  function extractLatinFromMixed(text) {
    const parts = String(text || "").split(/\s+/);
    for (const part of parts) {
      const p = part.trim();
      if (p.length >= 2 && isLatinLabel(p)) return p;
    }
    const match = String(text || "").match(/[A-Za-z][A-Za-z\s.'-]{1,}/);
    return match ? match[0].trim() : "";
  }

  const $ = (id) => document.getElementById(id);

  function toast() {
    /* Status toasts removed — they stayed visible on mobile and cluttered the globe/planner. */
  }

  function persist(opts = {}) {
    const {
      touchPlanner = false,
      cloud = true,
      refreshUi = true,
    } = opts;
    if (touchPlanner) WorldStore.touchPlanner(state);
    try {
      WorldStore.saveState(state);
    } catch (e) {
      console.warn("Local persist failed", e);
    }
    if (cloud && user?.uid && WorldCloud.configured && !WorldCloud.isApplyingRemote?.()) {
      WorldCloud.scheduleSave(user.uid, state);
    }
    if (refreshUi) {
      WorldGlobe.updatePins(countriesForUi(state));
      renderCountryPanel();
      renderStats();
      resolveCityCenters();
    }
  }

  function persistNav() {
    persist({ cloud: false, touchPlanner: false, refreshUi: false });
  }

  function persistPlanner({ flush, skipPlannerRender, cloud = true } = {}) {
    persist({ touchPlanner: true, cloud, refreshUi: false });
    if (!skipPlannerRender && WorldPlanner?.isOpen?.()) WorldPlanner?.render?.(state);
    if (flush && cloud && user?.uid && WorldCloud.configured) {
      return WorldCloud.flushSave(user.uid, state).catch((e) => {
        console.warn("Planner flush failed", e);
        return { ok: false, error: e };
      });
    }
    return Promise.resolve({ ok: true });
  }

  function getState() { return state; }

  function setState(next, { skipPersist } = {}) {
    state = next;
    if (!skipPersist) persist();
    return state;
  }

  function cloneState() {
    return JSON.parse(JSON.stringify(state));
  }

  function refresh() {
    renderStats();
    renderCountryList();
    if (selectedCountry) renderCountryPanel();
    if (WorldGlobe.isReady?.()) {
      WorldGlobe.updatePins(countriesForUi(state));
      resolveCityCenters();
    } else if (!$("app-root")?.classList.contains("hidden")) {
      ensureGlobe();
    }
    if (WorldPlanner?.isOpen?.()) WorldPlanner.render(state);
  }

  function countriesForUi(state) {
    return WorldStore.countriesForUi(state);
  }

  function renderStats() {
    if (!state?.places) return;
    const total = state.places.length;
    const list = countriesForUi(state);
    $("stat-places").textContent = total.toLocaleString();
    $("stat-countries").textContent = list.length;
  }

  function renderCountryList() {
    const el = $("country-list");
    if (!el || !state) return;
    const list = countriesForUi(state);
    el.innerHTML = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (c) => `
      <button type="button" class="country-chip ${selectedCountry === c.id ? "active" : ""}" data-country="${c.id}">
        <img src="${CountryMeta.flagUrl(c.iso, 20)}" alt="" width="20" height="14" loading="lazy"/>
        <span>${c.name}</span>
        <small>${c.placeCount}</small>
      </button>`
      )
      .join("");
    el.querySelectorAll("[data-country]").forEach((btn) => {
      btn.addEventListener("click", () => selectCountry(btn.dataset.country));
    });
    updateCountryStripArrows();
  }

  const THEME_KEY = "mw-theme";

  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === "light" ? "#f5f5f8" : "#050508";
    const btn = $("btn-theme-toggle");
    if (btn) {
      btn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
      btn.textContent = next === "light" ? "☀️" : "🌙";
      btn.title = next === "light" ? "Switch to dark mode" : "Switch to light mode";
    }
  }

  function initTheme() {
    let saved = "dark";
    try { saved = localStorage.getItem(THEME_KEY) || "dark"; } catch { /* */ }
    applyTheme(saved);
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme || "dark";
    applyTheme(current === "light" ? "dark" : "light");
  }

  function fmtShortDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
  }

  function collectTripActivitiesForCountry(countryId) {
    if (!state?.planner?.trips?.length) return [];
    const rows = [];
    for (const trip of state.planner.trips) {
      WorldPlanner.migrateTrip(trip);
      for (let i = 0; i < (trip.days || []).length; i++) {
        const dayNum = i + 1;
        const day = trip.days[i];
        const seg = WorldPlanner.segmentForDay(trip, dayNum);
        if (seg?.countryId !== countryId) continue;
        const segCity = seg?.city && seg.city !== "Other" ? seg.city : "";
        for (const item of WorldPlanner.itemsOf(day)) {
          const name = String(item.name || "").trim();
          if (!name || name === "—") continue;
          const city = item.importLocation || segCity || "Other";
          const categoryLabel = item.importCategoryLabel || PlaceCategorize.plannerLabel(item.category) || "Other";
          rows.push({
            tripId: trip.id,
            tripName: trip.name || "Trip",
            dayNum,
            dayDate: day.date || null,
            dayKey: `${trip.id}|${dayNum}`,
            countryId,
            city,
            category: item.category || "place",
            categoryLabel,
            name,
            url: item.url || "",
            time: item.time || "",
            itemId: item.id,
          });
        }
      }
    }
    return rows;
  }

  function updatePanelFilterMode() {
    const tripMode = viewMode === "trip";
    $("panel-filters-places")?.classList.toggle("hidden", tripMode);
    $("panel-filters-trip")?.classList.toggle("hidden", !tripMode);
    $("panel-place-actions")?.classList.toggle("hidden", tripMode);
  }

  function setActiveViewTab(id) {
    document.querySelectorAll(".view-toggle .tab").forEach((t) => t.classList.remove("active"));
    $(id)?.classList.add("active");
  }

  function updateCountryStripArrows() {
    const list = $("country-list");
    const left = $("country-scroll-left");
    const right = $("country-scroll-right");
    if (!list || !left || !right) return;
    const max = list.scrollWidth - list.clientWidth;
    left.disabled = list.scrollLeft <= 2;
    right.disabled = max <= 2 || list.scrollLeft >= max - 2;
  }

  function countryStripScrollStep() {
    const list = $("country-list");
    if (!list) return 180;
    return Math.max(140, Math.round(list.clientWidth * 0.72));
  }

  function clearDayPlaceFilter() {
    placeIdFilter = null;
    dayPanelLabel = "";
    placeIdOrder = [];
  }

  function loadCityCenterCache() {
    try {
      const raw =
        localStorage.getItem(CITY_CENTER_KEY) ||
        localStorage.getItem("mister-worldwide-city-centers-v7") ||
        localStorage.getItem("mister-worldwide-city-centers-v6") ||
        localStorage.getItem("mister-worldwide-city-centers-v5") ||
        localStorage.getItem("mister-worldwide-city-centers-v4") ||
        localStorage.getItem("mister-worldwide-city-centers-v3");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      for (const [key, val] of Object.entries(data)) {
        if (!Number.isFinite(val?.lat) || !Number.isFinite(val?.lng)) continue;
        const labelEn = String(val.labelEn || val.label || "").trim();
        cityCenterCache.set(key, {
          lat: val.lat,
          lng: val.lng,
          labelEn: labelEn && isLatinLabel(labelEn) ? labelEn : "",
        });
      }
    } catch {
      /* ignore */
    }
  }

  function saveCityCenterCache() {
    try {
      const data = Object.fromEntries(cityCenterCache);
      localStorage.setItem(CITY_CENTER_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function medianCoord(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function fallbackCityCenter(places) {
    const lat = medianCoord(places.map((p) => p.lat));
    const lng = medianCoord(places.map((p) => p.lng));
    return { lat, lng };
  }

  function cityCenterKey(countryId, city) {
    return `${countryId}|${city}`;
  }

  function countryNameForId(countryId) {
    return state?.countries?.find((c) => c.id === countryId)?.name || "";
  }

  function knownCityCenter(countryId, city) {
    return KNOWN_CITY_CENTERS[cityCenterKey(countryId, city)] || null;
  }

  function clusterDistance(a, b) {
    if (!a || !b) return Infinity;
    let dLng = a.lng - b.lng;
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    return Math.hypot(a.lat - b.lat, dLng);
  }

  function geocodeQueryFor(city, countryName, places) {
    const us = /^(united states|usa|u\.s\.a\.?)$/i.test(String(countryName || "").trim());
    const nycBoroughs = new Set(["Brooklyn", "Manhattan", "Queens", "Bronx", "Staten Island"]);
    if (us && nycBoroughs.has(city)) return `${city}, New York City, NY, USA`;
    if (us && city === "New York") return "New York City, NY, USA";
    return [city, countryName].filter(Boolean).join(", ");
  }

  function nearPlaceCluster(center, places, maxDeg = 4.5) {
    const ref = fallbackCityCenter(places);
    if (!ref || !center) return false;
    const dLat = center.lat - ref.lat;
    let dLng = center.lng - ref.lng;
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    return Math.hypot(dLat, dLng) <= maxDeg;
  }

  function cityDisplayLabel(countryId, city) {
    if (!isDisplayableCityLabel(city)) return city === "Other" ? "Other" : "";
    const key = cityCenterKey(countryId, city);
    const cached = cityCenterCache.get(key);
    const english = normalizeCityLabel(cached?.labelEn);
    if (english && isLatinLabel(english)) return english;
    const mixed = extractLatinFromMixed(city);
    if (mixed && mixed !== city) return mixed;
    if (isLatinLabel(city)) return normalizeCityLabel(city) || city;
    return city;
  }

  function needsEnglishCityLabel(existing, city) {
    if (!existing?.labelEn) return true;
    if (!isLatinLabel(existing.labelEn)) return true;
    if (existing.labelEn === city) return true;
    return false;
  }

  async function fetchGeocodeEnglishLabel(lat, lng, city, countryName) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    if (city) params.set("city", city);
    if (countryName) params.set("country", countryName);
    try {
      const res = await fetch(`/api/geocode/label?${params}`);
      if (!res.ok) return "";
      const data = await res.json();
      const label = String(data?.labelEn || "").trim();
      if (label && isLatinLabel(label)) return label;
      return extractLatinFromMixed(label);
    } catch {
      return "";
    }
  }

  async function photonReverseEnglishLabel(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    try {
      const res = await fetch(
        `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&lang=en`
      );
      if (!res.ok) return "";
      const data = await res.json();
      const candidates = [];
      for (const feature of data?.features || []) {
        const p = feature?.properties || {};
        candidates.push(p.city, p.town, p.municipality, p.district, p.locality, p.county, p.name);
      }
      for (const c of candidates) {
        const s = normalizeCityLabel(c);
        if (s && isLatinLabel(s)) return s;
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  async function resolveEnglishCityLabel(city, countryName, lat, lng, places) {
    if (!isLatinLabel(city)) {
      const fromMixed = extractLatinFromMixed(city);
      if (fromMixed) return fromMixed;
    }

    const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : fallbackCityCenter(places);
    if (center) {
      const fromPhoton = await photonReverseEnglishLabel(center.lat, center.lng);
      if (fromPhoton) return fromPhoton;
      const fromApi = await fetchGeocodeEnglishLabel(center.lat, center.lng, city, countryName);
      if (fromApi) return fromApi;
    }

    const photon = await photonCityLookup(city, countryName, places);
    if (photon?.labelEn) {
      const label = normalizeCityLabel(photon.labelEn);
      if (isLatinLabel(label)) return label;
      const latin = extractLatinFromMixed(label);
      if (latin) return latin;
    }
    if (isLatinLabel(city)) return normalizeCityLabel(city) || city;
    return "";
  }

  function rankPhotonCityFeatures(features, city, countryName, places) {
    const cityLower = city.toLowerCase();
    const countryLower = String(countryName || "").toLowerCase();
    const preferredTypes = new Set(["city", "town", "municipality", "borough", "locality", "suburb"]);
    const ref = fallbackCityCenter(places);
    return (features || [])
      .map((f) => {
        const [lng, lat] = f.geometry?.coordinates || [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const p = f.properties || {};
        const labelEn = String(p.name || p.city || "").trim();
        const name = labelEn.toLowerCase();
        const type = String(p.type || p.osm_value || "").toLowerCase();
        const featureCountry = String(p.country || "").toLowerCase();
        const stateName = String(p.state || "").toLowerCase();
        let score = 0;
        if (name === cityLower) score += 10;
        else if (name.startsWith(cityLower) || cityLower.startsWith(name)) score += 6;
        else if (name.includes(cityLower) || cityLower.includes(name)) score += 3;
        if (preferredTypes.has(type)) score += 5;
        if (type === "borough" && cityLower === "brooklyn") score += 4;
        if (countryLower && featureCountry === countryLower) score += 6;
        else if (countryLower && featureCountry.includes(countryLower)) score += 2;
        if (stateName.includes("new york") && cityLower === "brooklyn") score += 5;
        return { lat, lng, score, labelEn };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((hit) => ({ ...hit, dist: clusterDistance(hit, ref) }));
  }

  async function photonCityLookup(city, countryName, places) {
    const q = geocodeQueryFor(city, countryName, places);
    if (!q) return null;
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&osm_tag=place:city&osm_tag=place:town&osm_tag=place:municipality&osm_tag=place:borough&osm_tag=place:suburb`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const ranked = rankPhotonCityFeatures(data?.features || [], city, countryName, places);
    if (!ranked.length) return null;
    const valid = ranked.filter((hit) => hit.score >= 8 && nearPlaceCluster(hit, places, 3.5));
    if (valid.length) {
      valid.sort((a, b) => a.dist - b.dist);
      return valid[0];
    }
    for (const hit of ranked) {
      if (hit.score < 8) continue;
      if (!nearPlaceCluster(hit, places)) continue;
      return hit;
    }
    return ranked[0]?.score >= 5 ? ranked[0] : null;
  }

  async function geocodeCityCenter(city, countryId, countryName, places) {
    const known = knownCityCenter(countryId, city);
    const fallback = fallbackCityCenter(places);
    if (known) {
      const labelEn = await resolveEnglishCityLabel(city, countryName, known.lat, known.lng, places);
      return { ...known, labelEn: labelEn || "" };
    }
    try {
      const hit = await photonCityLookup(city, countryName, places);
      const lat = hit?.lat ?? fallback?.lat;
      const lng = hit?.lng ?? fallback?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const labelEn = await resolveEnglishCityLabel(city, countryName, lat, lng, places);
      return { lat, lng, labelEn: labelEn || "" };
    } catch {
      return null;
    }
  }

  async function resolveCityCenters() {
    if (!state?.places?.length) return;
    const gen = ++cityCenterResolveGen;
    const groups = new Map();
    for (const p of state.places) {
      const city = String(p.city || "").trim();
      if (!city || city === "Other") continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const key = cityCenterKey(p.countryId, city);
      if (!groups.has(key)) groups.set(key, { countryId: p.countryId, city, places: [] });
      groups.get(key).places.push(p);
    }

    const pending = [];
    for (const g of groups.values()) {
      const key = cityCenterKey(g.countryId, g.city);
      const known = knownCityCenter(g.countryId, g.city);
      const existing = cityCenterCache.get(key);
      if (known && !existing) {
        cityCenterCache.set(key, { ...known, labelEn: "" });
        continue;
      }
      const needsCoords = !Number.isFinite(existing?.lat) && !known;
      const needsLabel = needsEnglishCityLabel(existing, g.city);
      if (needsCoords || needsLabel) pending.push(g);
    }

    if (!pending.length) return;
    const batchSize = 4;
    for (let i = 0; i < pending.length; i += batchSize) {
      if (gen !== cityCenterResolveGen) return;
      const batch = pending.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (g) => {
          const key = cityCenterKey(g.countryId, g.city);
          const existing = cityCenterCache.get(key);
          const known = knownCityCenter(g.countryId, g.city);
          const countryName = countryNameForId(g.countryId);
          const fallback = fallbackCityCenter(g.places);
          let lat = existing?.lat ?? known?.lat;
          let lng = existing?.lng ?? known?.lng;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const photon = await photonCityLookup(g.city, countryName, g.places);
            lat = photon?.lat ?? fallback?.lat;
            lng = photon?.lng ?? fallback?.lng;
          }
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const labelEn = await resolveEnglishCityLabel(g.city, countryName, lat, lng, g.places);
          cityCenterCache.set(key, { lat, lng, labelEn: labelEn || "" });
        })
      );
      if (gen !== cityCenterResolveGen) return;
      if (cityCenterCache.size) saveCityCenterCache();
      if (WorldGlobe.getPinViewMode?.() === "city" && WorldGlobe.isReady?.()) {
        WorldGlobe.refreshCityPins?.();
      }
      if (WorldPlanner?.isOpen?.()) WorldPlanner.render?.(state);
      if (selectedCountry) renderCountryPanel();
      if (i + batchSize < pending.length) await new Promise((r) => setTimeout(r, 300));
    }
  }

  function cityPinsForCountry(countryId) {
    return allCityPins().filter((p) => p.countryId === countryId);
  }

  function allCityPins() {
    if (!state?.places?.length) return [];
    const groups = new Map();
    for (const p of state.places) {
      const city = String(p.city || "").trim();
      if (!city || city === "Other") continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const key = cityCenterKey(p.countryId, city);
      if (!groups.has(key)) groups.set(key, { countryId: p.countryId, city, places: [] });
      groups.get(key).places.push(p);
    }
    const pins = [];
    for (const g of groups.values()) {
      const key = cityCenterKey(g.countryId, g.city);
      const known = knownCityCenter(g.countryId, g.city);
      const cached = cityCenterCache.get(key);
      const center = known || cached || fallbackCityCenter(g.places);
      pins.push({
        countryId: g.countryId,
        city: g.city,
        label: cityDisplayLabel(g.countryId, g.city) || g.city,
        lat: center.lat,
        lng: center.lng,
        placeCount: g.places.length,
      });
    }
    return pins;
  }

  function openCountryPanel() {
    document.body.classList.add("country-panel-open");
    $("country-panel")?.classList.add("open");
    syncGlobeOverlay();
  }

  function closeCountryPanel() {
    $("country-panel")?.classList.remove("open");
    document.body.classList.remove("country-panel-open");
    selectedCountry = null;
    clearDayPlaceFilter();
    filterCity = "";
    WorldGlobe.restoreCountryPins?.();
    syncGlobeOverlay();
    renderCountryList();
  }

  function selectCityInCountry(countryId, city) {
    if (!countryId || !city) return;
    clearDayPlaceFilter();
    selectedCountry = countryId;
    filterCategory = "";
    filterQuery = "";
    filterCity = city;
    tripDayFilter = "";
    tripCityFilter = "";
    tripActivityCategoryFilter = "";
    viewMode = "list";
    setActiveViewTab("view-list");
    const q = $("place-search");
    if (q) q.value = "";
    const citySel = $("city-filter");
    if (citySel) citySel.value = city;
    const pin = cityPinsForCountry(countryId).find((p) => p.city === city);
    if (pin) WorldGlobe.focusCity?.(pin.lat, pin.lng);
    else WorldGlobe.focusCountry(countryId);
    renderCountryList();
    renderCountryPanel();
    openCountryPanel();
  }

  function selectCountry(countryId, { keepDayFilter = false } = {}) {
    if (!keepDayFilter) clearDayPlaceFilter();
    selectedCountry = countryId;
    filterCategory = "";
    filterCity = "";
    filterQuery = "";
    tripDayFilter = "";
    tripCityFilter = "";
    tripActivityCategoryFilter = "";
    sortBy = "name";
    sortOrder = "asc";
    const q = $("place-search");
    if (q) q.value = "";
    const citySel = $("city-filter");
    if (citySel) citySel.value = "";
    WorldGlobe.focusCountry(countryId);
    renderCountryList();
    renderCountryPanel();
    openCountryPanel();
  }

  function showDayPlacesOnCountry(countryId, placeIds, { city, label, order } = {}) {
    const ids = (placeIds || []).filter(Boolean);
    placeIdFilter = ids.length ? new Set(ids) : null;
    placeIdOrder = order?.length ? order.filter((id) => ids.includes(id)) : ids;
    dayPanelLabel = label || "";
    selectedCountry = countryId;
    filterCategory = "";
    filterQuery = "";
    sortBy = "name";
    sortOrder = "asc";
    if (city) filterCity = city;
    else filterCity = "";
    const q = $("place-search");
    if (q) q.value = "";
    viewMode = "list";
    setActiveViewTab("view-list");
    renderCountryList();
    renderCountryPanel();
    openCountryPanel();
    $("app-root")?.classList.remove("hidden");
  }

  function renderCountryPanel() {
    const panel = $("country-panel");
    if (!panel || !selectedCountry) return;
    const country = state.countries.find((c) => c.id === selectedCountry);
    if (!country) return;

    updatePanelFilterMode();

    $("panel-flag").src = CountryMeta.flagUrl(country.iso, 80);
    $("panel-flag").alt = country.name;
    $("panel-title").textContent = country.name;

    const body = $("panel-body");
    if (!body) return;

    if (viewMode === "trip") {
      const allActivities = collectTripActivitiesForCountry(selectedCountry);
      const tripCities = [...new Set(allActivities.map((a) => a.city).filter((c) => c && c !== "Other"))].sort();
      const tripCats = [...new Set(allActivities.map((a) => a.categoryLabel).filter(Boolean))].sort();
      const tripDays = [];
      const daySeen = new Set();
      for (const a of allActivities) {
        if (daySeen.has(a.dayKey)) continue;
        daySeen.add(a.dayKey);
        const parts = [a.tripName, `Day ${a.dayNum}`];
        if (a.dayDate) parts.push(fmtShortDate(a.dayDate));
        tripDays.push({ key: a.dayKey, label: parts.join(" · ") });
      }

      const daySel = $("trip-day-filter");
      if (daySel) {
        daySel.innerHTML = `<option value="">All days</option>` +
          tripDays.map((d) => `<option value="${esc(d.key)}" ${tripDayFilter === d.key ? "selected" : ""}>${esc(d.label)}</option>`).join("");
      }
      const tripCitySel = $("trip-city-filter");
      if (tripCitySel) {
        tripCitySel.innerHTML = `<option value="">All cities</option>` +
          tripCities.map((c) => {
          const label = cityDisplayLabel(selectedCountry, c) || c;
          return `<option value="${esc(c)}" ${tripCityFilter === c ? "selected" : ""}>${esc(label)}</option>`;
        }).join("");
      }
      const tripCatSel = $("trip-activity-cat-filter");
      if (tripCatSel) {
        tripCatSel.innerHTML = `<option value="">All categories</option>` +
          tripCats.map((c) => `<option value="${esc(c)}" ${tripActivityCategoryFilter === c ? "selected" : ""}>${esc(c)}</option>`).join("");
      }

      let activities = allActivities.filter((a) => {
        if (tripDayFilter && a.dayKey !== tripDayFilter) return false;
        if (tripCityFilter && a.city !== tripCityFilter) return false;
        if (tripActivityCategoryFilter && a.categoryLabel !== tripActivityCategoryFilter) return false;
        return true;
      });
      activities.sort((a, b) => {
        const tripCmp = a.tripName.localeCompare(b.tripName);
        if (tripCmp) return tripCmp;
        if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
        return a.name.localeCompare(b.name);
      });

      $("panel-count").textContent = allActivities.length
        ? `${activities.length} trip activit${activities.length === 1 ? "y" : "ies"} · ${allActivities.length} total`
        : "No planner activities in this country";

      const dayBanner = "";
      const bodyHtml = activities.length
        ? `<ul class="place-list trip-activity-list">${activities.map(tripActivityCard).join("")}</ul>`
        : `<p class="muted panel-empty">${allActivities.length ? "No activities match your filters." : "Open the planner and add trip days in this country to see them here."}</p>`;
      body.innerHTML = dayBanner + bodyHtml;
      return;
    }

    let places = WorldStore.placesByCountry(state, selectedCountry, {
      category: filterCategory || undefined,
      city: filterCity || undefined,
      query: filterQuery || undefined,
      sort: sortBy,
      order: sortOrder,
    });

    if (placeIdFilter?.size) {
      places = places.filter((p) => placeIdFilter.has(p.id));
      if (placeIdOrder.length) {
        const rank = new Map(placeIdOrder.map((id, i) => [id, i]));
        places.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
      }
      $("panel-count").textContent = dayPanelLabel || `${places.length} place${places.length === 1 ? "" : "s"} on this day`;
    } else {
      $("panel-count").textContent = `${country.placeCount} saved places`;
    }

    const allInCountry = WorldStore.placesByCountry(state, selectedCountry);
    const cats = [...new Set(allInCountry.map((p) => p.category))];
    const cities = [...new Set(allInCountry.map((p) => p.city))].sort();

    const catFilter = $("category-filter");
    if (catFilter) {
      catFilter.innerHTML = `<option value="">All categories</option>` +
        cats.sort((a, b) => PlaceCategorize.label(a).localeCompare(PlaceCategorize.label(b)))
          .map((c) => `<option value="${c}" ${filterCategory === c ? "selected" : ""}>${PlaceCategorize.label(c)}</option>`)
          .join("");
    }

    const cityFilter = $("city-filter");
    if (cityFilter) {
      cityFilter.innerHTML = `<option value="">All cities</option>` +
        cities.map((c) => {
          const label = cityDisplayLabel(selectedCountry, c) || c;
          return `<option value="${esc(c)}" ${filterCity === c ? "selected" : ""}>${esc(label)}</option>`;
        }).join("");
    }

    const sortSel = $("sort-by");
    if (sortSel) sortSel.value = sortBy;
    const orderSel = $("sort-order");
    if (orderSel) orderSel.value = sortOrder;

    const dayBanner = placeIdFilter?.size
      ? `<div class="day-place-filter-banner">
          <span>${esc(dayPanelLabel || "Day places")}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-clear-day-filter">Show all</button>
        </div>`
      : "";

    let bodyHtml = "";
    if (viewMode === "city") {
      const groups = WorldStore.groupByCity(places);
      bodyHtml = groups.map(([city, items]) => `
        <section class="place-group">
          <h3 class="group-title">${city} <span class="muted">(${items.length})</span></h3>
          <ul class="place-list">${items.map(placeCard).join("")}</ul>
        </section>
      `).join("") || emptyMsg();
    } else if (viewMode === "list") {
      bodyHtml = `<ul class="place-list">${places.map(placeCard).join("")}</ul>` || emptyMsg();
    } else {
      const groups = WorldStore.groupByCategory(places);
      bodyHtml = groups.map(([cat, items]) => `
        <section class="place-group">
          <h3 class="group-title">${PlaceCategorize.label(cat)} <span class="muted">(${items.length})</span></h3>
          <ul class="place-list">${items.map(placeCard).join("")}</ul>
        </section>
      `).join("") || emptyMsg();
    }
    body.innerHTML = dayBanner + bodyHtml;
    $("btn-clear-day-filter")?.addEventListener("click", () => {
      clearDayPlaceFilter();
      WorldGlobe.restoreCountryPins?.();
      renderCountryPanel();
    });
  }

  function tripActivityCard(a) {
    const dayLabel = a.dayDate ? `Day ${a.dayNum} · ${fmtShortDate(a.dayDate)}` : `Day ${a.dayNum}`;
    const cityLabel = cityDisplayLabel(a.countryId, a.city) || a.city;
    const meta = [dayLabel, cityLabel, a.categoryLabel].filter(Boolean).join(" · ");
    return `
      <li class="place-card trip-activity-card">
        <div class="place-main">
          <strong>${esc(a.name)}</strong>
          <span class="place-meta">${esc(meta)}</span>
          <span class="place-meta muted">${esc(a.tripName)}${a.time ? ` · ${esc(a.time)}` : ""}</span>
        </div>
        <div class="place-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-open-trip="${esc(a.tripId)}" data-open-day="${a.dayNum}" title="Open in planner">Planner</button>
          ${a.url ? `<a class="place-link" href="${esc(a.url)}" target="_blank" rel="noopener">Maps</a>` : ""}
        </div>
      </li>`;
  }

  function placeCard(p) {
    return `
      <li class="place-card">
        <div class="place-main">
          <strong>${esc(p.name)}</strong>
          <span class="place-meta">${esc(cityDisplayLabel(p.countryId, p.city) || p.city)} · ${PlaceCategorize.label(p.category)}</span>
        </div>
        <div class="place-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-add-trip="${esc(p.id)}" title="Add to trip">+ Trip</button>
          ${p.url ? `<a class="place-link" href="${esc(p.url)}" target="_blank" rel="noopener">Maps</a>` : ""}
        </div>
      </li>`;
  }

  function emptyMsg() {
    return `<p class="muted panel-empty">No places match your filters.</p>`;
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function bindUi() {
    $("btn-close-panel")?.addEventListener("click", () => {
      closeCountryPanel();
    });

    $("btn-toggle-filters")?.addEventListener("click", () => {
      const wrap = $("panel-filters");
      const btn = $("btn-toggle-filters");
      const caret = $("filter-caret");
      if (!wrap || !btn) return;
      const open = wrap.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      if (caret) caret.textContent = open ? "▼" : "▲";
    });

    $("country-scroll-left")?.addEventListener("click", () => {
      $("country-list")?.scrollBy({ left: -countryStripScrollStep(), behavior: "smooth" });
      setTimeout(updateCountryStripArrows, 280);
    });
    $("country-scroll-right")?.addEventListener("click", () => {
      $("country-list")?.scrollBy({ left: countryStripScrollStep(), behavior: "smooth" });
      setTimeout(updateCountryStripArrows, 280);
    });
    $("country-list")?.addEventListener("scroll", updateCountryStripArrows);
    window.addEventListener("resize", updateCountryStripArrows);

    $("view-category")?.addEventListener("click", () => {
      viewMode = "category";
      setActiveViewTab("view-category");
      renderCountryPanel();
    });
    $("view-city")?.addEventListener("click", () => {
      viewMode = "city";
      setActiveViewTab("view-city");
      renderCountryPanel();
    });
    $("view-list")?.addEventListener("click", () => {
      viewMode = "list";
      setActiveViewTab("view-list");
      renderCountryPanel();
    });
    $("view-trip")?.addEventListener("click", () => {
      viewMode = "trip";
      setActiveViewTab("view-trip");
      renderCountryPanel();
    });

    $("trip-day-filter")?.addEventListener("change", (e) => {
      tripDayFilter = e.target.value;
      renderCountryPanel();
    });
    $("trip-city-filter")?.addEventListener("change", (e) => {
      tripCityFilter = e.target.value;
      renderCountryPanel();
    });
    $("trip-activity-cat-filter")?.addEventListener("change", (e) => {
      tripActivityCategoryFilter = e.target.value;
      renderCountryPanel();
    });

    $("btn-theme-toggle")?.addEventListener("click", toggleTheme);

    $("category-filter")?.addEventListener("change", (e) => {
      filterCategory = e.target.value;
      renderCountryPanel();
    });

    $("city-filter")?.addEventListener("change", (e) => {
      filterCity = e.target.value;
      renderCountryPanel();
    });

    $("sort-by")?.addEventListener("change", (e) => {
      sortBy = e.target.value;
      renderCountryPanel();
    });

    $("sort-order")?.addEventListener("change", (e) => {
      sortOrder = e.target.value;
      renderCountryPanel();
    });

    $("panel-body")?.addEventListener("click", (e) => {
      const tripBtn = e.target.closest?.("[data-open-trip]");
      if (tripBtn) {
        WorldPlanner.openTripDay?.(tripBtn.dataset.openTrip, Number(tripBtn.dataset.openDay));
        return;
      }
      const btn = e.target.closest?.("[data-add-trip]");
      if (!btn) return;
      const place = state.places.find((p) => p.id === btn.dataset.addTrip);
      if (place) WorldPlanner.showAddToTripMenu(place);
    });

    $("place-search")?.addEventListener("input", (e) => {
      filterQuery = e.target.value.trim();
      renderCountryPanel();
    });

    $("btn-add-maps-url")?.addEventListener("click", async () => {
      const url = $("maps-url-input")?.value?.trim();
      if (!url) return toast("Paste a Google Maps URL", "warn");
      if (!selectedCountry) return toast("Select a country first", "warn");
      const country = state.countries.find((c) => c.id === selectedCountry);
      const btn = $("btn-add-maps-url");
      if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
      try {
        const r = await WorldMapsImport.importMapsUrls(state, url, {
          countryId: selectedCountry,
          countryName: country?.name,
          city: filterCity || "",
        });
        persist();
        $("maps-url-input").value = "";
        toast(`Added ${r.added.length} place${r.added.length === 1 ? "" : "s"}`);
      } catch (e) {
        toast(e.message || "Could not add URL", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Add URL"; }
      }
    });

    $("btn-export-csv")?.addEventListener("click", () => {
      if (!selectedCountry) return toast("Select a country first", "warn");
      const csv = WorldStore.exportCountryCsv(state, selectedCountry);
      const c = state.countries.find((x) => x.id === selectedCountry);
      downloadBlob(csv, `${c?.name || "country"}-places.csv`, "text/csv");
      toast("CSV exported");
    });

    $("btn-export-json")?.addEventListener("click", () => {
      downloadBlob(JSON.stringify(state, null, 2), "mister-worldwide.json", "application/json");
      toast("JSON exported");
    });

    $("import-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (file.name.endsWith(".csv") && selectedCountry) {
          const added = WorldStore.importCsvPlaces(state, selectedCountry, text);
          persist();
          toast(`Imported ${added.length} places`);
        } else {
          const parsed = JSON.parse(text);
          if (parsed.places && parsed.countries) {
            state = { ...state, ...parsed };
            if (parsed.planner) WorldStore.touchPlanner(state);
            persist(parsed.planner ? { touchPlanner: true } : {});
            toast("JSON imported");
          } else throw new Error("Invalid JSON");
        }
      } catch (err) {
        toast(err.message || "Import failed", "error");
      }
      e.target.value = "";
    });

    $("btn-import")?.addEventListener("click", () => $("import-file")?.click());
    $("btn-reset")?.addEventListener("click", () => {
      if (!confirm("Reset all places to seed data? Your edits will be lost.")) return;
      state = WorldStore.defaultState();
      persist();
      toast("Reset to seed data");
    });
  }

  function downloadBlob(content, name, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showAuth(show) {
    $("auth-gate")?.classList.toggle("hidden", !show);
    $("app-root")?.classList.toggle("hidden", show);
  }

  function mergeCloudState(local, remote) {
    if (!remote) return WorldStore.reconcileState(local);
    const next = WorldStore.applyCloudPayload(local, remote);
    if (local?.planner && next?.planner) {
      next.planner.view = local.planner.view || next.planner.view;
      next.planner.activeTripId = local.planner.activeTripId || next.planner.activeTripId;
      next.planner.activeDayNum = local.planner.activeDayNum || next.planner.activeDayNum;
    }
    return next;
  }

  async function waitForGlobeLib(timeoutMs = 15000) {
    const start = Date.now();
    while (typeof Globe !== "function") {
      if (Date.now() - start > timeoutMs) throw new Error("globe.gl not loaded");
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function waitForLayout(el, attempts = 20) {
    for (let i = 0; i < attempts; i++) {
      if (el.clientWidth > 0 && el.clientHeight > 0) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  async function ensureGlobe() {
    const el = $("globe");
    const root = $("app-root");
    if (!el || root?.classList.contains("hidden")) return;

    try {
      await waitForGlobeLib();
      await waitForLayout(el);

      if (!ready || !WorldGlobe.isReady?.()) {
        await WorldGlobe.init(el, {
          countries: countriesForUi(state),
          onCountryClick: selectCountry,
          onCityClick: selectCityInCountry,
          getAllCityPins: allCityPins,
        });
        ready = true;
        resolveCityCenters();
      } else {
        WorldGlobe.resize();
        WorldGlobe.updatePins(countriesForUi(state));
      }
    } catch (e) {
      console.error("Globe init failed", e);
      ready = false;
      toast("Globe failed to load — try refreshing the page", "error");
    }
  }

  function watchMainView() {
    const root = $("app-root");
    if (!root || root._globeWatch) return;
    root._globeWatch = true;
    const observer = new MutationObserver(() => {
      if (!root.classList.contains("hidden")) ensureGlobe();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("load", () => ensureGlobe());
    window.addEventListener("orientationchange", () => setTimeout(() => ensureGlobe(), 200));
  }

  function bindAuth() {
    const errEl = $("auth-error");
    const setErr = (msg) => {
      if (!errEl) return;
      errEl.hidden = !msg;
      errEl.textContent = msg || "";
    };

    $("btn-google")?.addEventListener("click", async () => {
      setErr("");
      try { await WorldCloud.signInWithGoogle(); }
      catch (e) { setErr(e.message || "Google sign-in failed"); }
    });

    $("auth-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      setErr("");
      const email = $("auth-email")?.value;
      const password = $("auth-password")?.value;
      try { await WorldCloud.signIn(email, password); }
      catch (err) { setErr(err.message || "Sign in failed"); }
    });

    $("btn-signup")?.addEventListener("click", async () => {
      setErr("");
      const email = $("auth-email")?.value;
      const password = $("auth-password")?.value;
      try { await WorldCloud.signUp(email, password); }
      catch (err) { setErr(err.message || "Sign up failed"); }
    });

    $("btn-logout")?.addEventListener("click", () => WorldCloud.signOut());
  }

  async function onUser(u) {
    user = u;
    if (u) {
      WorldStore.setUserEmail(u.email);
      $("user-chip").textContent = u.email || u.displayName || "Signed in";
      showAuth(false);
      refresh();
      const cloud = await WorldCloud.loadFromCloud(u.uid);
      const local = WorldStore.reconcileState(WorldStore.loadState());
      if (WorldStore.hasCloudData(cloud)) {
        state = mergeCloudState(local, cloud);
      } else {
        state = local;
      }
      WorldStore.saveState(state);
      WorldCloud.resumeQuota?.();
      const needsMigrate = !cloud || cloud.v !== 2 || !!cloud.places || !!cloud.countries;
      const localNewer = Date.parse(local?.plannerUpdatedAt || local?.planner?.updatedAt || 0)
        > Date.parse(cloud?.plannerUpdatedAt || cloud?.planner?.updatedAt || 0);
      if (needsMigrate || localNewer || !WorldStore.hasCloudData(cloud)) {
        WorldCloud.scheduleSave(u.uid, state);
      }
      WorldCloud.listenCloud(u.uid, (remote) => {
        const plannerOpen = WorldPlanner?.isOpen?.();
        const prev = state?.planner ? { ...state.planner } : null;
        state = mergeCloudState(state, remote);
        if (plannerOpen && prev && state.planner) {
          state.planner.view = prev.view;
          state.planner.activeTripId = prev.activeTripId;
          state.planner.activeDayNum = prev.activeDayNum;
        }
        WorldStore.saveState(state);
        if (plannerOpen) {
          renderStats();
          return;
        }
        refresh();
        ensureGlobe();
      });
      await WorldAssistant?.bindUser?.({ uid: u.uid, email: u.email, displayName: u.displayName });
    } else {
      WorldStore.setUserEmail("local");
      state = WorldStore.reconcileState(WorldStore.loadState());
      showAuth(WorldCloud.configured);
      $("user-chip").textContent = WorldCloud.configured ? "" : "Local mode";
      if (WorldCloud.configured) {
        await WorldAssistant?.unbindUser?.();
      } else {
        await WorldAssistant?.bindUser?.({ uid: "local", email: "local@device", displayName: "Local" });
      }
    }
    CountryMeta.init(state.countries);
    refresh();
    await ensureGlobe();
  }

  async function start() {
    try {
      initTheme();
      loadCityCenterCache();
      bindUi();
      bindAuth();
      watchMainView();
      WorldPlanner?.init?.();
      WorldImportPanel?.init?.();
      await WorldStore.loadSeed();
      state = WorldStore.reconcileState(WorldStore.loadState());
      CountryMeta.init(state.countries);
      refresh();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && user?.uid && WorldCloud.configured) {
          WorldCloud.flushSave(user.uid, state).catch(() => {});
        }
      });

      if (!WorldCloud.configured) {
        $("auth-config-hint").hidden = false;
        $("auth-config-hint").textContent = "Firebase not configured — running in local-only mode.";
        await onUser(null);
        return;
      }

      const init = WorldCloud.initFirebase();
      if (!init.ok) {
        await onUser(null);
        return;
      }

      WorldCloud.onAuthStateChanged(async (u, err) => {
        if (err) {
          const quota = WorldCloud.isQuotaError?.(err);
          toast(
            quota ? "Cloud sync unavailable (quota). Planner still works on this device." : err.message,
            quota ? "warn" : "error"
          );
        }
        await onUser(u);
      });
    } catch (e) {
      console.error("App start failed", e);
      showAuth(false);
      toast(e?.message || "App failed to start — try refreshing", "error");
    }
  }

  return {
    start, ready: () => ready, getState, setState, cloneState, persist, persistNav, persistPlanner, refresh, toast,
    getUser: () => user,
    selectCountry, selectCityInCountry, showDayPlacesOnCountry, cityDisplayLabel, setOverlayPanel, resolveCityLabels: () => resolveCityCenters(),
    get selectedCountry() { return selectedCountry; },
  };
})();

document.addEventListener("DOMContentLoaded", () => WorldApp.start());
