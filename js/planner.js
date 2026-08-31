/**
 * Travel planner — trips, day slots, local + AI suggestions (low-token).
 */
window.WorldPlanner = (() => {
  const SLOTS = [
    { id: "breakfast", label: "Breakfast" },
    { id: "brunch", label: "Brunch" },
    { id: "lunch", label: "Lunch" },
    { id: "afternoon", label: "Afternoon" },
    { id: "dinner", label: "Dinner" },
    { id: "drinks", label: "Drinks" },
    { id: "dessert", label: "Dessert" },
    { id: "show", label: "Show" },
    { id: "activity", label: "Activity & Sights" },
    { id: "hotel", label: "Hotel" },
    { id: "transport", label: "Transport" },
  ];

  const $ = (id) => document.getElementById(id);
  let open = false;

  function slotLabel(id) {
    return SLOTS.find((s) => s.id === id)?.label || id;
  }

  function ensurePlanner(state) {
    if (!state.planner) state.planner = { trips: [], activeTripId: null };
    if (!Array.isArray(state.planner.trips)) state.planner.trips = [];
    return state.planner;
  }

  function emptyDay(dayNum) {
    return { day: dayNum, slots: {}, notes: "" };
  }

  function ensureDays(trip) {
    const n = Math.max(1, Number(trip.dayCount) || 1);
    trip.dayCount = n;
    if (!Array.isArray(trip.days)) trip.days = [];
    for (let i = 1; i <= n; i++) {
      if (!trip.days[i - 1]) trip.days[i - 1] = emptyDay(i);
      if (!trip.days[i - 1].slots) trip.days[i - 1].slots = {};
    }
    trip.days = trip.days.slice(0, n);
    return trip;
  }

  function createTrip(state, { countryId, city, name, dayCount = 3 }) {
    const planner = ensurePlanner(state);
    const country = state.countries.find((c) => c.id === countryId);
    const trip = ensureDays({
      id: WorldStore.uid("trip"),
      name: name || `${city || country?.name || "Trip"}`,
      countryId,
      city: city || "Other",
      dayCount,
      days: [],
      suggestions: [],
      createdAt: new Date().toISOString(),
    });
    planner.trips.unshift(trip);
    planner.activeTripId = trip.id;
    return trip;
  }

  function getActiveTrip(state) {
    const planner = ensurePlanner(state);
    return planner.trips.find((t) => t.id === planner.activeTripId) || planner.trips[0] || null;
  }

  function setActiveTrip(state, tripId) {
    ensurePlanner(state).activeTripId = tripId;
  }

  function placesForTrip(state, trip) {
    if (!trip) return [];
    return WorldStore.placesByCountry(state, trip.countryId, { city: trip.city });
  }

  function entryFromPlace(place, slot, note = "") {
    return {
      id: WorldStore.uid("item"),
      placeId: place.id,
      name: place.name,
      category: place.category,
      city: place.city,
      slot,
      note,
      url: place.url || "",
      lat: place.lat,
      lng: place.lng,
    };
  }

  function addEntry(state, tripId, dayNum, slot, entry) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    ensureDays(trip);
    const day = trip.days[dayNum - 1];
    if (!day.slots[slot]) day.slots[slot] = [];
    day.slots[slot].push(entry);
    return true;
  }

  function addPlace(state, tripId, dayNum, slot, place, note = "") {
    const entry = entryFromPlace(place, slot, note);
    return addEntry(state, tripId, dayNum, slot, entry);
  }

  function removeEntry(state, tripId, dayNum, slot, entryId) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip?.days?.[dayNum - 1]?.slots?.[slot]) return false;
    trip.days[dayNum - 1].slots[slot] = trip.days[dayNum - 1].slots[slot].filter((e) => e.id !== entryId);
    return true;
  }

  function localSuggestDay(state, trip, dayNum, opts = {}) {
    const places = placesForTrip(state, trip);
    const used = new Set();
    for (const d of trip.days) {
      for (const items of Object.values(d.slots || {})) {
        for (const e of items || []) if (e.placeId) used.add(e.placeId);
      }
    }
    const pool = places.filter((p) => !used.has(p.id));
    const hour = opts.hour != null ? Number(opts.hour) : new Date().getHours();
    const suggestions = [];

    const pick = (catList, slot, limit = 2) => {
      const matches = pool.filter((p) => catList.includes(p.category) || (catList.includes("eat") && PlaceCategorize.isEatCategory(p.category)));
      for (const p of matches.slice(0, limit)) {
        suggestions.push({
          id: WorldStore.uid("sug"),
          placeId: p.id,
          name: p.name,
          category: p.category,
          slot,
          reason: `Fits ${slotLabel(slot).toLowerCase()} (${PlaceCategorize.label(p.category)})`,
          score: 1,
        });
        used.add(p.id);
      }
    };

    if (hour < 11) pick(["bagel", "bakery", "cafe"], "breakfast", 1);
    pick(["museum", "landmark", "monument", "viewpoint", "temple", "park"], "activity", 2);
    pick(["asian_restaurant", "italian_restaurant", "restaurant", "street_food", "eat"], "lunch", 1);
    pick(["park", "beach", "amusement", "zoo", "shopping"], "afternoon", 1);
    pick(["restaurant", "steakhouse", "seafood", "italian_restaurant", "asian_restaurant", "eat"], "dinner", 1);
    pick(["bar", "nightlife", "brewery", "show"], hour >= 18 ? "drinks" : "show", 1);
    pick(["hotel"], "hotel", 1);

    trip.suggestions = suggestions;
    return suggestions;
  }

  async function aiSuggestDay(state, trip, dayNum, opts = {}) {
    const places = placesForTrip(state, trip).slice(0, 35);
    if (!places.length) return { ok: false, error: "No places in this city" };

    const compact = places.map((p) => `${p.id}|${p.name}|${p.category}`).join("\n");
    const ctx = [
      `City: ${trip.city}, ${state.countries.find((c) => c.id === trip.countryId)?.name || trip.countryId}`,
      `Day: ${dayNum}/${trip.dayCount}`,
      opts.date ? `Date: ${opts.date}` : "",
      opts.hour != null ? `Hour: ${opts.hour}` : `Hour: ${new Date().getHours()}`,
      opts.weather ? `Weather: ${opts.weather}` : "",
      "Format each line: placeId|slot|reason (slot: breakfast,lunch,dinner,drinks,activity,afternoon,show,hotel,transport)",
      "Places:",
      compact,
    ].filter(Boolean).join("\n");

    const key = WorldAssistant?.getApiKey?.();
    const provider = WorldAssistant?.provider?.() || "groq";
    if (!key) {
      const local = localSuggestDay(state, trip, dayNum, opts);
      return { ok: true, source: "local", suggestions: local };
    }

    try {
      const res = await fetch(`/.netlify/functions/llm?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: provider === "groq" ? "llama-3.1-8b-instant" : "openai/gpt-4o-mini",
          max_tokens: 280,
          temperature: 0.4,
          messages: [
            { role: "system", content: "Travel planner. Reply with only placeId|slot|short reason lines. Use saved places only." },
            { role: "user", content: ctx },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      const byId = new Map(places.map((p) => [p.id, p]));
      const suggestions = [];
      for (const line of text.split(/\n+/)) {
        const [pid, slot, ...rest] = line.split("|").map((s) => s.trim());
        const place = byId.get(pid);
        if (!place || !slot) continue;
        suggestions.push({
          id: WorldStore.uid("sug"),
          placeId: place.id,
          name: place.name,
          category: place.category,
          slot,
          reason: rest.join("|") || "AI pick",
          score: 2,
        });
      }
      if (suggestions.length) trip.suggestions = suggestions;
      return { ok: true, source: "ai", suggestions: trip.suggestions };
    } catch (e) {
      const local = localSuggestDay(state, trip, dayNum, opts);
      return { ok: true, source: "local", suggestions: local, warn: String(e.message || e) };
    }
  }

  function adoptSuggestion(state, tripId, suggestion, dayNum) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    const place = (state.places || []).find((p) => p.id === suggestion.placeId);
    const entry = place
      ? entryFromPlace(place, suggestion.slot, suggestion.reason)
      : {
          id: WorldStore.uid("item"),
          placeId: suggestion.placeId || null,
          name: suggestion.name,
          category: suggestion.category || "place",
          slot: suggestion.slot,
          note: suggestion.reason || "",
        };
    addEntry(state, tripId, dayNum, suggestion.slot, entry);
    trip.suggestions = (trip.suggestions || []).filter((s) => s.id !== suggestion.id);
    return true;
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function render(state) {
    const panel = $("planner-panel");
    if (!panel) return;
    const planner = ensurePlanner(state);
    const trip = getActiveTrip(state);
    const countries = WorldStore.countriesForUi(state);

    const tripOptions = planner.trips
      .map((t) => `<option value="${esc(t.id)}" ${t.id === planner.activeTripId ? "selected" : ""}>${esc(t.name)} — ${esc(t.city)}</option>`)
      .join("");

    const countryOptions = countries
      .map((c) => `<option value="${esc(c.id)}" ${trip?.countryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("");

    const cities = trip
      ? [...new Set(WorldStore.placesByCountry(state, trip.countryId).map((p) => p.city))].sort()
      : [];
    const cityOptions = cities.map((c) => `<option value="${esc(c)}" ${trip?.city === c ? "selected" : ""}>${esc(c)}</option>`).join("");

    const dayNum = Number($("planner-day")?.value) || 1;
    const day = trip?.days?.[dayNum - 1];

    let planHtml = "";
    if (day) {
      for (const slot of SLOTS) {
        const items = day.slots?.[slot.id] || [];
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
        <div>
          <strong>${esc(s.name)}</strong>
          <span class="muted place-meta">${esc(slotLabel(s.slot))} · ${esc(s.reason || PlaceCategorize.label(s.category))}</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-adopt-sug="${esc(s.id)}">Add to day</button>
      </li>`).join("");

    panel.innerHTML = `
      <header class="planner-head">
        <div>
          <strong>Travel Planner</strong>
          <p class="muted assist-sub">Pick country & city · plan days · AI suggestions</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="planner-close">✕</button>
      </header>
      <div class="planner-controls">
        <select id="planner-trip" class="pill-select">${tripOptions || '<option value="">No trips yet</option>'}</select>
        <button type="button" class="btn btn-secondary btn-sm" id="planner-new-trip">New trip</button>
      </div>
      <div class="planner-controls planner-grid">
        <select id="planner-country" class="pill-select">${countryOptions}</select>
        <select id="planner-city" class="pill-select">${cityOptions}</select>
        <input id="planner-days" type="number" min="1" max="21" value="${trip?.dayCount || 3}" class="pill-select" aria-label="Days" />
        <select id="planner-day" class="pill-select">${Array.from({ length: trip?.dayCount || 3 }, (_, i) => `<option value="${i + 1}" ${dayNum === i + 1 ? "selected" : ""}>Day ${i + 1}</option>`).join("")}</select>
      </div>
      <div class="planner-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="planner-suggest-local">Quick suggest</button>
        <button type="button" class="btn btn-primary btn-sm" id="planner-suggest-ai">AI suggest day</button>
      </div>
      <div class="planner-body">
        <section class="planner-section">
          <h3>Suggestions</h3>
          <ul class="planner-suggestions">${sugHtml || '<li class="muted">No suggestions yet — try Quick suggest or AI.</li>'}</ul>
        </section>
        <section class="planner-section">
          <h3>Your plan — Day ${dayNum}</h3>
          <div class="planner-plan">${planHtml || '<p class="muted">Empty day — add from suggestions or country page.</p>'}</div>
        </section>
      </div>`;

    bindPanel(state);
  }

  function bindPanel(state) {
    $("planner-close")?.addEventListener("click", () => toggle(false));
    $("planner-new-trip")?.addEventListener("click", () => {
      const countryId = $("planner-country")?.value;
      const city = $("planner-city")?.value || "Other";
      const dayCount = Number($("planner-days")?.value) || 3;
      if (!countryId) return WorldApp.toast("Pick a country", "warn");
      createTrip(state, { countryId, city, dayCount });
      WorldApp.persist();
      render(state);
    });

    $("planner-trip")?.addEventListener("change", (e) => {
      setActiveTrip(state, e.target.value);
      WorldApp.persist();
      render(state);
    });

    $("planner-country")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.countryId = $("planner-country").value;
      WorldApp.persist();
      render(state);
    });

    $("planner-city")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.city = $("planner-city").value;
      WorldApp.persist();
      render(state);
    });

    $("planner-days")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.dayCount = Number($("planner-days").value) || 1;
      ensureDays(trip);
      WorldApp.persist();
      render(state);
    });

    $("planner-day")?.addEventListener("change", () => render(state));

    $("planner-suggest-local")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      const dayNum = Number($("planner-day")?.value) || 1;
      if (!trip) return WorldApp.toast("Create a trip first", "warn");
      localSuggestDay(state, trip, dayNum);
      WorldApp.persist();
      render(state);
      WorldApp.toast("Suggestions ready");
    });

    $("planner-suggest-ai")?.addEventListener("click", async () => {
      const trip = getActiveTrip(state);
      const dayNum = Number($("planner-day")?.value) || 1;
      if (!trip) return WorldApp.toast("Create a trip first", "warn");
      WorldApp.toast("Getting AI suggestions…");
      const r = await aiSuggestDay(state, trip, dayNum, { hour: new Date().getHours() });
      WorldApp.persist();
      render(state);
      WorldApp.toast(r.source === "ai" ? "AI suggestions ready" : "Local suggestions ready");
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

  function toggle(on) {
    open = on != null ? !!on : !open;
    const panel = $("planner-panel");
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.hidden = !open;
    if (open) render(WorldApp.getState());
  }

  function showAddToTripMenu(place, anchor) {
    const state = WorldApp.getState();
    const trip = getActiveTrip(state);
    if (!trip) {
      WorldApp.toast("Open Travel Planner and create a trip first", "warn");
      toggle(true);
      return;
    }
    const dayNum = Number(prompt(`Add "${place.name}" to which day? (1-${trip.dayCount})`, "1")) || 1;
    const slot = prompt(
      `Which part of the day?\n${SLOTS.map((s) => s.id).join(", ")}`,
      PlaceCategorize.defaultSlot(place.category)
    );
    if (!slot || !SLOTS.some((s) => s.id === slot)) return;
    const note = prompt("Note (optional — breakfast, drinks, show…)", "") || "";
    addPlace(state, trip.id, Math.min(trip.dayCount, Math.max(1, dayNum)), slot, place, note);
    WorldApp.persist();
    WorldApp.toast(`Added to day ${dayNum} · ${slotLabel(slot)}`);
  }

  function init() {
    $("btn-planner")?.addEventListener("click", () => toggle(true));
  }

  return {
    init,
    toggle,
    open: () => toggle(true),
    render,
    SLOTS,
    slotLabel,
    ensurePlanner,
    createTrip,
    getActiveTrip,
    addPlace,
    removeEntry,
    localSuggestDay,
    aiSuggestDay,
    adoptSuggestion,
    showAddToTripMenu,
  };
})();
