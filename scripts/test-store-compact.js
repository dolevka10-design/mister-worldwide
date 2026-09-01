#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.join(__dirname, "..");
const storeMem = {};
const ctx = {
  window: {},
  console,
  localStorage: {
    getItem: (k) => (k in storeMem ? storeMem[k] : null),
    setItem: (k, v) => { storeMem[k] = String(v); },
    removeItem: (k) => { delete storeMem[k]; },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/store.js`, "utf8"), ctx);
const Store = ctx.window.WorldStore;

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
}

const seed = {
  version: 1,
  countries: [{ id: "us", name: "United States", iso: "us", lat: 38, lng: -97, placeCount: 1 }],
  places: [
    { id: "p1", countryId: "us", name: "Statue of Liberty", city: "New York", category: "landmark", lat: 40.68, lng: -74.04, url: "", description: "" },
    { id: "p2", countryId: "us", name: "Central Park", city: "New York", category: "park", lat: 40.78, lng: -73.96, url: "", description: "" },
  ],
  categories: ["landmark", "park"],
};
Store.setSeed(seed);

const state = Store.defaultState();
state.places.push({
  id: "p99", countryId: "us", name: "Joe's Pizza", city: "New York", category: "pizza",
  lat: 40.73, lng: -74.0, url: "https://maps.google.com/?q=joes", description: "NY",
});
state.planner = {
  trips: [{ id: "t1", name: "USA", days: [{ day: 1, date: "2026-09-17", items: [{ id: "i1", name: "Joe's Pizza" }] }], updatedAt: "2026-09-01T00:00:00.000Z" }],
  activeTripId: "t1",
  view: "trip",
  activeDayNum: 3,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const compact = Store.compactUserData(state);
assert(compact.v === 2, "compact v2");
assert(compact.userPlaces.length === 1, `userPlaces ${compact.userPlaces.length}`);
assert(compact.userPlaces[0].id === "p99", "imported place kept");
assert(!compact.userPlaces.some((p) => p.id === "p1"), "seed place not duplicated");
assert(compact.deletedPlaceIds.length === 0, "no false deletions");
assert(JSON.stringify(compact).length < 5000, "compact payload is small");

const packed = Store.packCloudPayload(state);
assert(!packed.places, "cloud payload has no seed places");
assert(packed.userPlaces.length === 1, "cloud userPlaces");
assert(packed.planner.trips.length === 1, "cloud planner trips");
assert(packed.planner.view == null, "cloud planner omits UI view");

const hydrated = Store.hydrateUserData(compact);
assert(hydrated.places.some((p) => p.id === "p1"), "hydrate keeps seed");
assert(hydrated.places.some((p) => p.id === "p99"), "hydrate keeps user place");
assert(hydrated.planner.trips[0].name === "USA", "hydrate planner");

const merged = Store.applyCloudPayload(state, packed);
assert(merged.planner.view === "trip", "merge keeps local view");
assert(merged.planner.activeDayNum === 3, "merge keeps local day");
assert(merged.places.some((p) => p.id === "p99"), "merge keeps user place");

Store.setUserEmail("test@example.com");
assert(Store.saveState(state) === true, "saveState ok");
const raw = storeMem[Object.keys(storeMem)[0]];
assert(raw && !raw.includes("Statue of Liberty"), "localStorage does not dump seed places");
assert(raw.includes("Joe's Pizza"), "localStorage keeps user place");

const loaded = Store.loadState();
assert(loaded.places.some((p) => p.id === "p1"), "load hydrates seed");
assert(loaded.places.some((p) => p.name === "Joe's Pizza"), "load hydrates user place");

process.exit(failed ? 1 : 0);
