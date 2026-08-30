/**
 * 3D hollow wireframe globe with country pins (flags).
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let onCountryClick = null;
  let countries = [];

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  async function init(el, opts = {}) {
    container = el;
    onCountryClick = opts.onCountryClick || (() => {});
    countries = opts.countries || [];

    if (typeof Globe !== "function") throw new Error("three-globe not loaded");

    globe = Globe()
      .globeImageUrl(null)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(false)
      .width(el.clientWidth)
      .height(el.clientHeight)(el);

    const scene = globe.scene();
    scene.background = new THREE.Color(0x050508);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0f,
      transparent: true,
      opacity: 0.15,
    });
    globe.globeMaterial(mat);

    globe
      .polygonsData([])
      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(255,255,255,0.03)")
      .polygonStrokeColor(() => "#333340")
      .polygonAltitude(0.006);

    globe
      .pointsData([])
      .pointLat("lat")
      .pointLng("lng")
      .pointAltitude(0.03)
      .pointRadius(0.55)
      .pointColor(() => "#ffffff")
      .pointLabel((d) => `
        <div class="globe-tooltip">
          <img src="${CountryMeta.flagUrl(d.iso, 20)}" alt="" width="20" height="14"/>
          <strong>${d.name}</strong>
          <span>${d.placeCount} places</span>
        </div>
      `)
      .onPointClick((d) => onCountryClick(d.id));

    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.35;
    globe.controls().enableDamping = true;
    globe.controls().minDistance = 180;
    globe.controls().maxDistance = 500;

    try {
      const topo = await fetch(GEO_URL).then((r) => r.json());
      const feats = topojson.feature(topo, topo.objects.countries).features;
      globe.polygonsData(feats);
    } catch (e) {
      console.warn("GeoJSON load failed", e);
    }

    updatePins(countries);
    window.addEventListener("resize", onResize);
    return globe;
  }

  function updatePins(list) {
    countries = list || countries;
    if (!globe) return;
    globe.pointsData(
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
    globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.8 }, 1200);
  }

  function onResize() {
    if (!globe || !container) return;
    globe.width(container.clientWidth).height(container.clientHeight);
  }

  function destroy() {
    window.removeEventListener("resize", onResize);
    if (container) container.innerHTML = "";
    globe = null;
  }

  return { init, updatePins, focusCountry, destroy };
})();
