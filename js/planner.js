/**
 * Travel planner — multi-city/country segments, dates, import tab, suggestions.
 */
window.WorldPlanner = (() => {
  const SLOTS = [
    { id: "breakfast", label: "Breakfast" }, { id: "brunch", label: "Brunch" },
    { id: "lunch", label: "Lunch" }, { id: "afternoon", label: "Afternoon" },
    { id: "dinner", label: "Dinner" }, { id: "drinks", label: "Drinks" },
    { id: "dessert", label: "Dessert" }, { id: "show", label: "Show" },
    { id: "activity", label: "Activity & Sights" }, { id: "hotel", label: "Hotel" },
    { id: "transport", label: "Transport" },
  ];

  const $ = (id) => document.getElementById(id);
  let open = false;
  let activeTab = "plan";

  function slotLabel(id) { return SLOTS.find((s) => s.id === id)?.label || id; }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

  function ensurePlanner(state) {
    if (!state.planner) state.planner = { trips: [], activeTripId: null };
    if (!Array.isArray(state.planner.trips)) state.planner.trips = [];
    for (const t of state.planner.trips) migrateTrip(t);
    return state.planner;
  }

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(d) {
    if (!d) return "";
    return d.toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return fmtDate(d);
  }

  function daysBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return 0;
    return Math.max(0, Math.round((db - da) / 86400000));
  }

  function emptyDay(dayNum, date, segmentId) {
    return { day: dayNum, date: date || null, segmentId: segmentId || null, slots: {}, notes: "" };
  }

  function migrateTrip(trip) {
    if (!trip) return trip;
    if (!trip.segments?.length) {
      trip.segments = [{
        id: WorldStore.uid("seg"),
        countryId: trip.countryId || "",
        city: trip.city || "Other",
        startDate: trip.startDate || null,
        endDate: trip.endDate || null,
      }];
    }
    rebuildDays(trip);
    return trip;
  }

  function segmentForDay(trip, dayNum) {
    const day = trip.days?.[dayNum - 1];
    if (day?.segmentId) return trip.segments.find((s) => s.id === day.segmentId) || trip.segments[0];
    if (day?.date) {
      return trip.segments.find((s) => s.startDate && s.endDate && day.date >= s.startDate && day.date <= s.endDate) || trip.segments[0];
    }
    const segIdx = Math.min(trip.segments.length - 1, Math.floor(((dayNum - 1) / Math.max(trip.dayCount, 1)) * trip.segments.length));
    return trip.segments[segIdx] || trip.segments[0];
  }

  function rebuildDays(trip) {
    const start = trip.startDate || trip.segments[0]?.startDate;
    let dayCount = trip.dayCount;
    if (start && trip.endDate) dayCount = daysBetween(start, trip.endDate) + 1;
    else if (trip.segments.length) {
      dayCount = trip.segments.reduce((sum, s) => {
        if (s.startDate && s.endDate) return sum + daysBetween(s.startDate, s.endDate) + 1;
        return sum + 1;
      }, 0) || trip.dayCount || 3;
    }
    trip.dayCount = Math.max(1, dayCount || 3);
    const prev = trip.days || [];
    trip.days = [];
    for (let i = 1; i <= trip.dayCount; i++) {
      const date = start ? addDays(start, i - 1) : prev[i - 1]?.date || null;
      const seg = trip.segments.find((s) => date && s.startDate && s.endDate && date >= s.startDate && date <= s.endDate)
        || trip.segments[Math.min(trip.segments.length - 1, Math.floor(((i - 1) / trip.dayCount) * trip.segments.length))];
      const old = prev[i - 1];
      trip.days.push({
        ...emptyDay(i, date, seg?.id),
        slots: old?.slots || {},
        notes: old?.notes || "",
      });
    }
    return trip;
  }

  function createTrip(state, { name, startDate, endDate, segments, dayCount }) {
    const planner = ensurePlanner(state);
    const segs = (segments || []).map((s) => ({
      id: WorldStore.uid("seg"),
      countryId: s.countryId,
      city: s.city || "Other",
      startDate: s.startDate || null,
      endDate: s.endDate || null,
    }));
    if (!segs.length) segs.push({ id: WorldStore.uid("seg"), countryId: "", city: "Other", startDate, endDate });

    const trip = migrateTrip({
      id: WorldStore.uid("trip"),
      name: name || "My trip",
      startDate: startDate || segs[0]?.startDate || null,
      endDate: endDate || segs[segs.length - 1]?.endDate || null,
      segments: segs,
      dayCount: dayCount || 3,
      days: [],
      suggestions: [],
      createdAt: new Date().toISOString(),
    });
    rebuildDays(trip);
    planner.trips.unshift(trip);
    planner.activeTripId = trip.id;
    return trip;
  }

  function getActiveTrip(state) {
    const planner = ensurePlanner(state);
    return planner.trips.find((t) => t.id === planner.activeTripId) || planner.trips[0] || null;
  }

  function setActiveTrip(state, tripId) { ensurePlanner(state).activeTripId = tripId; }

  function placesForDay(state, trip, dayNum) {
    const seg = segmentForDay(trip, dayNum);
    if (!seg?.countryId) return [];
    return WorldStore.placesByCountry(state, seg.countryId, { city: seg.city === "Other" ? undefined : seg.city });
  }

  function entryFromPlace(place, slot, note = "") {
    return {
      id: WorldStore.uid("item"), placeId: place.id, name: place.name, category: place.category,
      city: place.city, countryId: place.countryId, slot, note, url: place.url || "", lat: place.lat, lng: place.lng,
    };
  }

  function addEntry(state, tripId, dayNum, slot, entry) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    migrateTrip(trip);
    const day = trip.days[dayNum - 1];
    if (!day) return false;
    if (!day.slots[slot]) day.slots[slot] = [];
    day.slots[slot].push(entry);
    return true;
  }

  function addPlace(state, tripId, dayNum, slot, place, note = "") {
    return addEntry(state, tripId, dayNum, slot, entryFromPlace(place, slot, note));
  }

  function removeEntry(state, tripId, dayNum, slot, entryId) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip?.days?.[dayNum - 1]?.slots?.[slot]) return false;
    trip.days[dayNum - 1].slots[slot] = trip.days[dayNum - 1].slots[slot].filter((e) => e.id !== entryId);
    return true;
  }

  function addSegment(state, tripId, { countryId, city, startDate, endDate }) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return null;
    trip.segments.push({ id: WorldStore.uid("seg"), countryId, city: city || "Other", startDate, endDate });
    if (startDate && (!trip.startDate || startDate < trip.startDate)) trip.startDate = startDate;
    if (endDate && (!trip.endDate || endDate > trip.endDate)) trip.endDate = endDate;
    rebuildDays(trip);
    return trip;
  }

  function localSuggestDay(state, trip, dayNum, opts = {}) {
    const places = placesForDay(state, trip, dayNum);
    const seg = segmentForDay(trip, dayNum);
    const used = new Set();
    for (const d of trip.days) {
      for (const items of Object.values(d.slots || {})) {
        for (const e of items || []) if (e.placeId) used.add(e.placeId);
      }
    }
    const pool = places.filter((p) => !used.has(p.id));
    const hour = opts.hour != null ? Number(opts.hour) : new Date().getHours();
    const suggestions = [];
    const pick = (cats, slot, limit = 2) => {
      for (const p of pool.filter((x) => cats.includes(x.category) || (cats.includes("eat") && PlaceCategorize.isEatCategory(x.category))).slice(0, limit)) {
        suggestions.push({
          id: WorldStore.uid("sug"), placeId: p.id, name: p.name, category: p.category, slot,
          reason: `${PlaceCategorize.label(p.category)} in ${seg?.city || "area"}`,
          score: 1,
        });
        used.add(p.id);
      }
    };
    if (hour < 11) pick(["bagel", "bakery", "cafe"], "breakfast", 1);
    pick(["museum", "landmark", "monument", "viewpoint", "temple", "park"], "activity", 2);
    pick(["pizza", "ramen", "sushi", "burger", "asian_restaurant", "street_food", "eat"], "lunch", 1);
    pick(["park", "beach", "shopping", "zoo"], "afternoon", 1);
    pick(["pizza", "italian_restaurant", "steakhouse", "seafood", "restaurant", "eat"], "dinner", 1);
    pick(["bar", "nightlife", "brewery", "show"], hour >= 18 ? "drinks" : "show", 1);
    pick(["hotel"], "hotel", 1);
    trip.suggestions = suggestions;
    return suggestions;
  }

  async function aiSuggestDay(state, trip, dayNum, opts = {}) {
    const places = placesForDay(state, trip, dayNum).slice(0, 35);
    const seg = segmentForDay(trip, dayNum);
    const day = trip.days[dayNum - 1];
    if (!places.length) return { ok: false, error: "No places for this day's city" };

    const country = state.countries.find((c) => c.id === seg?.countryId);
    const compact = places.map((p) => `${p.id}|${p.name}|${p.category}`).join("\n");
    const ctx = [
      `${seg?.city}, ${country?.name || seg?.countryId}`,
      `Day ${dayNum}/${trip.dayCount}${day?.date ? ` (${day.date})` : ""}`,
      opts.hour != null ? `Hour:${opts.hour}` : `Hour:${new Date().getHours()}`,
      opts.weather ? `Weather:${opts.weather}` : "",
      "Reply: placeId|slot|reason",
      compact,
    ].filter(Boolean).join("\n");

    const key = WorldAssistant?.getApiKey?.();
    const provider = WorldAssistant?.provider?.() || "groq";
    if (!key) return { ok: true, source: "local", suggestions: localSuggestDay(state, trip, dayNum, opts) };

    try {
      const res = await fetch(`/.netlify/functions/llm?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: provider === "groq" ? "llama-3.1-8b-instant" : "openai/gpt-4o-mini",
          max_tokens: 280, temperature: 0.4,
          messages: [
            { role: "system", content: "Travel planner. Lines only: placeId|slot|reason. Saved places only." },
            { role: "user", content: ctx },
          ],
        }),
      });
      const data = await res.json();
      const byId = new Map(places.map((p) => [p.id, p]));
      const suggestions = [];
      for (const line of (data?.choices?.[0]?.message?.content || "").split(/\n+/)) {
        const [pid, slot, ...rest] = line.split("|").map((s) => s.trim());
        const place = byId.get(pid);
        if (!place || !slot) continue;
        suggestions.push({ id: WorldStore.uid("sug"), placeId: place.id, name: place.name, category: place.category, slot, reason: rest.join("|") || "AI pick", score: 2 });
      }
      if (suggestions.length) trip.suggestions = suggestions;
      return { ok: true, source: "ai", suggestions: trip.suggestions };
    } catch (e) {
      return { ok: true, source: "local", suggestions: localSuggestDay(state, trip, dayNum, opts), warn: String(e.message || e) };
    }
  }

  function adoptSuggestion(state, tripId, suggestion, dayNum) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    const place = (state.places || []).find((p) => p.id === suggestion.placeId);
    const entry = place ? entryFromPlace(place, suggestion.slot, suggestion.reason) : {
      id: WorldStore.uid("item"), placeId: suggestion.placeId, name: suggestion.name,
      category: suggestion.category || "place", slot: suggestion.slot, note: suggestion.reason || "",
    };
    addEntry(state, tripId, dayNum, suggestion.slot, entry);
    trip.suggestions = (trip.suggestions || []).filter((s) => s.id !== suggestion.id);
    return true;
  }

  function segmentSummary(trip) {
    return (trip.segments || []).map((s) => {
      const dates = s.startDate && s.endDate ? ` ${s.startDate}→${s.endDate}` : "";
      return `${s.city}${dates}`;
    }).join(" · ");
  }

  function renderImportTab(state) {
    return `
      <section class="planner-section">
        <h3>Import from Google Maps</h3>
        <p class="muted assist-sub">Paste CSV export: Name, Description, Latitude, Longitude, Url<br/>Description format: City | Country | URL</p>
        <textarea id="import-paste" class="import-paste" rows="8" placeholder="Name,Description,Latitude,Longitude,Url&#10;Joe's Pizza,&quot;Rome | Italy | https://...&quot;,41.89,12.49,https://..."></textarea>
        <button type="button" class="btn btn-primary btn-sm" id="import-paste-btn">Import places</button>
        <p class="muted assist-sub" id="import-result"></p>
      </section>`;
  }

  function renderPlanTab(state, trip, dayNum) {
    const countries = WorldStore.countriesForUi(state);
    const day = trip?.days?.[dayNum - 1];
    const seg = trip ? segmentForDay(trip, dayNum) : null;
    const country = countries.find((c) => c.id === seg?.countryId);

    const segHtml = (trip?.segments || []).map((s, i) => {
      const c = state.countries.find((x) => x.id === s.countryId);
      return `<li class="planner-segment">
        <span><strong>${esc(s.city)}</strong> · ${esc(c?.name || "?")}</span>
        <span class="muted">${esc(s.startDate || "?")} → ${esc(s.endDate || "?")}</span>
      </li>`;
    }).join("");

    let planHtml = "";
    if (day) {
      for (const slot of SLOTS) {
        const items = day.slots?.[slot.id] || [];
        if (!items.length) continue;
        planHtml += `<section class="planner-slot"><h4>${esc(slot.label)}</h4><ul class="planner-items">`;
        planHtml += items.map((e) => `
          <li class="planner-item">
            <div><strong>${esc(e.name)}</strong><span class="muted place-meta">${esc(PlaceCategorize.label(e.category))}${e.note ? ` · ${esc(e.note)}` : ""}</span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-remove-entry="${esc(e.id)}" data-slot="${esc(slot.id)}">✕</button>
          </li>`).join("");
        planHtml += `</ul></section>`;
      }
    }

    const sugHtml = (trip?.suggestions || []).map((s) => `
      <li class="planner-suggestion">
        <div><strong>${esc(s.name)}</strong><span class="muted place-meta">${esc(slotLabel(s.slot))} · ${esc(s.reason || "")}</span></div>
        <button type="button" class="btn btn-primary btn-sm" data-adopt-sug="${esc(s.id)}">Add</button>
      </li>`).join("");

    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    return `
      <div class="planner-controls planner-grid">
        <input id="planner-start" type="date" class="pill-select" value="${esc(trip?.startDate || "")}" />
        <input id="planner-end" type="date" class="pill-select" value="${esc(trip?.endDate || "")}" />
        <select id="planner-day" class="pill-select">${Array.from({ length: trip?.dayCount || 1 }, (_, i) => {
          const d = trip?.days?.[i];
          const label = d?.date ? `Day ${i + 1} (${d.date})` : `Day ${i + 1}`;
          return `<option value="${i + 1}" ${dayNum === i + 1 ? "selected" : ""}>${label}</option>`;
        }).join("")}</select>
      </div>
      ${seg ? `<p class="muted day-context">Day ${dayNum}: <strong>${esc(seg.city)}</strong>, ${esc(country?.name || "")}${day?.date ? ` · ${day.date}` : ""}</p>` : ""}
      <div class="planner-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="planner-suggest-local">Quick suggest</button>
        <button type="button" class="btn btn-primary btn-sm" id="planner-suggest-ai">AI suggest</button>
        <button type="button" class="btn btn-ghost btn-sm" id="planner-add-seg">+ City</button>
      </div>
      <section class="planner-section"><h3>Route</h3><ul class="planner-segments">${segHtml || '<li class="muted">Add cities below</li>'}</ul></section>
      <details class="planner-add-seg-form">
        <summary class="muted">Add city / country segment</summary>
        <div class="planner-grid" style="margin-top:0.5rem">
          <select id="seg-country" class="pill-select">${countryOpts}</select>
          <input id="seg-city" class="pill-select" placeholder="City" />
          <input id="seg-start" type="date" class="pill-select" />
          <input id="seg-end" type="date" class="pill-select" />
          <button type="button" class="btn btn-secondary btn-sm" id="seg-save">Add segment</button>
        </div>
      </details>
      <section class="planner-section"><h3>Suggestions</h3><ul class="planner-suggestions">${sugHtml || '<li class="muted">No suggestions yet</li>'}</ul></section>
      <section class="planner-section"><h3>Day ${dayNum} plan</h3>${planHtml || '<p class="muted">Empty — add from suggestions or country page (+ Trip)</p>'}</section>`;
  }

  function render(state) {
    const panel = $("planner-panel");
    if (!panel) return;
    const planner = ensurePlanner(state);
    const trip = getActiveTrip(state);
    const dayNum = Number($("planner-day")?.value) || 1;
    const countries = WorldStore.countriesForUi(state);

    const tripOpts = planner.trips.map((t) =>
      `<option value="${esc(t.id)}" ${t.id === planner.activeTripId ? "selected" : ""}>${esc(t.name)} — ${esc(segmentSummary(t))}</option>`
    ).join("");

    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    panel.innerHTML = `
      <header class="planner-head">
        <div><strong>Travel Planner</strong><p class="muted assist-sub">Multi-city · multi-country · dates</p></div>
        <button type="button" class="btn btn-ghost btn-sm" id="planner-close">✕</button>
      </header>
      <div class="planner-tabs">
        <button type="button" class="planner-tab ${activeTab === "plan" ? "active" : ""}" data-tab="plan">Plan</button>
        <button type="button" class="planner-tab ${activeTab === "import" ? "active" : ""}" data-tab="import">Import Maps</button>
      </div>
      <div class="planner-controls">
        <select id="planner-trip" class="pill-select">${tripOpts || '<option value="">No trips</option>'}</select>
        <button type="button" class="btn btn-secondary btn-sm" id="planner-new-trip">New trip</button>
      </div>
      <div class="planner-body">
        ${activeTab === "import" ? renderImportTab(state) : renderPlanTab(state, trip, dayNum)}
      </div>`;

    if (activeTab === "plan" && !trip) {
      panel.querySelector(".planner-body").innerHTML = `
        <p class="muted">Create a trip to start planning.</p>
        <div class="planner-grid">
          <input id="new-trip-name" class="pill-select" placeholder="Trip name" />
          <select id="new-trip-country" class="pill-select">${countryOpts}</select>
          <input id="new-trip-city" class="pill-select" placeholder="City" />
          <input id="new-trip-start" type="date" class="pill-select" />
          <input id="new-trip-end" type="date" class="pill-select" />
          <button type="button" class="btn btn-primary btn-sm" id="new-trip-create">Create trip</button>
        </div>`;
    }

    bindPanel(state);
  }

  function bindPanel(state) {
    $("planner-close")?.addEventListener("click", () => toggle(false));

    document.querySelectorAll(".planner-tab").forEach((btn) => {
      btn.addEventListener("click", () => { activeTab = btn.dataset.tab; render(state); });
    });

    $("planner-trip")?.addEventListener("change", (e) => {
      setActiveTrip(state, e.target.value);
      WorldApp.persist();
      render(state);
    });

    $("new-trip-create")?.addEventListener("click", () => {
      const countryId = $("new-trip-country")?.value;
      const city = $("new-trip-city")?.value || "Other";
      const startDate = $("new-trip-start")?.value;
      const endDate = $("new-trip-end")?.value;
      const name = $("new-trip-name")?.value || `${city} trip`;
      if (!countryId) return WorldApp.toast("Pick a country", "warn");
      createTrip(state, {
        name, startDate, endDate,
        segments: [{ countryId, city, startDate, endDate }],
        dayCount: startDate && endDate ? daysBetween(startDate, endDate) + 1 : 3,
      });
      WorldApp.persist();
      WorldApp.refresh();
      activeTab = "plan";
      render(state);
    });

    $("planner-new-trip")?.addEventListener("click", () => {
      ensurePlanner(state).activeTripId = null;
      activeTab = "plan";
      render(state);
    });

    $("planner-start")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.startDate = $("planner-start").value;
      rebuildDays(trip);
      WorldApp.persist();
      render(state);
    });

    $("planner-end")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.endDate = $("planner-end").value;
      rebuildDays(trip);
      WorldApp.persist();
      render(state);
    });

    $("planner-day")?.addEventListener("change", () => render(state));

    $("seg-save")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      addSegment(state, trip.id, {
        countryId: $("seg-country")?.value,
        city: $("seg-city")?.value || "Other",
        startDate: $("seg-start")?.value,
        endDate: $("seg-end")?.value,
      });
      WorldApp.persist();
      render(state);
      WorldApp.toast("Segment added");
    });

    $("planner-suggest-local")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      const dayNum = Number($("planner-day")?.value) || 1;
      if (!trip) return;
      localSuggestDay(state, trip, dayNum);
      WorldApp.persist();
      render(state);
      WorldApp.toast("Suggestions ready");
    });

    $("planner-suggest-ai")?.addEventListener("click", async () => {
      const trip = getActiveTrip(state);
      const dayNum = Number($("planner-day")?.value) || 1;
      if (!trip) return;
      WorldApp.toast("Getting suggestions…");
      await aiSuggestDay(state, trip, dayNum, { hour: new Date().getHours() });
      WorldApp.persist();
      render(state);
    });

    $("import-paste-btn")?.addEventListener("click", () => {
      const text = $("import-paste")?.value?.trim();
      if (!text) return WorldApp.toast("Paste CSV first", "warn");
      try {
        const r = WorldMapsImport.importText(state, text);
        WorldApp.persist();
        WorldApp.refresh();
        const el = $("import-result");
        if (el) el.textContent = `Added ${r.added.length} places${r.skipped.length ? `, skipped ${r.skipped.length} duplicates` : ""}${r.newCountries.length ? `, new countries: ${r.newCountries.length}` : ""}`;
        WorldApp.toast(`Imported ${r.added.length} places`);
      } catch (e) {
        WorldApp.toast(e.message || "Import failed", "error");
      }
    });

    document.querySelectorAll("[data-adopt-sug]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const trip = getActiveTrip(state);
        const dayNum = Number($("planner-day")?.value) || 1;
        const sug = trip?.suggestions?.find((s) => s.id === btn.dataset.adoptSug);
        if (!sug) return;
        adoptSuggestion(state, trip.id, sug, dayNum);
        WorldApp.persist();
        render(state);
      });
    });

    document.querySelectorAll("[data-remove-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const trip = getActiveTrip(state);
        const dayNum = Number($("planner-day")?.value) || 1;
        if (!trip) return;
        removeEntry(state, trip.id, dayNum, btn.dataset.slot, btn.dataset.removeEntry);
        WorldApp.persist();
        render(state);
      });
    });
  }

  function plannerClearTrip(state) {
    ensurePlanner(state).activeTripId = null;
  }

  function toggle(on) {
    open = on != null ? !!on : !open;
    const panel = $("planner-panel");
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.hidden = !open;
    if (open) render(WorldApp.getState());
  }

  function showAddToTripMenu(place) {
    const state = WorldApp.getState();
    let trip = getActiveTrip(state);
    if (!trip) {
      toggle(true);
      WorldApp.toast("Create a trip first", "warn");
      return;
    }
    const dayNum = Number(prompt(`Add "${place.name}" to day? (1-${trip.dayCount})`, "1")) || 1;
    const slot = prompt(`Slot: ${SLOTS.map((s) => s.id).join(", ")}`, PlaceCategorize.defaultSlot(place.category));
    if (!slot || !SLOTS.some((s) => s.id === slot)) return;
    const note = prompt("Note (breakfast, drinks, show…)", "") || "";
    addPlace(state, trip.id, Math.min(trip.dayCount, Math.max(1, dayNum)), slot, place, note);
    WorldApp.persist();
    WorldApp.toast(`Added to day ${dayNum}`);
  }

  function init() {
    $("btn-planner")?.addEventListener("click", () => toggle(true));
  }

  return {
    init, toggle, open: () => toggle(true), render, SLOTS, slotLabel,
    ensurePlanner, migrateTrip, createTrip, getActiveTrip, addPlace, removeEntry,
    addSegment, segmentForDay, placesForDay, localSuggestDay, aiSuggestDay,
    adoptSuggestion, showAddToTripMenu, rebuildDays,
  };
})();
