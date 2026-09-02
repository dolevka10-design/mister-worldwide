#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");

const root = require("path").join(__dirname, "..");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(`${root}/js/categorize.js`, "utf8"), ctx);
vm.runInContext(fs.readFileSync(`${root}/js/import-planner.js`, "utf8"), ctx);
const { parseDelimited, parseItineraryPages, buildTripDraft, locationCountryHint, cityFromItineraryLine, describePdfPages, parsedFromPages, buildExportPack, exportCsv, exportPdf, exportPdfPages, exportXlsxSheets, zipItineraryPaths } = ctx.window.WorldPlannerImport;

let pageSeq = 0;
function lineFromTab(tab) {
  const parts = tab.split("\t");
  const cells = parts.map((str, i) => ({ x: i * 80, str }));
  return { cells, tab, line: parts.join(" ") };
}

function mockPage(tabs, pageNum) {
  pageSeq += 1;
  return { pageNum: pageNum || pageSeq, lines: tabs.map(lineFromTab) };
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

const pickerPages = [
  mockPage(["Party in the USA Trip Planner Total Days 39"]),
  mockPage([
    "New York Itinerary",
    hdr,
    row("17.09.26", "Day 1", "New York", "05:15", "Landing In EWR", "", "Transportation / Flight"),
    row("17.09.26", "Day 1", "New York", "", "Times Square", "", "Sightseeing / Attraction"),
  ]),
  mockPage([
    "Getting Around Washington DC",
    "Ride the E train from Penn Station to Jamaica then AirTrain to JFK. PATH to Newark Penn Station. Port Authority bus. Queens-bound E train.",
    row("25.09.26", "Day 9", "Washington DC Ride the E train from Penn Station to Jamaica then AirTrain to JFK PATH to Newark", "09:00", "Transit notes", "", "Transportation"),
  ]),
  mockPage([
    "Washington Itinerary",
    hdr,
    row("22.09.26", "Day 6", "Washington", "09:00", "National Mall", "", "Sightseeing / Attraction"),
  ]),
];
const pack = describePdfPages(pickerPages, "Party USA");
assert(pack.pages.length === 4, `picker pages: ${pack.pages.length}`);
const ny = pack.pages.find((p) => /new york/i.test(p.title));
const dc = pack.pages.find((p) => /washington itinerary/i.test(p.title));
const ride = pack.pages.find((p) => /getting around/i.test(p.title) || p.kind === "guide");
const cover = pack.pages.find((p) => p.kind === "overview" || /cover|overview/i.test(p.title));
assert(ny?.suggested, "NY itinerary suggested");
assert(dc?.suggested, "Washington itinerary suggested");
assert(ride && !ride.suggested, `getting around should not be suggested: ${ride && ride.kind}`);
if (cover) assert(!cover.suggested, "cover not suggested");
const picked = parsedFromPages(pack, [ny.id, dc.id]);
assert(picked.rows.some((r) => /Times Square/i.test(r.place)), "picked NY");
assert(picked.rows.some((r) => /National Mall/i.test(r.place)), "picked DC");
assert(!picked.rows.some((r) => /AirTrain/i.test(r.place + r.location)), "did not import getting-around blob");
const onlyItin = parsedFromPages(pack, pack.pages.filter((p) => p.suggested).map((p) => p.id));
assert(!onlyItin.rows.some((r) => /AirTrain|Penn Station|Getting Around/i.test(`${r.place} ${r.location}`)), "suggested pages skip transit guide");
let threw = false;
try { parsedFromPages(pack, []); } catch { threw = true; }
assert(threw, "empty selection throws");

const exportRows = [
  { date: "2026-09-17", day: 1, location: "New York", time: "05:15", place: "Times Square", notes: "", category: "Sightseeing / Attraction", url: "https://maps.google.com/?q=Times+Square", _ord: 0 },
  { date: "17.09.26", day: "Day 1", location: "New York", time: "", place: "Joe's Pizza", notes: "slice", category: "Food & Dining", url: "", _ord: 1 },
  { date: "22.09.26", day: 6, location: "Washington", time: "09:00", place: "National Mall", notes: "", category: "Sightseeing / Attraction", url: "", _ord: 2 },
  { date: "22.09.26", day: 6, location: "Washington", time: "", place: "", notes: "", category: "Places", url: "https://maps.google.com/?q=—", placeholder: true, _ord: 3 },
  { date: "30.09.26", day: 14, location: "New York", time: "", place: "", notes: "", category: "Places", url: "", placeholder: true, _ord: 4 },
];
const exportPack = buildExportPack({
  title: "Party USA",
  dayCount: 14,
  rows: exportRows,
});
assert(exportPack.rows.length === 3, `export keeps real activities only: ${exportPack.rows.length}`);
assert(exportPack.rows[0].place.includes("Times Square"), "timeline first row");
assert(exportPack.rows[1].place.includes("Joe"), "timeline second row");
assert(exportPack.rows[2].place.includes("National Mall"), "timeline third row");
assert(!exportPack.pages, "flat export has no pages");

const csvOut = exportCsv(exportPack);
assert(!/Itinerary\nDate/.test(csvOut), "csv has no repeated city headers");
assert((csvOut.match(/Times Square/g) || []).length === 1, "csv has one Times Square row");
assert((csvOut.match(/Joe's Pizza/g) || []).length === 1, "csv has one Joe row");
const csvBack = parseDelimited(csvOut);
assert(csvBack.rows.some((r) => /Times Square/i.test(r.place) && r.location === "New York"), "csv round-trip Times Square");
assert(csvBack.rows.some((r) => /National Mall/i.test(r.place) && r.location === "Washington"), "csv round-trip National Mall");
assert(!csvBack.rows.some((r) => /^places$/i.test(r.category) && !r.place), "csv skips empty Places rows");

const pdfBytes = exportPdf(exportPack);
const pdfHead = String.fromCharCode(...pdfBytes.slice(0, 8));
assert(pdfHead.startsWith("%PDF-"), `pdf magic: ${pdfHead}`);
const pdfText = Array.from(pdfBytes).map((b) => String.fromCharCode(b)).join("");
assert(pdfText.includes("Times Square"), "pdf contains activity");
assert(!pdfText.includes("Niagara Falls Itinerary"), "pdf has no per-city headers");

const sheets = exportXlsxSheets(exportPack);
assert(sheets.length === 1, "single itinerary sheet");
assert(sheets[0].aoa.some((row) => row.includes("Times Square")), "xlsx row has Times Square");

assert(zipItineraryPaths(["trip.csv", "trip.xlsx", "trip.pdf"]).join() === "trip.pdf", "export zip prefers pdf pages");
assert(zipItineraryPaths(["a.csv", "b.csv"]).length === 2, "plain csv zip keeps both");

process.exit(failed ? 1 : 0);
