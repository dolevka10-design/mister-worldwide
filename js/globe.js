/**
 * 3D Earth globe — flag pins at country geographic centers.
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let resizeObserver = null;
  let onCountryClick = null;
  let countries = [];
  let centroidsByName = new Map();
  let autoRotateEnabled = false;
  let pinClickBound = false;

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const EARTH_TEX_CDN = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
  const EARTH_TEX_LOCAL = "assets/textures/earth.jpg";
  const ROTATE_KEY = "mister-worldwide-globe-rotate";
  const ROTATE_SPEED = 0.4;

  let lastSelectAt = 0;

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

  function selectCountry(countryId) {
    if (!countryId) return;
    const now = Date.now();
    if (now - lastSelectAt < 300) return;
    lastSelectAt = now;
    onCountryClick?.(countryId);
  }

  function centroidOfRing(ring) {
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (const coord of ring) {
      if (!coord || coord.length < 2) continue;
      sumLng += coord[0];
      sumLat += coord[1];
      n++;
    }
    return n ? { lat: sumLat / n, lng: sumLng / n } : null;
  }

  function centroidOfFeature(feat) {
    const geom = feat?.geometry;
    if (!geom) return null;
    const rings = [];
    if (geom.type === "Polygon") rings.push(...geom.coordinates);
    else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) rings.push(...poly);
    }
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (const ring of rings) {
      const c = centroidOfRing(ring);
      if (!c) continue;
      sumLat += c.lat;
      sumLng += c.lng;
      n++;
    }
    return n ? { lat: sumLat / n, lng: sumLng / n } : null;
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
    const atlasName = CountryMeta.atlasLookupName(c.name);
    const fromAtlas = centroidsByName.get(atlasName);
    if (fromAtlas) return fromAtlas;
    if (c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng };
    return null;
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

    const pick = (e) => {
      const pin = e.target.closest?.(".globe-flag-pin");
      if (!pin?.dataset?.countryId) return;
      e.preventDefault();
      e.stopPropagation();
      selectCountry(pin.dataset.countryId);
    };

    el.addEventListener("click", pick);
    el.addEventListener("touchend", (e) => {
      if (e.changedTouches?.length !== 1) return;
      const pin = e.target.closest?.(".globe-flag-pin");
      if (!pin) return;
      pick(e);
    }, { passive: false });
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

  function bindControls(controls) {
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 170;
    controls.maxDistance = 450;
    applyAutoRotate();
  }

  async function init(el, opts = {}) {
    if (!el) throw new Error("Globe container missing");
    if (typeof Globe !== "function") throw new Error("globe.gl not loaded");

    onCountryClick = opts.onCountryClick || onCountryClick || (() => {});
    countries = opts.countries || countries;
    autoRotateEnabled = loadRotatePref();

    if (globe && container !== el) destroy();
    if (globe && container === el) {
      updatePins(countries);
      onResize();
      syncRotateButton();
      return globe;
    }

    container = el;
    container.classList.add("globe-ready");
    bindPinClicks(el);
    bindRotateToggle();

    globe = Globe()
      .globeImageUrl(EARTH_TEX_CDN)
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#7cf0ff")
      .atmosphereAltitude(0.14)
      .backgroundColor("rgba(5,5,8,0.85)")
      .width(Math.max(el.clientWidth, 1))
      .height(Math.max(el.clientHeight, 320))(el);

    const img = new Image();
    img.onload = () => { if (globe) globe.globeImageUrl(EARTH_TEX_LOCAL); };
    img.src = EARTH_TEX_LOCAL;

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
      .htmlElement((d) => makeFlagPin(d));

    globe
      .pointsData([])
      .pointLat("lat")
      .pointLng("lng")
      .pointAltitude(0.04)
      .pointRadius(0.85)
      .pointColor(() => "rgba(124, 240, 255, 0.01)")
      .onPointClick((p) => selectCountry(p.id));

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

    return globe;
  }

  function updatePins(list) {
    countries = (list || countries).filter((c) => (c.placeCount || 0) > 0);
    if (!globe) return;
    const data = pinData(countries);
    globe.htmlElementsData(data);
    globe.pointsData(data);
  }

  function focusCountry(countryId) {
    const c = countries.find((x) => x.id === countryId);
    if (!c || !globe) return;
    const center = countryCenter(c);
    if (!center) return;
    globe.pointOfView({ lat: center.lat, lng: center.lng, altitude: 1.55 }, 1200);
  }

  function onResize() {
    if (!globe || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    globe.width(w).height(h);
  }

  function resize() {
    onResize();
  }

  function isReady() {
    return !!globe && !!container?.querySelector("canvas");
  }

  function destroy() {
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
  }

  return {
    init,
    updatePins,
    focusCountry,
    destroy,
    resize,
    isReady,
    setAutoRotate,
    isAutoRotate: () => autoRotateEnabled,
  };
})();
