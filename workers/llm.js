/**
 * POST /api/llm?provider=groq|openrouter — CORS-safe LLM proxy for browser clients.
 */
const TARGETS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, HTTP-Referer, X-Title",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export async function handleLlm(request, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ error: { message: "POST only" } }, 405);
  }

  const provider = String(url.searchParams.get("provider") || "groq").toLowerCase();
  const target = TARGETS[provider];
  if (!target) {
    return json({ error: { message: `Unknown provider: ${provider}` } }, 400);
  }

  const auth = request.headers.get("Authorization");
  if (!auth) {
    return json({ error: { message: "Missing Authorization bearer key" } }, 401);
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: auth,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      request.headers.get("HTTP-Referer") ||
      request.headers.get("Referer") ||
      "https://mister-worldwide.netlify.app";
    headers["X-Title"] = "Mister Worldwide";
  }

  try {
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: request.body,
    });
    const text = await res.text();
    return new Response(text || JSON.stringify({ error: { message: res.statusText || `HTTP ${res.status}` } }), {
      status: res.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ error: { message: String(e.message || e) } }, 502);
  }
}
