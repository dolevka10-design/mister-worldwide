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
  let placeIdFilter = null;
  let dayPanelLabel = "";
  let placeIdOrder = [];

  const $ = (id) => document.getElementById(id);

  function toast(msg, type = "info") {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `toast toast-${type} show`;
    el.setAttribute("aria-live", "polite");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), type === "error" ? 4200 : 2800);
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

  function selectCountry(countryId, { keepDayFilter = false } = {}) {
    if (!keepDayFilter) clearDayPlaceFilter();
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
    document.querySelectorAll(".view-toggle .tab").forEach((t) => t.classList.remove("active"));
    $("view-list")?.classList.add("active");
    WorldGlobe.setPinsVisible?.(false);
    renderCountryList();
    renderCountryPanel();
    $("country-panel")?.classList.add("open");
    $("app-root")?.classList.remove("hidden");
  }

  function renderCountryPanel() {
    const panel = $("country-panel");
    if (!panel || !selectedCountry) return;
    const country = state.countries.find((c) => c.id === selectedCountry);
    if (!country) return;

    $("panel-flag").src = CountryMeta.flagUrl(country.iso, 80);
    $("panel-flag").alt = country.name;
    $("panel-title").textContent = country.name;

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
        cities.map((c) => `<option value="${esc(c)}" ${filterCity === c ? "selected" : ""}>${esc(c)}</option>`)
          .join("");
    }

    const sortSel = $("sort-by");
    if (sortSel) sortSel.value = sortBy;
    const orderSel = $("sort-order");
    if (orderSel) orderSel.value = sortOrder;

    const body = $("panel-body");
    if (!body) return;

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
      clearDayPlaceFilter();
      WorldGlobe.restoreCountryPins?.();
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
    selectCountry, showDayPlacesOnCountry, get selectedCountry() { return selectedCountry; },
  };
})();

document.addEventListener("DOMContentLoaded", () => WorldApp.start());
