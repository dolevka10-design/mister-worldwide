/**
 * 3D Earth globe — rotating earth model + flag pins per country.
 */
window.WorldGlobe = (() => {
  let globe = null;
  let container = null;
  let onCountryClick = null;
  let countries = [];
  let earthGroup = null;

  const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
  const EARTH_GLB = "assets/models/earth.glb";
  const EARTH_TEX = "assets/textures/earth.jpg";
  const EARTH_TEX_FALLBACK = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
  const GLOBE_RADIUS = 100;

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject);
    });
  }

  function addTexturedSphere(group, texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 72, 72),
      new THREE.MeshPhongMaterial({
        map: texture,
        shininess: 12,
        specular: 0x333333,
      })
    );
    mesh.name = "EarthSphere";
    group.add(mesh);
    return mesh;
  }

  async function loadEarthModel(group) {
    let texture = null;
    try { texture = await loadTexture(EARTH_TEX); }
    catch { texture = await loadTexture(EARTH_TEX_FALLBACK); }

    if (typeof THREE.GLTFLoader !== "undefined") {
      try {
        const gltf = await new Promise((resolve, reject) => {
          new THREE.GLTFLoader().load(EARTH_GLB, resolve, undefined, reject);
        });
        const root = gltf.scene;
        root.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.material = new THREE.MeshPhongMaterial({
            map: texture,
            shininess: 12,
            specular: 0x333333,
          });
        });
        root.scale.setScalar(GLOBE_RADIUS);
        root.name = "EarthModel";
        group.add(root);
        return;
      } catch (err) {
        console.warn("earth.glb load failed, using textured sphere", err);
      }
    }

    addTexturedSphere(group, texture);
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

    earthGroup = new THREE.Group();
    await loadEarthModel(earthGroup);

    globe = Globe()
      .globeObject(earthGroup)
      .showGlobe(false)
      .showAtmosphere(true)
      .atmosphereColor("#7cf0ff")
      .atmosphereAltitude(0.14)
      .backgroundColor("rgba(0,0,0,0)")
      .width(el.clientWidth)
      .height(el.clientHeight)(el);

    const scene = globe.scene();
    scene.background = null;

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(4, 2, 3);
    scene.add(ambient, sun);

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

  function destroy() {
    window.removeEventListener("resize", onResize);
    if (container) container.innerHTML = "";
    globe = null;
    earthGroup = null;
  }

  return { init, updatePins, focusCountry, destroy };
})();
