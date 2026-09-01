#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");

const root = require("path").join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/import-planner.js`, "utf8"), ctx);
const { parseDelimited, parseItineraryPages, buildTripDraft, locationCountryHint, cityFromItineraryLine } = ctx.window.WorldPlannerImport;

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

assert(cityFromItineraryLine("Istanbul Itinerary") === "Istanbul", `cityFromItineraryLine Istanbul: ${cityFromItineraryLine("Istanbul Itinerary")}`);
assert(cityFromItineraryLine("Cappadocia Itinerary") === "Cappadocia", `cityFromItineraryLine Cappadocia: ${cityFromItineraryLine("Cappadocia Itinerary")}`);
assert(locationCountryHint("Istanbul", "Turkey trip") === "Turkey", "Istanbul → Turkey");
assert(locationCountryHint("Cappadocia", "") === "Turkey", "Cappadocia → Turkey");
assert(locationCountryHint("Goreme", "Türkiye") === "Turkey", "Goreme + Türkiye → Turkey");

const placeholderCsv = [
  hdr,
  row("01.10.26", "Day 1", "Istanbul", "09:00", "Hagia Sophia", "", "Sightseeing / Attraction"),
  row("01.10.26", "Day 1", "Istanbul", "", "", "", ""),
  row("01.10.26", "Day 1", "Istanbul", "14:00", "Grand Bazaar", "https://maps.google.com/?q=Grand+Bazaar", "Shopping"),
].join("\n");
const placeholders = parseDelimited(placeholderCsv);
assert(placeholders.rows.length >= 3, `placeholder csv rows: ${placeholders.rows.length}`);
assert(placeholders.rows.some((r) => r.placeholder || !r.place), "empty placeholder row kept");
assert(placeholders.rows.some((r) => /Hagia/i.test(r.place)), "Hagia Sophia kept");
assert(placeholders.rows.some((r) => r.url && /maps\.google/.test(r.url)), "maps url kept");

const turkeyPages = [
  mockPage(["Turkey Trip Planner Total Days 12"]),
  mockPage([
    "Istanbul Itinerary",
    hdr,
    row("01.10.26", "Day 1", "Istanbul", "09:00", "Hagia Sophia", "", "Sightseeing / Attraction"),
    row("01.10.26", "Day 1", "Istanbul", "11:00", "Blue Mosque", "", "Sightseeing / Attraction"),
  ]),
  mockPage([
    row("01.10.26", "Day 1", "Istanbul", "", "", "", ""),
    row("01.10.26", "Day 1", "Istanbul", "14:00", "Grand Bazaar", "https://maps.google.com/?q=Grand+Bazaar", "Shopping"),
  ]),
  mockPage([
    "Cappadocia Itinerary",
    hdr,
    row("01.10.26", "Day 1", "Cappadocia", "19:00", "Sunset viewpoint", "", "Sightseeing / Attraction"),
    row("02.10.26", "Day 2", "Cappadocia", "06:00", "Hot air balloon", "", "Sightseeing / Attraction"),
  ]),
];
const turkey = parseItineraryPages(turkeyPages, "Turkey Trip");
assert(turkey.rows.length >= 5, `turkey itinerary rows: ${turkey.rows.length}`);
assert(turkey.rows.some((r) => r.location === "Istanbul" && /Hagia/i.test(r.place)), "Istanbul Hagia");
assert(turkey.rows.some((r) => r.location === "Istanbul" && /Grand Bazaar/i.test(r.place)), "continuation page Grand Bazaar");
assert(turkey.rows.some((r) => r.placeholder || (r.location === "Istanbul" && !r.place)), "Istanbul empty placeholder from continuation page");
assert(turkey.rows.some((r) => r.location === "Cappadocia" && /balloon/i.test(r.place)), "Cappadocia balloon");

const draft = buildTripDraft(turkey);
assert(draft.segments.some((s) => s.city === "Istanbul" && s.countryName === "Turkey"), "Istanbul segment in Turkey");
assert(draft.segments.some((s) => s.city === "Cappadocia" && s.countryName === "Turkey"), "Cappadocia segment in Turkey");
const day1 = draft.dayPlans.find((d) => d.date === "2026-10-01");
assert(!!day1, "day 1 by date");
assert(day1.locations.includes("Istanbul") && day1.locations.includes("Cappadocia"), `day 1 cities: ${day1.location}`);
assert(day1.rows.length >= 5, `day 1 merged rows: ${day1.rows.length}`);
assert(day1.rows.some((r) => r.placeholder || !r.place), "merged day keeps empty placeholders");
assert(draft.dayPlans.some((d) => d.date === "2026-10-02"), "day 2 separate date");

process.exit(failed ? 1 : 0);
