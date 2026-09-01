#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");

const root = require("path").join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/import-planner.js`, "utf8"), ctx);
const { parseDelimited, parseItineraryPages } = ctx.window.WorldPlannerImport;

function lineFromTab(tab) {
  const parts = tab.split("\t");
  const cells = parts.map((str, i) => ({ x: i * 80, str }));
  return { cells, tab, line: parts.join(" ") };
}

function mockPage(tabs) {
  return { pageNum: 1, lines: tabs.map(lineFromTab) };
}

const splitCityPdf = `
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory
17.09.26\tDay 1\tNew\t05:15\tYork Landing In EWR Flight LY027\t\tTransportation / Flight
17.09.26\tDay 1\tNew\t\tYork Times Square\t\tSightseeing / Attraction
17.09.26\tDay 1\tNew\t19:00\tYork Junior's Restaurant & Bakery\t\tFood & Dining
`;

const partyUsa = `
Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory
17.09.26\tDay 1\tNew York\t05:15\tLanding In EWR Flight LY027\t\tTransportation / Flight
17.09.26\tDay 1\tNew York\t\tJoe's Pizza\t\tFood & Dining
`;

let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
}

const split = parseDelimited(splitCityPdf);
assert(split.rows[0].location === "New York", `split city: got location "${split.rows[0].location}"`);
assert(!split.rows[0].place.toLowerCase().startsWith("york"), `split city: place should not start with York: "${split.rows[0].place}"`);
assert(split.rows[1].place.includes("Times"), `split row 2 place: ${split.rows[1].place}`);
assert(split.rows[2].time === "19:00", `split row 3 time: ${split.rows[2].time}`);

const normal = parseDelimited(partyUsa);
assert(normal.rows[0].location === "New York", "normal location");
assert(normal.rows[1].place.includes("Joe"), "normal place");

const hdr = "Date\tDay\tLocation\tTime/Order\tPlace/Activity\tNotes\tCategory";
const row = (date, day, loc, time, place, notes, cat) =>
  [date, day, loc, time, place, notes, cat].join("\t");

const itineraryPages = [
  mockPage(["Party in the USA Trip Planner Total Days 39"]),
  mockPage([
    "New York Itinerary",
    hdr,
    row("17.09.26", "Day 1", "New York", "05:15", "Landing In EWR", "", "Transportation / Flight"),
    row("17.09.26", "Day 1", "New York", "", "Times Square", "", "Sightseeing / Attraction"),
  ]),
  mockPage([
    "Niagara Falls Itinerary",
    hdr,
    row("20.09.26", "Day 4", "Niagara Falls", "10:00", "Maid of the Mist", "", "Sightseeing / Attraction"),
    row("20.09.26", "Day 4", "Niagara Falls", "14:00", "Niagara Falls State Park", "", "Sightseeing / Attraction"),
  ]),
  mockPage([
    "Washington Itinerary",
    hdr,
    row("22.09.26", "Day 6", "Washington", "09:00", "National Mall", "", "Sightseeing / Attraction"),
    row("22.09.26", "Day 6", "Washington", "13:00", "Smithsonian Museum", "", "Sightseeing / Attraction"),
  ]),
];

const itinerary = parseItineraryPages(itineraryPages, "Party USA");
assert(itinerary.rows.length >= 6, `itinerary rows: got ${itinerary.rows.length}`);
assert(itinerary.rows.some((r) => r.place.includes("Times Square")), "NY Times Square");
assert(itinerary.rows.some((r) => r.location === "Niagara Falls"), "Niagara location");
assert(itinerary.rows.some((r) => r.place.includes("Smithsonian")), "Washington Smithsonian");
assert(!itinerary.rows.some((r) => /total days/i.test(r.place || "")), "no overview junk");

process.exit(failed ? 1 : 0);
