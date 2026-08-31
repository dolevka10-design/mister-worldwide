/**
 * Travel planner — multi-city/country segments, dates, suggestions.
 */
window.WorldPlanner = (() => {
  const SLOTS = [
    { id: "breakfast", label: "Breakfast", icon: "☀️" },
    { id: "brunch", label: "Brunch", icon: "🥐" },
    { id: "lunch", label: "Lunch", icon: "🍽️" },
    { id: "afternoon", label: "Afternoon", icon: "🌤️" },
    { id: "dinner", label: "Dinner", icon: "🌙" },
    { id: "drinks", label: "Drinks", icon: "🍸" },
    { id: "dessert", label: "Dessert", icon: "🍰" },
    { id: "show", label: "Show", icon: "🎭" },
    { id: "activity", label: "Sights", icon: "📍" },
    { id: "hotel", label: "Hotel", icon: "🏨" },
    { id: "transport", label: "Transit", icon: "🚆" },
  ];

  const $ = (id) => document.getElementById(id);
  let open = false;

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

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
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
      trip.days.push({ ...emptyDay(i, date, seg?.id), slots: old?.slots || {}, notes: old?.notes || "" });
    }
    return trip;
  }

  function createTrip(state, { name, startDate, endDate, segments, dayCount }) {
    const planner = ensurePlanner(state);
    const segs = (segments || []).map((s) => ({
      id: WorldStore.uid("seg"), countryId: s.countryId, city: s.city || "Other",
      startDate: s.startDate || null, endDate: s.endDate || null,
    }));
    if (!segs.length) segs.push({ id: WorldStore.uid("seg"), countryId: "", city: "Other", startDate, endDate });
    const trip = migrateTrip({
      id: WorldStore.uid("trip"), name: name || "My trip",
      startDate: startDate || segs[0]?.startDate || null,
      endDate: endDate || segs[segs.length - 1]?.endDate || null,
      segments: segs, dayCount: dayCount || 3, days: [], suggestions: [],
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
          reason: `${PlaceCategorize.label(p.category)} · ${seg?.city || "area"}`, score: 1,
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
      `Hour:${opts.hour != null ? opts.hour : new Date().getHours()}`,
      "Reply: placeId|slot|reason", compact,
    ].join("\n");
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

  function countDayItems(day) {
    let n = 0;
    for (const items of Object.values(day?.slots || {})) n += (items || []).length;
    return n;
  }

  function renderCreateForm(state, countryOpts) {
    return `
      <div class="planner-empty card">
        <h3>Start a new trip</h3>
        <p class="muted">Multi-city &amp; multi-country — add segments with date ranges.</p>
        <div class="planner-grid">
          <input id="new-trip-name" class="pill-select" placeholder="Trip name" />
          <select id="new-trip-country" class="pill-select">${countryOpts}</select>
          <input id="new-trip-city" class="pill-select" placeholder="First city" />
          <input id="new-trip-start" type="date" class="pill-select" aria-label="Start date" />
          <input id="new-trip-end" type="date" class="pill-select" aria-label="End date" />
          <button type="button" class="btn btn-primary" id="new-trip-create">Create trip</button>
        </div>
      </div>`;
  }

  function renderPlan(state, trip, dayNum) {
    const day = trip?.days?.[dayNum - 1];
    const seg = trip ? segmentForDay(trip, dayNum) : null;
    const country = state.countries.find((c) => c.id === seg?.countryId);
    const countries = WorldStore.countriesForUi(state);
    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    const dayChips = Array.from({ length: trip?.dayCount || 1 }, (_, i) => {
      const d = trip?.days?.[i];
      const n = i + 1;
      const items = countDayItems(d);
      return `<button type="button" class="day-chip ${dayNum === n ? "active" : ""}" data-day="${n}">Day ${n}${d?.date ? `<small>${d.date.slice(5)}</small>` : ""}${items ? `<span class="day-count">${items}</span>` : ""}</button>`;
    }).join("");

    const segCards = (trip?.segments || []).map((s) => {
      const c = state.countries.find((x) => x.id === s.countryId);
      return `<article class="segment-card card">
        <div class="segment-card-head">
          ${c ? `<img src="${CountryMeta.flagUrl(c.iso, 24)}" alt="" width="28" height="20"/>` : ""}
          <div><strong>${esc(s.city)}</strong><span class="muted place-meta">${esc(c?.name || "Country")}</span></div>
        </div>
        <p class="muted segment-dates">${esc(s.startDate || "—")} → ${esc(s.endDate || "—")}</p>
      </article>`;
    }).join("");

    let planHtml = "";
    if (day) {
      for (const slot of SLOTS) {
        const items = day.slots?.[slot.id] || [];
        if (!items.length) continue;
        planHtml += `<article class="slot-card card"><header class="slot-card-head"><span>${slot.icon}</span><h4>${esc(slot.label)}</h4></header><ul class="planner-items">`;
        planHtml += items.map((e) => `
          <li class="planner-item">
            <div><strong>${esc(e.name)}</strong><span class="muted place-meta">${esc(PlaceCategorize.label(e.category))}${e.note ? ` · ${esc(e.note)}` : ""}</span></div>
            <button type="button" class="btn btn-ghost btn-sm" data-remove-entry="${esc(e.id)}" data-slot="${esc(slot.id)}">✕</button>
          </li>`).join("");
        planHtml += `</ul></article>`;
      }
    }

    const sugHtml = (trip?.suggestions || []).map((s) => `
      <li class="planner-suggestion card">
        <div><strong>${esc(s.name)}</strong><span class="muted place-meta">${esc(slotLabel(s.slot))} · ${esc(s.reason || "")}</span></div>
        <button type="button" class="btn btn-primary btn-sm" data-adopt-sug="${esc(s.id)}">Add</button>
      </li>`).join("");

    return `
      <div class="planner-trip-bar card">
        <label class="muted">Trip</label>
        <div class="planner-controls-inline">
          <select id="planner-trip" class="pill-select">${(ensurePlanner(state).trips).map((t) =>
            `<option value="${esc(t.id)}" ${t.id === ensurePlanner(state).activeTripId ? "selected" : ""}>${esc(t.name)}</option>`
          ).join("")}</select>
          <button type="button" class="btn btn-ghost btn-sm" id="planner-new-trip">+ New</button>
        </div>
      </div>
      <div class="planner-dates planner-grid">
        <input id="planner-start" type="date" class="pill-select" value="${esc(trip?.startDate || "")}" aria-label="Trip start" />
        <input id="planner-end" type="date" class="pill-select" value="${esc(trip?.endDate || "")}" aria-label="Trip end" />
      </div>
      <div class="day-chip-row">${dayChips}</div>
      ${seg ? `<p class="day-context card">📍 Day ${dayNum}: <strong>${esc(seg.city)}</strong>, ${esc(country?.name || "")}${day?.date ? ` · ${day.date}` : ""}</p>` : ""}
      <div class="planner-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="planner-suggest-local">Quick suggest</button>
        <button type="button" class="btn btn-primary btn-sm" id="planner-suggest-ai">AI suggest</button>
      </div>
      <section class="planner-section"><h3>Route</h3><div class="segment-grid">${segCards || '<p class="muted">No segments yet</p>'}</div></section>
      <details class="planner-add-seg-form card">
        <summary>Add city / country segment</summary>
        <div class="planner-grid" style="margin-top:0.65rem">
          <select id="seg-country" class="pill-select">${countryOpts}</select>
          <input id="seg-city" class="pill-select" placeholder="City" />
          <input id="seg-start" type="date" class="pill-select" />
          <input id="seg-end" type="date" class="pill-select" />
          <button type="button" class="btn btn-secondary btn-sm" id="seg-save">Add segment</button>
        </div>
      </details>
      <section class="planner-section"><h3>Suggestions</h3><ul class="planner-suggestions">${sugHtml || '<li class="muted">Tap Quick suggest or AI suggest</li>'}</ul></section>
      <section class="planner-section"><h3>Day ${dayNum} itinerary</h3><div class="slot-grid">${planHtml || '<p class="muted card planner-empty">Empty — add from suggestions or + Trip on a place</p>'}</div></section>
      <input type="hidden" id="planner-day" value="${dayNum}" />`;
  }

  function render(stateIn) {
    const state = stateIn || WorldApp.getState();
    const panel = $("planner-panel");
    if (!panel) return;
    const trip = getActiveTrip(state);
    const dayNum = Number($("planner-day")?.value) || 1;
    const countries = WorldStore.countriesForUi(state);
    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    panel.innerHTML = `
      <header class="planner-head">
        <div><strong>Travel Planner</strong><p class="muted assist-sub">Multi-city · multi-country · dated itinerary</p></div>
        <button type="button" class="btn btn-ghost btn-sm" id="planner-close">✕</button>
      </header>
      <div class="planner-body">${trip ? renderPlan(state, trip, dayNum) : renderCreateForm(state, countryOpts)}</div>`;

    bindPanel(state, dayNum);
  }

  function bindPanel(state, dayNum) {
    $("planner-close")?.addEventListener("click", () => toggle(false));

    $("planner-trip")?.addEventListener("change", (e) => {
      setActiveTrip(state, e.target.value);
      WorldApp.persistPlanner();
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
      WorldApp.persistPlanner();
      WorldApp.refresh();
      render(state);
    });

    $("planner-new-trip")?.addEventListener("click", () => {
      ensurePlanner(state).activeTripId = null;
      render(state);
    });

    $("planner-start")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.startDate = $("planner-start").value;
      rebuildDays(trip);
      WorldApp.persistPlanner();
      render(state);
    });

    $("planner-end")?.addEventListener("change", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      trip.endDate = $("planner-end").value;
      rebuildDays(trip);
      WorldApp.persistPlanner();
      render(state);
    });

    document.querySelectorAll(".day-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hidden = $("planner-day");
        if (hidden) hidden.value = btn.dataset.day;
        render(state);
      });
    });

    $("seg-save")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      addSegment(state, trip.id, {
        countryId: $("seg-country")?.value,
        city: $("seg-city")?.value || "Other",
        startDate: $("seg-start")?.value,
        endDate: $("seg-end")?.value,
      });
      WorldApp.persistPlanner();
      render(state);
      WorldApp.toast("Segment added");
    });

    $("planner-suggest-local")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      const d = Number($("planner-day")?.value) || dayNum || 1;
      if (!trip) return;
      localSuggestDay(state, trip, d);
      WorldApp.persistPlanner();
      render(state);
      WorldApp.toast("Suggestions ready");
    });

    $("planner-suggest-ai")?.addEventListener("click", async () => {
      const trip = getActiveTrip(state);
      const d = Number($("planner-day")?.value) || dayNum || 1;
      if (!trip) return;
      WorldApp.toast("Getting suggestions…");
      await aiSuggestDay(state, trip, d, { hour: new Date().getHours() });
      WorldApp.persistPlanner();
      render(state);
    });

    document.querySelectorAll("[data-adopt-sug]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const trip = getActiveTrip(state);
        const d = Number($("planner-day")?.value) || dayNum || 1;
        const sug = trip?.suggestions?.find((s) => s.id === btn.dataset.adoptSug);
        if (!sug) return;
        adoptSuggestion(state, trip.id, sug, d);
        WorldApp.persistPlanner();
        render(state);
      });
    });

    document.querySelectorAll("[data-remove-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const trip = getActiveTrip(state);
        const d = Number($("planner-day")?.value) || dayNum || 1;
        if (!trip) return;
        removeEntry(state, trip.id, d, btn.dataset.slot, btn.dataset.removeEntry);
        WorldApp.persistPlanner();
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

  function showAddToTripMenu(place) {
    const state = WorldApp.getState();
    const trip = getActiveTrip(state);
    if (!trip) { toggle(true); return WorldApp.toast("Create a trip first", "warn"); }
    const dayNum = Number(prompt(`Add "${place.name}" to day? (1-${trip.dayCount})`, "1")) || 1;
    const slot = prompt(`Slot: ${SLOTS.map((s) => s.id).join(", ")}`, PlaceCategorize.defaultSlot(place.category));
    if (!slot || !SLOTS.some((s) => s.id === slot)) return;
    const note = prompt("Note (breakfast, drinks, show…)", "") || "";
    addPlace(state, trip.id, Math.min(trip.dayCount, Math.max(1, dayNum)), slot, place, note);
    WorldApp.persistPlanner();
    WorldApp.toast(`Added to day ${dayNum}`);
  }

  function init() { $("btn-planner")?.addEventListener("click", () => toggle(true)); }

  return {
    init, toggle, open: () => toggle(true), render, SLOTS, slotLabel,
    ensurePlanner, migrateTrip, createTrip, getActiveTrip, addPlace, removeEntry,
    addSegment, segmentForDay, placesForDay, localSuggestDay, aiSuggestDay,
    adoptSuggestion, showAddToTripMenu, rebuildDays,
  };
})();
