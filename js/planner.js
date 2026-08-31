/**
 * Travel planner — multi-country trips, city segments, daily itinerary.
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
  let pendingPlace = null;

  function slotLabel(id) { return SLOTS.find((s) => s.id === id)?.label || id; }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function slotOptions(selected) {
    return SLOTS.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.label}</option>`).join("");
  }

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

  function syncTripBounds(trip) {
    const segs = trip.segments || [];
    const starts = segs.map((s) => s.startDate).filter(Boolean).sort();
    const ends = segs.map((s) => s.endDate).filter(Boolean).sort();
    if (starts.length) trip.startDate = starts[0];
    if (ends.length) trip.endDate = ends[ends.length - 1];
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
    syncTripBounds(trip);
    const prevByDate = new Map();
    for (const d of trip.days || []) {
      if (d.date) prevByDate.set(d.date, d);
    }

    const days = [];
    let dayNum = 1;
    for (const seg of trip.segments || []) {
      if (seg.startDate && seg.endDate) {
        const count = daysBetween(seg.startDate, seg.endDate) + 1;
        for (let i = 0; i < count; i++) {
          const date = addDays(seg.startDate, i);
          const old = prevByDate.get(date) || trip.days?.[dayNum - 1];
          days.push({
            ...emptyDay(dayNum, date, seg.id),
            slots: old?.slots ? JSON.parse(JSON.stringify(old.slots)) : {},
            notes: old?.notes || "",
          });
          dayNum++;
        }
      } else {
        const old = trip.days?.[dayNum - 1];
        days.push({
          ...emptyDay(dayNum, null, seg.id),
          slots: old?.slots ? JSON.parse(JSON.stringify(old.slots)) : {},
          notes: old?.notes || "",
        });
        dayNum++;
      }
    }

    if (!days.length) {
      const n = Math.max(1, trip.dayCount || 3);
      const start = trip.startDate;
      for (let i = 1; i <= n; i++) {
        const date = start ? addDays(start, i - 1) : null;
        const old = trip.days?.[i - 1];
        days.push({
          ...emptyDay(i, date, trip.segments?.[0]?.id),
          slots: old?.slots ? JSON.parse(JSON.stringify(old.slots)) : {},
          notes: old?.notes || "",
        });
      }
    }

    trip.days = days;
    trip.dayCount = days.length;
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

  function placesForDay(state, trip, dayNum, { city } = {}) {
    const seg = segmentForDay(trip, dayNum);
    if (!seg?.countryId) return [];
    const cityFilter = city || (seg.city === "Other" ? undefined : seg.city);
    return WorldStore.placesByCountry(state, seg.countryId, { city: cityFilter });
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

  function flatDayEntries(day) {
    const out = [];
    for (const slot of SLOTS) {
      for (const e of day.slots?.[slot.id] || []) out.push({ slot: slot.id, entry: e });
    }
    return out;
  }

  function applyFlatDayEntries(day, flat) {
    day.slots = {};
    for (const { slot, entry } of flat) {
      if (!day.slots[slot]) day.slots[slot] = [];
      day.slots[slot].push(entry);
    }
  }

  function moveEntry(state, tripId, dayNum, entryId, dir) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    const day = trip?.days?.[dayNum - 1];
    if (!day) return false;
    const flat = flatDayEntries(day);
    const idx = flat.findIndex((x) => x.entry.id === entryId);
    if (idx < 0) return false;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= flat.length) return false;
    [flat[idx], flat[newIdx]] = [flat[newIdx], flat[idx]];
    applyFlatDayEntries(day, flat);
    return true;
  }

  function moveDay(trip, dayNum, dir) {
    const idx = dayNum - 1;
    const newIdx = idx + dir;
    if (!trip.days || newIdx < 0 || newIdx >= trip.days.length) return false;
    [trip.days[idx], trip.days[newIdx]] = [trip.days[newIdx], trip.days[idx]];
    trip.days.forEach((d, i) => { d.day = i + 1; });
    trip.dayCount = trip.days.length;
    return true;
  }

  function removeDay(trip, dayNum) {
    if (!trip.days || trip.days.length <= 1) return false;
    trip.days.splice(dayNum - 1, 1);
    trip.days.forEach((d, i) => { d.day = i + 1; });
    trip.dayCount = trip.days.length;
    return true;
  }

  function updateSegment(trip, segId, patch) {
    const seg = trip.segments.find((s) => s.id === segId);
    if (!seg) return false;
    Object.assign(seg, patch);
    syncTripBounds(trip);
    rebuildDays(trip);
    return true;
  }

  function removeSegment(trip, segId) {
    if (!trip.segments || trip.segments.length <= 1) return false;
    trip.segments = trip.segments.filter((s) => s.id !== segId);
    syncTripBounds(trip);
    rebuildDays(trip);
    return true;
  }

  function moveSegment(trip, segId, dir) {
    const idx = trip.segments.findIndex((s) => s.id === segId);
    if (idx < 0) return false;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= trip.segments.length) return false;
    [trip.segments[idx], trip.segments[newIdx]] = [trip.segments[newIdx], trip.segments[idx]];
    syncTripBounds(trip);
    rebuildDays(trip);
    return true;
  }

  function addSegment(state, tripId, { countryId, city, startDate, endDate }) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return null;
    trip.segments.push({ id: WorldStore.uid("seg"), countryId, city: city || "Other", startDate, endDate });
    syncTripBounds(trip);
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

  function countDayItems(day) {
    let n = 0;
    for (const items of Object.values(day?.slots || {})) n += (items || []).length;
    return n;
  }

  function countryRowHtml(countries, idx, row = {}) {
    const opts = countries.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === row.countryId ? "selected" : ""}>${esc(c.name)}</option>`
    ).join("");
    return `
      <div class="trip-country-row" data-row="${idx}">
        <select class="new-seg-country pill-select">${opts}</select>
        <input class="new-seg-city pill-select" placeholder="City" value="${esc(row.city || "")}" />
        <input class="new-seg-start pill-select" type="date" value="${esc(row.startDate || "")}" aria-label="Start" />
        <input class="new-seg-end pill-select" type="date" value="${esc(row.endDate || "")}" aria-label="End" />
        <button type="button" class="btn btn-ghost btn-sm row-remove" title="Remove">✕</button>
      </div>`;
  }

  function renderCreateForm(state) {
    const countries = WorldStore.countriesForUi(state);
    return `
      <div class="planner-empty card">
        <h3>Start a new trip</h3>
        <p class="muted">Add countries with date ranges — they become one connected trip.</p>
        <input id="new-trip-name" class="pill-select" placeholder="Trip name" style="margin-bottom:0.5rem;width:100%" />
        <div id="new-trip-rows" class="trip-country-rows">${countryRowHtml(countries, 0)}</div>
        <div class="planner-actions" style="margin-top:0.5rem">
          <button type="button" class="btn btn-ghost btn-sm" id="new-trip-add-country">+ Country</button>
          <button type="button" class="btn btn-primary" id="new-trip-create">Create trip</button>
        </div>
      </div>`;
  }

  function collectCreateRows() {
    const rows = [];
    document.querySelectorAll(".trip-country-row").forEach((el) => {
      const countryId = el.querySelector(".new-seg-country")?.value;
      const city = el.querySelector(".new-seg-city")?.value?.trim() || "Other";
      const startDate = el.querySelector(".new-seg-start")?.value || null;
      const endDate = el.querySelector(".new-seg-end")?.value || null;
      if (countryId) rows.push({ countryId, city, startDate, endDate });
    });
    return rows;
  }

  function segmentPhotoUrl(seg, country) {
    const city = seg?.city || "city";
    const lat = country?.lat;
    const lng = country?.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=11&size=640x240&mapnik`;
    }
    const seed = encodeURIComponent(city.toLowerCase().replace(/\s+/g, "-"));
    return `https://picsum.photos/seed/${seed}/640/240`;
  }

  function renderEditableSegments(state, trip) {
    const countries = WorldStore.countriesForUi(state);
    return (trip.segments || []).map((s, i) => {
      const c = state.countries.find((x) => x.id === s.countryId);
      const opts = countries.map((cc) =>
        `<option value="${esc(cc.id)}" ${cc.id === s.countryId ? "selected" : ""}>${esc(cc.name)}</option>`
      ).join("");
      const photo = segmentPhotoUrl(s, c);
      return `<article class="segment-card card segment-editable" data-seg-id="${esc(s.id)}">
        <div class="segment-photo" style="background-image:url('${photo}')">
          <div class="segment-photo-overlay">
            ${c ? `<img class="segment-flag" src="${CountryMeta.flagUrl(c.iso, 24)}" alt="" width="28" height="20"/>` : ""}
            <div><strong>${esc(s.city)}</strong><span class="muted place-meta">${esc(c?.name || "Country")}</span></div>
          </div>
        </div>
        <div class="segment-card-head">
          <strong>Stop ${i + 1}</strong>
          <div class="segment-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-seg-up="${esc(s.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button type="button" class="btn btn-ghost btn-sm" data-seg-down="${esc(s.id)}" ${i === trip.segments.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            <button type="button" class="btn btn-ghost btn-sm" data-seg-remove="${esc(s.id)}" title="Remove segment" aria-label="Remove">✕</button>
          </div>
        </div>
        <div class="segment-edit-grid">
          <select class="seg-edit-country pill-select" data-seg="${esc(s.id)}">${opts}</select>
          <input class="seg-edit-city pill-select" data-seg="${esc(s.id)}" value="${esc(s.city)}" placeholder="City" />
          <input class="seg-edit-start pill-select" data-seg="${esc(s.id)}" type="date" value="${esc(s.startDate || "")}" />
          <input class="seg-edit-end pill-select" data-seg="${esc(s.id)}" type="date" value="${esc(s.endDate || "")}" />
        </div>
      </article>`;
    }).join("");
  }

  function renderDayList(trip, dayNum) {
    return (trip.days || []).map((d, i) => {
      const n = i + 1;
      const seg = trip.segments.find((s) => s.id === d.segmentId) || segmentForDay(trip, n);
      const items = countDayItems(d);
      return `<div class="day-row ${dayNum === n ? "active" : ""}" data-day-row="${n}">
        <button type="button" class="day-chip ${dayNum === n ? "active" : ""}" data-day="${n}">
          Day ${n}${d.date ? `<small>${d.date.slice(5)}</small>` : ""}${items ? `<span class="day-count">${items}</span>` : ""}
        </button>
        <span class="day-row-meta muted">${esc(seg?.city || "")}</span>
        <div class="day-row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-day-up="${n}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn btn-ghost btn-sm" data-day-down="${n}" ${i === trip.days.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn btn-ghost btn-sm" data-day-remove="${n}" title="Remove day">✕</button>
        </div>
      </div>`;
    }).join("");
  }

  function renderDayItinerary(day) {
    const flat = flatDayEntries(day);
    if (!flat.length) return '<p class="muted card planner-empty">Empty — add from saved places below or + Trip on a place</p>';
    return `<ul class="planner-items planner-day-order">${flat.map(({ slot, entry }) => `
      <li class="planner-item">
        <div class="planner-item-order">
          <button type="button" class="btn btn-ghost btn-sm" data-entry-up="${esc(entry.id)}">↑</button>
          <button type="button" class="btn btn-ghost btn-sm" data-entry-down="${esc(entry.id)}">↓</button>
        </div>
        <div class="planner-item-body">
          <strong>${esc(entry.name)}</strong>
          <span class="muted place-meta">${esc(slotLabel(slot))} · ${esc(PlaceCategorize.label(entry.category))}${entry.note ? ` · ${esc(entry.note)}` : ""}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-remove-entry="${esc(entry.id)}" data-slot="${esc(slot)}">✕</button>
      </li>`).join("")}</ul>`;
  }

  function renderPlacePicker(state, trip, dayNum) {
    const seg = segmentForDay(trip, dayNum);
    const places = placesForDay(state, trip, dayNum).slice(0, 24);
    if (!places.length) return "";
    const country = state.countries.find((c) => c.id === seg?.countryId);
    return `
      <section class="planner-section">
        <h3>Add from ${esc(country?.name || "country")} · ${esc(seg?.city || "")}</h3>
        <ul class="planner-pick-list">${places.map((p) => `
          <li><button type="button" class="btn btn-ghost btn-sm pick-place-btn" data-pick-place="${esc(p.id)}">+ ${esc(p.name)} <span class="muted">${esc(p.city)}</span></button></li>
        `).join("")}</ul>
      </section>`;
  }

  function csvCell(v) {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportTripSpreadsheet(state, trip) {
    const lines = [];
    lines.push(["Trip", trip.name, "Start", trip.startDate || "", "End", trip.endDate || ""].map(csvCell).join(","));
    lines.push("");
    lines.push(["Segment#", "Country", "City", "Start", "End"].map(csvCell).join(","));
    (trip.segments || []).forEach((s, i) => {
      const c = state.countries.find((x) => x.id === s.countryId);
      lines.push([i + 1, c?.name || s.countryId, s.city, s.startDate || "", s.endDate || ""].map(csvCell).join(","));
    });
    lines.push("");
    lines.push(["Day", "Date", "Segment City", "Segment Country", "Slot", "Place", "Category", "Note", "URL", "Lat", "Lng"].map(csvCell).join(","));
    for (let d = 1; d <= (trip.dayCount || 0); d++) {
      const day = trip.days?.[d - 1];
      const seg = segmentForDay(trip, d);
      const country = state.countries.find((c) => c.id === seg?.countryId);
      const flat = day ? flatDayEntries(day) : [];
      if (!flat.length) {
        lines.push([d, day?.date || "", seg?.city || "", country?.name || "", "", "", "", "", "", "", ""].map(csvCell).join(","));
      } else {
        for (const { slot, entry } of flat) {
          lines.push([
            d, day?.date || "", seg?.city || "", country?.name || "", slotLabel(slot),
            entry.name, PlaceCategorize.label(entry.category), entry.note || "", entry.url || "",
            entry.lat ?? "", entry.lng ?? "",
          ].map(csvCell).join(","));
        }
      }
    }
    return `\uFEFF${lines.join("\n")}`;
  }

  function downloadTripExcel(state, trip) {
    const safe = (trip.name || "trip").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "trip";
    const blob = new Blob([exportTripSpreadsheet(state, trip)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safe}-itinerary.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderPlan(state, trip, dayNum) {
    const day = trip?.days?.[dayNum - 1];
    const seg = trip ? segmentForDay(trip, dayNum) : null;
    const country = state.countries.find((c) => c.id === seg?.countryId);
    const countries = WorldStore.countriesForUi(state);
    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

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
        <label class="field"><span class="muted">Trip start</span><input id="planner-start" type="date" class="pill-select" value="${esc(trip?.startDate || "")}" /></label>
        <label class="field"><span class="muted">Trip end</span><input id="planner-end" type="date" class="pill-select" value="${esc(trip?.endDate || "")}" /></label>
      </div>
      <section class="planner-section">
        <h3>Route — countries &amp; cities</h3>
        <div class="segment-grid">${renderEditableSegments(state, trip) || '<p class="muted">No segments</p>'}</div>
      </section>
      <details class="planner-add-seg-form card">
        <summary>Add city segment</summary>
        <div class="planner-grid" style="margin-top:0.65rem">
          <select id="seg-country" class="pill-select">${countryOpts}</select>
          <input id="seg-city" class="pill-select" placeholder="City" />
          <input id="seg-start" type="date" class="pill-select" />
          <input id="seg-end" type="date" class="pill-select" />
          <button type="button" class="btn btn-secondary btn-sm" id="seg-save">Add segment</button>
        </div>
      </details>
      <section class="planner-section">
        <h3>Days</h3>
        <div class="day-list">${renderDayList(trip, dayNum)}</div>
      </section>
      ${seg ? `<p class="day-context card">📍 Day ${dayNum}: <strong>${esc(seg.city)}</strong>, ${esc(country?.name || "")}${day?.date ? ` · ${day.date}` : ""}</p>` : ""}
      <div class="planner-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="planner-suggest-local">Quick suggest</button>
        <button type="button" class="btn btn-primary btn-sm" id="planner-suggest-ai">AI suggest</button>
      </div>
      <section class="planner-section"><h3>Suggestions</h3><ul class="planner-suggestions">${sugHtml || '<li class="muted">Tap Quick suggest or AI suggest</li>'}</ul></section>
      <section class="planner-section"><h3>Day ${dayNum} places</h3>${renderDayItinerary(day)}</section>
      ${renderPlacePicker(state, trip, dayNum)}
      <footer class="planner-footer">
        <button type="button" class="btn btn-secondary btn-sm" id="planner-export">Export Excel</button>
        <button type="button" class="btn btn-primary" id="planner-save">Save trip</button>
      </footer>
      <input type="hidden" id="planner-day" value="${dayNum}" />`;
  }

  function render(stateIn) {
    const state = stateIn || WorldApp.getState();
    const panel = $("planner-panel");
    if (!panel) return;
    const trip = getActiveTrip(state);
    const dayNum = Number($("planner-day")?.value) || 1;

    panel.innerHTML = `
      <header class="planner-head">
        <div><strong>Travel Planner</strong><p class="muted assist-sub">Countries · cities · daily itinerary</p></div>
        <button type="button" class="btn btn-ghost btn-sm" id="planner-close">✕</button>
      </header>
      <div class="planner-body">${trip ? renderPlan(state, trip, dayNum) : renderCreateForm(state)}</div>`;

    bindPanel(state, dayNum);
  }

  function savePlanner({ flush, close } = {}) {
    WorldApp.persistPlanner({ flush });
    if (close) {
      WorldApp.toast(flush ? "Trip saved — syncing to cloud" : "Trip saved");
      toggle(false);
      return;
    }
    WorldApp.toast(flush ? "Trip saved — syncing to cloud" : "Trip saved");
  }

  function bindSegmentEdits(state, trip) {
    const applySeg = (segId) => {
      updateSegment(trip, segId, {
        countryId: document.querySelector(`.seg-edit-country[data-seg="${segId}"]`)?.value,
        city: document.querySelector(`.seg-edit-city[data-seg="${segId}"]`)?.value || "Other",
        startDate: document.querySelector(`.seg-edit-start[data-seg="${segId}"]`)?.value || null,
        endDate: document.querySelector(`.seg-edit-end[data-seg="${segId}"]`)?.value || null,
      });
      savePlanner();
      render(state);
    };
    document.querySelectorAll(".seg-edit-country, .seg-edit-city, .seg-edit-start, .seg-edit-end").forEach((el) => {
      el.addEventListener("change", () => applySeg(el.dataset.seg));
    });
    document.querySelectorAll("[data-seg-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        moveSegment(trip, btn.dataset.segUp, -1);
        savePlanner();
        render(state);
      });
    });
    document.querySelectorAll("[data-seg-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        moveSegment(trip, btn.dataset.segDown, 1);
        savePlanner();
        render(state);
      });
    });
    document.querySelectorAll("[data-seg-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!removeSegment(trip, btn.dataset.segRemove)) return WorldApp.toast("Need at least one segment", "warn");
        savePlanner();
        render(state);
      });
    });
  }

  function bindPanel(state, dayNum) {
    $("planner-close")?.addEventListener("click", () => toggle(false));

    $("planner-save")?.addEventListener("click", () => savePlanner({ flush: true, close: true }));

    $("planner-export")?.addEventListener("click", () => {
      const trip = getActiveTrip(state);
      if (!trip) return;
      downloadTripExcel(state, trip);
      WorldApp.toast("Trip exported");
    });

    $("planner-trip")?.addEventListener("change", (e) => {
      setActiveTrip(state, e.target.value);
      savePlanner();
      render(state);
    });

    $("new-trip-add-country")?.addEventListener("click", () => {
      const rows = $("new-trip-rows");
      const countries = WorldStore.countriesForUi(state);
      const idx = rows?.querySelectorAll(".trip-country-row").length || 0;
      rows?.insertAdjacentHTML("beforeend", countryRowHtml(countries, idx));
      bindCreateRows(state);
    });

    bindCreateRows(state);

    $("new-trip-create")?.addEventListener("click", () => {
      const segments = collectCreateRows();
      const name = $("new-trip-name")?.value?.trim() || "My trip";
      if (!segments.length) return WorldApp.toast("Add at least one country with dates", "warn");
      for (const s of segments) {
        if (!s.startDate || !s.endDate) return WorldApp.toast("Each country needs start and end dates", "warn");
      }
      createTrip(state, { name, segments });
      savePlanner({ flush: true });
      render(state);
    });

    $("planner-new-trip")?.addEventListener("click", () => {
      ensurePlanner(state).activeTripId = null;
      render(state);
    });

    const trip = getActiveTrip(state);
    if (!trip) return;

    $("planner-start")?.addEventListener("change", () => {
      trip.startDate = $("planner-start").value;
      if (trip.segments[0]) trip.segments[0].startDate = trip.startDate;
      rebuildDays(trip);
      savePlanner();
      render(state);
    });

    $("planner-end")?.addEventListener("change", () => {
      trip.endDate = $("planner-end").value;
      const last = trip.segments[trip.segments.length - 1];
      if (last) last.endDate = trip.endDate;
      rebuildDays(trip);
      savePlanner();
      render(state);
    });

    document.querySelectorAll("[data-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hidden = $("planner-day");
        if (hidden) hidden.value = btn.dataset.day;
        render(state);
      });
    });

    document.querySelectorAll("[data-day-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        moveDay(trip, Number(btn.dataset.dayUp), -1);
        savePlanner();
        render(state);
      });
    });
    document.querySelectorAll("[data-day-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        moveDay(trip, Number(btn.dataset.dayDown), 1);
        savePlanner();
        render(state);
      });
    });
    document.querySelectorAll("[data-day-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.dayRemove);
        if (!removeDay(trip, n)) return WorldApp.toast("Need at least one day", "warn");
        const hidden = $("planner-day");
        if (hidden && Number(hidden.value) > trip.dayCount) hidden.value = String(trip.dayCount);
        savePlanner();
        render(state);
      });
    });

    bindSegmentEdits(state, trip);

    $("seg-save")?.addEventListener("click", () => {
      addSegment(state, trip.id, {
        countryId: $("seg-country")?.value,
        city: $("seg-city")?.value || "Other",
        startDate: $("seg-start")?.value,
        endDate: $("seg-end")?.value,
      });
      savePlanner();
      render(state);
      WorldApp.toast("Segment added");
    });

    $("planner-suggest-local")?.addEventListener("click", () => {
      const d = Number($("planner-day")?.value) || dayNum || 1;
      localSuggestDay(state, trip, d);
      savePlanner();
      render(state);
      WorldApp.toast("Suggestions ready");
    });

    $("planner-suggest-ai")?.addEventListener("click", async () => {
      const d = Number($("planner-day")?.value) || dayNum || 1;
      WorldApp.toast("Getting suggestions…");
      await aiSuggestDay(state, trip, d, { hour: new Date().getHours() });
      savePlanner();
      render(state);
    });

    document.querySelectorAll("[data-adopt-sug]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number($("planner-day")?.value) || dayNum || 1;
        const sug = trip.suggestions?.find((s) => s.id === btn.dataset.adoptSug);
        if (!sug) return;
        adoptSuggestion(state, trip.id, sug, d);
        savePlanner();
        render(state);
      });
    });

    document.querySelectorAll("[data-remove-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number($("planner-day")?.value) || dayNum || 1;
        removeEntry(state, trip.id, d, btn.dataset.slot, btn.dataset.removeEntry);
        savePlanner();
        render(state);
      });
    });

    document.querySelectorAll("[data-entry-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number($("planner-day")?.value) || dayNum || 1;
        moveEntry(state, trip.id, d, btn.dataset.entryUp, -1);
        savePlanner();
        render(state);
      });
    });
    document.querySelectorAll("[data-entry-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number($("planner-day")?.value) || dayNum || 1;
        moveEntry(state, trip.id, d, btn.dataset.entryDown, 1);
        savePlanner();
        render(state);
      });
    });

    document.querySelectorAll("[data-pick-place]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number($("planner-day")?.value) || dayNum || 1;
        const place = state.places.find((p) => p.id === btn.dataset.pickPlace);
        if (!place) return;
        const slot = PlaceCategorize.defaultSlot(place.category);
        addPlace(state, trip.id, d, slot, place, "");
        savePlanner();
        render(state);
        WorldApp.toast(`Added ${place.name}`);
      });
    });
  }

  function bindCreateRows(state) {
    document.querySelectorAll(".row-remove").forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest(".trip-country-row");
        const rows = document.querySelectorAll(".trip-country-row");
        if (rows.length <= 1) return WorldApp.toast("Need at least one country", "warn");
        row?.remove();
      };
    });
  }

  function populateTripModal(state, place) {
    const planner = ensurePlanner(state);
    const tripSel = $("tam-trip");
    const daySel = $("tam-day");
    const citySel = $("tam-city");
    const slotSel = $("tam-slot");
    if (!tripSel || !daySel || !citySel || !slotSel) return;

    tripSel.innerHTML = planner.trips.length
      ? planner.trips.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")
      : '<option value="">— Create a trip first —</option>';

    slotSel.innerHTML = slotOptions(PlaceCategorize.defaultSlot(place.category));

    const fillDaysAndCities = () => {
      const trip = planner.trips.find((t) => t.id === tripSel.value) || getActiveTrip(state);
      if (!trip) {
        daySel.innerHTML = "";
        citySel.innerHTML = "";
        return;
      }
      daySel.innerHTML = (trip.days || []).map((d, i) => {
        const seg = segmentForDay(trip, i + 1);
        return `<option value="${i + 1}">Day ${i + 1}${d.date ? ` (${d.date})` : ""} — ${esc(seg?.city || "")}</option>`;
      }).join("");

      const matchingSegs = (trip.segments || []).filter((s) => s.countryId === place.countryId);
      const segs = matchingSegs.length ? matchingSegs : trip.segments;
      citySel.innerHTML = segs.map((s) =>
        `<option value="${esc(s.id)}" ${s.city === place.city ? "selected" : ""}>${esc(s.city)} (${esc(state.countries.find((c) => c.id === s.countryId)?.name || "")})</option>`
      ).join("");
    };

    fillDaysAndCities();
    tripSel.onchange = fillDaysAndCities;
  }

  function showAddToTripModal(place) {
    const state = WorldApp.getState();
    ensurePlanner(state);
    if (!getActiveTrip(state) && !state.planner.trips.length) {
      toggle(true);
      return WorldApp.toast("Create a trip first in Planner", "warn");
    }
    pendingPlace = place;
    $("tam-place-name").textContent = `${place.name} · ${place.city}`;
    populateTripModal(state, place);
    const modal = $("trip-add-modal");
    if (modal) modal.hidden = false;
  }

  function hideAddToTripModal() {
    pendingPlace = null;
    const modal = $("trip-add-modal");
    if (modal) modal.hidden = true;
  }

  function confirmAddToTrip() {
    if (!pendingPlace) return;
    const state = WorldApp.getState();
    const tripId = $("tam-trip")?.value;
    const dayNum = Number($("tam-day")?.value) || 1;
    const slot = $("tam-slot")?.value;
    const note = $("tam-note")?.value?.trim() || "";
    const segId = $("tam-city")?.value;

    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return WorldApp.toast("Select a trip", "warn");
    if (!slot) return WorldApp.toast("Select a time slot", "warn");

    const day = trip.days[dayNum - 1];
    if (day && segId) day.segmentId = segId;

    addPlace(state, trip.id, dayNum, slot, pendingPlace, note);
    setActiveTrip(state, trip.id);
    savePlanner({ flush: true });
    hideAddToTripModal();
    WorldApp.toast(`Added to day ${dayNum}`);
  }

  function bindModal() {
    $("tam-cancel")?.addEventListener("click", hideAddToTripModal);
    $("tam-confirm")?.addEventListener("click", confirmAddToTrip);
    $("trip-add-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "trip-add-modal") hideAddToTripModal();
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

  function showAddToTripMenu(place) { showAddToTripModal(place); }

  function init() {
    $("btn-planner")?.addEventListener("click", () => toggle(true));
    bindModal();
  }

  return {
    init, toggle, open: () => toggle(true), render, SLOTS, slotLabel,
    ensurePlanner, migrateTrip, createTrip, getActiveTrip, addPlace, removeEntry,
    addSegment, updateSegment, removeSegment, moveSegment, moveDay, removeDay, moveEntry,
    segmentForDay, placesForDay, localSuggestDay, aiSuggestDay,
    adoptSuggestion, showAddToTripMenu, showAddToTripModal, rebuildDays, exportTripSpreadsheet, downloadTripExcel,
  };
})();
