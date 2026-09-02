/**
 * 3D Earth globe — flag pins at country geographic centers.
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let resizeObserver = null;
  let onCountryClick = null;
  let onCityClick = null;
  let getAllCityPins = null;
  let countries = [];
  let centroidsByName = new Map();
  let autoRotateEnabled = false;
  let pinClickBound = false;
  let globeDragging = false;
  let pointerSession = null;
  const TAP_MOVE_PX = 14;
  const TAP_MAX_MS = 400;

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const EARTH_TEX_CDN = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
  const EARTH_TEX_LOCAL = "assets/textures/earth.jpg";
  const EARTH_TILE_URL =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{l}/{y}/{x}";
  const ROTATE_KEY = "mister-worldwide-globe-rotate";
  const PIN_VIEW_KEY = "mister-worldwide-globe-pin-view";
  const ROTATE_SPEED = 0.4;
  const MAX_CITY_PINS = 120;
  const CITY_PIN_MIN_PLACES = 2;
  const DEFAULT_POV = { lat: 18, lng: 0, altitude: 2.35 };
  const MIN_POV_ALT = 0.019;
  const MAX_POV_ALT = 3.2;
  const ALT_DISPLAY_FAR = 2.5;
  // Fixed physical altitudes — stamped hi-res entry / exit (independent of HUD % scale)
  const TILE_ON_ALT = 0.489;
  const TILE_OFF_ALT = 0.58;
  const TILE_MIN_ALT = MIN_POV_ALT;
  const HOME_FLIGHT_MS = 1600;
  const STANDARD_STAGES = [
    { minPct: 0, curvature: 5, label: "Standard globe" },
    { minPct: 10, curvature: 5, label: "Standard globe" },
    { minPct: 20, curvature: 5, label: "Standard globe" },
    { minPct: 25, curvature: 5, label: "Standard globe" },
    { minPct: 30, curvature: 4, label: "Regional" },
    { minPct: 40, curvature: 4, label: "Regional" },
    { minPct: 45, curvature: 4, label: "Regional" },
    { minPct: 50, curvature: 4, label: "Regional+" },
    { minPct: 55, curvature: 4, label: "Regional+" },
    { minPct: 60, curvature: 3, label: "Closer" },
    { minPct: 65, curvature: 3, label: "Closer" },
    { minPct: 70, curvature: 3, label: "Closer" },
  ];
  let TILE_ON_PCT = 0;
  let TILE_OFF_PCT = 0;
  let HI_RES_TIERS = [];

  let lastSelectAt = 0;
  let cityPinRefreshTimer = null;
  let tileSyncRaf = null;
  let zoomHudHideTimer = null;
  let tilesActive = false;
  let tileMaxLevel = 0;
  let allCityPinsCache = [];
  let zoomBarEl = null;
  let zoomLevelEl = null;
  let zoomModeEl = null;
  let zoomFillEl = null;
  let lastHudAlt = null;
  let pinClicksEnabled = true;
  let pinLockTimer = null;
  let wheelZoomHandler = null;
  const PIN_UNLOCK_MS = 150;

  function loadRotatePref() {
    try {
      return localStorage.getItem(ROTATE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function saveRotatePref(on) {
    try {
      localStorage.setItem(ROTATE_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function loadPinViewPref() {
    try {
      return localStorage.getItem(PIN_VIEW_KEY) === "city" ? "city" : "country";
    } catch {
      return "country";
    }
  }

  function savePinViewPref(mode) {
    try {
      localStorage.setItem(PIN_VIEW_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  function applyAutoRotate() {
    const controls = globe?.controls();
    if (!controls) return;
    controls.autoRotate = autoRotateEnabled;
    controls.autoRotateSpeed = ROTATE_SPEED;
  }

  function setAutoRotate(on) {
    autoRotateEnabled = !!on;
    saveRotatePref(autoRotateEnabled);
    applyAutoRotate();
    syncRotateButton();
  }

  function syncRotateButton() {
    const btn = document.getElementById("btn-globe-rotate");
    if (!btn) return;
    btn.textContent = autoRotateEnabled ? "Rotating" : "Steady";
    btn.setAttribute("aria-pressed", autoRotateEnabled ? "true" : "false");
    btn.title = autoRotateEnabled
      ? "Auto-rotate on — tap for steady globe"
      : "Steady globe — tap to auto-rotate";
  }

  function syncPinViewButton() {
    const btn = document.getElementById("btn-globe-pin-view");
    if (!btn) return;
    const city = pinViewMode === "city";
    btn.textContent = city ? "Countries" : "Cities";
    btn.setAttribute("aria-pressed", city ? "true" : "false");
    btn.title = city ? "Show country pins on the globe" : "Show city pins on the globe";
  }

  function bindRotateToggle() {
    const btn = document.getElementById("btn-globe-rotate");
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setAutoRotate(!autoRotateEnabled);
    });
    syncRotateButton();
  }

  function bindPinViewToggle() {
    const btn = document.getElementById("btn-globe-pin-view");
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPinViewMode(pinViewMode === "city" ? "country" : "city");
    });
    syncPinViewButton();
  }

  function angularDistance(lat1, lng1, lat2, lng2) {
    const dLat = lat2 - lat1;
    let dLng = lng2 - lng1;
    while (dLng > 180) dLng -= 360;
    while (dLng < -180) dLng += 360;
    return Math.hypot(dLat, dLng);
  }

  function viewRadiusDeg(alt) {
    if (!Number.isFinite(alt)) return 90;
    return Math.min(95, Math.max(18, 52 / Math.sqrt(Math.max(alt, 0.55))));
  }

  function filterCityPinsForView(pins) {
    if (!globe || !pins?.length) return [];
    const pov = globe.pointOfView?.() || { lat: 0, lng: 0, altitude: 2.5 };
    const radius = viewRadiusDeg(pov.altitude);
    const visible = pins.filter((p) => angularDistance(pov.lat, pov.lng, p.lat, p.lng) <= radius);
    const pool = visible.length ? visible : pins;
    let ranked = pool
      .filter((p) => (p.placeCount || 0) >= CITY_PIN_MIN_PLACES)
      .sort((a, b) => (b.placeCount || 0) - (a.placeCount || 0));
    if (!ranked.length) {
      ranked = [...pool].sort((a, b) => (b.placeCount || 0) - (a.placeCount || 0));
    }
    return ranked.slice(0, MAX_CITY_PINS);
  }

  function isMobileViewport() {
    return window.matchMedia?.("(max-width: 768px)")?.matches || false;
  }

  function tileUrlFor(x, y, l) {
    return EARTH_TILE_URL.replace("{x}", x).replace("{y}", y).replace("{l}", l);
  }

  function zoomPercent(alt) {
    if (!Number.isFinite(alt)) return 0;
    const clamped = Math.max(MIN_POV_ALT, Math.min(ALT_DISPLAY_FAR, alt));
    return Math.round(((ALT_DISPLAY_FAR - clamped) / (ALT_DISPLAY_FAR - MIN_POV_ALT)) * 100);
  }

  function hiResLabelForT(t) {
    if (t < 0.12) return "Satellite";
    if (t < 0.28) return "Satellite+";
    if (t < 0.48) return "Hi-res";
    if (t < 0.68) return "Hi-res+";
    if (t < 0.84) return "Detail";
    if (t < 0.94) return "Detail+";
    return "Max detail";
  }

  function initZoomScale() {
    TILE_ON_PCT = zoomPercent(TILE_ON_ALT);
    TILE_OFF_PCT = zoomPercent(TILE_OFF_ALT);
    const step = 1;
    const minLevel = 10;
    const maxLevel = 15;
    HI_RES_TIERS = [];
    for (let pct = TILE_ON_PCT; pct < 100; pct += step) {
      const t = (pct - TILE_ON_PCT) / Math.max(1, 100 - TILE_ON_PCT);
      HI_RES_TIERS.push({
        minPct: pct,
        level: Math.round(minLevel + t * (maxLevel - minLevel)),
        curvature: Math.max(2, Math.round(5 - t * 3)),
        label: hiResLabelForT(t),
      });
    }
    HI_RES_TIERS.push({ minPct: 100, level: maxLevel, curvature: 2, label: "Max detail" });
  }
  initZoomScale();

  function standardStageForPercent(pct) {
    let stage = STANDARD_STAGES[0];
    for (const step of STANDARD_STAGES) {
      if (pct >= step.minPct) stage = step;
    }
    return stage;
  }

  function qualityAtPercent(pct) {
    if (pct < TILE_ON_PCT || !HI_RES_TIERS.length) return null;
    if (pct >= HI_RES_TIERS[HI_RES_TIERS.length - 1].minPct) {
      return HI_RES_TIERS[HI_RES_TIERS.length - 1];
    }
    for (let i = 0; i < HI_RES_TIERS.length - 1; i++) {
      const lo = HI_RES_TIERS[i];
      const hi = HI_RES_TIERS[i + 1];
      if (pct >= lo.minPct && pct < hi.minPct) {
        const t = (pct - lo.minPct) / Math.max(1, hi.minPct - lo.minPct);
        return {
          minPct: lo.minPct,
          level: Math.round(lo.level + (hi.level - lo.level) * t),
          curvature: Math.round(lo.curvature + (hi.curvature - lo.curvature) * t),
          label: lo.label,
        };
      }
    }
    return HI_RES_TIERS[0];
  }

  function displayStageForPercent(pct) {
    if (pct >= TILE_ON_PCT) return qualityAtPercent(pct) || standardStageForPercent(pct);
    return standardStageForPercent(pct);
  }

  function qualityTierForAltitude(alt) {
    return displayStageForPercent(zoomPercent(alt));
  }

  function bindZoomHud() {
    zoomBarEl = document.getElementById("globe-zoom-bar");
    zoomLevelEl = document.getElementById("globe-zoom-level");
    zoomModeEl = document.getElementById("globe-zoom-mode");
    zoomFillEl = document.getElementById("globe-zoom-bar-fill");
    initZoomScale();
    renderZoomTicks();
    setZoomBarVisible(false);
  }

  function renderZoomTicks() {
    const track = document.querySelector(".globe-zoom-bar-track");
    if (!track) return;
    track.querySelectorAll(".globe-zoom-tick").forEach((el) => el.remove());
    track._ticksBound = true;
    for (const stage of STANDARD_STAGES) {
      if (stage.minPct <= 0) continue;
      if (stage.minPct % 10 !== 0 && stage.minPct !== 25 && stage.minPct !== 70) continue;
      const tick = document.createElement("span");
      tick.className = "globe-zoom-tick is-standard";
      tick.style.left = `${stage.minPct}%`;
      tick.title = `${stage.minPct}% · ${stage.label}`;
      track.appendChild(tick);
    }
    const entry = document.createElement("span");
    entry.className = "globe-zoom-tick is-entry";
    entry.style.left = `${TILE_ON_PCT}%`;
    entry.title = `${TILE_ON_PCT}% · Satellite entry`;
    track.appendChild(entry);
    for (const tier of HI_RES_TIERS) {
      if (tier.minPct <= TILE_ON_PCT) continue;
      if ((tier.minPct - TILE_ON_PCT) % 5 !== 0 && tier.minPct !== 100) continue;
      const tick = document.createElement("span");
      tick.className = "globe-zoom-tick is-hires";
      tick.style.left = `${tier.minPct}%`;
      tick.title = `${tier.minPct}% · ${tier.label}`;
      track.appendChild(tick);
    }
  }

  function setZoomBarVisible(visible) {
    if (!zoomBarEl) return;
    const pov = globe?.pointOfView?.();
    const alt = pov?.altitude ?? DEFAULT_POV.altitude;
    const keepForDepth = tilesActive || zoomPercent(alt) >= TILE_OFF_PCT;
    if (!visible && keepForDepth) {
      updateZoomHud(pov);
      zoomBarEl.classList.add("is-visible");
      return;
    }
    zoomBarEl.classList.toggle("is-visible", !!visible);
    clearTimeout(zoomHudHideTimer);
    if (visible) return;
    zoomHudHideTimer = setTimeout(() => {
      if (tilesActive || zoomPercent(globe?.pointOfView?.().altitude ?? DEFAULT_POV.altitude) >= TILE_OFF_PCT) return;
      zoomBarEl?.classList.remove("is-visible");
    }, 900);
  }

  function noteZoomInteraction(pov) {
    if (!pov || !Number.isFinite(pov.altitude)) return;
    const altChanged = lastHudAlt == null || Math.abs(pov.altitude - lastHudAlt) > 0.002;
    lastHudAlt = pov.altitude;
    if (altChanged || tilesActive || zoomPercent(pov.altitude) >= TILE_OFF_PCT) {
      setZoomBarVisible(true);
      updateZoomHud(pov);
    }
  }

  function updateZoomHud(pov = globe?.pointOfView?.()) {
    if (!zoomLevelEl || !zoomModeEl || !zoomFillEl) return;
    const alt = Number.isFinite(pov?.altitude) ? pov.altitude : DEFAULT_POV.altitude;
    const pct = zoomPercent(alt);
    zoomLevelEl.textContent = `${pct}%`;
    zoomFillEl.style.width = `${pct}%`;
    const stage = displayStageForPercent(pct);
    const hires = tilesActive || pct >= TILE_ON_PCT;
    zoomModeEl.textContent = stage?.label || (hires ? "Hi-res satellite" : "Standard globe");
    zoomModeEl.classList.toggle("is-hires", hires);
  }

  function applyBaseGlobeCurvature(pct) {
    if (!globe || tilesActive) return;
    const stage = standardStageForPercent(pct);
    try {
      if (globe.globeCurvatureResolution?.() !== stage.curvature) {
        globe.globeCurvatureResolution(stage.curvature);
      }
    } catch {
      /* ignore */
    }
  }

  function syncControlSpeeds(pov) {
    const controls = globe?.controls();
    if (!controls || !pov) return;
    const alt = Math.max(MIN_POV_ALT, pov.altitude || DEFAULT_POV.altitude);
    const pct = zoomPercent(alt);
    const overview = pct < 40;
    const cruising = pct < 65;
    const deep = pct >= TILE_ON_PCT;
    const extreme = pct >= 92;
    // Same zoom speed at every depth; only ease damping/rotate in deep zoom for stability.
    controls.zoomSpeed = 0.22;
    if (overview) {
      controls.dampingFactor = 0.1;
      controls.rotateSpeed = 0.3;
    } else if (cruising) {
      controls.dampingFactor = 0.13;
      controls.rotateSpeed = Math.max(0.14, Math.min(0.34, alt * 0.15));
    } else {
      controls.dampingFactor = extreme ? 0.22 : deep ? 0.18 : 0.16;
      controls.rotateSpeed = extreme ? 0.04 : deep ? 0.08 : Math.max(0.1, Math.min(0.34, alt * 0.16));
    }
    if (deep && autoRotateEnabled) controls.autoRotate = false;
    else if (!deep && autoRotateEnabled) controls.autoRotate = true;
    applyBaseGlobeCurvature(pct);
  }

  function setPinClicksEnabled(enabled) {
    pinClicksEnabled = !!enabled;
    container?.classList.toggle("globe-pins-locked", !pinClicksEnabled);
  }

  function lockPinClicks() {
    clearTimeout(pinLockTimer);
    setPinClicksEnabled(false);
  }

  function unlockPinClicks(delay = PIN_UNLOCK_MS) {
    clearTimeout(pinLockTimer);
    pinLockTimer = setTimeout(() => setPinClicksEnabled(true), delay);
  }

  function enforcePovLimits(pov = globe?.pointOfView?.()) {
    if (!globe || !pov) return;
    const alt = pov.altitude;
    if (!Number.isFinite(alt)) return;
    if (alt >= MIN_POV_ALT && alt <= MAX_POV_ALT) return;
    const nextAlt = Math.max(MIN_POV_ALT, Math.min(MAX_POV_ALT, alt));
    globe.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: nextAlt }, 0);
    syncControlSpeeds({ ...pov, altitude: nextAlt });
  }

  function maxTileLevelForAltitude(alt) {
    if (!Number.isFinite(alt)) return 0;
    const pct = zoomPercent(alt);
    if (tilesActive ? pct < TILE_OFF_PCT : pct < TILE_ON_PCT) return 0;
    const quality = qualityAtPercent(pct);
    if (!quality?.level) return isMobileViewport() ? 10 : 10;
    return isMobileViewport() ? Math.min(quality.level, 13) : quality.level;
  }

  function tileCurvatureForAltitude(alt) {
    const pct = zoomPercent(alt);
    if (!Number.isFinite(alt) || pct < TILE_OFF_PCT) return standardStageForPercent(pct).curvature;
    const quality = qualityAtPercent(pct);
    return quality?.curvature ?? 5;
  }

  function applyTileCurvature(alt) {
    if (!globe) return;
    const next = tileCurvatureForAltitude(alt);
    try {
      if (globe.globeCurvatureResolution?.() !== next) globe.globeCurvatureResolution(next);
    } catch {
      /* ignore */
    }
  }

  function disableZoomTiles() {
    if (!globe || !tilesActive) return;
    try {
      globe.globeTileEngineUrl(null);
      const pct = zoomPercent(globe.pointOfView?.().altitude ?? DEFAULT_POV.altitude);
      globe.globeCurvatureResolution?.(standardStageForPercent(pct).curvature);
    } catch (e) {
      console.warn("Disable globe tiles failed", e);
    }
    tilesActive = false;
    tileMaxLevel = 0;
    updateZoomHud();
    setZoomBarVisible(true);
  }

  function enableZoomTiles(level, alt) {
    if (!globe) return;
    const nextLevel = Math.max(7, level || 7);
    const wasActive = tilesActive;
    try {
      applyTileCurvature(alt);
      if (!tilesActive) {
        globe.globeTileEngineMaxLevel(nextLevel);
        globe.globeTileEngineUrl(tileUrlFor);
        tilesActive = true;
        tileMaxLevel = nextLevel;
      } else if (nextLevel !== tileMaxLevel) {
        globe.globeTileEngineMaxLevel(nextLevel);
        tileMaxLevel = nextLevel;
      }
    } catch (e) {
      console.warn("Enable globe tiles failed", e);
    }
    if (!wasActive && tilesActive) {
      updateZoomHud();
      setZoomBarVisible(true);
    } else if (tilesActive) {
      updateZoomHud();
    }
  }

  function syncZoomTiles() {
    if (!globe) return;
    const pov = globe.pointOfView?.() || DEFAULT_POV;
    const alt = pov.altitude;
    const targetLevel = maxTileLevelForAltitude(alt);
    if (targetLevel <= 0) {
      if (tilesActive) disableZoomTiles();
      updateZoomHud(pov);
      return;
    }
    enableZoomTiles(targetLevel, alt);
    updateZoomHud(pov);
  }

  function scheduleZoomTileSync() {
    if (tileSyncRaf) return;
    tileSyncRaf = requestAnimationFrame(() => {
      tileSyncRaf = null;
      syncZoomTiles();
    });
  }

  function resetDefaultView({ duration = HOME_FLIGHT_MS } = {}) {
    if (!globe) return;
    disableZoomTiles();
    setZoomBarVisible(true);
    globe.pointOfView({ ...DEFAULT_POV }, duration);
    scheduleZoomTileSync();
    lastHudAlt = DEFAULT_POV.altitude;
    updateZoomHud({ ...DEFAULT_POV });
    applyBaseGlobeCurvature(zoomPercent(DEFAULT_POV.altitude));
    setTimeout(() => setZoomBarVisible(false), duration + 260);
  }

  function bindHomeButton() {
    const btn = document.getElementById("btn-globe-home");
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetDefaultView();
    });
  }

  function applyGlobeQuality() {
    if (!globe) return;
    try {
      const renderer = globe.renderer?.();
      if (!renderer) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const map = globe.globeMaterial?.()?.map;
      if (!map) return;
      const maxAniso = renderer.capabilities?.getMaxAnisotropy?.() || 1;
      map.anisotropy = maxAniso;
      map.needsUpdate = true;
    } catch (e) {
      console.warn("Globe quality tweak failed", e);
    }
  }

  function loadHiResTexture() {
    const img = new Image();
    img.onload = () => {
      if (!globe) return;
      globe.globeImageUrl(EARTH_TEX_LOCAL);
      applyGlobeQuality();
    };
    img.onerror = () => applyGlobeQuality();
    img.src = EARTH_TEX_LOCAL;
  }

  function scheduleCityPinRefresh(delay = 180) {
    if (pinViewMode !== "city" || dayMode) return;
    clearTimeout(cityPinRefreshTimer);
    cityPinRefreshTimer = setTimeout(refreshCityPinsForView, delay);
  }

  function applyPinLayerSettings(mode) {
    if (!globe) return;
    const city = mode === "city";
    globe
      .htmlAltitude(city ? 0 : 0.04)
      .htmlTransitionDuration(0);
  }

  function refreshCityPinsForView() {
    if (!globe || dayMode || pinViewMode !== "city" || !pinsVisible) return;
    allCityPinsCache = getAllCityPins?.() || allCityPinsCache;
    const pins = filterCityPinsForView(allCityPinsCache);
    if (!pins.length) {
      showCountryFlagPins();
      return;
    }
    applyPinLayerSettings("city");
    globe
      .htmlElement((d) => makeCityPin(d))
      .htmlElementsData(pins);
  }

  function selectCountry(countryId) {
    if (!countryId) return;
    const now = Date.now();
    if (now - lastSelectAt < 300) return;
    lastSelectAt = now;
    onCountryClick?.(countryId);
  }

  function selectCity(countryId, city) {
    if (!countryId || !city) return;
    const now = Date.now();
    if (now - lastSelectAt < 300) return;
    lastSelectAt = now;
    onCityClick?.(countryId, city);
  }

  function centroidOfRing(ring) {
    if (!ring?.length) return null;
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const x1 = ring[j][0];
      const y1 = ring[j][1];
      const x2 = ring[i][0];
      const y2 = ring[i][1];
      const f = x1 * y2 - x2 * y1;
      twiceArea += f;
      cx += (x1 + x2) * f;
      cy += (y1 + y2) * f;
    }
    if (!twiceArea) return null;
    return { lng: cx / (3 * twiceArea), lat: cy / (3 * twiceArea) };
  }

  function ringArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(a / 2);
  }

  function centroidOfFeature(feat) {
    const geom = feat?.geometry;
    if (!geom) return null;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    let best = null;
    let bestArea = 0;
    for (const poly of polys) {
      const ring = poly?.[0];
      if (!ring?.length) continue;
      const area = ringArea(ring);
      if (area <= bestArea) continue;
      const c = centroidOfRing(ring);
      if (!c) continue;
      bestArea = area;
      best = c;
    }
    return best;
  }

  function buildCentroids(features) {
    const map = new Map();
    for (const feat of features) {
      const name = feat?.properties?.name;
      const c = centroidOfFeature(feat);
      if (name && c) map.set(name, c);
    }
    centroidsByName = map;
  }

  function countryCenter(c) {
    const manual = CountryMeta.pinCenterFor(c.id);
    if (manual) return manual;
    const atlasName = CountryMeta.atlasLookupName(c.name);
    const fromAtlas = centroidsByName.get(atlasName);
    if (fromAtlas) return fromAtlas;
    if (c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng };
    return null;
  }

  function bindPinTap(el, onTap) {
    el.addEventListener(
      "pointerdown",
      (e) => {
        e.stopPropagation();
      },
      true
    );
    el.addEventListener("click", (e) => {
      if (!pinClicksEnabled || globeDragging) return;
      e.preventDefault();
      e.stopPropagation();
      onTap();
    });
  }

  function makeFlagPin(d) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "globe-flag-pin";
    el.dataset.countryId = d.id;
    el.title = `${d.name} (${d.placeCount} places)`;
    el.setAttribute("aria-label", `${d.name}, ${d.placeCount} places`);
    el.innerHTML = `
      <img src="${CountryMeta.flagUrl(d.iso, 40)}" alt="" width="32" height="24" loading="lazy" draggable="false"/>
      <span class="globe-flag-count">${d.placeCount}</span>`;
    bindPinTap(el, () => selectCountry(d.id));
    return el;
  }

  function makeCityPin(d) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "globe-city-pin";
    el.dataset.countryId = d.countryId;
    el.dataset.city = d.city;
    el.title = `${d.city} (${d.placeCount} places)`;
    el.setAttribute("aria-label", `${d.city}, ${d.placeCount} places`);
    const shortCity = d.city.length > 14 ? `${d.city.slice(0, 12)}…` : d.city;
    el.innerHTML = `
      <span class="globe-city-dot" aria-hidden="true"></span>
      <span class="globe-city-stack">
        <span class="globe-city-label">${shortCity}</span>
        <span class="globe-city-count">${d.placeCount}</span>
      </span>`;
    bindPinTap(el, () => selectCity(d.countryId, d.city));
    return el;
  }

  function pinData(list) {
    return (list || countries)
      .filter((c) => c.placeCount > 0)
      .map((c) => {
        const center = countryCenter(c);
        if (!center) return null;
        return {
          id: c.id,
          name: c.name,
          iso: c.iso,
          lat: center.lat,
          lng: center.lng,
          placeCount: c.placeCount || 0,
        };
      })
      .filter(Boolean);
  }

  function bindPinClicks(el) {
    if (pinClickBound) return;
    pinClickBound = true;

    const onPointerDown = (e) => {
      pointerSession = {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        moved: false,
      };
    };

    const onPointerMove = (e) => {
      if (!pointerSession || pointerSession.moved) return;
      const dx = e.clientX - pointerSession.x;
      const dy = e.clientY - pointerSession.y;
      if (Math.hypot(dx, dy) > TAP_MOVE_PX) pointerSession.moved = true;
    };

    const onPointerEnd = () => {
      if (!pointerSession) return;
      const session = pointerSession;
      pointerSession = null;
      if (session.moved || globeDragging) {
        session.suppressClick = true;
        setTimeout(() => {
          session.suppressClick = false;
        }, 80);
      }
      el._lastPointerSession = session;
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", onPointerEnd, { passive: true });
    el.addEventListener("pointercancel", onPointerEnd, { passive: true });

    const pick = (e) => {
      if (!pinClicksEnabled) return;
      const cityPin = e.target.closest?.(".globe-city-pin");
      if (cityPin?.dataset?.countryId && cityPin.dataset.city) {
        const session = el._lastPointerSession;
        if (globeDragging || session?.suppressClick || session?.moved) return;
        if (session && Date.now() - session.t > TAP_MAX_MS) return;
        e.preventDefault();
        e.stopPropagation();
        selectCity(cityPin.dataset.countryId, cityPin.dataset.city);
        return;
      }
      const pin = e.target.closest?.(".globe-flag-pin");
      if (!pin?.dataset?.countryId) return;
      const session = el._lastPointerSession;
      if (globeDragging || session?.suppressClick || session?.moved) return;
      if (session && Date.now() - session.t > TAP_MAX_MS) return;
      e.preventDefault();
      e.stopPropagation();
      selectCountry(pin.dataset.countryId);
    };

    el.addEventListener("click", pick);
  }

  function bindResize(el) {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(() => {
      if (!globe || !container) return;
      if (container.clientWidth > 0 && container.clientHeight > 0) onResize();
    });
    resizeObserver.observe(el);
    window.addEventListener("resize", onResize);
  }

  let pinsVisible = true;
  let dayMode = false;
  let pinViewMode = "country";

  function makePlacePin(d) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "globe-place-pin";
    el.title = d.name;
    el.setAttribute("aria-label", d.name);
    el.innerHTML = `<span class="globe-place-num">${d.label || "📍"}</span>`;
    return el;
  }

  function showDayPlaces(places) {
    if (!globe) return;
    const data = (places || [])
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p, i) => ({ ...p, label: p.label || String(i + 1) }));
    if (!data.length) return;
    dayMode = true;
    pinsVisible = true;
    globe
      .htmlElement((d) => makePlacePin(d))
      .htmlElementsData(data);
    const lat = data.reduce((s, p) => s + p.lat, 0) / data.length;
    const lng = data.reduce((s, p) => s + p.lng, 0) / data.length;
    const spread = Math.max(...data.map((p) => Math.hypot(p.lat - lat, p.lng - lng)), 0.5);
    const altitude = Math.min(2.8, Math.max(1.4, 1.8 + spread * 0.35));
    const safeAlt = Math.max(MIN_POV_ALT, altitude);
    globe.pointOfView({ lat, lng, altitude: safeAlt }, 1200);
  }

  function showCountryFlagPins() {
    if (!globe) return;
    const data = pinsVisible ? pinData(countries) : [];
    applyPinLayerSettings("country");
    globe.htmlElement((d) => makeFlagPin(d)).htmlElementsData(data);
  }

  function showAllCityPins() {
    if (!globe) return;
    allCityPinsCache = getAllCityPins?.() || [];
    if (!allCityPinsCache.length) {
      showCountryFlagPins();
      return;
    }
    refreshCityPinsForView();
  }

  function applyPinView() {
    if (!globe || dayMode) return;
    savePinViewPref(pinViewMode);
    syncPinViewButton();
    if (!pinsVisible) {
      globe.htmlElementsData([]);
      return;
    }
    if (pinViewMode === "city") showAllCityPins();
    else showCountryFlagPins();
  }

  function setPinViewMode(mode) {
    pinViewMode = mode === "city" ? "city" : "country";
    applyPinView();
  }

  function restoreCountryPins() {
    if (!globe) return;
    dayMode = false;
    pinsVisible = true;
    applyPinView();
  }

  function setPinsVisible(visible) {
    pinsVisible = !!visible;
    if (!globe || dayMode) return;
    applyPinView();
  }

  function bindControls(controls) {
    const globeR = globe?.getGlobeRadius?.() || 100;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.enableRotate = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = globeR * (1 + MIN_POV_ALT);
    controls.maxDistance = globeR * (1 + MAX_POV_ALT);
    const pov = globe.pointOfView?.() || DEFAULT_POV;
    syncControlSpeeds(pov);
    controls.addEventListener("start", () => {
      globeDragging = true;
      lockPinClicks();
    });
    controls.addEventListener("end", () => {
      unlockPinClicks();
      setTimeout(() => {
        globeDragging = false;
        scheduleCityPinRefresh(80);
        syncZoomTiles();
        enforcePovLimits();
        updateZoomHud();
        if (zoomPercent(globe.pointOfView?.().altitude ?? DEFAULT_POV.altitude) < TILE_OFF_PCT && !tilesActive) {
          setZoomBarVisible(false);
        }
      }, 60);
    });
    const onWheelZoom = () => {
      lockPinClicks();
      unlockPinClicks();
    };
    wheelZoomHandler = onWheelZoom;
    container?.addEventListener("wheel", wheelZoomHandler, { passive: true });
    controls.addEventListener("change", () => {
      const nextPov = globe.pointOfView?.();
      enforcePovLimits(nextPov);
      syncControlSpeeds(globe.pointOfView?.() || nextPov);
      noteZoomInteraction(globe.pointOfView?.() || nextPov);
      scheduleCityPinRefresh(220);
      scheduleZoomTileSync();
    });
    applyAutoRotate();
    globe.onZoom?.((nextPov) => {
      enforcePovLimits(nextPov);
      syncControlSpeeds(nextPov);
      noteZoomInteraction(nextPov);
      scheduleZoomTileSync();
    });
  }

  async function init(el, opts = {}) {
    if (!el) throw new Error("Globe container missing");
    if (typeof Globe !== "function") throw new Error("globe.gl not loaded");

    onCountryClick = opts.onCountryClick || onCountryClick || (() => {});
    onCityClick = opts.onCityClick || onCityClick || (() => {});
    getAllCityPins = opts.getAllCityPins || getAllCityPins || (() => []);
    countries = opts.countries || countries;
    autoRotateEnabled = loadRotatePref();
    pinViewMode = loadPinViewPref();

    if (globe && container !== el) destroy();
    if (globe && container === el) {
      updatePins(countries);
      onResize();
      syncRotateButton();
      syncPinViewButton();
      bindHomeButton();
      bindZoomHud();
      return globe;
    }

    container = el;
    container.classList.add("globe-ready");
    bindPinClicks(el);
    bindRotateToggle();
    bindPinViewToggle();
    bindHomeButton();
    bindZoomHud();

    globe = Globe()
      .globeImageUrl(EARTH_TEX_CDN)
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#7cf0ff")
      .atmosphereAltitude(0.14)
      .backgroundColor("rgba(5,5,8,0.85)")
      .width(Math.max(el.clientWidth, 1))
      .height(Math.max(el.clientHeight, 320))(el);

    applyGlobeQuality();
    loadHiResTexture();

    globe
      .polygonsData([])
      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => "rgba(255,255,255,0.22)")
      .polygonAltitude(0.01);

    globe
      .htmlElementsData([])
      .htmlLat("lat")
      .htmlLng("lng")
      .htmlAltitude(0.04)
      .htmlTransitionDuration(0)
      .htmlElement((d) => makeFlagPin(d));

    bindControls(globe.controls());

    try {
      const topo = await fetch(GEO_URL).then((r) => r.json());
      const feats = topojson.feature(topo, topo.objects.countries).features;
      buildCentroids(feats);
      globe.polygonsData(feats);
    } catch (e) {
      console.warn("GeoJSON load failed", e);
    }

    updatePins(countries);
    bindResize(el);
    onResize();
    syncRotateButton();
    syncPinViewButton();

    return globe;
  }

  function updatePins(list) {
    countries = (list || countries).filter((c) => (c.placeCount || 0) > 0);
    if (!globe) return;
    if (dayMode) return;
    applyPinView();
  }

  function focusCountry(countryId) {
    const c = countries.find((x) => x.id === countryId);
    if (!c || !globe) return;
    const center = countryCenter(c);
    if (!center) return;
    globe.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.55 }, 1200);
  }

  function focusPlace(lat, lng, { altitude = 1.65, duration = 1200 } = {}) {
    if (!globe || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const safeAlt = Math.max(MIN_POV_ALT, Math.min(MAX_POV_ALT, altitude));
    globe.pointOfView({ lat, lng, altitude: safeAlt }, duration);
    lastHudAlt = safeAlt;
    setZoomBarVisible(true);
    updateZoomHud({ lat, lng, altitude: safeAlt });
    setTimeout(() => setZoomBarVisible(false), duration + 200);
  }

  function focusCity(lat, lng, { altitude = 1.35, duration = 900 } = {}) {
    focusPlace(lat, lng, { altitude, duration });
  }

  function onResize() {
    if (!globe || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    globe.width(w).height(h);
    applyGlobeQuality();
    scheduleZoomTileSync();
    scheduleCityPinRefresh(120);
  }

  function resize() {
    onResize();
  }

  function isReady() {
    return !!globe && !!container?.querySelector("canvas");
  }

  function destroy() {
    clearTimeout(cityPinRefreshTimer);
    clearTimeout(zoomHudHideTimer);
    clearTimeout(pinLockTimer);
    if (container && wheelZoomHandler) {
      container.removeEventListener("wheel", wheelZoomHandler);
    }
    wheelZoomHandler = null;
    pinClicksEnabled = true;
    if (tileSyncRaf) cancelAnimationFrame(tileSyncRaf);
    tileSyncRaf = null;
    disableZoomTiles();
    window.removeEventListener("resize", onResize);
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    pinClickBound = false;
    if (container) {
      container.classList.remove("globe-ready");
      container.innerHTML = "";
    }
    globe = null;
    container = null;
    dayMode = false;
  }

  return {
    init,
    updatePins,
    focusCountry,
    focusPlace,
    focusCity,
    showDayPlaces,
    restoreCountryPins,
    setPinViewMode,
    getPinViewMode: () => pinViewMode,
    destroy,
    resize,
    isReady,
    setAutoRotate,
    isAutoRotate: () => autoRotateEnabled,
    setPinsVisible,
    resetDefaultView,
    refreshCityPins: refreshCityPinsForView,
  };
})();
