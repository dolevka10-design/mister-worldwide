/**
 * Expand short Google Maps links (maps.app.goo.gl) to full URLs server-side.
 * GET /.netlify/functions/resolve-maps?url=...
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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
      headers: { "User-Agent": "MisterWorldwide/1.0" },
    });
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ url: res.url || url }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(e.message || e), url }),
    };
  }
};
