/**
 * 3D Earth globe — rotating earth model + flag pins per country.
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let resizeObserver = null;
  let onCountryClick = null;
  let countries = [];

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const EARTH_TEX_CDN = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
  const EARTH_TEX_LOCAL = "assets/textures/earth.jpg";

  function makeFlagPin(d) {
    const el = document.createElement("div");
    el.className = "globe-flag-pin";
    el.title = `${d.name} (${d.placeCount} places)`;
    el.innerHTML = `
      <img src="${CountryMeta.flagUrl(d.iso, 40)}" alt="${d.name}" width="32" height="24" loading="lazy"/>
      <span class="globe-flag-count">${d.placeCount}</span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onCountryClick?.(d.id);
    });
    return el;
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

  async function init(el, opts = {}) {
    if (!el) throw new Error("Globe container missing");
    if (typeof Globe !== "function") throw new Error("globe.gl not loaded");

    if (globe && container !== el) destroy();
    if (globe && container === el) {
      updatePins(opts.countries || countries);
      onResize();
      return globe;
    }

    container = el;
    onCountryClick = opts.onCountryClick || (() => {});
    countries = opts.countries || [];

    globe = Globe()
      .globeImageUrl(EARTH_TEX_CDN)
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#7cf0ff")
      .atmosphereAltitude(0.14)
      .backgroundColor("rgba(5,5,8,0.85)")
      .width(Math.max(el.clientWidth, 1))
      .height(Math.max(el.clientHeight, 320))(el);

    // Retry local texture if CDN is blocked/slow.
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
      .htmlAltitude(0.05)
      .htmlElement((d) => makeFlagPin(d));

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 170;
    controls.maxDistance = 450;

    try {
      const topo = await fetch(GEO_URL).then((r) => r.json());
      const feats = topojson.feature(topo, topo.objects.countries).features;
      globe.polygonsData(feats);
    } catch (e) {
      console.warn("GeoJSON load failed", e);
    }

    updatePins(countries);
    bindResize(el);
    onResize();

    return globe;
  }

  function updatePins(list) {
    countries = (list || countries).filter((c) => c.placeCount > 0 && c.lat != null && c.lng != null);
    if (!globe) return;
    globe.htmlElementsData(
      countries.map((c) => ({
        id: c.id,
        name: c.name,
        iso: c.iso,
        lat: c.lat,
        lng: c.lng,
        placeCount: c.placeCount || 0,
      }))
    );
  }

  function focusCountry(countryId) {
    const c = countries.find((x) => x.id === countryId);
    if (!c || !globe) return;
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.55 }, 1200);
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
    if (container) container.innerHTML = "";
    globe = null;
    container = null;
  }

  return { init, updatePins, focusCountry, destroy, resize, isReady };
})();
