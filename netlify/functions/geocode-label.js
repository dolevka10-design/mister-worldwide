/**
 * GET /.netlify/functions/geocode-label?lat=&lng=&country=&city=
 * Reverse-geocode via Nominatim (server-side — no browser CORS).
 */
const UA = "MisterWorldwide/1.0 (travel-globe)";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function isLatinLabel(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u1100-\u11FF]/.test(s)) {
    return false;
  }
  return /[A-Za-z]/.test(s);
}

function extractLatinFromMixed(text) {
  const parts = String(text || "").split(/\s+/);
  for (const part of parts) {
    const p = part.trim();
    if (p.length >= 2 && isLatinLabel(p)) return p;
  }
  const match = String(text || "").match(/[A-Za-z][A-Za-z\s.'-]{1,}/);
  return match ? match[0].trim() : "";
}

function pickEnglishPlaceName(namedetails, address, displayName) {
  const nd = namedetails || {};
  const addr = address || {};
  const cityLevel = [
    nd["name:en"],
    addr.city,
    addr.town,
    addr.municipality,
    nd["official_name:en"],
    nd["name:international"],
    addr.county,
  ];
  for (const c of cityLevel) {
    const s = String(c || "").trim();
    if (s && isLatinLabel(s)) return s;
    const latin = extractLatinFromMixed(s);
    if (latin) return latin;
  }
  const parts = String(displayName || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const s = parts[i];
    if (!s || /^\d{2,}$/.test(s)) continue;
    if (isLatinLabel(s)) return s;
    const latin = extractLatinFromMixed(s);
    if (latin) return latin;
  }
  return "";
}

function normalizeEnglishLabel(label) {
  return String(label || "")
    .replace(/\s+(District|Municipality|Subdistrict|County)$/i, "")
    .trim();
}

function isTooBroadLabel(label, address) {
  const l = String(label || "").toLowerCase();
  if (/^(north|south|east|west|central)\s+region$/.test(l)) return true;
  if (/\b(province|prefecture|oblast|governorate)\b/.test(l)) return true;
  const addr = address || {};
  if (addr.state && String(label).trim() === String(addr.state).trim()) return true;
  if (addr.region && String(label).trim() === String(addr.region).trim()) return true;
  return false;
}

function scoreEnglishLabel(label, address, zoom) {
  const l = String(label || "").trim();
  if (!l) return -1;
  let score = Math.min(zoom, 16);
  const addr = address || {};
  if (addr.city && l === addr.city) score += 40;
  if (addr.town && l === addr.town) score += 35;
  if (addr.municipality && l === addr.municipality) score += 30;
  if (/\bdistrict\b/i.test(l)) score += 20;
  if (/\b(road|street|lane|avenue|highway)\b/i.test(l)) score -= 25;
  if (isTooBroadLabel(l, addr)) score -= 30;
  return score;
}

async function nominatimReverseData(lat, lng, zoom) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=${zoom}` +
    `&accept-language=en&namedetails=1&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) return null;
  return res.json();
}

async function bestReverseEnglishLabel(lat, lng) {
  let best = { label: "", score: -1 };
  for (const zoom of [14, 12, 10, 8, 6]) {
    const data = await nominatimReverseData(lat, lng, zoom);
    if (!data) continue;
    const label = pickEnglishPlaceName(data?.namedetails, data?.address, data?.display_name);
    if (!label) continue;
    const score = scoreEnglishLabel(label, data?.address, zoom);
    if (score > best.score) best = { label, score };
  }
  return best.label;
}

async function nominatimSearch(q) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json` +
    `&q=${encodeURIComponent(q)}&limit=5&accept-language=en&namedetails=1&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) return "";
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return "";
  for (const row of rows) {
    const label = pickEnglishPlaceName(row.namedetails, row.address, row.display_name);
    if (label) return label;
  }
  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "GET only" }),
    };
  }

  const params = event.queryStringParameters || {};
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const city = String(params.city || "").trim();
  const country = String(params.country || "").trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      statusCode: 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "lat and lng required" }),
    };
  }

  try {
    const reverse = await bestReverseEnglishLabel(lat, lng);
    if (reverse) {
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ labelEn: normalizeEnglishLabel(reverse) }),
      };
    }
    if (city && country) {
      const search = await nominatimSearch(`${city}, ${country}`);
      if (search) {
        return {
          statusCode: 200,
          headers: { ...cors, "Content-Type": "application/json" },
          body: JSON.stringify({ labelEn: normalizeEnglishLabel(search) }),
        };
      }
    }
    const mixed = extractLatinFromMixed(city);
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ labelEn: mixed || "" }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(e.message || e) }),
    };
  }
};
