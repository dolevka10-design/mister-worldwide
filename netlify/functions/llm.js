/**
 * Proxies chat completions to Groq / OpenRouter (browser CORS).
 * POST /.netlify/functions/llm?provider=groq|openrouter
 */
const TARGETS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, HTTP-Referer, X-Title",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "POST only" } }),
    };
  }

  const provider = String(event.queryStringParameters?.provider || "groq").toLowerCase();
  const target = TARGETS[provider];
  if (!target) {
    return {
      statusCode: 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: `Unknown provider: ${provider}` } }),
    };
  }

  const auth = event.headers.authorization || event.headers.Authorization;
  if (!auth) {
    return {
      statusCode: 401,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Missing Authorization bearer key" } }),
    };
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: auth,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = event.headers["http-referer"] || event.headers.referer || "https://mister-worldwide.netlify.app";
    headers["X-Title"] = "Mister Worldwide";
  }

  try {
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: event.body || "{}",
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { ...cors, "Content-Type": "application/json" },
      body: text || JSON.stringify({ error: { message: res.statusText || `HTTP ${res.status}` } }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: String(e.message || e) } }),
    };
  }
};
