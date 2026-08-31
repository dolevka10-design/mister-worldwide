/**
 * Expand short Google Maps links and extract place name + coordinates server-side.
 * GET /.netlify/functions/resolve-maps?url=...
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseCoordsFromString(s) {
  if (!s) return null;
  const patterns = [
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/i,
    /!8m2!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/i,
    /@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,|\?|\/|z|$)/,
    /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /\/search\/(-?\d+\.?\d*),\+?(-?\d+\.?\d*)/,
    /"lat":\s*(-?\d+\.?\d*)\s*,\s*"lng":\s*(-?\d+\.?\d*)/,
    /"latitude":\s*(-?\d+\.?\d*)\s*,\s*"longitude":\s*(-?\d+\.?\d*)/,
    /\[-?\d+\.?\d*,\s*-?\d+\.?\d*,\s*(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\]/,
    /center=(-?\d+\.?\d*)%2C(-?\d+\.?\d*)/i,
    /!2d(-?\d+\.?\d*)!3d(-?\d+\.?\d*)/i,
  ];
  for (const re of patterns) {
    const m = String(s).match(re);
    if (!m) continue;
    let lat = parseFloat(m[1]);
    let lng = parseFloat(m[2]);
    if (re.source.includes("!2d")) {
      lng = parseFloat(m[1]);
      lat = parseFloat(m[2]);
    }
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function parseCoordsFromAppInit(html) {
  const m = String(html || "").match(/APP_INITIALIZATION_STATE=\[\[\[([^\]]+)\]/);
  if (!m) return null;
  const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
  if (parts.length < 3) return null;
  const lng = parts[1];
  const lat = parts[2];
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  return null;
}

function parseNameFromUrl(url) {
  const m = String(url || "").match(/\/maps\/place\/([^/@?]+)/);
  if (!m || !m[1]) return "";
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
  } catch {
    return m[1].replace(/\+/g, " ").trim();
  }
}

function parseNameFromHtml(html) {
  const s = String(html || "");
  const og = s.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og?.[1]) {
    const t = og[1].replace(/\s*[-–·|]\s*Google Maps.*$/i, "").trim();
    if (t) return t;
  }
  const title = s.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1]) {
    const t = title[1].replace(/\s*[-–·|]\s*Google Maps.*$/i, "").trim();
    if (t && !/not found|error/i.test(t)) return t;
  }
  const meta = s.match(/"title":"([^"]+)"/);
  if (meta?.[1] && !/google maps/i.test(meta[1])) return meta[1].trim();
  return "";
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`,
      { headers: { Accept: "application/json", "User-Agent": "MisterWorldwide/1.0 (maps-resolve)" } }
    );
    if (!res.ok) return { city: "", country: "" };
    const data = await res.json();
    const a = data.address || {};
    return {
      city: a.city || a.town || a.village || a.municipality || a.suburb || a.county || "",
      country: a.country || "",
    };
  } catch {
    return { city: "", country: "" };
  }
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

  const url = String(event.queryStringParameters?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      statusCode: 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "url query parameter required" }),
    };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const finalUrl = res.url || url;
    const html = await res.text();
    const coords =
      parseCoordsFromString(finalUrl) ||
      parseCoordsFromString(html.slice(0, 1200000)) ||
      parseCoordsFromAppInit(html);
    const name =
      parseNameFromUrl(finalUrl) ||
      parseNameFromUrl(url) ||
      parseNameFromHtml(html) ||
      null;

    let city = null;
    let country = null;
    if (coords) {
      const rev = await reverseGeocode(coords.lat, coords.lng);
      city = rev.city || null;
      country = rev.country || null;
    }

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: finalUrl,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        name: name || null,
        city,
        country,
        resolved: !!(coords || name),
      }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(e.message || e), url }),
    };
  }
};
