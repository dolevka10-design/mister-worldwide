/**
 * 3D Earth globe — rotating earth model + flag pins per country.
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let onCountryClick = null;
  let countries = [];

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const EARTH_TEX = "assets/textures/earth.jpg";
  const EARTH_TEX_FALLBACK = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

  async function resolveEarthTexture() {
    try {
      const head = await fetch(EARTH_TEX, { method: "HEAD" });
      if (head.ok) return EARTH_TEX;
    } catch {
      /* use fallback */
    }
    return EARTH_TEX_FALLBACK;
  }

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

  async function init(el, opts = {}) {
    container = el;
    onCountryClick = opts.onCountryClick || (() => {});
    countries = opts.countries || [];

    if (typeof Globe !== "function") throw new Error("globe.gl not loaded");

    const globeImage = await resolveEarthTexture();

    globe = Globe()
      .globeImageUrl(globeImage)
      .showGlobe(true)
      .showAtmosphere(true)
      .atmosphereColor("#7cf0ff")
      .atmosphereAltitude(0.14)
      .backgroundColor("rgba(0,0,0,0)")
      .width(el.clientWidth)
      .height(el.clientHeight)(el);

    const scene = globe.scene();
    scene.background = null;

    globe
      .polygonsData([])
      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => "rgba(255,255,255,0.2)")
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
    window.addEventListener("resize", onResize);

    if (el.clientWidth === 0 || el.clientHeight === 0) {
      const ro = new ResizeObserver(() => {
        if (!globe || !container) return;
        if (container.clientWidth > 0 && container.clientHeight > 0) onResize();
      });
      ro.observe(el);
    } else {
      onResize();
    }

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
    globe.width(container.clientWidth).height(container.clientHeight);
  }

  function resize() {
    onResize();
  }

  function destroy() {
    window.removeEventListener("resize", onResize);
    if (container) container.innerHTML = "";
    globe = null;
  }

  return { init, updatePins, focusCountry, destroy, resize };
})();
