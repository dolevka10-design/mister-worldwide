/**
 * Travel planner — single-page itinerary (Excel/PDF columns).
 * Date · Day · Location · Time · Place · Notes · Category · Maps
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
  let showCreate = false;
  let highlightSegId = null;
  let keepSegFormOpen = true;
  let bound = false;
  let lastScroll = 0;
  let activeDayNum = 1;
  let routeEditorOpen = false;
  let tripListOpen = true;

  let lastActionAt = 0;
  let lastActionKey = "";
  let lastTouchKey = "";

  function handleAction(actEl, e) {
    if (!actEl?.dataset?.act || actEl.disabled) return;
    const key = `${actEl.dataset.act}:${actEl.dataset.tripId || ""}:${actEl.dataset.day || ""}:${actEl.dataset.item || ""}`;
    const now = Date.now();
    if (e?.type === "click" && lastTouchKey === key && now - lastActionAt < 600) return;
    if (e?.type === "touchend") lastTouchKey = key;
    lastActionAt = now;
    lastActionKey = key;
    try {
      onClick({ target: actEl, preventDefault: () => {}, stopPropagation: () => {}, type: e?.type || "click" }, actEl);
    } catch (err) {
      console.error("Planner action failed:", actEl.dataset.act, err);
      WorldApp.toast(err?.message || "Action failed", "error");
    }
  }

  function panelPointer(e) {
    const panel = $("planner-panel");
    if (!panel || panel.hidden || !open) return;
    if (!panel.contains(e.target)) return;
    if (e.target.closest("input, textarea, select, option, a.place-link")) return;
    const actEl = e.target.closest("button[data-act], .trip-chip[data-act], summary[data-act]");
    if (!actEl || actEl.disabled) return;
    if (e.type === "touchend") e.preventDefault();
    handleAction(actEl, e);
  }

  function wirePlannerActions() {
    /* Handled by panelPointer in init — kept for compatibility */
  }

  function act(e) {
    const el = e?.currentTarget || e?.target?.closest?.("button[data-act], .trip-chip[data-act]");
    if (el) handleAction(el, e);
  }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function slotLabel(id) { return SLOTS.find((s) => s.id === id)?.label || id; }
  function slotOptions(selected) {
    return SLOTS.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.label}</option>`).join("");
  }
  function catOptions(selected) {
    const labels = PlaceCategorize.allLabels();
    return Object.entries(labels).map(([id, lab]) =>
      `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(lab)}</option>`
    ).join("");
  }

  function ensurePlanner(state) {
    if (!state.planner) state.planner = { trips: [], activeTripId: null, view: "list", activeDayNum: 1 };
    if (!Array.isArray(state.planner.trips)) state.planner.trips = [];
    if (!state.planner.view) {
      state.planner.view = state.planner.activeTripId ? "trip" : (state.planner.trips.length ? "list" : "create");
    }
    if (!state.planner.activeDayNum) state.planner.activeDayNum = 1;
    for (const t of state.planner.trips) migrateTrip(t);
    return state.planner;
  }

  function setPlannerView(state, view, tripId, dayNum) {
    const p = ensurePlanner(state);
    p.view = view;
    if (tripId !== undefined) p.activeTripId = tripId || null;
    if (dayNum != null) p.activeDayNum = dayNum;
  }

  function syncUiFromState(state) {
    const p = ensurePlanner(state);
    const trip = getActiveTrip(state);
    if (p.view === "trip" && trip) {
      tripListOpen = false;
      showCreate = false;
      activeDayNum = clampDayNum(trip, p.activeDayNum || 1);
      p.activeDayNum = activeDayNum;
    } else if (p.view === "create") {
      tripListOpen = true;
      showCreate = true;
    } else {
      tripListOpen = true;
      showCreate = !p.trips.length;
    }
  }

  function plannerView(state) {
    const p = ensurePlanner(state);
    const trip = getActiveTrip(state);
    if (!p.trips.length && !trip) return "create";
    if (p.view === "trip" && trip) return "trip";
    if (p.view === "create") return "create";
    if (p.activeTripId && trip) return "trip";
    return "list";
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

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-");
    if (!d) return iso;
    return `${d}.${m}.${String(y).slice(2)}`;
  }

  function fmtDateLong(iso) {
    if (!iso) return "";
    const d = parseDate(iso);
    if (!d) return fmtDate(iso);
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
  }

  function clampDayNum(trip, n) {
    const max = Math.max(1, trip?.days?.length || 1);
    return Math.min(max, Math.max(1, n || 1));
  }

  function categoryIcon(cat) {
    const icons = {
      restaurant: "🍽️", cafe: "☕", landmark: "📍", museum: "🏛️", hotel: "🏨", bar: "🍸",
      nightlife: "🍸", transport: "🚆", shopping: "🛍️", park: "🌳", show: "🎭", guide: "📖",
      bakery: "🥐", dessert: "🍰", brunch: "🥐", pizza: "🍕", sushi: "🍣",
    };
    return icons[cat] || "📌";
  }

  function groupItemsByCategory(items) {
    const order = [];
    const groups = new Map();
    for (const item of items) {
      const key = item.category || "place";
      if (!groups.has(key)) { groups.set(key, []); order.push(key); }
      groups.get(key).push(item);
    }
    return order.map((k) => ({ category: k, items: groups.get(k) }));
  }

  function slotsToItems(slots) {
    const items = [];
    for (const slot of SLOTS) {
      for (const e of slots?.[slot.id] || []) {
        items.push({
          id: e.id || WorldStore.uid("item"),
          time: e.time || "",
          name: e.name,
          notes: e.note || e.notes || "",
          category: e.category,
          url: e.url || "",
          placeId: e.placeId || "",
          slot: slot.id,
          lat: e.lat, lng: e.lng,
        });
      }
    }
    return items;
  }

  function itemsOf(day) {
    if (Array.isArray(day?.items) && day.items.length) return day.items;
    return slotsToItems(day?.slots);
  }

  function emptyDay(dayNum, date, segmentId) {
    return { day: dayNum, date: date || null, segmentId: segmentId || null, slots: {}, items: [], notes: "" };
  }

  function normalizeSegDates(seg) {
    if (seg.startDate && seg.endDate && seg.endDate < seg.startDate) {
      const tmp = seg.startDate;
      seg.startDate = seg.endDate;
      seg.endDate = tmp;
    }
    return seg;
  }

  function syncTripBounds(trip) {
    const segs = (trip.segments || []).map(normalizeSegDates);
    const starts = segs.map((s) => s.startDate).filter(Boolean).sort();
    const ends = segs.map((s) => s.endDate).filter(Boolean).sort();
    if (starts.length) trip.startDate = starts[0];
    if (ends.length) trip.endDate = ends[ends.length - 1];
  }

  function hasStableDayPlan(trip) {
    if (trip.daysSource === "import" || trip.daysLocked) return true;
    const days = trip.days || [];
    if (!days.length) return false;
    const dated = days.filter((d) => d.date);
    if (dated.length !== days.length) return false;
    const uniqueDates = new Set(dated.map((d) => d.date));
    return uniqueDates.size === days.length;
  }

  function migrateTrip(trip) {
    if (!trip) return trip;
    if (!Array.isArray(trip.guides)) trip.guides = [];
    if (!trip.segments?.length) {
      trip.segments = [{
        id: WorldStore.uid("seg"),
        countryId: trip.countryId || "",
        city: trip.city || "Other",
        startDate: trip.startDate || null,
        endDate: trip.endDate || null,
      }];
    }
    for (const s of trip.segments) normalizeSegDates(s);
    if (hasStableDayPlan(trip)) {
      trip.dayCount = trip.days.length;
      syncTripBounds(trip);
    } else {
      rebuildDays(trip);
    }
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
    const prevByKey = new Map();
    for (const d of trip.days || []) {
      const items = itemsOf(d);
      if (d.date) prevByDate.set(d.date, { ...d, items });
      prevByKey.set(`${d.segmentId || ""}|${d.day}`, { ...d, items });
    }

    const days = [];
    let dayNum = 1;
    for (const seg of trip.segments || []) {
      if (seg.startDate && seg.endDate) {
        const count = daysBetween(seg.startDate, seg.endDate) + 1;
        for (let i = 0; i < count; i++) {
          const date = addDays(seg.startDate, i);
          const old = prevByDate.get(date) || prevByKey.get(`${seg.id}|${dayNum}`);
          days.push({
            ...emptyDay(dayNum, date, seg.id),
            items: old?.items ? JSON.parse(JSON.stringify(old.items)) : [],
            notes: old?.notes || "",
          });
          dayNum++;
        }
      } else {
        const old = trip.days?.[dayNum - 1];
        days.push({
          ...emptyDay(dayNum, null, seg.id),
          items: old?.items ? JSON.parse(JSON.stringify(itemsOf(old))) : [],
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
          items: old ? JSON.parse(JSON.stringify(itemsOf(old))) : [],
          notes: old?.notes || "",
        });
      }
    }

    trip.days = days;
    trip.dayCount = days.length;
    trip.updatedAt = new Date().toISOString();
    return trip;
  }

  function createTrip(state, { name, startDate, endDate, segments, dayCount, guides }) {
    const planner = ensurePlanner(state);
    const segs = (segments || []).map((s) => normalizeSegDates({
      id: s.id || WorldStore.uid("seg"),
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
      guides: guides || [],
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
    return planner.trips.find((t) => t.id === planner.activeTripId) || null;
  }

  function setActiveTrip(state, tripId) { ensurePlanner(state).activeTripId = tripId || null; }

  function deleteTrip(state, tripId) {
    const planner = ensurePlanner(state);
    const idx = planner.trips.findIndex((t) => t.id === tripId);
    if (idx < 0) return false;
    planner.trips.splice(idx, 1);
    if (planner.activeTripId === tripId) {
      planner.activeTripId = planner.trips[0]?.id || null;
      activeDayNum = 1;
      planner.activeDayNum = 1;
      if (planner.activeTripId) setPlannerView(state, "trip", planner.activeTripId, 1);
      else setPlannerView(state, planner.trips.length ? "list" : "create", null, 1);
      showCreate = !planner.trips.length;
    }
    return true;
  }

  function placesForDay(state, trip, dayNum, { city } = {}) {
    const seg = segmentForDay(trip, dayNum);
    if (!seg?.countryId) return [];
    const cityFilter = city || (seg.city === "Other" ? undefined : seg.city);
    return WorldStore.placesByCountry(state, seg.countryId, { city: cityFilter });
  }

  function entryFromPlace(place, slot, note = "") {
    return {
      id: WorldStore.uid("item"), placeId: place.id, name: place.name, category: place.category,
      city: place.city, countryId: place.countryId, slot, time: "", notes: note, note,
      url: place.url || "", lat: place.lat, lng: place.lng,
    };
  }

  function addItem(trip, dayNum, item) {
    const day = trip.days[dayNum - 1];
    if (!day) return false;
    if (!Array.isArray(day.items)) day.items = itemsOf(day);
    day.items.push(item);
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function addEntry(state, tripId, dayNum, slot, entry) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    migrateTrip(trip);
    const item = {
      id: entry.id || WorldStore.uid("item"),
      time: entry.time || "",
      name: entry.name,
      notes: entry.note || entry.notes || "",
      category: entry.category,
      url: entry.url || "",
      placeId: entry.placeId || "",
      slot: slot || PlaceCategorize.defaultSlot(entry.category),
      lat: entry.lat, lng: entry.lng,
    };
    return addItem(trip, dayNum, item);
  }

  function addPlace(state, tripId, dayNum, slot, place, note = "") {
    return addEntry(state, tripId, dayNum, slot, entryFromPlace(place, slot, note));
  }

  function removeItem(trip, dayNum, itemId) {
    const day = trip.days[dayNum - 1];
    if (!day) return false;
    day.items = itemsOf(day).filter((e) => e.id !== itemId);
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function removeEntry(state, tripId, dayNum, slot, entryId) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    return removeItem(trip, dayNum, entryId);
  }

  function updateItem(trip, dayNum, itemId, patch) {
    const day = trip.days[dayNum - 1];
    if (!day) return false;
    day.items = itemsOf(day);
    const item = day.items.find((e) => e.id === itemId);
    if (!item) return false;
    Object.assign(item, patch);
    if (patch.category && !patch.slot) item.slot = PlaceCategorize.defaultSlot(patch.category);
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function moveItem(trip, dayNum, itemId, dir) {
    const day = trip.days[dayNum - 1];
    if (!day) return false;
    const flat = itemsOf(day);
    const idx = flat.findIndex((x) => x.id === itemId);
    if (idx < 0) return false;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= flat.length) return false;
    [flat[idx], flat[newIdx]] = [flat[newIdx], flat[idx]];
    day.items = flat;
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function moveEntry(state, tripId, dayNum, entryId, dir) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return false;
    return moveItem(trip, dayNum, entryId, dir);
  }

  function moveDay(trip, dayNum, dir) {
    const idx = dayNum - 1;
    const newIdx = idx + dir;
    if (!trip.days || newIdx < 0 || newIdx >= trip.days.length) return false;
    [trip.days[idx], trip.days[newIdx]] = [trip.days[newIdx], trip.days[idx]];
    trip.days.forEach((d, i) => { d.day = i + 1; });
    trip.dayCount = trip.days.length;
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function removeDay(trip, dayNum) {
    if (!trip.days || trip.days.length <= 1) return false;
    trip.days.splice(dayNum - 1, 1);
    trip.days.forEach((d, i) => { d.day = i + 1; });
    trip.dayCount = trip.days.length;
    trip.updatedAt = new Date().toISOString();
    return true;
  }

  function unlockTripDays(trip) {
    if (!trip) return;
    delete trip.daysSource;
    delete trip.daysLocked;
  }

  function updateSegment(trip, segId, patch) {
    const seg = trip.segments.find((s) => s.id === segId);
    if (!seg) return false;
    Object.assign(seg, patch);
    normalizeSegDates(seg);
    syncTripBounds(trip);
    unlockTripDays(trip);
    rebuildDays(trip);
    return true;
  }

  function removeSegment(trip, segId) {
    if (!trip.segments || trip.segments.length <= 1) return false;
    trip.segments = trip.segments.filter((s) => s.id !== segId);
    syncTripBounds(trip);
    unlockTripDays(trip);
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
    unlockTripDays(trip);
    rebuildDays(trip);
    return true;
  }

  function addSegment(state, tripId, { countryId, city, startDate, endDate }) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return null;
    const seg = normalizeSegDates({
      id: WorldStore.uid("seg"), countryId, city: city || "Other", startDate, endDate,
    });
    trip.segments.push(seg);
    syncTripBounds(trip);
    unlockTripDays(trip);
    rebuildDays(trip);
    return seg.id;
  }

  function mapsHref(item, city, country) {
    if (item?.url && /^https?:\/\//i.test(item.url)) return item.url;
    const q = [item?.name, city, country].filter(Boolean).join(", ");
    if (!q) return "";
    if (Number.isFinite(item?.lat) && Number.isFinite(item?.lng)) {
      return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  function upsertPlaceFromItem(state, { name, city, countryId, countryName, category, url, lat, lng, notes }) {
    if (!name) return null;
    const cleanName = String(name).trim();
    const cleanCityName = (city || "Other").trim();
    let parsedLat = lat;
    let parsedLng = lng;
    if (url && (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng))) {
      const coords = WorldMapsImport?.parseCoordsFromUrl?.(url);
      if (coords?.lat && coords?.lng) {
        parsedLat = coords.lat;
        parsedLng = coords.lng;
      }
    }
    const existing = (state.places || []).find((p) =>
      p.name.toLowerCase() === cleanName.toLowerCase()
      && (p.city || "").toLowerCase() === cleanCityName.toLowerCase()
    );
    if (existing) {
      if (url && !existing.url) existing.url = url;
      if (category && category !== "place") existing.category = category;
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        existing.lat = parsedLat;
        existing.lng = parsedLng;
      }
      if (notes && !existing.description) existing.description = notes;
      WorldStore.recalcCountry(state, existing.countryId);
      return existing;
    }
    let cid = countryId;
    if (!cid && countryName) {
      const c = (state.countries || []).find((x) => x.name.toLowerCase() === countryName.toLowerCase() || x.id === countryName.toLowerCase());
      cid = c?.id;
    }
    if (!cid) {
      const id = (countryName || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
      if (!(state.countries || []).some((c) => c.id === id) && countryName && !/^region/i.test(countryName) && countryName !== "Unknown") {
        state.countries.push({
          id, name: countryName, iso: id.slice(0, 2), lat: lat || 0, lng: lng || 0, placeCount: 0,
        });
        CountryMeta.init(state.countries);
      }
      cid = id;
    }
    const country = state.countries.find((c) => c.id === cid);
    const place = {
      id: WorldStore.nextPlaceId(state),
      countryId: cid,
      name: cleanName,
      city: cleanCityName || "Other",
      category: category || PlaceCategorize.categorize(cleanName, notes || ""),
      lat: Number.isFinite(parsedLat) ? parsedLat : (country?.lat || 0),
      lng: Number.isFinite(parsedLng) ? parsedLng : (country?.lng || 0),
      url: url || "",
      description: `${cleanCityName || ""} | ${country?.name || countryName || ""} | ${notes || ""} | ${url || ""}`.replace(/\s+\|\s+$/g, "").trim(),
    };
    state.places.push(place);
    WorldStore.recalcCountry(state, cid);
    return place;
  }

  async function importDraft(state, draft) {
    const segments = [];
    for (const seg of draft.segments || []) {
      const countryName = seg.countryName || "";
      let countryId = "";
      if (countryName) {
        const c = (state.countries || []).find((x) => x.name.toLowerCase() === countryName.toLowerCase());
        countryId = c?.id || "";
      }
      if (!countryId) {
        const c = (state.countries || []).find((x) => /united states|usa/i.test(x.name)) || state.countries[0];
        countryId = c?.id || "";
      }
      segments.push({
        id: WorldStore.uid("seg"),
        countryId,
        city: seg.city || "Other",
        startDate: seg.startDate,
        endDate: seg.endDate,
      });
    }
    if (!segments.length) {
      segments.push({ id: WorldStore.uid("seg"), countryId: "", city: "Other", startDate: draft.startDate, endDate: draft.endDate });
    }

    const trip = createTrip(state, {
      name: draft.name,
      startDate: draft.startDate,
      endDate: draft.endDate,
      segments,
      dayCount: draft.dayPlans?.length || 0,
      guides: (draft.guides || []).map((g) => ({ id: WorldStore.uid("guide"), title: g.title, body: g.body, city: g.city || "" })),
    });

    const segByCity = new Map((trip.segments || []).map((s) => [s.city, s]));

    function itemFromRow(row, countryId, countryName, city) {
      const rowCity = (row.location || city || "Other").trim();
      const cat = PlaceCategorize.fromPlannerLabel(row.category) || PlaceCategorize.categorize(row.place, row.notes);
      const place = upsertPlaceFromItem(state, {
        name: row.place,
        city: rowCity,
        countryId,
        countryName,
        category: cat,
        url: row.url,
        notes: row.notes,
      });
      const lat = place?.lat;
      const lng = place?.lng;
      return {
        id: WorldStore.uid("item"),
        time: row.time || "",
        name: row.place,
        notes: row.notes || "",
        category: cat,
        url: row.url || place?.url || "",
        placeId: place?.id || "",
        slot: PlaceCategorize.defaultSlot(cat),
        lat, lng,
      };
    }

    if (draft.dayPlans?.length) {
      trip.days = draft.dayPlans.map((plan, i) => {
        const planCity = plan.location || "Other";
        const seg = segByCity.get(planCity) || trip.segments[0];
        const country = state.countries.find((c) => c.id === seg?.countryId);
        const items = (plan.rows || []).map((row) => {
          const rowCity = (row.location || planCity || "Other").trim();
          const rowSeg = segByCity.get(rowCity) || seg;
          const rowCountry = state.countries.find((c) => c.id === rowSeg?.countryId);
          return itemFromRow(row, rowSeg?.countryId, rowCountry?.name || country?.name, rowCity);
        });
        return {
          day: plan.day || (i + 1),
          date: plan.date,
          segmentId: seg?.id || null,
          items,
          notes: "",
          slots: {},
        };
      });
      trip.dayCount = trip.days.length;
      trip.startDate = trip.days[0]?.date || draft.startDate;
      trip.endDate = trip.days[trip.days.length - 1]?.date || draft.endDate;
      trip.daysSource = "import";
      for (const seg of trip.segments) {
        const segDays = trip.days.filter((d) => d.segmentId === seg.id);
        if (segDays.length) {
          seg.startDate = segDays[0].date;
          seg.endDate = segDays[segDays.length - 1].date;
        }
      }
    }

    WorldStore.recategorizePlaces(state);
    WorldGlobe.updatePins?.(WorldStore.countriesForUi(state));
    return trip;
  }

  function dayPlacesForMap(state, trip, dayNum) {
    const day = trip.days?.[dayNum - 1];
    if (!day) return [];
    const seg = segmentForDay(trip, dayNum);
    const country = state.countries.find((c) => c.id === seg?.countryId);
    return itemsOf(day).map((item, idx) => {
      const place = item.placeId ? (state.places || []).find((p) => p.id === item.placeId) : null;
      const lat = item.lat ?? place?.lat;
      const lng = item.lng ?? place?.lng;
      return {
        id: item.id,
        name: item.name,
        lat, lng,
        label: String(idx + 1),
        countryId: seg?.countryId || place?.countryId,
        city: seg?.city || place?.city,
        countryName: country?.name,
      };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  function showDayOnGlobe(state, trip, dayNum) {
    const places = dayPlacesForMap(state, trip, dayNum);
    const seg = segmentForDay(trip, dayNum);
    if (places.length) {
      WorldGlobe.showDayPlaces?.(places);
      WorldApp.toast(`Showing ${places.length} location${places.length === 1 ? "" : "s"} on globe`);
    } else if (seg?.countryId) {
      WorldApp.selectCountry(seg.countryId);
      WorldGlobe.focusCountry(seg.countryId);
      WorldApp.toast("No map coordinates yet — showing country on globe");
    } else {
      WorldApp.toast("Add Maps URLs to activities to show them on the globe", "warn");
    }
  }

  function localSuggestDay(state, trip, dayNum) {
    const places = placesForDay(state, trip, dayNum);
    const seg = segmentForDay(trip, dayNum);
    const used = new Set();
    for (const d of trip.days) {
      for (const e of itemsOf(d)) if (e.placeId) used.add(e.placeId);
    }
    const pool = places.filter((p) => !used.has(p.id));
    const suggestions = [];
    const pick = (cats, slot, limit = 2) => {
      for (const p of pool.filter((x) => cats.includes(x.category) || (cats.includes("eat") && PlaceCategorize.isEatCategory(x.category))).slice(0, limit)) {
        suggestions.push({
          id: WorldStore.uid("sug"), placeId: p.id, name: p.name, category: p.category, slot,
          reason: `${PlaceCategorize.label(p.category)} · ${seg?.city || "area"}`, score: 1, url: p.url || "",
        });
        used.add(p.id);
      }
    };
    pick(["bagel", "bakery", "cafe"], "breakfast", 1);
    pick(["museum", "landmark", "monument", "viewpoint", "temple", "park"], "activity", 2);
    pick(["pizza", "ramen", "sushi", "burger", "asian_restaurant", "eat"], "lunch", 1);
    pick(["park", "beach", "shopping"], "afternoon", 1);
    pick(["restaurant", "italian_restaurant", "eat"], "dinner", 1);
    pick(["bar", "nightlife"], "drinks", 1);
    trip.suggestions = suggestions;
    return suggestions;
  }

  async function aiSuggestDay(state, trip, dayNum, opts = {}) {
    const places = placesForDay(state, trip, dayNum).slice(0, 35);
    const seg = segmentForDay(trip, dayNum);
    if (!places.length) return { ok: false, error: "No places for this day's city" };
    const key = WorldAssistant?.getApiKey?.();
    if (!key) return { ok: true, source: "local", suggestions: localSuggestDay(state, trip, dayNum, opts) };
    try {
      const country = state.countries.find((c) => c.id === seg?.countryId);
      const compact = places.map((p) => `${p.id}|${p.name}|${p.category}`).join("\n");
      const provider = WorldAssistant?.provider?.() || "groq";
      const res = await fetch(`/.netlify/functions/llm?provider=${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: provider === "groq" ? "llama-3.1-8b-instant" : "openai/gpt-4o-mini",
          max_tokens: 280, temperature: 0.4,
          messages: [
            { role: "system", content: "Travel planner. Lines only: placeId|slot|reason. Saved places only." },
            { role: "user", content: `${seg?.city}, ${country?.name || ""}\nDay ${dayNum}\n${compact}` },
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
        suggestions.push({ id: WorldStore.uid("sug"), placeId: place.id, name: place.name, category: place.category, slot, reason: rest.join("|") || "AI pick", url: place.url || "" });
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
      id: WorldStore.uid("item"), name: suggestion.name, category: suggestion.category || "place",
      slot: suggestion.slot, notes: suggestion.reason || "", url: suggestion.url || "",
    };
    addEntry(state, tripId, dayNum, suggestion.slot, entry);
    trip.suggestions = (trip.suggestions || []).filter((s) => s.id !== suggestion.id);
    return true;
  }

  function defaultDateRange(offsetDays = 0) {
    const start = new Date();
    start.setDate(start.getDate() + offsetDays);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  function countryRowHtml(countries, idx, row = {}) {
    const defaults = defaultDateRange(idx * 7);
    const startDate = row.startDate || defaults.startDate;
    const endDate = row.endDate || defaults.endDate;
    const opts = countries.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === row.countryId ? "selected" : ""}>${esc(c.name)}</option>`
    ).join("");
    return `
      <div class="trip-country-row" data-row="${idx}">
        <select class="new-seg-country pill-select">${opts}</select>
        <input class="new-seg-city pill-select" placeholder="City" value="${esc(row.city || "")}" />
        <label class="field field-inline"><span class="muted">Start</span><input class="new-seg-start pill-select" type="date" value="${esc(startDate)}" /></label>
        <label class="field field-inline"><span class="muted">End</span><input class="new-seg-end pill-select" type="date" value="${esc(endDate)}" /></label>
        <button type="button" class="btn btn-ghost btn-sm" data-act="remove-create-row" aria-label="Remove">✕</button>
      </div>`;
  }

  function collectCreateRows() {
    const rows = [];
    document.querySelectorAll(".trip-country-row").forEach((el, idx) => {
      const countryId = el.querySelector(".new-seg-country")?.value;
      const city = el.querySelector(".new-seg-city")?.value?.trim() || "Other";
      let startDate = el.querySelector(".new-seg-start")?.value || "";
      let endDate = el.querySelector(".new-seg-end")?.value || "";
      if (!startDate || !endDate) {
        const d = defaultDateRange(idx * 7);
        startDate = startDate || d.startDate;
        endDate = endDate || d.endDate;
      }
      if (countryId) rows.push({ countryId, city, startDate, endDate });
    });
    return rows;
  }

  function segmentPhotoStyle(seg) {
    const city = seg?.city || "city";
    let h = 0;
    for (let i = 0; i < city.length; i++) h = (h * 31 + city.charCodeAt(i)) >>> 0;
    return `background:linear-gradient(135deg,hsl(${h % 360},42%,32%) 0%,hsl(${(h + 48) % 360},30%,16%) 100%)`;
  }

  function formatTripDates(trip) {
    if (trip.startDate && trip.endDate) return `${fmtDate(trip.startDate)} → ${fmtDate(trip.endDate)}`;
    if (trip.startDate) return `from ${fmtDate(trip.startDate)}`;
    return "Dates not set";
  }

  function csvCell(v) {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportTripSpreadsheet(state, trip) {
    const lines = [];
    lines.push(["Trip", trip.name, "Total Days", trip.dayCount, "Start", trip.startDate || "", "End", trip.endDate || ""].map(csvCell).join(","));
    lines.push("");
    lines.push(["Date", "Day", "Location", "Time/Order", "Place/Activity", "Notes", "Category", "Google Maps Link"].map(csvCell).join(","));
    for (const day of trip.days || []) {
      const seg = trip.segments.find((s) => s.id === day.segmentId) || segmentForDay(trip, day.day);
      const country = state.countries.find((c) => c.id === seg?.countryId);
      const items = itemsOf(day);
      if (!items.length) {
        lines.push([fmtDate(day.date), `Day ${day.day}`, seg?.city || "", "", "", "", "", ""].map(csvCell).join(","));
      } else {
        for (const item of items) {
          lines.push([
            fmtDate(day.date), `Day ${day.day}`, seg?.city || "", item.time || "",
            item.name, item.notes || "", PlaceCategorize.plannerLabel(item.category),
            mapsHref(item, seg?.city, country?.name),
          ].map(csvCell).join(","));
        }
      }
    }
    if (trip.guides?.length) {
      lines.push("");
      lines.push(["Guides"].map(csvCell).join(","));
      for (const g of trip.guides) {
        lines.push([g.title, g.city || "", g.body || ""].map(csvCell).join(","));
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

  function scrollPlannerToDay() {
    requestAnimationFrame(() => {
      const b = document.querySelector(".planner-body");
      const el = document.getElementById("planner-day-page");
      if (b) b.scrollTop = 0;
      if (b && el) {
        const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 8;
        b.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      }
    });
  }

  function goToDay(dayNum, { persist = false } = {}) {
    const state = WorldApp.getState();
    const trip = getActiveTrip(state);
    if (!trip) return;
    activeDayNum = clampDayNum(trip, dayNum);
    trip.activeDayNum = activeDayNum;
    ensurePlanner(state).activeDayNum = activeDayNum;
    lastScroll = 0;
    if (persist) WorldApp.persistPlanner({ skipPlannerRender: true });
    render(state);
    scrollPlannerToDay();
  }

  function renderTripNavBar(state, trip) {
    return `
      <div class="planner-trip-nav card">
        <button type="button" class="btn btn-ghost btn-sm" data-act="trips-back">← Trips</button>
        <div class="planner-trip-nav-meta">
          <strong>${esc(trip.name)}</strong>
          <span class="muted">${esc(formatTripDates(trip))}</span>
        </div>
      </div>`;
  }

  function renderTripRail(state) {
    const trips = ensurePlanner(state).trips || [];
    const activeId = state.planner.activeTripId;
    return `
      <section class="planner-rail">
        <div class="planner-rail-actions">
          <button type="button" class="btn btn-primary" data-act="new-trip" onclick="WorldPlanner.act(event)">+ New trip</button>
          <button type="button" class="btn btn-secondary" data-act="import-pick" onclick="WorldPlanner.act(event)">Import Excel/PDF</button>
        </div>
        ${trips.length ? `<div class="planner-trip-chips">
          ${trips.map((t) => `
            <div class="trip-chip-row">
              <button type="button" class="trip-chip ${t.id === activeId ? "active" : ""}" data-act="open-trip" data-trip-id="${esc(t.id)}" onclick="WorldPlanner.act(event)">
                <strong>${esc(t.name)}</strong>
                <span class="muted">${esc(formatTripDates(t))}</span>
              </button>
              <button type="button" class="btn btn-ghost btn-sm trip-chip-del" data-act="delete-trip" data-trip-id="${esc(t.id)}" aria-label="Delete trip">✕</button>
            </div>`).join("")}
        </div>` : `<p class="muted planner-empty-hint">No trips yet — create one or import an Excel/PDF itinerary.</p>`}
      </section>`;
  }

  function renderCreateForm(state) {
    const countries = WorldStore.countriesForUi(state);
    return `
      <section class="planner-empty card" id="planner-create">
        <h3>Start a new trip</h3>
        <p class="muted">Add countries with date ranges — they become one connected itinerary.</p>
        <input id="new-trip-name" class="pill-select" placeholder="Trip name" />
        <div id="new-trip-rows" class="trip-country-rows">${countryRowHtml(countries, 0)}</div>
        <div class="planner-actions">
          <button type="button" class="btn btn-ghost" data-act="add-create-row">+ Country</button>
          <button type="button" class="btn btn-primary" data-act="create-trip" onclick="WorldPlanner.act(event)">Create trip</button>
        </div>
      </section>`;
  }

  function renderActivityCard(item, day, seg, country, state) {
    const href = mapsHref(item, seg?.city, country?.name);
    const catLabel = PlaceCategorize.plannerLabel(item.category);
    const place = item.placeId ? (state.places || []).find((p) => p.id === item.placeId) : null;
    const canPin = !!(item.lat ?? place?.lat) || !!seg?.countryId;
    return `<article class="activity-card" data-item-id="${esc(item.id)}" data-day="${day.day}">
      <div class="activity-card-head">
        <span class="activity-cat-badge">${categoryIcon(item.category)} ${esc(catLabel)}</span>
        <input class="activity-time pill-select" data-act="item-time" data-item="${esc(item.id)}" data-day="${day.day}" value="${esc(item.time || "")}" placeholder="Time" />
      </div>
      <input class="activity-name pill-select" data-act="item-name" data-item="${esc(item.id)}" data-day="${day.day}" value="${esc(item.name || "")}" placeholder="Place / activity" />
      <input class="activity-notes pill-select" data-act="item-notes" data-item="${esc(item.id)}" data-day="${day.day}" value="${esc(item.notes || "")}" placeholder="Notes" />
      <div class="activity-card-foot">
        <select class="pill-select activity-cat-select" data-act="item-cat" data-item="${esc(item.id)}" data-day="${day.day}">${catOptions(item.category)}</select>
        <div class="activity-card-actions">
          ${canPin ? `<button type="button" class="btn btn-ghost btn-sm" data-act="pin-globe" data-item="${esc(item.id)}" data-day="${day.day}">Globe</button>` : ""}
          ${href ? `<a class="btn btn-ghost btn-sm place-link" href="${esc(href)}" target="_blank" rel="noopener">Maps</a>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="item-up" data-item="${esc(item.id)}" data-day="${day.day}">↑</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="item-down" data-item="${esc(item.id)}" data-day="${day.day}">↓</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="item-remove" data-item="${esc(item.id)}" data-day="${day.day}" aria-label="Remove">✕</button>
        </div>
      </div>
    </article>`;
  }

  function renderDayAddForm(day) {
    return `<div class="day-add card">
      <strong>Add activity</strong>
      <div class="day-add-grid">
        <input class="pill-select add-item-time" data-day="${day.day}" placeholder="Time" />
        <input class="pill-select add-item-name" data-day="${day.day}" placeholder="Place / activity" />
        <input class="pill-select add-item-notes" data-day="${day.day}" placeholder="Notes" />
        <select class="pill-select add-item-cat" data-day="${day.day}">${catOptions("landmark")}</select>
        <input class="pill-select add-item-url" data-day="${day.day}" placeholder="Maps URL (optional)" />
        <button type="button" class="btn btn-secondary" data-act="add-item" data-day="${day.day}">+ Add to day</button>
      </div>
    </div>`;
  }

  function renderDayPage(state, trip, dayNum) {
    const day = trip.days?.[dayNum - 1];
    if (!day) return '<p class="muted">No days in this trip yet.</p>';
    const seg = segmentForDay(trip, dayNum);
    const country = state.countries.find((c) => c.id === seg?.countryId);
    const headline = [
      day.date ? fmtDateLong(day.date) : `Day ${dayNum}`,
      seg?.city && seg.city !== "Other" ? seg.city : "",
      country?.name || "",
    ].filter(Boolean).join(" · ");
    const groups = groupItemsByCategory(itemsOf(day));
    const total = trip.days?.length || 0;
    return `
      <section class="day-page" id="planner-day-page">
        <header class="day-page-head card">
          <p class="day-page-kicker">Day ${dayNum} of ${total}</p>
          <h2 class="day-page-title">${esc(headline)}</h2>
        </header>
        <nav class="day-nav-bar" aria-label="Day navigation">
          <button type="button" class="btn btn-ghost btn-sm day-nav-arrow" data-act="day-prev" ${dayNum <= 1 ? "disabled" : ""}>←</button>
          <label class="day-jump-field">
            <span class="sr-only">Jump to day</span>
            <select class="pill-select day-jump-select" id="day-jump-select" data-act="day-select">
              ${(trip.days || []).map((d) => {
                const seg = segmentForDay(trip, d.day);
                const country = state.countries.find((c) => c.id === seg?.countryId);
                const label = [
                  `Day ${d.day}`,
                  d.date ? fmtDate(d.date) : "",
                  seg?.city && seg.city !== "Other" ? seg.city : "",
                  country?.name || "",
                ].filter(Boolean).join(" · ");
                return `<option value="${d.day}" ${d.day === dayNum ? "selected" : ""}>${esc(label)}</option>`;
              }).join("")}
            </select>
          </label>
          <button type="button" class="btn btn-ghost btn-sm day-nav-arrow" data-act="day-next" ${dayNum >= total ? "disabled" : ""}>→</button>
        </nav>
        <div class="day-nav-chips" role="tablist" aria-label="Day chips">
          ${(trip.days || []).map((d) => `
            <button type="button" role="tab" class="day-nav-chip ${d.day === dayNum ? "active" : ""}" data-act="day-go" data-day="${d.day}" aria-selected="${d.day === dayNum}">
              ${d.date ? esc(fmtDate(d.date)) : `D${d.day}`}
            </button>`).join("")}
        </div>
        <div class="day-map-bar card">
          <button type="button" class="btn btn-secondary" data-act="day-map" data-day="${day.day}">🌍 Map this day on globe</button>
          <ul class="day-location-list">
            ${itemsOf(day).map((item, idx) => {
              const place = item.placeId ? (state.places || []).find((p) => p.id === item.placeId) : null;
              const hasCoords = Number.isFinite(item.lat ?? place?.lat) && Number.isFinite(item.lng ?? place?.lng);
              return `<li class="day-location-item">
                <span class="day-loc-num">${idx + 1}</span>
                <span class="day-loc-name">${esc(item.time ? `${item.time} · ` : "")}${esc(item.name)}</span>
                ${hasCoords ? `<button type="button" class="btn btn-ghost btn-sm" data-act="pin-globe" data-item="${esc(item.id)}" data-day="${day.day}">Globe</button>` : ""}
              </li>`;
            }).join("") || '<li class="muted">No locations with coordinates yet</li>'}
          </ul>
        </div>
        <div class="day-sections">
          ${groups.length ? groups.map((g) => `
            <section class="day-category-section card">
              <h3 class="day-category-title">${categoryIcon(g.category)} ${esc(PlaceCategorize.plannerLabel(g.category))}</h3>
              <div class="activity-list">
                ${g.items.map((item) => renderActivityCard(item, day, seg, country, state)).join("")}
              </div>
            </section>`).join("") : '<p class="muted day-empty">No activities yet — add one below.</p>'}
        </div>
        ${renderDayAddForm(day)}
      </section>`;
  }

  function renderLocationSection(state, trip, seg, idx) {
    const country = state.countries.find((c) => c.id === seg.countryId);
    const days = (trip.days || []).filter((d) => d.segmentId === seg.id);
    const countries = WorldStore.countriesForUi(state);
    const opts = countries.map((cc) =>
      `<option value="${esc(cc.id)}" ${cc.id === seg.countryId ? "selected" : ""}>${esc(cc.name)}</option>`
    ).join("");
    const guides = (trip.guides || []).filter((g) => !g.city || g.city === seg.city);
    return `<section class="itin-location card" id="seg-${esc(seg.id)}">
      <div class="segment-photo" style="${segmentPhotoStyle(seg)}">
        <div class="segment-photo-overlay">
          ${country ? `<img class="segment-flag" src="${CountryMeta.flagUrl(country.iso, 24)}" alt="" width="28" height="20"/>` : ""}
          <div><strong>${esc(seg.city)}</strong><span class="muted place-meta">${esc(country?.name || "")} · ${days.length} day${days.length === 1 ? "" : "s"}</span></div>
        </div>
      </div>
      <div class="segment-card-head">
        <strong>Stop ${idx + 1}</strong>
        <div class="segment-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="seg-up" data-seg="${esc(seg.id)}" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="seg-down" data-seg="${esc(seg.id)}" ${idx === trip.segments.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="seg-remove" data-seg="${esc(seg.id)}" aria-label="Remove location">✕</button>
        </div>
      </div>
      <div class="segment-edit-grid">
        <select class="seg-edit-country pill-select" data-act="seg-field" data-seg="${esc(seg.id)}" data-field="countryId">${opts}</select>
        <input class="seg-edit-city pill-select" data-act="seg-field" data-seg="${esc(seg.id)}" data-field="city" value="${esc(seg.city)}" placeholder="City" />
        <label class="field field-inline"><span class="muted">Start</span><input class="seg-edit-start pill-select" type="date" data-act="seg-field" data-seg="${esc(seg.id)}" data-field="startDate" value="${esc(seg.startDate || "")}" /></label>
        <label class="field field-inline"><span class="muted">End</span><input class="seg-edit-end pill-select" type="date" data-act="seg-field" data-seg="${esc(seg.id)}" data-field="endDate" value="${esc(seg.endDate || "")}" /></label>
      </div>
      ${guides.length ? `<div class="itin-guides"><h4>Getting around · ${esc(seg.city)}</h4>
        ${guides.map((g) => `<article class="guide-card"><strong>${esc(g.title)}</strong><pre class="guide-body">${esc(g.body)}</pre>
          <button type="button" class="btn btn-ghost btn-sm" data-act="guide-remove" data-guide="${esc(g.id)}">Remove</button></article>`).join("")}
      </div>` : ""}
    </section>`;
  }

  function renderTripDoc(state, trip) {
    const countries = WorldStore.countriesForUi(state);
    const countryOpts = countries.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    activeDayNum = clampDayNum(trip, trip.activeDayNum || activeDayNum);
    trip.activeDayNum = activeDayNum;
    return `
      <article class="planner-trip-doc" id="planner-trip-doc">
        <header class="trip-doc-head card">
          <input id="trip-name-edit" class="trip-name-input" value="${esc(trip.name)}" />
          <p class="muted">${trip.dayCount || 0} days · ${esc(formatTripDates(trip))}</p>
        </header>
        ${renderDayPage(state, trip, activeDayNum)}
        <details class="route-editor card" ${routeEditorOpen ? "open" : ""}>
          <summary class="route-editor-summary">Edit locations &amp; dates</summary>
          <section class="planner-section" id="planner-route">
            ${(trip.segments || []).map((s, i) => renderLocationSection(state, trip, s, i)).join("")}
            <div class="planner-add-seg-form card"${keepSegFormOpen ? " open" : ""}>
              <strong>Add location</strong>
              <div class="planner-grid" style="margin-top:0.65rem">
                <select id="seg-country" class="pill-select">${countryOpts}</select>
                <input id="seg-city" class="pill-select" placeholder="City" />
                <label class="field field-inline"><span class="muted">Start</span><input id="seg-start" type="date" class="pill-select" /></label>
                <label class="field field-inline"><span class="muted">End</span><input id="seg-end" type="date" class="pill-select" /></label>
                <button type="button" class="btn btn-primary" data-act="add-segment">+ Add location</button>
              </div>
            </div>
          </section>
        </details>
        ${(trip.suggestions || []).length ? `<section class="planner-section"><h3>Suggestions</h3>
          <ul class="planner-suggestions">${trip.suggestions.map((s) => `
            <li class="planner-suggestion card">
              <div><strong>${esc(s.name)}</strong><span class="muted place-meta">${esc(slotLabel(s.slot))} · ${esc(s.reason || "")}</span></div>
              <button type="button" class="btn btn-primary btn-sm" data-act="adopt-sug" data-sug="${esc(s.id)}">Add</button>
            </li>`).join("")}</ul></section>` : ""}
        <footer class="planner-footer">
          <button type="button" class="btn btn-secondary" data-act="suggest">Quick suggest</button>
          <button type="button" class="btn btn-secondary" data-act="export">Export Excel</button>
          <button type="button" class="btn btn-primary" data-act="save">Save trip</button>
        </footer>
      </article>`;
  }

  function render(stateIn) {
    const state = stateIn || WorldApp.getState();
    const panel = $("planner-panel");
    if (!panel) return;
    restorePlannerNav(state);
    ensurePlanner(state);
    syncUiFromState(state);
    const body = panel.querySelector(".planner-body");
    if (body) lastScroll = body.scrollTop;
    const trip = getActiveTrip(state);
    const trips = state.planner.trips || [];
    const view = plannerView(state);
    const showList = view === "list";
    const showTrip = view === "trip" && !!trip;
    const showCreateForm = view === "create" && !showTrip;

    panel.innerHTML = `
      <header class="planner-head">
        <div class="planner-head-main">
          <div>
            <strong>Travel Planner</strong>
            <p class="muted assist-sub">Locations · days · places · maps</p>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-act="close" aria-label="Close">✕</button>
      </header>
      <div class="planner-body">
        ${showList ? renderTripRail(state) : (showTrip ? renderTripNavBar(state, trip) : renderTripRail(state))}
        ${showCreateForm && !showTrip ? renderCreateForm(state) : ""}
        ${showTrip ? renderTripDoc(state, trip) : ""}
      </div>`;

    requestAnimationFrame(() => {
      const b = panel.querySelector(".planner-body");
      if (b && lastScroll) b.scrollTop = lastScroll;
    });
    wirePlannerActions();
    return state;
  }

  function persistLive({ flush, toast: msg, scroll } = {}) {
    const body = document.querySelector(".planner-body");
    if (body) lastScroll = body.scrollTop;
    WorldApp.persistPlanner({ flush, skipPlannerRender: true });
    render(WorldApp.getState());
    requestAnimationFrame(() => {
      const b = document.querySelector(".planner-body");
      if (scroll && b) {
        const el = document.querySelector(scroll);
        if (el) {
          const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 8;
          b.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        }
      } else if (b) b.scrollTop = lastScroll;
    });
    if (msg) WorldApp.toast(msg);
  }

  function enterTripView(state, tripId, { dayNum = 1, flush = false, toast: msg } = {}) {
    const trip = ensurePlanner(state).trips.find((t) => t.id === tripId);
    if (!trip) return null;
    const n = clampDayNum(trip, dayNum);
    setPlannerView(state, "trip", tripId, n);
    state.planner.view = "trip";
    state.planner.activeTripId = tripId;
    state.planner.activeDayNum = n;
    activeDayNum = n;
    trip.activeDayNum = n;
    showCreate = false;
    tripListOpen = false;
    open = true;
    lastScroll = 0;
    const panel = $("planner-panel");
    if (panel) {
      panel.classList.add("open");
      panel.hidden = false;
    }
    try {
      sessionStorage.setItem("plannerNav", JSON.stringify({ view: "trip", tripId, dayNum: n, ts: Date.now() }));
    } catch { /* */ }
    WorldStore.saveState(state);
    render(state);
    scrollPlannerToDay();
    WorldApp.persist({ touchPlanner: true });
    if (flush && WorldCloud?.configured) {
      setTimeout(() => {
        WorldApp.persistPlanner({ flush: true, skipPlannerRender: true }).catch(() => {});
      }, 300);
    }
    if (msg) WorldApp.toast(msg);
    return trip;
  }

  function finishCreateTrip(state, created) {
    if (!created?.id) return WorldApp.toast("Could not create trip", "error");
    enterTripView(state, created.id, { dayNum: 1, flush: false, toast: "Trip created" });
  }

  function onClick(e, actElIn) {
    const actEl = actElIn || e.target.closest("[data-act]");
    if (!actEl) return;
    const act = actEl.dataset.act;
    const state = WorldApp.getState();
    ensurePlanner(state);
    const trip = getActiveTrip(state);

    if (act === "close") {
      WorldGlobe.restoreCountryPins?.();
      return toggle(false);
    }
    if (act === "jump") {
      const b = document.querySelector(".planner-body");
      const el = document.querySelector(actEl.dataset.jump);
      if (b && el) {
        const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop - 8;
        b.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
      return;
    }
    if (act === "new-trip") {
      setPlannerView(state, "create", null);
      showCreate = true;
      tripListOpen = true;
      WorldApp.persist({ touchPlanner: true });
      return render(state);
    }
    if (act === "trips-back") {
      setPlannerView(state, "list");
      tripListOpen = true;
      WorldApp.persist({ touchPlanner: true });
      return render(state);
    }
    if (act === "open-trip") {
      return enterTripView(state, actEl.dataset.tripId, { dayNum: 1 });
    }
    if (act === "delete-trip") {
      e.preventDefault();
      e.stopPropagation();
      const id = actEl.dataset.tripId;
      const t = state.planner.trips.find((x) => x.id === id);
      if (!t) return;
      deleteTrip(state, id);
      if (state.planner.activeTripId) {
        setPlannerView(state, "trip", state.planner.activeTripId);
      } else {
        setPlannerView(state, "list", null);
        tripListOpen = true;
      }
      WorldApp.persist({ touchPlanner: true });
      WorldApp.persistPlanner({ flush: true, skipPlannerRender: true });
      render(state);
      return WorldApp.toast(`Deleted "${t.name}"`);
    }
    if (act === "day-go") {
      e.preventDefault();
      e.stopPropagation();
      return goToDay(Number(actEl.dataset.day));
    }
    if (act === "day-prev") {
      e.preventDefault();
      if (!trip) return;
      return goToDay(activeDayNum - 1);
    }
    if (act === "day-next") {
      e.preventDefault();
      if (!trip) return;
      return goToDay(activeDayNum + 1);
    }
    if (act === "add-create-row") {
      const rows = $("new-trip-rows");
      const countries = WorldStore.countriesForUi(state);
      const idx = rows?.querySelectorAll(".trip-country-row").length || 0;
      rows?.insertAdjacentHTML("beforeend", countryRowHtml(countries, idx));
      return;
    }
    if (act === "remove-create-row") {
      const row = actEl.closest(".trip-country-row");
      if (document.querySelectorAll(".trip-country-row").length <= 1) return WorldApp.toast("Need at least one country", "warn");
      row?.remove();
      return;
    }
    if (act === "import-pick") {
      e.preventDefault();
      $("planner-import-file")?.click();
      return;
    }
    if (act === "create-trip") {
      try {
        const segments = collectCreateRows();
        const name = $("new-trip-name")?.value?.trim() || "My trip";
        if (!segments.length) return WorldApp.toast("Pick at least one country", "warn");
        const created = createTrip(state, { name, segments });
        if (!created) return WorldApp.toast("Could not create trip", "error");
        WorldStore.saveState(state);
        finishCreateTrip(state, created);
      } catch (err) {
        WorldApp.toast(err?.message || "Create failed", "error");
      }
      return;
    }
    if (act === "day-map") {
      if (!trip) return;
      return showDayOnGlobe(state, trip, Number(actEl.dataset.day) || activeDayNum);
    }
    if (act === "save") {
      persistLive({ flush: true, toast: "Trip saved" });
      return;
    }
    if (act === "export") {
      if (!trip) return;
      downloadTripExcel(state, trip);
      return WorldApp.toast("Trip exported");
    }
    if (act === "add-segment") {
      if (!trip) return;
      const countryId = $("seg-country")?.value;
      const city = $("seg-city")?.value || "Other";
      const startDate = $("seg-start")?.value;
      const endDate = $("seg-end")?.value;
      if (!countryId) return WorldApp.toast("Pick a country", "warn");
      const segId = addSegment(state, trip.id, { countryId, city, startDate, endDate });
      highlightSegId = segId;
      keepSegFormOpen = true;
      persistLive({ toast: "Location added", scroll: segId ? `#seg-${segId}` : "#planner-route" });
      return;
    }
    if (act === "seg-remove") {
      if (!trip) return;
      if (!removeSegment(trip, actEl.dataset.seg)) return WorldApp.toast("Need at least one location", "warn");
      return persistLive({ toast: "Location removed", scroll: "#planner-route" });
    }
    if (act === "seg-up") {
      moveSegment(trip, actEl.dataset.seg, -1);
      return persistLive({ scroll: "#planner-route" });
    }
    if (act === "seg-down") {
      moveSegment(trip, actEl.dataset.seg, 1);
      return persistLive({ scroll: "#planner-route" });
    }
    if (act === "day-up") {
      moveDay(trip, Number(actEl.dataset.day), -1);
      return persistLive();
    }
    if (act === "day-down") {
      moveDay(trip, Number(actEl.dataset.day), 1);
      return persistLive();
    }
    if (act === "day-remove") {
      if (!removeDay(trip, Number(actEl.dataset.day))) return WorldApp.toast("Need at least one day", "warn");
      return persistLive({ toast: "Day removed" });
    }
    if (act === "add-item") {
      const dayNum = Number(actEl.dataset.day);
      const wrap = actEl.closest(".day-add") || actEl.closest(".itin-day");
      const name = wrap?.querySelector(".add-item-name")?.value?.trim();
      if (!name) return WorldApp.toast("Enter a place name", "warn");
      const time = wrap.querySelector(".add-item-time")?.value?.trim() || "";
      const notes = wrap.querySelector(".add-item-notes")?.value?.trim() || "";
      const category = wrap.querySelector(".add-item-cat")?.value || "place";
      const url = wrap.querySelector(".add-item-url")?.value?.trim() || "";
      const seg = segmentForDay(trip, dayNum);
      const country = state.countries.find((c) => c.id === seg?.countryId);
      const place = upsertPlaceFromItem(state, {
        name, city: seg?.city, countryId: seg?.countryId, countryName: country?.name, category, url, notes,
      });
      addItem(trip, dayNum, {
        id: WorldStore.uid("item"), time, name, notes, category, url: url || place?.url || "",
        placeId: place?.id || "", slot: PlaceCategorize.defaultSlot(category), lat: place?.lat, lng: place?.lng,
      });
      persistLive({ toast: `Added ${name}`, scroll: "#planner-day-page" });
      return;
    }
    if (act === "pin-globe") {
      const dayNum = Number(actEl.dataset.day);
      const itemId = actEl.dataset.item;
      const day = trip.days?.[dayNum - 1];
      const item = itemsOf(day).find((i) => i.id === itemId);
      if (!item) return;
      const seg = segmentForDay(trip, dayNum);
      const place = item.placeId ? (state.places || []).find((p) => p.id === item.placeId) : null;
      const lat = item.lat ?? place?.lat;
      const lng = item.lng ?? place?.lng;
      if (seg?.countryId) WorldApp.selectCountry(seg.countryId);
      if (Number.isFinite(lat) && Number.isFinite(lng)) WorldGlobe.focusPlace?.(lat, lng);
      else if (seg?.countryId) WorldGlobe.focusCountry(seg.countryId);
      WorldApp.toast(`Pinned ${item.name} on globe`);
      return;
    }
    if (act === "item-remove") {
      if (!trip) return;
      removeItem(trip, Number(actEl.dataset.day), actEl.dataset.item);
      WorldApp.persist({ touchPlanner: true });
      render(state);
      return;
    }
    if (act === "item-up") {
      moveItem(trip, Number(actEl.dataset.day), actEl.dataset.item, -1);
      return persistLive();
    }
    if (act === "item-down") {
      moveItem(trip, Number(actEl.dataset.day), actEl.dataset.item, 1);
      return persistLive();
    }
    if (act === "adopt-sug") {
      const sug = trip.suggestions?.find((s) => s.id === actEl.dataset.sug);
      if (!sug) return;
      adoptSuggestion(state, trip.id, sug, activeDayNum);
      return persistLive({ toast: "Added", scroll: "#planner-day-page" });
    }
    if (act === "suggest") {
      localSuggestDay(state, trip, activeDayNum);
      return persistLive({ toast: "Suggestions ready" });
    }
    if (act === "guide-remove") {
      trip.guides = (trip.guides || []).filter((g) => g.id !== actEl.dataset.guide);
      trip.updatedAt = new Date().toISOString();
      return persistLive();
    }
  }

  function onChange(e) {
    const el = e.target;
    const state = WorldApp.getState();
    const trip = getActiveTrip(state);
    if (!trip) return;

    if (el.id === "trip-name-edit") {
      trip.name = el.value.trim() || trip.name;
      trip.updatedAt = new Date().toISOString();
      WorldApp.persistPlanner({ skipPlannerRender: true });
      return;
    }
    if (el.id === "planner-import-file") return;

    if (el.id === "day-jump-select") {
      return goToDay(Number(el.value), { persist: true });
    }

    const act = el.dataset.act;
    if (act === "seg-field") {
      const field = el.dataset.field;
      const patch = {};
      patch[field] = el.value;
      updateSegment(trip, el.dataset.seg, patch);
      persistLive({ toast: "Location updated", scroll: `#seg-${el.dataset.seg}` });
      return;
    }
    if (act === "item-cat") {
      updateItem(trip, Number(el.dataset.day), el.dataset.item, { category: el.value });
      persistLive({ scroll: `#day-${el.dataset.day}` });
    }
  }

  function onBlur(e) {
    const el = e.target;
    const act = el.dataset?.act;
    const state = WorldApp.getState();
    const trip = getActiveTrip(state);
    if (!trip || !act) return;
    const day = Number(el.dataset.day);
    const id = el.dataset.item;
    if (act === "item-time") updateItem(trip, day, id, { time: el.value.trim() });
    if (act === "item-name") updateItem(trip, day, id, { name: el.value.trim() || "Place" });
    if (act === "item-notes") updateItem(trip, day, id, { notes: el.value.trim() });
    if (act === "item-time" || act === "item-name" || act === "item-notes") {
      WorldApp.persistPlanner({ skipPlannerRender: true });
    }
  }

  async function onImportFile(file) {
    if (!file || !window.WorldPlannerImport) return WorldApp.toast("Importer not loaded", "error");
    WorldApp.toast("Reading itinerary…");
    try {
      const parsed = await WorldPlannerImport.parseFile(file);
      const draft = WorldPlannerImport.buildTripDraft(parsed);
      const state = WorldApp.getState();
      const trip = await importDraft(state, draft);
      WorldStore.saveState(state);
      enterTripView(state, trip.id, { dayNum: 1, flush: true, toast: `Imported ${draft.rowCount} activities` });
      return trip;
    } catch (err) {
      console.warn("Import failed", err);
      WorldApp.toast(err.message || "Import failed — try Excel/CSV export from your planner", "error");
    }
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
    const fill = () => {
      const trip = planner.trips.find((t) => t.id === tripSel.value) || getActiveTrip(state);
      if (!trip) { daySel.innerHTML = ""; citySel.innerHTML = ""; return; }
      daySel.innerHTML = (trip.days || []).map((d, i) => {
        const seg = segmentForDay(trip, i + 1);
        return `<option value="${i + 1}">Day ${i + 1}${d.date ? ` (${d.date})` : ""} — ${esc(seg?.city || "")}</option>`;
      }).join("");
      const matchingSegs = (trip.segments || []).filter((s) => s.countryId === place.countryId);
      const segs = matchingSegs.length ? matchingSegs : trip.segments;
      citySel.innerHTML = segs.map((s) =>
        `<option value="${esc(s.id)}" ${s.city === place.city ? "selected" : ""}>${esc(s.city)}</option>`
      ).join("");
    };
    fill();
    tripSel.onchange = fill;
  }

  function showAddToTripModal(place) {
    const state = WorldApp.getState();
    ensurePlanner(state);
    if (!state.planner.trips.length) {
      showCreate = true;
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
    const day = trip.days[dayNum - 1];
    if (day && segId) day.segmentId = segId;
    addPlace(state, trip.id, dayNum, slot, pendingPlace, note);
    hideAddToTripModal();
    activeDayNum = dayNum;
    enterTripView(state, trip.id, { dayNum, flush: true, toast: `Added to day ${dayNum}` });
  }

  function restorePlannerNav(state) {
    try {
      const raw = sessionStorage.getItem("plannerNav");
      if (!raw) return;
      const nav = JSON.parse(raw);
      const p = ensurePlanner(state);
      if (nav.view === "trip" && nav.tripId && p.trips.some((t) => t.id === nav.tripId)) {
        setPlannerView(state, "trip", nav.tripId, nav.dayNum || 1);
      }
    } catch { /* */ }
  }

  function toggle(on) {
    open = on != null ? !!on : !open;
    const panel = $("planner-panel");
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.hidden = !open;
    if (open) {
      const st = WorldApp.getState();
      const planner = ensurePlanner(st);
      restorePlannerNav(st);
      const trip = getActiveTrip(st);
      if (!planner.view || (planner.view === "trip" && !trip)) {
        if (trip) setPlannerView(st, "trip", trip.id, trip.activeDayNum || 1);
        else if (!planner.trips.length) setPlannerView(st, "create", null);
        else setPlannerView(st, "list", null);
      }
      syncUiFromState(st);
      render(st);
    }
  }

  function init() {
    if (bound) return;
    const panel = $("planner-panel");
    if (!panel) return;
    bound = true;
    $("btn-planner")?.addEventListener("click", () => toggle(true));
    panel.addEventListener("click", panelPointer, true);
    panel.addEventListener("touchend", panelPointer, { passive: false, capture: true });
    panel.addEventListener("change", onChange);
    panel.addEventListener("focusout", onBlur);
    panel.addEventListener("toggle", (e) => {
      if (e.target?.classList?.contains("route-editor")) routeEditorOpen = e.target.open;
    }, true);
    $("planner-import-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) onImportFile(file);
    });
    $("tam-cancel")?.addEventListener("click", hideAddToTripModal);
    $("tam-confirm")?.addEventListener("click", confirmAddToTrip);
    $("trip-add-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "trip-add-modal") hideAddToTripModal();
    });
  }

  return {
    init, toggle, open: () => toggle(true), render, isOpen: () => open, act, SLOTS, slotLabel,
    ensurePlanner, migrateTrip, createTrip, getActiveTrip, addPlace, removeEntry,
    addSegment, updateSegment, removeSegment, moveSegment, moveDay, removeDay, moveEntry,
    segmentForDay, placesForDay, localSuggestDay, aiSuggestDay,
    adoptSuggestion, showAddToTripMenu: showAddToTripModal, showAddToTripModal, rebuildDays,
    exportTripSpreadsheet, downloadTripExcel, importDraft, itemsOf,
  };
})();
