/**
 * Cloudflare Worker — static SPA + API routes for LLM proxy and Maps resolve.
 */
import { handleGeocodeLabel } from "./workers/geocode.js";
import { handleLlm } from "./workers/llm.js";
import { handleResolveMaps } from "./workers/resolve-maps.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/llm" || path.startsWith("/api/llm/") || path === "/.netlify/functions/llm") {
      return handleLlm(request, url);
    }

    if (path === "/api/resolve-maps" || path === "/.netlify/functions/resolve-maps") {
      return handleResolveMaps(request, url);
    }

    if (path === "/api/geocode/label" || path === "/.netlify/functions/geocode-label") {
      return handleGeocodeLabel(request, url);
    }

    return env.ASSETS.fetch(request);
  },
};
