/**
 * Mister Worldwide — main app shell
 */
window.WorldApp = (() => {
  let state = null;
  let user = null;
  let ready = false;
  let selectedCountry = null;
  let viewMode = "category"; // category | city | list
  let filterCategory = "";
  let filterCity = "";
  let filterQuery = "";
  let sortBy = "name";
  let sortOrder = "asc";

  const $ = (id) => document.getElementById(id);

  function toast(msg, type = "info") {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast toast-${type} show`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function persist({ touchPlanner } = {}) {
    if (touchPlanner) WorldStore.touchPlanner(state);
    WorldStore.saveState(state);
    if (user?.uid && WorldCloud.configured) {
      WorldCloud.scheduleSave(user.uid, WorldStore.packCloudPayload(state));
    }
    WorldGlobe.updatePins(countriesForUi(state));
    renderCountryPanel();
    renderStats();
  }

  function persistPlanner({ flush } = {}) {
    persist({ touchPlanner: true });
    WorldPlanner?.render?.(state);
    if (flush && user?.uid && WorldCloud.configured) {
      WorldCloud.flushSave(user.uid, WorldStore.packCloudPayload(state));
    }
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
    } else if (!$("app-root")?.classList.contains("hidden")) {
      ensureGlobe();
    }
    WorldPlanner?.render?.(state);
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

  function selectCountry(countryId) {
    selectedCountry = countryId;
    filterCategory = "";
    filterCity = "";
    filterQuery = "";
    sortBy = "name";
    sortOrder = "asc";
    const q = $("place-search");
    if (q) q.value = "";
    const citySel = $("city-filter");
    if (citySel) citySel.value = "";
    WorldGlobe.focusCountry(countryId);
    WorldGlobe.setPinsVisible?.(false);
    renderCountryList();
    renderCountryPanel();
    $("country-panel")?.classList.add("open");
  }

  function renderCountryPanel() {
    const panel = $("country-panel");
    if (!panel || !selectedCountry) return;
    const country = state.countries.find((c) => c.id === selectedCountry);
    if (!country) return;

    $("panel-flag").src = CountryMeta.flagUrl(country.iso, 80);
    $("panel-flag").alt = country.name;
    $("panel-title").textContent = country.name;
    $("panel-count").textContent = `${country.placeCount} saved places`;

    let places = WorldStore.placesByCountry(state, selectedCountry, {
      category: filterCategory || undefined,
      city: filterCity || undefined,
      query: filterQuery || undefined,
      sort: sortBy,
      order: sortOrder,
    });

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
        cities.map((c) => `<option value="${esc(c)}" ${filterCity === c ? "selected" : ""}>${esc(c)}</option>`)
          .join("");
    }

    const sortSel = $("sort-by");
    if (sortSel) sortSel.value = sortBy;
    const orderSel = $("sort-order");
    if (orderSel) orderSel.value = sortOrder;

    const body = $("panel-body");
    if (!body) return;

    if (viewMode === "city") {
      const groups = WorldStore.groupByCity(places);
      body.innerHTML = groups.map(([city, items]) => `
        <section class="place-group">
          <h3 class="group-title">${city} <span class="muted">(${items.length})</span></h3>
          <ul class="place-list">${items.map(placeCard).join("")}</ul>
        </section>
      `).join("") || emptyMsg();
    } else if (viewMode === "list") {
      body.innerHTML = `<ul class="place-list">${places.map(placeCard).join("")}</ul>` || emptyMsg();
    } else {
      const groups = WorldStore.groupByCategory(places);
      body.innerHTML = groups.map(([cat, items]) => `
        <section class="place-group">
          <h3 class="group-title">${PlaceCategorize.label(cat)} <span class="muted">(${items.length})</span></h3>
          <ul class="place-list">${items.map(placeCard).join("")}</ul>
        </section>
      `).join("") || emptyMsg();
    }
  }

  function placeCard(p) {
    return `
      <li class="place-card">
        <div class="place-main">
          <strong>${esc(p.name)}</strong>
          <span class="place-meta">${esc(p.city)} · ${PlaceCategorize.label(p.category)}</span>
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
      $("country-panel")?.classList.remove("open");
      selectedCountry = null;
      WorldGlobe.setPinsVisible?.(true);
      renderCountryList();
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
      $("view-category").classList.add("active");
      $("view-city").classList.remove("active");
      $("view-list")?.classList.remove("active");
      renderCountryPanel();
    });
    $("view-city")?.addEventListener("click", () => {
      viewMode = "city";
      $("view-city").classList.add("active");
      $("view-category").classList.remove("active");
      $("view-list")?.classList.remove("active");
      renderCountryPanel();
    });
    $("view-list")?.addEventListener("click", () => {
      viewMode = "list";
      $("view-list").classList.add("active");
      $("view-category").classList.remove("active");
      $("view-city").classList.remove("active");
      renderCountryPanel();
    });

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
      const btn = e.target.closest?.("[data-add-trip]");
      if (!btn) return;
      const place = state.places.find((p) => p.id === btn.dataset.addTrip);
      if (place) WorldPlanner.showAddToTripMenu(place);
    });

    $("place-search")?.addEventListener("input", (e) => {
      filterQuery = e.target.value.trim();
      renderCountryPanel();
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

    const countries = new Map((local?.countries || []).map((c) => [c.id, { ...c }]));
    for (const c of remote?.countries || []) {
      const prev = countries.get(c.id);
      countries.set(c.id, prev ? { ...prev, ...c } : { ...c });
    }

    const mergedPlanner = WorldStore.mergePlanner(local?.planner, remote?.planner);
    const plannerUpdatedAt = mergedPlanner.updatedAt
      || remote?.plannerUpdatedAt
      || local?.plannerUpdatedAt
      || null;

    const next = {
      ...local,
      ...remote,
      countries: [...countries.values()],
      planner: mergedPlanner,
      plannerUpdatedAt,
    };

    if (!remote.places?.length && local?.places?.length) next.places = local.places;
    if (!remote.countries?.length && local?.countries?.length) next.countries = local.countries;

    return WorldStore.reconcileState(next);
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
        });
        ready = true;
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
        WorldCloud.scheduleSave(u.uid, WorldStore.packCloudPayload(state));
      }
      WorldStore.saveState(state);
      WorldCloud.listenCloud(u.uid, (remote) => {
        state = mergeCloudState(state, remote);
        WorldStore.saveState(state);
        refresh();
        ensureGlobe();
      });
      WorldAssistant?.bindUser?.({ uid: u.uid, email: u.email, displayName: u.displayName });
    } else {
      WorldStore.setUserEmail("local");
      state = WorldStore.reconcileState(WorldStore.loadState());
      showAuth(WorldCloud.configured);
      $("user-chip").textContent = WorldCloud.configured ? "" : "Local mode";
      WorldAssistant?.unbindUser?.();
    }
    CountryMeta.init(state.countries);
    refresh();
    await ensureGlobe();
  }

  async function start() {
    bindUi();
    bindAuth();
    watchMainView();
    await WorldStore.loadSeed();
    state = WorldStore.reconcileState(WorldStore.loadState());
    CountryMeta.init(state.countries);
    refresh();

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
      if (err) toast(err.message, "error");
      await onUser(u);
    });

    WorldPlanner?.init?.();
    WorldImportPanel?.init?.();
  }

  return {
    start, ready: () => ready, getState, setState, cloneState, persist, persistPlanner, refresh, toast,
    getUser: () => user,
    selectCountry, get selectedCountry() { return selectedCountry; },
  };
})();

document.addEventListener("DOMContentLoaded", () => WorldApp.start());
