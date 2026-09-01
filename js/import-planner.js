/**
 * Import Excel / PDF / CSV trip planners (Party-in-the-USA style).
 * Columns: Date, Day, Location, Time/Order, Place/Activity, Notes, Category, Google Maps Link
 */
window.WorldPlannerImport = (() => {
  function norm(s) { return String(s || "").trim(); }
  function slug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  const CATEGORY_LABELS = [
    "Transportation / Flight", "Transportation", "Food & Dining", "Sightseeing / Attraction", "Sightseeing",
    "Coffee & Snacks", "Accommodation", "Nightlife / Drinks", "Nightlife", "Guide / Info", "Guide", "Shopping", "Map",
  ];

  const HEADER_CELL = /^(date|day|location|city|time\/?order|time|place\/?activity|place|activity|notes|category|google maps link|google maps|map|order)$/i;

  const COUNTRY_NAMES = /^(united states|usa|u\.s\.a\.|united kingdom|uk|canada|australia|france|germany|italy|spain|japan)$/i;

  function cleanCity(name) {
    const n = norm(name);
    if (!n || HEADER_CELL.test(n) || /^place\/?activity$/i.test(n)) return "";
    if (COUNTRY_NAMES.test(n)) return "";
    return n;
  }

  function isCategoryLabel(s) {
    const n = norm(s).toLowerCase();
    return CATEGORY_LABELS.some((l) => l.toLowerCase() === n);
  }

  function isJunkRow(row) {
    const p = norm(row.place);
    const l = norm(row.location);
    const n = norm(row.notes);
    if (!p && !l) return true;
    if (!p && l) return false;
    if (HEADER_CELL.test(p) || HEADER_CELL.test(l) || HEADER_CELL.test(n)) return true;
    if (/^place\/?activity$/i.test(p) || /^place\/?activity$/i.test(l)) return true;
    if (isCategoryLabel(p) && (!n || /^activity$/i.test(n) || HEADER_CELL.test(n)) && !row.time && !row.url) return true;
    if (isCategoryLabel(p) && !row.notes && !row.time && !row.url) return true;
    if (/^activity$/i.test(p)) return true;
    if (/^notes$/i.test(p) || /^places$/i.test(p)) return true;
    return false;
  }

  function parsePlannerDate(s) {
    const t = norm(s).replace(/\s+/g, "");
    if (!t) return null;
    let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : null;
  }

  function parseDayNum(s) {
    const m = String(s || "").match(/day\s*(\d+)/i);
    if (m) return Number(m[1]);
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 && n < 400 ? n : null;
  }

  function headerKey(h) {
    const n = String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (/^date/.test(n)) return "date";
    if (/^day/.test(n)) return "day";
    if (/location|city|stop/.test(n)) return "location";
    if (/time|order/.test(n)) return "time";
    if (/place|activity|what/.test(n)) return "place";
    if (/note/.test(n)) return "notes";
    if (/categor/.test(n)) return "category";
    if (/map|url|link/.test(n)) return "url";
    return n.replace(/\s+/g, "_") || "col";
  }

  function isUrl(s) {
    return /^https?:\/\//i.test(norm(s));
  }

  function extractUrl(s) {
    const m = String(s || "").match(/https?:\/\/[^\s)>\]]+/i);
    return m ? m[0].replace(/[),.;]+$/g, "") : "";
  }

  function looksLikeHeader(cells) {
    const j = cells.map((c) => String(c || "").toLowerCase()).join(" ");
    return /date/.test(j) && (/place|activity|location/.test(j) || /day/.test(j));
  }

  function rowFromCells(keys, cells) {
    const row = {};
    keys.forEach((k, i) => { row[k] = norm(cells[i]); });
    return row;
  }

  function isTimeOnly(s) {
    return /^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?$/.test(norm(s));
  }

  function isGuideTitle(s) {
    return /\bguide\b/i.test(s) && !/\brestaurant|cafe|hotel\b/i.test(s);
  }

  function escapeRe(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const CITY_SUFFIX = {
    new: "York",
    los: "Angeles",
    san: "Francisco",
    las: "Vegas",
    niagara: "Falls",
    salt: "Lake City",
    kansas: "City",
    oklahoma: "City",
    tel: "Aviv",
    rio: "de Janeiro",
    mexico: "City",
    hong: "Kong",
    buenos: "Aires",
  };

  function repairSplitCity(location, place) {
    let loc = norm(location);
    let p = norm(place);
    if (!loc) return { location: loc, place: p };

    const words = loc.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      const key = words[0].toLowerCase();
      const suffix = CITY_SUFFIX[key];
      if (suffix && p.toLowerCase().startsWith(suffix.toLowerCase())) {
        return { location: `${words[0]} ${suffix}`, place: p.slice(suffix.length).trim() };
      }
      if (key === "new" && /^york\b/i.test(p)) {
        return { location: "New York", place: p.replace(/^york\s*/i, "").trim() };
      }
    }
    return { location: loc, place: p };
  }

  function cleanPlaceName(place, { location, time, category } = {}) {
    let p = norm(place);
    if (!p) return "";

    for (const lab of CATEGORY_LABELS) {
      const re = new RegExp(`\\s+${escapeRe(lab)}\\s*$`, "i");
      if (re.test(p)) {
        p = p.replace(re, "").trim();
        if (!category) category = lab;
      }
    }

    if (location && location !== "Other") {
      const loc = location.trim();
      if (p.toLowerCase().startsWith(`${loc.toLowerCase()} `)) {
        p = p.slice(loc.length).trim();
      } else if (p.toLowerCase() === loc.toLowerCase()) {
        p = "";
      }
    }

    if (time && isTimeOnly(time)) {
      p = p.replace(new RegExp(`^${escapeRe(time)}\\s*`, "i"), "").trim();
      p = p.replace(new RegExp(`\\b${escapeRe(time)}\\b`, "gi"), " ").replace(/\s+/g, " ").trim();
    }

    for (const lab of CATEGORY_LABELS) {
      const re = new RegExp(`\\s+${escapeRe(lab)}\\s*$`, "i");
      p = p.replace(re, "").trim();
    }

    return p.replace(/\s+Map\s*$/i, "").trim();
  }

  function finalizeActivityFields({ place, location, time, notes, category, url }) {
    let cat = norm(category);
    let note = norm(notes);
    let t = isTimeOnly(time) ? norm(time) : "";
    const repaired = repairSplitCity(location, place);
    let name = cleanPlaceName(repaired.place, { location: repaired.location, time: t, category: cat });

    if (!name && note && !isCategoryLabel(note)) {
      name = cleanPlaceName(note, { location: repaired.location, time: t, category: cat });
      note = "";
    }
    if (!cat && place && isCategoryLabel(place)) cat = place;
    if (isCategoryLabel(name)) return null;
    if (!name) {
      if (repaired.location) {
        return {
          place: "",
          location: repaired.location,
          time: t,
          notes: note,
          category: cat,
          url,
          placeholder: true,
        };
      }
      return null;
    }

    return {
      place: name,
      location: cleanCity(repaired.location) || "Other",
      time: t,
      notes: note,
      category: cat,
      url: /^https?:\/\//i.test(url) ? url : "",
    };
  }

  function normalizeRow(row, fallbackLocation, ctx = {}) {
    const rawDate = norm(row.date);
    if (rawDate && !parsePlannerDate(rawDate) && (isCategoryLabel(rawDate) || HEADER_CELL.test(rawDate))) {
      return null;
    }
    let date = parsePlannerDate(row.date) || ctx.date || null;
    let day = parseDayNum(row.day) ?? ctx.day ?? null;
    let location = cleanCity(row.location) || cleanCity(ctx.location) || cleanCity(fallbackLocation) || "";
    let time = norm(row.time);
    let place = norm(row.place);
    let notes = norm(row.notes);
    let category = norm(row.category);
    let url = extractUrl(row.url) || extractUrl(place) || extractUrl(notes) || extractUrl(row.col_extra || "");

    if (HEADER_CELL.test(notes)) notes = "";
    if (HEADER_CELL.test(category)) category = "";

    if (isCategoryLabel(place) && !isCategoryLabel(category)) category = category || place;
    if (isCategoryLabel(place) && (notes || time)) {
      category = category || place;
      const nextPlace = notes && !HEADER_CELL.test(notes) && !/^activity$/i.test(notes) ? notes : time;
      place = isTimeOnly(nextPlace) ? "" : (nextPlace || "");
      if (isTimeOnly(time)) { /* keep */ } else if (isTimeOnly(notes)) time = notes;
      notes = "";
    }
    if (!place && row.col_extra && !isCategoryLabel(row.col_extra) && !HEADER_CELL.test(row.col_extra)) {
      place = norm(row.col_extra);
    }
    if (isTimeOnly(place) && !time) {
      time = place;
      place = "";
    }
    if (!place && isTimeOnly(notes)) {
      time = time || notes;
      notes = "";
    }
    if (!place && notes && !isTimeOnly(notes) && !isCategoryLabel(notes)) {
      place = notes;
      notes = "";
    }

    if (url && place.includes(url)) place = place.replace(url, "").trim();
    place = place.replace(/\s+Map\s*$/i, "").trim();

    const hasContext = !!(date || location || day);
    if (!place && !notes && !time && !hasContext) return null;
    if (!place && !location && !date) return null;
    if (place && HEADER_CELL.test(place)) return null;
    if (location && HEADER_CELL.test(location)) return null;
    if (isJunkRow({ place, location, notes, time, category, url }) && place) return null;
    if (place && isCategoryLabel(place) && !hasContext) return null;

    location = cleanCity(location) || cleanCity(ctx.location) || cleanCity(fallbackLocation) || (hasContext ? "Other" : "");

    if (place && (isGuideTitle(place) || /^guide\s*\/\s*info$/i.test(category))) {
      return {
        type: "guide",
        title: place,
        body: notes || "",
        city: location || ctx.location || fallbackLocation || "",
      };
    }

    const finalized = finalizeActivityFields({ place, location, time, notes, category, url });
    if (!finalized) return null;

    return {
      type: "activity",
      date,
      day,
      location: (finalized.location || location || "Other").replace(/\s+/g, " "),
      time: finalized.time,
      place: finalized.place,
      notes: finalized.notes,
      category: finalized.category,
      url: finalized.url,
      placeholder: !!finalized.placeholder,
    };
  }

  function parseDelimited(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) return { rows: [], guides: [], title: "" };
    const headerLine = lines.find((l) => looksLikeHeader(l.split("\t")) || looksLikeHeader(l.split(",")) || looksLikeHeader(l.split(";")));
    const delim = headerLine?.includes("\t") ? "\t" : (headerLine?.includes(";") && (headerLine.split(";").length > headerLine.split(",").length) ? ";" : (headerLine?.includes(",") ? "," : "\t"));
    const split = (line) => {
      if (delim === "\t") return line.split("\t").map((c) => c.trim());
      const out = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; }
          else q = !q;
        } else if (ch === delim && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((c) => c.trim());
    };

    let keys = null;
    let fallbackLocation = "";
    let title = "";
    const rows = [];
    const guides = [];
    let guideBuf = null;
    let ctx = { date: null, day: null, location: "" };

    for (const line of lines) {
      if (/itinerary/i.test(line) && !line.includes(delim === "\t" ? "\t" : ",")) {
        const loc = line.replace(/itinerary/i, "").trim();
        if (loc) { fallbackLocation = loc; ctx.location = loc; }
        if (!title) title = line.trim();
        continue;
      }
      if (/^usa trip planner/i.test(line) && !title) title = "USA Trip";
      const cells = split(line);
      if (!keys && looksLikeHeader(cells)) {
        keys = cells.map(headerKey);
        continue;
      }
      if (/^\d+\.\s/.test(line) && /route|train|bus|airtrain|subway/i.test(line)) {
        if (guideBuf) guides.push(guideBuf);
        guideBuf = { title: line.replace(/^\d+\.\s*/, "").trim(), body: "", city: fallbackLocation };
        continue;
      }
      if (guideBuf && !keys) {
        guideBuf.body += (guideBuf.body ? "\n" : "") + line;
        continue;
      }
      if (!keys) continue;
      const raw = rowFromCells(keys, cells);
      const row = normalizeRow(raw, fallbackLocation, ctx);
      if (!row) continue;
      if (row.type === "guide") {
        guides.push({ title: row.title, body: row.body, city: row.city || fallbackLocation });
        continue;
      }
      if (row.date) ctx.date = row.date;
      if (row.day) ctx.day = row.day;
      if (row.location) { fallbackLocation = row.location; ctx.location = row.location; }
      rows.push(row);
    }
    if (guideBuf) guides.push(guideBuf);
    return { rows, guides, title };
  }

  function parseXlsx(buf) {
    if (typeof XLSX === "undefined") throw new Error("Excel library not loaded");
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const rows = [];
    const guides = [];
    let title = wb.SheetNames[0] || "Imported trip";
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      if (!json.length) continue;
      let keys = null;
      let fallbackLocation = /overview|planner|total/i.test(name) ? "" : name.replace(/itinerary/i, "").trim();
      let ctx = { date: null, day: null, location: fallbackLocation };
      if (/guide|transit|transport|getting/i.test(name)) {
        const text = json.map((r) => r.filter(Boolean).join(" ")).join("\n");
        if (text.trim()) guides.push({ title: name, body: text.trim(), city: fallbackLocation });
        continue;
      }
      for (const cells of json) {
        const flat = cells.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : norm(c)));
        if (!keys && looksLikeHeader(flat)) {
          keys = flat.map(headerKey);
          continue;
        }
        if (!keys) {
          const joined = flat.join(" ");
          if (/itinerary/i.test(joined)) fallbackLocation = joined.replace(/itinerary/i, "").trim() || fallbackLocation;
          if (/trip planner/i.test(joined) && !/date/i.test(joined)) title = flat.filter(Boolean)[0] || title;
          continue;
        }
        const raw = rowFromCells(keys, flat);
        if (raw.date && /^\d{1,2}[./]\d{1,2}/.test(raw.date) === false && /^\d{4}-\d{2}-\d{2}/.test(raw.date) === false) {
          const serial = Number(raw.date);
          if (Number.isFinite(serial) && serial > 20000) {
            const d = XLSX.SSF.parse_date_code(serial);
            if (d) raw.date = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
          }
        }
        const row = normalizeRow(raw, fallbackLocation, ctx);
        if (!row) continue;
        if (row.type === "guide") {
          guides.push({ title: row.title, body: row.body, city: row.city || fallbackLocation });
          continue;
        }
        if (row.date) ctx.date = row.date;
        if (row.day) ctx.day = row.day;
        if (row.location) { fallbackLocation = row.location; ctx.location = row.location; }
        rows.push(row);
      }
    }
    return { rows, guides, title: String(title).replace(/itinerary/i, "").trim() || "Imported trip" };
  }

  function detectColumns(cells) {
    const cols = cells
      .filter((c) => c.str && !/^\s*$/.test(c.str))
      .sort((a, b) => a.x - b.x);
    if (!cols.length) return null;
    const headerText = cols.map((c) => c.str.toLowerCase()).join(" ");
    if (!/date/.test(headerText) || !/place|activity|location|day/.test(headerText)) return null;
    return cols.map((c, i) => ({
      key: headerKey(c.str),
      x0: i === 0 ? 0 : (cols[i - 1].x + c.x) / 2,
      x1: i === cols.length - 1 ? 9999 : (c.x + cols[i + 1].x) / 2,
    }));
  }

  function cellForColumn(cells, col) {
    const sorted = [...cells].sort((a, b) => a.x - b.x);
    const inCol = sorted.filter((c) => c.x >= col.x0 && c.x < col.x1);
    if (!inCol.length) return "";
    const parts = inCol.map((c) => c.str);
    const last = inCol[inCol.length - 1];
    const next = sorted.find((c) => c.x >= col.x1 && c.x - last.x < 14);
    if (next && !sorted.some((c) => c.x >= col.x0 && c.x < col.x1 && c !== next && c.str === next.str)) {
      const gap = next.x - last.x;
      if (gap < 14 && parts.length < 3) parts.push(next.str);
    }
    return parts.join(" ").trim();
  }

  function rowFromPdfColumns(cells, columns, fallbackLocation, ctx) {
    const raw = {};
    for (const col of columns) raw[col.key] = norm(cellForColumn(cells, col));
    const extras = cells
      .filter((c) => !columns.some((col) => c.x >= col.x0 && c.x < col.x1))
      .map((c) => c.str)
      .join(" ");
    if (extras) raw.col_extra = extras;
    return normalizeRow(raw, fallbackLocation, ctx);
  }

  async function extractPdfPages(pdf) {
    const pages = [];
    let title = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const buckets = [];
      for (const it of content.items || []) {
        const str = norm(it.str);
        if (!str) continue;
        const x = it.transform?.[4] ?? 0;
        const y = Math.round((it.transform?.[5] ?? 0) / 2) * 2;
        let row = buckets.find((b) => Math.abs(b.y - y) < 4);
        if (!row) { row = { y, cells: [] }; buckets.push(row); }
        row.cells.push({ x, str });
      }
      buckets.sort((a, b) => b.y - a.y);
      const lines = [];
      for (const row of buckets) {
        row.cells.sort((a, b) => a.x - b.x);
        const line = row.cells.map((c) => c.str).join(" ");
        if (/trip planner/i.test(line) && !title) title = line.replace(/total days.*/i, "").trim();
        lines.push({ cells: row.cells, tab: row.cells.map((c) => c.str).join("\t"), line });
      }
      pages.push({ pageNum: p, lines });
    }
    return { pages, title };
  }

  async function extractPdfLines(pdf) {
    const { pages, title } = await extractPdfPages(pdf);
    const allLines = pages.flatMap((pg) => pg.lines);
    return { allLines, pages, title };
  }

  const ITINERARY_CITY = /new\s*york|niagara\s*falls|washington|boston|chicago|philadelphia|los\s*angeles|san\s*francisco|las\s*vegas|miami|seattle|austin|denver|portland|orlando|atlanta|dallas|houston|new\s*orleans|san\s*diego|vancouver|toronto|montreal|london|paris|rome|barcelona|amsterdam|berlin|tokyo|sydney|melbourne|buenos\s*aires|istanbul|cappadocia|antalya|ankara|izmir|ephesus|pamukkale|bodrum|fethiye|göreme|goreme|kusadasi|trabzon|athens|santorini|mykonos|tel\s*aviv|jerusalem|amman|petra|cairo|dubai|bangkok|singapore/i;

  function cityFromItineraryLine(line) {
    const raw = String(line || "")
      .replace(/trip\s*planner/gi, " ")
      .replace(/itinerary/gi, " ")
      .replace(/total\s*days.*/i, " ")
      .replace(/\s+/g, " ")
      .trim();
    const known = [
      ["new york", "New York"],
      ["niagara falls", "Niagara Falls"],
      ["washington", "Washington"],
      ["los angeles", "Los Angeles"],
      ["san francisco", "San Francisco"],
      ["las vegas", "Las Vegas"],
      ["new orleans", "New Orleans"],
      ["san diego", "San Diego"],
      ["buenos aires", "Buenos Aires"],
      ["tel aviv", "Tel Aviv"],
      ["kusadasi", "Kusadasi"],
      ["göreme", "Goreme"],
      ["goreme", "Goreme"],
    ];
    const lower = raw.toLowerCase();
    for (const [pat, name] of known) {
      if (lower.includes(pat)) return name;
    }
    const m = raw.match(ITINERARY_CITY);
    if (m) {
      return m[0].replace(/\s+/g, " ").replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
    if (raw && raw.split(/\s+/).length <= 5 && !HEADER_CELL.test(raw) && !/^\d/.test(raw)) {
      return cleanCity(raw) || "";
    }
    return cleanCity(raw) || "";
  }

  function isOverviewPage(page) {
    const text = page.lines.map((l) => l.line).join(" ");
    const dateRows = page.lines.filter((l) => /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(l.line)).length;
    const hasHeader = page.lines.some((l) => looksLikeHeader(l.cells.map((c) => c.str)));
    const hasItin = /itinerary/i.test(text);
    if (hasHeader || hasItin || dateRows >= 1) return false;
    return /total\s*days|table\s*of\s*contents|cover\s*page|getting\s*around\s*guide|party\s*in\s*the\s*usa\s*trip\s*planner/i.test(text);
  }

  function isItineraryPage(page) {
    const text = page.lines.map((l) => l.line).join(" ");
    if (/itinerary/i.test(text)) return true;
    if (page.lines.some((l) => looksLikeHeader(l.cells.map((c) => c.str)))) return true;
    const dateRows = page.lines.filter((l) =>
      /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(l.line) && l.cells.length >= 2
    ).length;
    return dateRows >= 1;
  }

  function isSkipPage(page) {
    return isOverviewPage(page);
  }

  function parseLinesChunk(lines, fallbackLocation, titleOut, inheritedColumns = null, inheritedCtx = null) {
    const rows = [];
    const guides = [];
    let columns = inheritedColumns;
    let location = fallbackLocation || inheritedCtx?.location || "";
    let ctx = {
      date: inheritedCtx?.date || null,
      day: inheritedCtx?.day || null,
      location,
    };
    for (const { cells, line } of lines) {
      if (/trip planner/i.test(line) && !titleOut.value) titleOut.value = line.replace(/total days.*/i, "").trim();
      if (/itinerary/i.test(line) && cells.length <= 5) {
        const city = cityFromItineraryLine(line);
        if (city) {
          location = city;
          ctx.location = location;
        }
        continue;
      }
      if (looksLikeHeader(cells.map((c) => c.str))) {
        const detected = detectColumns(cells);
        if (detected) { columns = detected; continue; }
      }
      if (!columns) {
        const detected = detectColumns(cells);
        if (detected) { columns = detected; continue; }
      }
      if (!columns) continue;
      const parsed = rowFromPdfColumns(cells, columns, location, ctx);
      if (!parsed) continue;
      if (parsed.type === "guide") {
        guides.push({ title: parsed.title, body: parsed.body, city: parsed.city || location });
        continue;
      }
      if (parsed.date) ctx.date = parsed.date;
      if (parsed.day) ctx.day = parsed.day;
      if (parsed.location) { location = parsed.location; ctx.location = parsed.location; }
      rows.push(parsed);
    }
    return { rows, guides, columns, location, ctx };
  }

  function parseItineraryPages(pages, docTitle) {
    const rows = [];
    const guides = [];
    const titleOut = { value: docTitle || "" };
    let sharedColumns = null;
    let lastLocation = "";
    let sharedCtx = { date: null, day: null, location: "" };
    for (const page of pages) {
      if (isSkipPage(page)) continue;
      const header = page.lines.find((l) => /itinerary/i.test(l.line) && l.cells.length <= 5);
      if (header) lastLocation = cityFromItineraryLine(header.line) || lastLocation;
      if (!isItineraryPage(page) && !sharedColumns) continue;
      const chunk = parseLinesChunk(page.lines, lastLocation, titleOut, sharedColumns, sharedCtx);
      if (chunk.columns) sharedColumns = chunk.columns;
      if (chunk.location) lastLocation = chunk.location;
      if (chunk.ctx) sharedCtx = { date: chunk.ctx.date || null, day: chunk.ctx.day || null, location: lastLocation };
      rows.push(...chunk.rows);
      guides.push(...chunk.guides);
    }
    return { rows, guides, title: titleOut.value || docTitle || "Imported trip" };
  }

  function clusterCellsToColumns(cells) {
    if (!cells?.length) return null;
    const sorted = [...cells].sort((a, b) => a.x - b.x);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push({ i, gap: sorted[i].x - sorted[i - 1].x });
    gaps.sort((a, b) => b.gap - a.gap);
    const splitAt = gaps.filter((g) => g.gap > 18).map((g) => g.i).sort((a, b) => a - b);
    if (!splitAt.length && sorted.length < 4) return null;
    const keys = ["date", "day", "location", "time", "place", "notes", "category", "url"];
    const parts = [];
    let start = 0;
    for (const idx of splitAt) {
      parts.push(sorted.slice(start, idx).map((c) => c.str).join(" ").trim());
      start = idx;
    }
    parts.push(sorted.slice(start).map((c) => c.str).join(" ").trim());
    if (parts.length < 4) return null;
    const raw = {};
    keys.forEach((k, i) => { raw[k] = parts[i] || ""; });
    return raw;
  }

  function parsePdfCellRows(allLines, fallbackLocation, ctxIn = {}) {
    const rows = [];
    const guides = [];
    const ctx = { ...ctxIn };
    let location = fallbackLocation || ctx.location || "";
    for (const { cells, line } of allLines) {
      if (/itinerary/i.test(line) && cells.length <= 3) {
        location = line.replace(/itinerary/i, "").trim() || location;
        ctx.location = location;
        continue;
      }
      if (looksLikeHeader(cells.map((c) => c.str))) continue;
      const raw = clusterCellsToColumns(cells);
      if (!raw) continue;
      const row = normalizeRow(raw, location, ctx);
      if (!row) continue;
      if (row.type === "guide") {
        guides.push({ title: row.title, body: row.body, city: row.city || location });
        continue;
      }
      if (row.date) ctx.date = row.date;
      if (row.day) ctx.day = row.day;
      if (row.location) { location = row.location; ctx.location = row.location; }
      rows.push(row);
    }
    return { rows, guides };
  }

  function rowQuality(r) {
    if (!r || r.type === "guide") return 0;
    let score = 0;
    if (r.date) score += 5;
    if (r.day) score += 2;
    if (r.location && cleanCity(r.location)) score += 5;
    if (r.time && isTimeOnly(r.time)) score += 4;
    if (r.category && isCategoryLabel(r.category)) score += 6;
    if (r.place && !isCategoryLabel(r.place)) score += 12;
    if (r.url) score += 3;
    if (r.place && isCategoryLabel(r.place)) score -= 25;
    if (r.place && /\b(transportation|food & dining|sightseeing|nightlife|coffee & snacks)\b/i.test(r.place)) score -= 20;
    if (r.place && (r.place.split(/\s+/).length > 14)) score -= 15;
    if (r.place && r.location && r.place.toLowerCase().includes(r.location.toLowerCase())) score -= 8;
    return score;
  }

  function pickBestParse(candidates) {
    const scored = candidates
      .filter((c) => c && (c.rows?.length || 0) > 0)
      .map((c) => {
        const q = (c.rows || []).reduce((sum, r) => sum + rowQuality(r), 0);
        const locs = new Set((c.rows || []).map((r) => r.location).filter(Boolean));
        return {
          ...c,
          score: q + (c.rows?.length || 0) * 2 + locs.size * 25,
        };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0] || { rows: [], guides: [], title: "" };
  }

  async function parsePdf(file) {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF library not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const { allLines, pages, title: pdfTitle } = await extractPdfLines(pdf);
    const tabText = allLines.map((l) => l.tab).join("\n");
    const candidates = [];

    // Strategy 0: per-page itinerary sections (New York, Niagara Falls, Washington, …)
    candidates.push(parseItineraryPages(pages, pdfTitle));

    // Strategy 1: column header detection on all lines
    {
      const rows = [];
      const guides = [];
      let columns = null;
      let fallbackLocation = "";
      let ctx = { date: null, day: null, location: "" };
      let title = pdfTitle;
      for (const { cells, line } of allLines) {
        if (/itinerary/i.test(line) && cells.length <= 3) {
          fallbackLocation = line.replace(/itinerary/i, "").trim() || fallbackLocation;
          ctx.location = fallbackLocation;
          continue;
        }
        if (!columns) {
          const detected = detectColumns(cells);
          if (detected) { columns = detected; continue; }
        }
        if (columns) {
          const parsed = rowFromPdfColumns(cells, columns, fallbackLocation, ctx);
          if (!parsed) continue;
          if (parsed.type === "guide") {
            guides.push({ title: parsed.title, body: parsed.body, city: parsed.city || fallbackLocation });
            continue;
          }
          if (parsed.date) ctx.date = parsed.date;
          if (parsed.day) ctx.day = parsed.day;
          if (parsed.location) { fallbackLocation = parsed.location; ctx.location = parsed.location; }
          rows.push(parsed);
        }
      }
      candidates.push({ rows, guides, title: title || pdfTitle });
    }

    // Strategy 2: tab-delimited from x positions
    candidates.push({ ...parseDelimited(tabText), title: pdfTitle });

    // Strategy 3: gap-clustered cells per row
    candidates.push({ ...parsePdfCellRows(allLines, "", {}), title: pdfTitle });

    // Strategy 4: loose line regex
    const loose = parsePdfLoose(tabText);
    candidates.push({ rows: loose.rows, guides: loose.guides, title: loose.title || pdfTitle });

    const best = pickBestParse(candidates);
    if (!best.rows?.length) {
      throw new Error("No itinerary rows found. Export your planner as Excel/CSV, or use columns: Date, Day, Location, Time, Place/Activity, Notes, Category, Maps URL");
    }
    return {
      rows: best.rows,
      guides: best.guides || [],
      title: (best.title || pdfTitle || "Imported trip").replace(/\s*total\s*days.*/i, "").trim() || "Imported trip",
    };
  }

  function parsePdfLoose(text) {
    const rows = [];
    const guides = [];
    let location = "";
    let title = "";
    let ctx = { date: null, day: null, location: "" };
    let guideBuf = null;

    for (const rawLine of String(text || "").split(/\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (/trip planner/i.test(line) && !title) title = line.replace(/total days.*/i, "").trim();
      if (/itinerary/i.test(line) && !/\d{1,2}[./-]\d{1,2}/.test(line)) {
        location = line.replace(/itinerary/i, "").trim() || location;
        ctx.location = location;
        continue;
      }
      if (/^\d+\.\s/.test(line) && /route|train|bus|airtrain|subway|direct/i.test(line)) {
        if (guideBuf) guides.push(guideBuf);
        guideBuf = { title: line.replace(/^\d+\.\s*/, ""), body: "", city: location };
        continue;
      }
      if (guideBuf && !/^\d{1,2}[./-]\d{1,2}/.test(line)) {
        guideBuf.body += (guideBuf.body ? "\n" : "") + line;
        continue;
      }

      const parts = line.split("\t").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 4) {
        const raw = {
          date: parts[0],
          day: parts[1],
          location: parts[2],
          time: parts[3],
          place: parts[4] || "",
          notes: parts[5] || "",
          category: parts[6] || "",
          url: parts.slice(7).join(" ") || parts[6] || "",
        };
        const row = normalizeRow(raw, location, ctx);
        if (row) {
          if (row.type === "guide") guides.push({ title: row.title, body: row.body, city: row.city || location });
          else {
            if (row.date) ctx.date = row.date;
            if (row.day) ctx.day = row.day;
            if (row.location) { location = row.location; ctx.location = location; }
            rows.push(row);
          }
          continue;
        }
      }

      const m = line.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(?:Day\s*)?(\d+)?\s+([A-Za-z][A-Za-z .'-]+?)(?:\s+(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?))?\s+(.*)$/i);
      if (!m) continue;
      const rest = m[5] || "";
      let category = "";
      let place = rest;
      for (const lab of CATEGORY_LABELS) {
        const re = new RegExp(`\\s+${lab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
        if (re.test(rest)) {
          category = lab;
          place = rest.replace(re, "").replace(/\s+Map\s*$/i, "").trim();
          break;
        }
      }
      const url = extractUrl(place) || extractUrl(rest);
      if (url) place = place.replace(url, "").trim();
      const locGuess = (m[3] || location).trim();
      if (/^(day|date|location)$/i.test(locGuess)) continue;
      const row = normalizeRow({
        date: m[1], day: m[2] ? `Day ${m[2]}` : "", location: locGuess,
        time: m[4] || "", place, notes: "", category, url,
      }, location, ctx);
      if (!row) continue;
      if (row.type === "guide") guides.push({ title: row.title, body: row.body, city: row.city || location });
      else {
        if (row.date) ctx.date = row.date;
        if (row.day) ctx.day = row.day;
        if (row.location) { location = row.location; ctx.location = location; }
        rows.push(row);
      }
    }
    if (guideBuf) guides.push(guideBuf);
    return { rows, guides, title };
  }

  async function parseZip(file) {
    if (typeof JSZip === "undefined") throw new Error("ZIP library not loaded");
    const zip = await JSZip.loadAsync(file);
    const merged = { rows: [], guides: [], title: String(file?.name || "Imported trip").replace(/\.zip$/i, "") };
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    for (const path of names) {
      const lower = path.toLowerCase();
      const entry = zip.files[path];
      try {
        if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
          const text = await entry.async("string");
          const parsed = parseDelimited(text);
          merged.rows.push(...(parsed.rows || []));
          merged.guides.push(...(parsed.guides || []));
          if (parsed.title && merged.title === String(file?.name || "").replace(/\.zip$/i, "")) merged.title = parsed.title;
        } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
          const buf = await entry.async("arraybuffer");
          const parsed = parseXlsx(buf);
          merged.rows.push(...(parsed.rows || []));
          merged.guides.push(...(parsed.guides || []));
        } else if (lower.endsWith(".pdf")) {
          const blob = await entry.async("blob");
          const pdfFile = new File([blob], path.split("/").pop() || "itinerary.pdf", { type: "application/pdf" });
          const parsed = await parsePdf(pdfFile);
          merged.rows.push(...(parsed.rows || []));
          merged.guides.push(...(parsed.guides || []));
        }
      } catch (e) {
        console.warn("ZIP entry failed", path, e);
      }
    }
    if (!merged.rows.length) throw new Error("No itinerary CSV/PDF/Excel found in the ZIP");
    return merged;
  }

  async function parseFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".zip")) return parseZip(file);
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      return parseXlsx(await file.arrayBuffer());
    }
    if (name.endsWith(".pdf")) {
      return parsePdf(file);
    }
    const text = await file.text();
    return parseDelimited(text);
  }

  const COUNTRY_ISO = {
    turkey: "tr", "united states": "us", usa: "us", israel: "il", greece: "gr",
    argentina: "ar", "united kingdom": "gb", uk: "gb", france: "fr", italy: "it",
    spain: "es", germany: "de", japan: "jp", canada: "ca", australia: "au",
    jordan: "jo", egypt: "eg", "united arab emirates": "ae", thailand: "th",
    singapore: "sg", brazil: "br", mexico: "mx", morocco: "ma", portugal: "pt",
  };

  function locationCountryHint(location, title) {
    const n = `${location || ""} ${title || ""}`.toLowerCase();
    if (/istanbul|cappadocia|antalya|ankara|izmir|ephesus|pamukkale|bodrum|fethiye|goreme|göreme|kusadasi|trabzon|bursa|konya|gallipoli|canakkale|alanya|marmaris|oludeniz|kas |mardin|gaziantep|safranbolu|turkey|türkiye|turkiye/.test(n)) {
      return "Turkey";
    }
    if (/niagara|washington|new york|nyc|manhattan|brooklyn|jersey|boston|chicago|miami|los angeles|san francisco|las vegas|seattle|philadelphia|orlando|austin|denver|portland|honolulu/.test(n)) {
      return "United States";
    }
    if (/buenos aires|patagonia|mendoza|bariloche|iguazu/.test(n)) return "Argentina";
    if (/london|manchester|edinburgh/.test(n)) return "United Kingdom";
    if (/paris|lyon|nice|marseille/.test(n)) return "France";
    if (/rome|milan|venice|florence|naples/.test(n)) return "Italy";
    if (/athens|santorini|mykonos|crete|thessaloniki/.test(n)) return "Greece";
    if (/tel aviv|jerusalem|haifa|eilat/.test(n)) return "Israel";
    if (/amman|petra|wadi rum/.test(n)) return "Jordan";
    if (/cairo|luxor|giza|aswan/.test(n)) return "Egypt";
    if (/dubai|abu dhabi/.test(n)) return "United Arab Emirates";
    if (/tokyo|kyoto|osaka/.test(n)) return "Japan";
    if (/barcelona|madrid|seville/.test(n)) return "Spain";
    if (/bangkok|phuket|chiang mai/.test(n)) return "Thailand";
    if (/singapore/.test(n)) return "Singapore";
    return "";
  }

  function countryIso(name) {
    return COUNTRY_ISO[String(name || "").toLowerCase()] || String(name || "xx").slice(0, 2).toLowerCase();
  }

  function buildTripDraft(parsed) {
    const rows = (parsed.rows || [])
      .map((r, i) => ({ ...r, _ord: i }))
      .filter((r) => r.type !== "guide" && (r.place || r.placeholder || r.location) && !isJunkRow(r));
    if (!rows.length) throw new Error("No itinerary rows found. Use columns: Date, Day, Location, Time, Place/Activity, Notes, Category, Maps URL");

    rows.sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return da.localeCompare(db);
      return (a._ord || 0) - (b._ord || 0);
    });

    const title = parsed.title || "";
    const segments = [];
    let current = null;
    let lastCity = "";
    for (const r of rows) {
      const loc = cleanCity(r.location);
      if (loc) lastCity = loc;
      const city = loc || lastCity || "Other";
      const date = r.date || null;
      if (!current || current.city !== city) {
        current = { city, countryName: locationCountryHint(city, title), startDate: date, endDate: date, rows: [] };
        segments.push(current);
      } else {
        if (date && (!current.startDate || date < current.startDate)) current.startDate = date;
        if (date && (!current.endDate || date > current.endDate)) current.endDate = date;
      }
      current.rows.push({ ...r, location: city });
    }

    const dayPlans = [];
    const dated = new Map();
    const undated = new Map();
    lastCity = "";

    function addRowToPlan(plan, r, loc) {
      if (r.day && !plan.day) plan.day = r.day;
      if (r.date && !plan.date) plan.date = r.date;
      if (!plan.locations.includes(loc)) plan.locations.push(loc);
      plan.location = plan.locations.join(" · ");
      plan.rows.push({ ...r, location: loc });
    }

    for (const r of rows) {
      const loc = cleanCity(r.location) || lastCity || "Other";
      if (cleanCity(r.location)) lastCity = loc;
      const fresh = () => ({
        date: r.date || null,
        day: r.day || null,
        location: loc,
        locations: [],
        rows: [],
      });
      if (r.date) {
        if (!dated.has(r.date)) dated.set(r.date, fresh());
        addRowToPlan(dated.get(r.date), r, loc);
      } else if (r.day) {
        const k = String(r.day);
        if (!undated.has(k)) undated.set(k, fresh());
        addRowToPlan(undated.get(k), r, loc);
      } else {
        const k = `_ord-${r._ord}`;
        if (!dated.has(k)) dated.set(k, fresh());
        addRowToPlan(dated.get(k), r, loc);
      }
    }
    for (const [dayKey, plan] of undated) {
      const match = [...dated.values()].find((p) => String(p.day || "") === String(plan.day || dayKey));
      if (match) {
        for (const loc of plan.locations) {
          if (!match.locations.includes(loc)) match.locations.push(loc);
        }
        match.location = match.locations.join(" · ");
        match.rows.push(...plan.rows);
        match.rows.sort((a, b) => (a._ord || 0) - (b._ord || 0));
      } else {
        dated.set(`day-${dayKey}`, plan);
      }
    }
    const ordered = [...dated.values()].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      if (da && db && da !== db) return da.localeCompare(db);
      if (da && !db) return -1;
      if (!da && db) return 1;
      return (a.day || 0) - (b.day || 0);
    });
    for (const plan of ordered) {
      plan.rows.sort((a, b) => (a._ord || 0) - (b._ord || 0));
      dayPlans.push(plan);
    }

    const allDates = dayPlans.map((d) => d.date).filter(Boolean).sort();
    return {
      name: (parsed.title || "Imported trip").replace(/\s*total\s*days.*/i, "").trim() || "Imported trip",
      startDate: allDates[0] || null,
      endDate: allDates[allDates.length - 1] || null,
      segments,
      dayPlans,
      guides: parsed.guides || [],
      rowCount: rows.length,
    };
  }

  return {
    parseFile, parseDelimited, parseXlsx, parsePdf, parseItineraryPages, buildTripDraft,
    parsePlannerDate, headerKey, locationCountryHint, countryIso, cityFromItineraryLine,
  };
})();
