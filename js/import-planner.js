/**
 * Import Excel / PDF / CSV trip planners (Party-in-the-USA style).
 * Columns: Date, Day, Location, Time/Order, Place/Activity, Notes, Category, Google Maps Link
 */
window.WorldPlannerImport = (() => {
  function norm(s) { return String(s || "").trim(); }
  function slug(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

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
    return Number.isFinite(n) ? n : null;
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

  function looksLikeHeader(cells) {
    const j = cells.map((c) => String(c || "").toLowerCase()).join(" ");
    return /date/.test(j) && (/place|activity|location/.test(j) || /day/.test(j));
  }

  function rowFromCells(keys, cells) {
    const row = {};
    keys.forEach((k, i) => { row[k] = norm(cells[i]); });
    return row;
  }

  function normalizeRow(row, fallbackLocation) {
    const date = parsePlannerDate(row.date);
    const day = parseDayNum(row.day);
    const location = norm(row.location) || fallbackLocation || "";
    const time = norm(row.time);
    const place = norm(row.place);
    const notes = norm(row.notes);
    const category = norm(row.category);
    let url = norm(row.url);
    if (url && !isUrl(url) && /^map$/i.test(url)) url = "";
    if (!place && !notes && !time) return null;
    if (!place && !location) return null;
    return {
      date,
      day,
      location: location.replace(/\s+/g, " "),
      time,
      place: place || notes || "Activity",
      notes: place ? notes : "",
      category,
      url: isUrl(url) ? url : "",
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

    for (const line of lines) {
      if (/itinerary/i.test(line) && !line.includes(delim === "\t" ? "\t" : ",")) {
        const loc = line.replace(/itinerary/i, "").trim();
        if (loc) fallbackLocation = loc;
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
      const row = normalizeRow(raw, fallbackLocation);
      if (row) {
        if (row.location) fallbackLocation = row.location;
        rows.push(row);
      }
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
        const row = normalizeRow(raw, fallbackLocation);
        if (row) {
          if (row.location) fallbackLocation = row.location;
          rows.push(row);
        }
      }
    }
    return { rows, guides, title: String(title).replace(/itinerary/i, "").trim() || "Imported trip" };
  }

  async function parsePdf(file) {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF library not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const allLines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const buckets = [];
      for (const it of content.items || []) {
        const str = norm(it.str);
        if (!str) continue;
        const x = it.transform?.[4] ?? 0;
        const y = Math.round((it.transform?.[5] ?? 0) / 3) * 3;
        let row = buckets.find((b) => Math.abs(b.y - y) < 5);
        if (!row) {
          row = { y, cells: [] };
          buckets.push(row);
        }
        row.cells.push({ x, str });
      }
      buckets.sort((a, b) => b.y - a.y);
      for (const row of buckets) {
        row.cells.sort((a, b) => a.x - b.x);
        allLines.push(row.cells.map((c) => c.str).join("\t"));
      }
      allLines.push("");
    }
    const parsed = parseDelimited(allLines.join("\n"));
    if (!parsed.rows.length) {
      const loose = parsePdfLoose(allLines.join("\n"));
      return { ...parsed, ...loose, rows: loose.rows.length ? loose.rows : parsed.rows };
    }
    return parsed;
  }

  function parsePdfLoose(text) {
    const rows = [];
    const guides = [];
    let location = "";
    let title = "";
    let guideBuf = null;
    for (const rawLine of String(text || "").split(/\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      if (/trip planner/i.test(line) && !title) title = line.replace(/total days.*/i, "").trim();
      if (/itinerary/i.test(line)) {
        location = line.replace(/itinerary/i, "").trim() || location;
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
      const m = line.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(?:Day\s*)?(\d+)?\s+([A-Za-z][A-Za-z .'-]+?)(?:\s+(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?))?\s+(.*)$/i);
      if (!m) continue;
      const rest = m[5] || "";
      const catMatch = rest.match(/\s+(Food & Dining|Sightseeing(?:\s*\/\s*Attraction)?|Coffee & Snacks|Accommodation|Nightlife(?:\s*\/\s*Drinks)?|Transportation(?:\s*\/\s*Flight)?|Guide(?:\s*\/\s*Info)?|Shopping|Map)\s*$/i);
      let place = rest;
      let category = "";
      if (catMatch) {
        category = catMatch[1];
        place = rest.slice(0, catMatch.index).replace(/\s+Map\s*$/i, "").trim();
      }
      place = place.replace(/\s+Map\s*$/i, "").trim();
      const locGuess = (m[3] || location).trim();
      if (/^(day|date|location)$/i.test(locGuess)) continue;
      rows.push({
        date: parsePlannerDate(m[1]),
        day: m[2] ? Number(m[2]) : null,
        location: locGuess,
        time: m[4] || "",
        place: place || locGuess,
        notes: "",
        category,
        url: "",
      });
      location = locGuess || location;
    }
    if (guideBuf) guides.push(guideBuf);
    return { rows, guides, title };
  }

  async function parseFile(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      return parseXlsx(await file.arrayBuffer());
    }
    if (name.endsWith(".pdf")) {
      return parsePdf(file);
    }
    const text = await file.text();
    return parseDelimited(text);
  }

  function locationCountryHint(location) {
    const n = String(location || "").toLowerCase();
    if (/niagara|washington|new york|nyc|jersey|boston|chicago|miami|los angeles|san francisco|las vegas/.test(n)) {
      return "United States";
    }
    return "";
  }

  function buildTripDraft(parsed) {
    const rows = (parsed.rows || []).filter((r) => r.place);
    if (!rows.length) throw new Error("No itinerary rows found. Use columns: Date, Day, Location, Time, Place/Activity, Notes, Category, Maps URL");
    const byLoc = new Map();
    for (const r of rows) {
      const loc = r.location || "Other";
      if (!byLoc.has(loc)) byLoc.set(loc, []);
      byLoc.get(loc).push(r);
    }
    const segments = [];
    for (const [city, locRows] of byLoc) {
      const dates = locRows.map((r) => r.date).filter(Boolean).sort();
      segments.push({
        city,
        countryName: locationCountryHint(city),
        startDate: dates[0] || null,
        endDate: dates[dates.length - 1] || null,
        rows: locRows,
      });
    }
    segments.sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
    const allDates = rows.map((r) => r.date).filter(Boolean).sort();
    return {
      name: parsed.title || "Imported trip",
      startDate: allDates[0] || null,
      endDate: allDates[allDates.length - 1] || null,
      segments,
      guides: parsed.guides || [],
      rowCount: rows.length,
    };
  }

  return { parseFile, parseDelimited, parseXlsx, parsePdf, buildTripDraft, parsePlannerDate, headerKey };
})();
