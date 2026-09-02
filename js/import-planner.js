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
    if (n.length > 48) return "";
    if (n.split(/\s+/).length > 6) return "";
    if (/penn station|airtrain|path train|port authority|queens-bound|getting around|how to get/i.test(n)) return "";
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
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
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
        if (guideBuf) { guides.push(guideBuf); guideBuf = null; }
        const loc = line.replace(/itinerary/i, "").trim();
        if (loc) { fallbackLocation = loc; ctx.location = loc; }
        if (!title) title = line.trim();
        continue;
      }
      if (/trip planner/i.test(line) && !title) {
        title = line.replace(/total days.*/i, "").trim() || title;
      }
      if (/^usa trip planner/i.test(line) && !title) title = "USA Trip";
      const cells = split(line);
      if (/getting\s*around|how\s*to\s*get\s*(to|around)/i.test(line) && cells.length <= 2 && !looksLikeHeader(cells)) {
        if (guideBuf) guides.push(guideBuf);
        const city = line.replace(/getting\s*around/ig, "").replace(/how\s*to\s*get\s*(to|around)/ig, "").trim();
        guideBuf = { title: line.trim(), body: "", city: city || fallbackLocation };
        continue;
      }
      if (guideBuf && cells.length <= 2 && !looksLikeHeader(cells) && !parsePlannerDate(cells[0])) {
        guideBuf.body += (guideBuf.body ? "\n" : "") + line;
        continue;
      }
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

  function describeXlsx(buf) {
    if (typeof XLSX === "undefined") throw new Error("Excel library not loaded");
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const pages = [];
    let title = wb.SheetNames[0] || "Imported trip";
    wb.SheetNames.forEach((name, i) => {
      const sheet = wb.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const rows = [];
      const guides = [];
      let keys = null;
      let fallbackLocation = /overview|planner|total/i.test(name) ? "" : name.replace(/itinerary/i, "").trim();
      let ctx = { date: null, day: null, location: fallbackLocation };
      const guideSheet = /guide|transit|transport|getting/i.test(name);
      if (guideSheet) {
        const text = json.map((r) => r.filter(Boolean).join(" ")).join("\n");
        if (text.trim()) guides.push({ title: name, body: text.trim(), city: fallbackLocation });
      } else {
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
      pages.push(pageFromParsed(
        `sheet-${i}-${name}`,
        name,
        { rows, guides },
        !guideSheet && !!rows.length,
        guideSheet ? "guide" : (rows.length ? "itinerary" : "empty")
      ));
    });
    return { title: String(title).replace(/itinerary/i, "").trim() || "Imported trip", pages };
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

  function isGuidePage(page) {
    const text = (page.lines || []).map((l) => l.line).join(" ");
    return /getting\s*around|how\s*to\s*get\s*(to|around)/i.test(text) && !/itinerary/i.test(text);
  }

  function isSkipPage(page) {
    return isOverviewPage(page) || isGuidePage(page);
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

  function pagePreviewText(page) {
    const lines = (page.lines || []).map((l) => String(l.line || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const skip = (s) => looksLikeHeader(s.split(/\s+/)) || HEADER_CELL.test(s) || /^date\b/i.test(s);
    const good = lines.filter((l) => l.length > 4 && !skip(l));
    return (good[0] || lines[0] || "").slice(0, 160);
  }

  function classifyImportPage(page, chunk) {
    const text = (page.lines || []).map((l) => l.line).join(" ");
    const places = (chunk.rows || []).filter((r) => r.place && !r.placeholder);
    if (isOverviewPage(page)) return "overview";
    if (isGuidePage(page) || ((chunk.guides || []).length && !places.length && /getting\s*around|how\s*to\s*get\s*(to|around)|table\s*of\s*contents/i.test(text))) {
      return "guide";
    }
    if (/itinerary/i.test(text) || (page.lines || []).some((l) => looksLikeHeader((l.cells || []).map((c) => c.str)))) {
      return "itinerary";
    }
    if (places.length) return "continuation";
    if ((chunk.guides || []).length && !places.length) return "guide";
    if ((chunk.rows || []).length) return "other";
    return "empty";
  }

  function kindLabel(kind) {
    if (kind === "itinerary") return "Itinerary";
    if (kind === "continuation") return "Continued itinerary";
    if (kind === "guide") return "Getting around / guide";
    if (kind === "overview") return "Cover / overview";
    if (kind === "empty") return "Empty";
    return "Other";
  }

  function describePdfPages(pages, docTitle) {
    const titleOut = { value: docTitle || "" };
    let sharedColumns = null;
    let lastLocation = "";
    let sharedCtx = { date: null, day: null, location: "" };
    const out = [];
    (pages || []).forEach((page, i) => {
      const pageNum = page.pageNum || i + 1;
      const header = (page.lines || []).find((l) => /itinerary/i.test(l.line) && (l.cells || []).length <= 5);
      if (header) lastLocation = cityFromItineraryLine(header.line) || lastLocation;
      let chunk;
      if (isGuidePage(page)) {
        const body = (page.lines || []).map((l) => l.line).join("\n");
        chunk = {
          rows: [],
          guides: [{ title: (page.lines || [])[0]?.line || "Getting around", body, city: lastLocation }],
          columns: sharedColumns,
          location: lastLocation,
          ctx: sharedCtx,
        };
      } else {
        chunk = parseLinesChunk(page.lines || [], lastLocation, titleOut, sharedColumns, sharedCtx);
        if (chunk.columns) sharedColumns = chunk.columns;
        if (chunk.location) lastLocation = chunk.location;
        if (chunk.ctx) sharedCtx = { date: chunk.ctx.date || null, day: chunk.ctx.day || null, location: lastLocation };
      }
      const kind = classifyImportPage(page, chunk);
      const places = (chunk.rows || []).filter((r) => r.place && !r.placeholder);
      const dates = [...new Set((chunk.rows || []).map((r) => r.date).filter(Boolean))].sort();
      let title = `Page ${pageNum}`;
      if (header) {
        const city = cityFromItineraryLine(header.line);
        title = city ? `${city} Itinerary` : String(header.line).replace(/\s+/g, " ").trim().slice(0, 80);
      } else if (kind === "guide") {
        const m = (page.lines || []).map((l) => l.line).join(" ").match(/getting\s*around[^.\n]{0,48}/i);
        title = m ? m[0].trim() : "Getting around";
      } else if (kind === "overview") {
        title = "Cover / overview";
      } else if (lastLocation && (chunk.rows || []).length) {
        title = `${lastLocation} (continued)`;
      } else {
        const first = (page.lines || []).map((l) => String(l.line || "").trim()).find((l) => l.length > 3);
        if (first) title = first.slice(0, 80);
      }
      const bits = [];
      if (chunk.rows?.length) bits.push(`${chunk.rows.length} row${chunk.rows.length === 1 ? "" : "s"}`);
      if (places.length) bits.push(places.slice(0, 3).map((r) => r.place).join(" · "));
      if (dates.length) bits.push(dates.length === 1 ? dates[0] : `${dates[0]}–${dates[dates.length - 1]}`);
      out.push({
        id: `p${pageNum}`,
        pageNum,
        title,
        kind,
        kindLabel: kindLabel(kind),
        suggested: kind === "itinerary" || kind === "continuation",
        preview: bits.join(" · ") || pagePreviewText(page),
        rows: chunk.rows || [],
        guides: chunk.guides || [],
      });
    });
    if (out.length && !out.some((p) => p.suggested)) {
      for (const p of out) {
        if (p.rows?.length) p.suggested = true;
      }
    }
    return { title: titleOut.value || docTitle || "Imported trip", pages: out };
  }

  function parsedFromPages(pack, selectedIds) {
    const want = new Set((selectedIds || []).map(String));
    const pages = (pack?.pages || []).filter((p) => want.has(String(p.id)));
    if (!pages.length) throw new Error("Select at least one page to import");
    const rows = [];
    const guides = [];
    for (const p of pages) {
      rows.push(...(p.rows || []));
      guides.push(...(p.guides || []));
    }
    if (!rows.length) throw new Error("Selected pages have no itinerary rows. Check city itinerary pages.");
    return {
      rows,
      guides,
      title: pack.title || "Imported trip",
    };
  }

  function pageFromParsed(id, title, parsed, suggested, kind) {
    const rows = parsed.rows || [];
    const places = rows.filter((r) => r.place && !r.placeholder);
    return {
      id,
      pageNum: null,
      title,
      kind: kind || (rows.length ? "itinerary" : "other"),
      kindLabel: kindLabel(kind || (rows.length ? "itinerary" : "other")),
      suggested: suggested !== false && !!rows.length,
      preview: places.slice(0, 3).map((r) => r.place).join(" · ") || `${rows.length} rows`,
      rows,
      guides: parsed.guides || [],
    };
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

  function zipItineraryPaths(names) {
    const files = (names || []).filter((n) => /\.(csv|tsv|txt|xlsx|xls|pdf)$/i.test(n) && !/(^|\/)(__macosx|\.)/i.test(n));
    const pdfs = files.filter((n) => n.toLowerCase().endsWith(".pdf"));
    const tables = files.filter((n) => /\.(csv|tsv|txt|xlsx|xls)$/i.test(n));
    if (pdfs.length && tables.length && pdfs.length + tables.length === files.length) return pdfs;
    return files;
  }

  async function parseZip(file) {
    if (typeof JSZip === "undefined") throw new Error("ZIP library not loaded");
    const zip = await JSZip.loadAsync(file);
    const merged = { rows: [], guides: [], title: String(file?.name || "Imported trip").replace(/\.zip$/i, "") };
    const names = zipItineraryPaths(Object.keys(zip.files).filter((n) => !zip.files[n].dir));
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

  async function describePdfFile(file) {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF library not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const { pages, title } = await extractPdfPages(pdf);
    return describePdfPages(pages, title);
  }

  async function parseFileForPicker(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".pdf")) return describePdfFile(file);
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return describeXlsx(await file.arrayBuffer());
    if (name.endsWith(".zip")) {
      if (typeof JSZip === "undefined") throw new Error("ZIP library not loaded");
      const zip = await JSZip.loadAsync(file);
      const pages = [];
      let title = String(file?.name || "Imported trip").replace(/\.zip$/i, "");
      const names = zipItineraryPaths(Object.keys(zip.files).filter((n) => !zip.files[n].dir));
      for (const path of names) {
        const lower = path.toLowerCase();
        const entry = zip.files[path];
        const label = path.split("/").pop() || path;
        try {
          if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
            const parsed = parseDelimited(await entry.async("string"));
            pages.push(pageFromParsed(`zip-${path}`, label, parsed, true, "itinerary"));
            if (parsed.title) title = parsed.title;
          } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
            const pack = describeXlsx(await entry.async("arraybuffer"));
            for (const p of pack.pages || []) {
              pages.push({ ...p, id: `zip-${path}-${p.id}`, title: `${label} · ${p.title}` });
            }
            if (pack.title) title = pack.title;
          } else if (lower.endsWith(".pdf")) {
            const blob = await entry.async("blob");
            const pdfFile = new File([blob], label, { type: "application/pdf" });
            const pack = await describePdfFile(pdfFile);
            for (const p of pack.pages || []) {
              pages.push({ ...p, id: `zip-${path}-${p.id}`, title: `${label} · ${p.title}` });
            }
            if (pack.title) title = pack.title;
          }
        } catch (e) {
          console.warn("ZIP entry failed", path, e);
        }
      }
      if (!pages.length) throw new Error("No itinerary CSV/PDF/Excel found in the ZIP");
      return { title, pages };
    }
    const parsed = parseDelimited(await file.text());
    return {
      title: parsed.title || String(file?.name || "Imported trip").replace(/\.[a-z0-9]+$/i, ""),
      pages: [pageFromParsed("csv", parsed.title || file?.name || "CSV", parsed, true, "itinerary")],
    };
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

  const EXPORT_HEADER = ["Date", "Day", "Location", "Time/Order", "Place/Activity", "Notes", "Category", "Google Maps Link"];
  const PDF_COL_X = [28, 88, 148, 228, 292, 468, 568, 668];
  const PDF_ROWS_PER_PAGE = 16;
  const PDF_PAGE_W = 792;
  const PDF_PAGE_H = 612;

  function fmtExportDate(isoOrPlanner) {
    const n = norm(isoOrPlanner);
    if (!n) return "";
    const parsed = parsePlannerDate(n);
    if (parsed) {
      const [y, m, d] = parsed.split("-");
      return `${d}.${m}.${String(y).slice(2)}`;
    }
    return n;
  }

  function exportDayLabel(day) {
    const n = parseDayNum(day);
    return n ? `Day ${n}` : (norm(day) || "");
  }

  function excelSheetName(raw, used) {
    let n = String(raw || "Sheet").replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
    let base = n;
    let i = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ` ${i++}`;
      n = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    used.add(n.toLowerCase());
    return n;
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function isExportableRow(r) {
    const place = norm(r.place);
    const notes = norm(r.notes);
    const time = norm(r.time);
    const url = extractUrl(r.url) || norm(r.url);
    const cat = norm(r.category);
    if (place && place !== "—" && place !== "-") return true;
    if (notes) return true;
    if (time && isTimeOnly(time)) return true;
    if (r.placeholder && !place) return false;
    if (!place && !notes && !time) return false;
    if (/^places$/i.test(cat) && !place) return false;
    return false;
  }

  function normalizeExportRow(r, ord = 0) {
    const dateRaw = r.date || "";
    const parsedDate = parsePlannerDate(dateRaw);
    return {
      date: fmtExportDate(dateRaw),
      day: exportDayLabel(r.day),
      location: cleanCity(r.location) || "Other",
      time: isTimeOnly(r.time) ? norm(r.time) : norm(r.time),
      place: r.placeholder ? "" : norm(r.place),
      notes: norm(r.notes),
      category: norm(r.category),
      url: extractUrl(r.url) || (/^https?:\/\//i.test(norm(r.url)) ? norm(r.url) : ""),
      _ord: ord,
      _sortDate: parsedDate || dateRaw || "",
      _sortDay: parseDayNum(r.day) ?? 9999,
    };
  }

  function sortExportRows(rows) {
    return [...rows].sort((a, b) => {
      const da = a._sortDate || "";
      const db = b._sortDate || "";
      if (da && db && da !== db) return da.localeCompare(db);
      if (da && !db) return -1;
      if (!da && db) return 1;
      if (a._sortDay !== b._sortDay) return a._sortDay - b._sortDay;
      return (a._ord || 0) - (b._ord || 0);
    });
  }

  function stripExportMeta(row) {
    const { _ord, _sortDate, _sortDay, ...out } = row;
    return out;
  }

  function buildExportPack({ title, dayCount, rows, guides } = {}) {
    const tripTitle = String(title || "Imported trip").replace(/\s*total\s*days.*/i, "").trim() || "Imported trip";
    const normalized = (rows || [])
      .map((r, i) => normalizeExportRow(r, r._ord ?? i))
      .filter(isExportableRow);
    const sorted = sortExportRows(normalized).map(stripExportMeta);
    const totalDays = Number(dayCount) > 0
      ? Number(dayCount)
      : new Set(sorted.map((r) => r.date || r.day).filter(Boolean)).size;
    return {
      title: tripTitle,
      dayCount: totalDays,
      rows: sorted,
      guides: (guides || []).map((g) => ({ title: g.title, body: g.body, city: g.city || "" })),
    };
  }

  function exportCsv(pack) {
    const titleLine = `${pack.title}${pack.dayCount ? ` · ${pack.dayCount} days` : ""} · ${pack.rows.length} activities`;
    const lines = [
      titleLine,
      EXPORT_HEADER.map(csvEscape).join(","),
      ...(pack.rows || []).map((r) =>
        [r.date, r.day, r.location, r.time, r.place, r.notes, r.category, r.url].map(csvEscape).join(",")
      ),
    ];
    return `\uFEFF${lines.join("\n")}\n`;
  }

  function exportXlsxSheets(pack) {
    return [{
      name: "Itinerary",
      kind: "itinerary",
      aoa: [
        [`${pack.title}${pack.dayCount ? ` · ${pack.dayCount} days` : ""} · ${(pack.rows || []).length} activities`],
        EXPORT_HEADER,
        ...(pack.rows || []).map((r) => [r.date, r.day, r.location, r.time, r.place, r.notes, r.category, r.url]),
      ],
    }];
  }

  function exportXlsx(pack) {
    if (typeof XLSX === "undefined") throw new Error("Excel library not loaded");
    const wb = XLSX.utils.book_new();
    for (const sheet of exportXlsxSheets(pack)) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  }

  function toWinAnsi(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "?")
      .slice(0, 160);
  }

  function pdfEscape(s) {
    return toWinAnsi(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function wrapText(s, width) {
    const words = String(s || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > width && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  function layoutExportPdfPages(pack) {
    const pages = [];
    const title = `${pack.title}${pack.dayCount ? ` · ${pack.dayCount} days` : ""} · ${(pack.rows || []).length} activities`;
    const rowsPerPage = 30;
    const chunks = [];
    for (let i = 0; i < (pack.rows || []).length || !chunks.length; i += rowsPerPage) {
      chunks.push((pack.rows || []).slice(i, i + rowsPerPage));
      if (!(pack.rows || []).length) break;
    }
    chunks.forEach((chunk, pageIdx) => {
      const items = [];
      if (pageIdx === 0) {
        items.push({ x: PDF_COL_X[0], y: 580, str: title, size: 13 });
        EXPORT_HEADER.forEach((h, i) => items.push({ x: PDF_COL_X[i], y: 556, str: h, size: 8 }));
      }
      let y = pageIdx === 0 ? 538 : 580;
      for (const r of chunk) {
        const vals = [r.date, r.day, r.location, r.time, r.place, r.notes, r.category, r.url];
        vals.forEach((v, i) => {
          const max = i === 4 ? 42 : (i === 7 ? 32 : (i === 5 ? 20 : 14));
          const str = String(v || "").slice(0, max);
          if (str) items.push({ x: PDF_COL_X[i], y, str, size: 8 });
        });
        y -= 14;
      }
      pages.push({ kind: "table", title, items, rows: chunk });
    });
    return pages;
  }

  function exportPdfPages(pack) {
    return layoutExportPdfPages(pack).map((page, i) => {
      const byY = new Map();
      for (const it of page.items) {
        const y = Math.round(it.y / 2) * 2;
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ x: it.x, str: it.str });
      }
      const ys = [...byY.keys()].sort((a, b) => b - a);
      const headerLine = page.items.find((it) => it.y === 556)?.str || "";
      const lines = ys.map((y) => {
        const cells = byY.get(y).sort((a, b) => a.x - b.x);
        return { cells, tab: cells.map((c) => c.str).join("\t"), line: cells.map((c) => c.str).join(" ") };
      });
      if (i === 0 && headerLine) {
        const hdrCells = EXPORT_HEADER.map((str, idx) => ({ x: PDF_COL_X[idx], str }));
        lines.unshift({ cells: hdrCells, tab: EXPORT_HEADER.join("\t"), line: EXPORT_HEADER.join(" ") });
      }
      return { pageNum: i + 1, lines };
    });
  }

  function exportPdf(pack) {
    const laid = layoutExportPdfPages(pack);
    const objects = [];
    const add = (s) => { objects.push(s); return objects.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add("<< /Type /Pages /Kids [] /Count 0 >>");
    const contentIds = laid.map((page) => {
      const ops = ["BT"];
      let lastSize = 0;
      for (const it of page.items) {
        const size = it.size || 10;
        if (size !== lastSize) {
          ops.push(`/F1 ${size} Tf`);
          lastSize = size;
        }
        ops.push(`1 0 0 1 ${Number(it.x).toFixed(2)} ${Number(it.y).toFixed(2)} Tm`);
        ops.push(`(${pdfEscape(it.str)}) Tj`);
      }
      ops.push("ET");
      const stream = ops.join("\n");
      return add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });
    const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const pageIds = laid.map((_, i) => add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_W} ${PDF_PAGE_H}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    ));
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    let out = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n`;
    out += "0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i++) {
      out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  return {
    parseFile, parseFileForPicker, parseDelimited, parseXlsx, parsePdf, parseItineraryPages, describePdfPages,
    parsedFromPages, buildTripDraft, buildExportPack, exportCsv, exportXlsx, exportXlsxSheets, exportPdf, exportPdfPages,
    parsePlannerDate, headerKey, locationCountryHint, countryIso, cityFromItineraryLine, zipItineraryPaths,
  };
})();
