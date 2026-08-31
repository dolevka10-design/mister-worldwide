/**
 * Expand short Google Maps links and extract place name + coordinates server-side.
 * GET /.netlify/functions/resolve-maps?url=...
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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
  ];
  for (const re of patterns) {
    const m = String(s).match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
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
        "User-Agent": "Mozilla/5.0 (compatible; MisterWorldwide/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const finalUrl = res.url || url;
    const html = await res.text();
    const coords = parseCoordsFromString(finalUrl) || parseCoordsFromString(html.slice(0, 800000));
    const name = parseNameFromUrl(finalUrl) || parseNameFromUrl(url);

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: finalUrl,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        name: name || null,
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
