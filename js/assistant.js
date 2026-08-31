/**
 * True AI assistant with tool-calling — Gemini, Groq, or OpenRouter.
 * Scoped per allowlisted user (own key + provider + chat).
 * Chat syncs to Firestore assistantChats/{uid}.
 */
(function () {
  const LS_PREFIX = "mister-worldwide-assist-v1:";
  const LEGACY_KEY = "mister-worldwide-gemini-api-key";
  const GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-flash-latest",
  ];
  const PROVIDERS = {
    gemini: {
      id: "gemini",
      label: "Gemini",
      signup: "https://aistudio.google.com/apikey",
      models: GEMINI_MODELS,
    },
    groq: {
      id: "groq",
      label: "Groq",
      signup: "https://console.groq.com/keys",
      // Prefer small/fast models first (free TPM limits are tight on 70B)
      models: ["llama-3.1-8b-instant", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"],
      proxyBase: "/api/llm/groq",
      directBase: "https://api.groq.com/openai/v1",
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter",
      signup: "https://openrouter.ai/keys",
      // Free catalog rotates — prefer router, then current :free slugs
      models: [
        "openrouter/free",
        "openai/gpt-oss-20b:free",
        "nvidia/nemotron-3-nano-30b-a3b:free",
        "google/gemma-4-31b-it:free",
        "inclusionai/ling-3.0-flash:free",
        "cohere/north-mini-code:free",
      ],
      proxyBase: "/api/llm/openrouter",
      directBase: "https://openrouter.ai/api/v1",
    },
  };

  /** Preferred order for Auto mode (best → fallback). Only used if that provider has a key. */
  const AUTO_RANKED = [
    { provider: "gemini", model: "gemini-2.5-flash" },
    { provider: "gemini", model: "gemini-2.5-flash-lite" },
    { provider: "groq", model: "llama-3.1-8b-instant" },
    { provider: "openrouter", model: "openrouter/free" },
    { provider: "groq", model: "openai/gpt-oss-20b" },
    { provider: "gemini", model: "gemini-flash-latest" },
    { provider: "openrouter", model: "openai/gpt-oss-20b:free" },
    { provider: "gemini", model: "gemini-3.5-flash" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
    { provider: "openrouter", model: "nvidia/nemotron-3-nano-30b-a3b:free" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "openrouter", model: "inclusionai/ling-3.0-flash:free" },
    { provider: "openrouter", model: "cohere/north-mini-code:free" },
  ];

  let activeModel = GEMINI_MODELS[0];
  const MAX_UNDO = 40;
  const MAX_HISTORY = 24;
  const MAX_HISTORY_LLM = 12; // keep OpenAI/Groq prompts smaller for free TPM
  const MAX_UI_LOG = 80;

  let undoStack = [];
  let chatHistory = [];
  let uiLog = [];
  let busy = false;
  let currentUser = null; // { uid, email, displayName }
  let saveTimer = null;
  let uiBound = false;
  let providerId = "gemini";
  /** Latest key per provider: { gemini, groq, openrouter } */
  let providerKeys = { gemini: "", groq: "", openrouter: "" };
  /** Auto: rotate across providers/models, skip rate-limited, keep shared chat text */
  let autoMode = false;
  let lastAutoPick = null; // { provider, model }
  /** modelCooldownKey → epoch ms until reusable */
  let modelCooldowns = {};

  function emptyKeys() {
    return { gemini: "", groq: "", openrouter: "" };
  }

  function migrateKeys(parsed) {
    const keys = emptyKeys();
    if (parsed?.keys && typeof parsed.keys === "object") {
      keys.gemini = String(parsed.keys.gemini || "").trim();
      keys.groq = String(parsed.keys.groq || "").trim();
      keys.openrouter = String(parsed.keys.openrouter || "").trim();
    }
    // Legacy single apiKey → slot for that provider
    const legacyKey = String(parsed?.apiKey || "").trim();
    if (legacyKey) {
      const p = normalizeProvider(
        parsed?.provider || detectProviderFromKey(legacyKey) || "gemini"
      );
      if (!keys[p]) keys[p] = legacyKey;
    }
    return keys;
  }

  function modelOptionValue(provider, model) {
    return `${provider}::${model}`;
  }

  function parseModelOptionValue(val) {
    const s = String(val || "");
    const i = s.indexOf("::");
    if (i < 0) return null;
    return {
      provider: normalizeProvider(s.slice(0, i)),
      model: s.slice(i + 2),
    };
  }

  function shortModelLabel(model) {
    const m = String(model || "");
    if (m.length <= 36) return m;
    return m.replace(/^[^/]+\//, "");
  }

  const TOOLS = [
    {
      name: "get_world_snapshot",
      description: "Get countries, place counts, categories, and recent places. Call before answering or changing data.",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING", description: "Optional country name or id filter" },
          recent_limit: { type: "INTEGER", description: "Recent places to include (default 15, max 50)" },
        },
      },
    },
    {
      name: "search_places",
      description: "Search saved places by name, city, country, or category.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING" },
          country: { type: "STRING" },
          city: { type: "STRING" },
          category: { type: "STRING", description: "museum, restaurant, park, beach, etc." },
          limit: { type: "INTEGER" },
        },
      },
    },
    {
      name: "add_place",
      description: "Add a place to a country list (Google Maps style).",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING", description: "Country name or id" },
          name: { type: "STRING" },
          city: { type: "STRING" },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
          url: { type: "STRING" },
          category: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["country", "name", "lat", "lng"],
      },
    },
    {
      name: "update_place",
      description: "Update an existing place by id.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          name: { type: "STRING" },
          city: { type: "STRING" },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
          url: { type: "STRING" },
          category: { type: "STRING" },
          country: { type: "STRING", description: "Move to another country" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_place",
      description: "Delete a place by id.",
      parameters: {
        type: "OBJECT",
        properties: { id: { type: "STRING" } },
        required: ["id"],
      },
    },
    {
      name: "add_country",
      description: "Add a new country to the globe (if not already present).",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          iso: { type: "STRING", description: "2-letter ISO code for flag" },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
        },
        required: ["name", "iso", "lat", "lng"],
      },
    },
    {
      name: "update_country",
      description: "Update a country's name, ISO flag code, or pin location on the globe.",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING", description: "Country name or id" },
          name: { type: "STRING" },
          iso: { type: "STRING", description: "2-letter ISO code for flag" },
          lat: { type: "NUMBER" },
          lng: { type: "NUMBER" },
        },
        required: ["country"],
      },
    },
    {
      name: "remove_country",
      description: "Remove a country and all its places.",
      parameters: {
        type: "OBJECT",
        properties: { country: { type: "STRING" } },
        required: ["country"],
      },
    },
    {
      name: "delete_places",
      description: "Delete multiple places by ids or by filter (country, city, category, name query).",
      parameters: {
        type: "OBJECT",
        properties: {
          ids: { type: "ARRAY", items: { type: "STRING" }, description: "Specific place ids to delete" },
          country: { type: "STRING" },
          city: { type: "STRING" },
          category: { type: "STRING" },
          query: { type: "STRING", description: "Name/description substring match" },
        },
      },
    },
    {
      name: "import_csv_places",
      description: "Import Google My Maps CSV rows into a country (Name,Description,Latitude,Longitude,Url).",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING" },
          csv_text: { type: "STRING" },
        },
        required: ["country", "csv_text"],
      },
    },
    {
      name: "undo_last_change",
      description: "Undo the last assistant mutation to travel data.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "get_planner_snapshot",
      description: "Get active travel planner trips, days, and suggestions (compact).",
      parameters: {
        type: "OBJECT",
        properties: {
          trip_id: { type: "STRING", description: "Optional trip id; defaults to active trip" },
        },
      },
    },
    {
      name: "planner_create_trip",
      description: "Create a travel planner trip for a country and city.",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING" },
          city: { type: "STRING" },
          name: { type: "STRING" },
          days: { type: "INTEGER", description: "Number of days (default 3)" },
        },
        required: ["country", "city"],
      },
    },
    {
      name: "planner_add_to_day",
      description: "Add a saved place to a planner day slot (breakfast, lunch, dinner, drinks, activity, hotel, etc.).",
      parameters: {
        type: "OBJECT",
        properties: {
          place_id: { type: "STRING" },
          day: { type: "INTEGER" },
          slot: { type: "STRING", description: "breakfast, lunch, dinner, drinks, dessert, show, activity, afternoon, hotel, transport" },
          note: { type: "STRING", description: "e.g. breakfast, drinks, show" },
          trip_id: { type: "STRING" },
        },
        required: ["place_id", "day", "slot"],
      },
    },
    {
      name: "planner_suggest_day",
      description: "Suggest places for one planner day using local heuristics (low token). Optional AI if key set.",
      parameters: {
        type: "OBJECT",
        properties: {
          day: { type: "INTEGER" },
          trip_id: { type: "STRING" },
          use_ai: { type: "BOOLEAN", description: "Use compact AI call (default false)" },
          hour: { type: "INTEGER" },
          weather: { type: "STRING" },
        },
        required: ["day"],
      },
    },
    {
      name: "planner_add_segment",
      description: "Add a city/country segment with dates to an existing trip (multi-city / multi-country).",
      parameters: {
        type: "OBJECT",
        properties: {
          country: { type: "STRING" },
          city: { type: "STRING" },
          start_date: { type: "STRING" },
          end_date: { type: "STRING" },
          trip_id: { type: "STRING" },
        },
        required: ["country", "city", "start_date", "end_date"],
      },
    },
    {
      name: "import_google_maps_csv",
      description: "Import Google My Maps CSV paste (Name,Description,Latitude,Longitude,Url). Creates countries/cities/categories automatically.",
      parameters: {
        type: "OBJECT",
        properties: {
          csv_text: { type: "STRING", description: "Full CSV including header row" },
        },
        required: ["csv_text"],
      },
    },
    {
      name: "import_maps_urls",
      description: "Import one or more Google Maps place URLs (including maps.app.goo.gl short links).",
      parameters: {
        type: "OBJECT",
        properties: {
          urls: { type: "STRING", description: "Maps URLs, one per line or space-separated" },
          country: { type: "STRING", description: "Optional country hint" },
          city: { type: "STRING", description: "Optional city hint" },
        },
        required: ["urls"],
      },
    },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function userKey() {
    const email = (currentUser?.email || "").trim().toLowerCase();
    return email || "local";
  }

  function syncUserFromApp() {
    if (currentUser?.email && currentUser.email !== "local@device") return currentUser;
    const u = window.WorldApp?.getUser?.();
    if (u?.email) {
      currentUser = {
        uid: u.uid || null,
        email: String(u.email).trim().toLowerCase(),
        displayName: u.displayName || String(u.email).split("@")[0],
      };
      return currentUser;
    }
    if (!WorldCloud?.configured && !currentUser) {
      currentUser = { uid: "local", email: "local@device", displayName: "Local" };
    }
    return currentUser;
  }

  function ensureAssistantUser() {
    syncUserFromApp();
    if (currentUser) return true;
    if (WorldCloud?.configured) {
      bot("Sign in with an allowlisted account, then add your API key.");
      return false;
    }
    currentUser = { uid: "local", email: "local@device", displayName: "Local" };
    return true;
  }

  function toggleKeyForm(show) {
    const form = $("assist-key-form");
    if (!form) return;
    const shouldShow = show != null ? !!show : !!form.hidden;
    form.hidden = !shouldShow;
    if (shouldShow) {
      const prov = $("assist-key-provider");
      const input = $("assist-key-input");
      if (prov) prov.value = providerId === "auto" ? "gemini" : providerId;
      if (input) {
        const cur = getApiKey(prov?.value || providerId);
        input.value = "";
        input.placeholder = cur ? "Paste new key to replace (leave blank + Clear to remove)" : "Paste your API key";
      }
    }
  }

  function saveKeyFromForm() {
    if (!ensureAssistantUser()) return;
    const prov = normalizeProvider($("assist-key-provider")?.value || providerId);
    const raw = $("assist-key-input")?.value?.trim();
    if (!raw) {
      bot("Paste a key in the field, or tap Clear to remove the saved key.");
      return;
    }
    const cleaned = raw.replace(/^["']|["']$/g, "");
    const withPrefix = parseKeyCommand(`key ${cleaned}`);
    const savedAs = setApiKey(withPrefix?.key || cleaned, prov || withPrefix?.provider || detectProviderFromKey(cleaned));
    toggleKeyForm(false);
    bot(
      `${PROVIDERS[savedAs].label} key saved${WorldCloud?.configured && currentUser?.uid !== "local" ? " to cloud" : ""}.\n` +
        "Pick a model above (key ✓) or use Auto mode."
    );
  }

  function clearKeyFromForm() {
    if (!ensureAssistantUser()) return;
    const prov = normalizeProvider($("assist-key-provider")?.value || providerId);
    clearApiKey(prov);
    const input = $("assist-key-input");
    if (input) input.value = "";
    bot(`${PROVIDERS[prov].label} key cleared.`);
  }

  function storageKey() {
    return LS_PREFIX + userKey();
  }

  function normalizeProvider(id) {
    const p = String(id || "").trim().toLowerCase();
    if (p === "or" || p === "open-router") return "openrouter";
    if (p === "auto") return "auto";
    if (PROVIDERS[p]) return p;
    return "gemini";
  }

  function detectProviderFromKey(key) {
    const k = String(key || "").trim().replace(/^["']|["']$/g, "");
    if (!k) return null;
    if (k.startsWith("gsk_")) return "groq";
    if (k.startsWith("sk-or-") || k.startsWith("sk-or-v1-")) return "openrouter";
    // Google AI Studio / Gemini keys
    if (k.startsWith("AIza") || /^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return "gemini";
    return null;
  }

  function resolveKeyProvider(key, hint) {
    const cleaned = String(key || "").trim().replace(/^["']|["']$/g, "");
    if (hint && PROVIDERS[normalizeProvider(hint)]) {
      // Explicit hint wins, unless key clearly belongs to another provider
      const detected = detectProviderFromKey(cleaned);
      if (detected && detected !== normalizeProvider(hint)) {
        // e.g. user said gemini but pasted gsk_ → trust the key shape
        if (detected === "groq" || detected === "openrouter") return detected;
        if (normalizeProvider(hint) === "gemini" && detected === "gemini") return "gemini";
      }
      return normalizeProvider(hint);
    }
    return detectProviderFromKey(cleaned) || "gemini";
  }

  function providerLabel() {
    return PROVIDERS[providerId]?.label || "AI";
  }

  function loadLocalSession() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_KEY);
        const keys = emptyKeys();
        const p = detectProviderFromKey(legacy) || "gemini";
        if (legacy) keys[p] = legacy;
        return {
          keys,
          apiKey: keys[p] || "",
          provider: p,
          model: PROVIDERS[p].models[0],
          autoMode: true,
          lastAutoPick: null,
          modelCooldowns: {},
          chatHistory: [],
          uiLog: [],
        };
      }
      const parsed = JSON.parse(raw);
      const keys = migrateKeys(parsed);
      const provider = normalizeProvider(
        parsed.provider || detectProviderFromKey(keys.groq || keys.openrouter || keys.gemini) || "gemini"
      );
      const models = PROVIDERS[provider].models || [];
      let model = String(parsed.model || "").trim();
      if (!models.includes(model)) model = models[0];
      return {
        keys,
        apiKey: keys[provider] || "",
        provider,
        model,
        autoMode: parsed.autoMode !== false, // default on for new field
        lastAutoPick: parsed.lastAutoPick || null,
        modelCooldowns:
          parsed.modelCooldowns && typeof parsed.modelCooldowns === "object" ? parsed.modelCooldowns : {},
        chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory : [],
        uiLog: Array.isArray(parsed.uiLog) ? parsed.uiLog : [],
      };
    } catch {
      return {
        keys: emptyKeys(),
        apiKey: "",
        provider: "gemini",
        model: GEMINI_MODELS[0],
        autoMode: true,
        lastAutoPick: null,
        modelCooldowns: {},
        chatHistory: [],
        uiLog: [],
      };
    }
  }

  function sessionPayload() {
    // Drop expired cooldowns to keep storage small
    const now = Date.now();
    const cool = {};
    for (const [k, until] of Object.entries(modelCooldowns || {})) {
      if (Number(until) > now) cool[k] = Number(until);
    }
    modelCooldowns = cool;
    return {
      keys: { ...providerKeys },
      apiKey: providerKeys[providerId] || "",
      provider: providerId,
      model: activeModel,
      autoMode: !!autoMode,
      lastAutoPick: lastAutoPick || null,
      modelCooldowns: cool,
      chatHistory,
      uiLog: uiLog.slice(-MAX_UI_LOG),
    };
  }

  function persistLocalSession() {
    localStorage.setItem(storageKey(), JSON.stringify(sessionPayload()));
  }

  function scheduleCloudSave() {
    if (!currentUser?.uid || !window.WorldCloud?.saveAssistantChat) return;
    if (currentUser.uid === "local") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      WorldCloud.saveAssistantChat(currentUser.uid, sessionPayload()).catch((e) =>
        console.warn("Assistant chat sync failed", e)
      );
    }, 600);
  }

  /** Immediate cloud write — use when saving API keys so redeploys/other browsers keep them */
  async function flushCloudSave() {
    if (!currentUser?.uid || !window.WorldCloud?.saveAssistantChat) return;
    if (currentUser.uid === "local") return;
    clearTimeout(saveTimer);
    try {
      await WorldCloud.saveAssistantChat(currentUser.uid, sessionPayload());
    } catch (e) {
      console.warn("Assistant cloud flush failed", e);
    }
  }

  function getApiKey(forProvider) {
    const p = normalizeProvider(forProvider || providerId);
    const fromMap = String(providerKeys[p] || "").trim();
    if (fromMap) return fromMap;
    return String(window.GEMINI_API_KEY || window.LLM_API_KEY || "").trim();
  }

  function resetHistoryForProviderSwitch(prevProvider, nextProvider) {
    if (prevProvider && prevProvider !== nextProvider) {
      chatHistory = textOnlyHistory(chatHistory);
    }
  }

  function setApiKey(key, providerHint) {
    const val = String(key || "").trim().replace(/^["']|["']$/g, "");
    const prev = providerId;
    const p = resolveKeyProvider(val, providerHint);
    providerKeys[p] = val;
    providerId = p;
    const models = PROVIDERS[p].models || [];
    if (!models.includes(activeModel)) activeModel = models[0] || activeModel;
    resetHistoryForProviderSwitch(prev, p);
    localStorage.removeItem(LEGACY_KEY);
    persistLocalSession();
    refreshModelSelect();
    updateAssistSub();
    flushCloudSave();
    return p;
  }

  function clearApiKey(forProvider) {
    const p = normalizeProvider(forProvider || providerId);
    providerKeys[p] = "";
    persistLocalSession();
    refreshModelSelect();
    updateAssistSub();
    flushCloudSave();
  }

  function setActiveModel(provider, model) {
    if (provider === "auto" || model === "auto") {
      autoMode = true;
      persistLocalSession();
      refreshModelSelect();
      updateAssistSub();
      scheduleCloudSave();
      return;
    }
    autoMode = false;
    const prev = providerId;
    providerId = normalizeProvider(provider);
    const models = PROVIDERS[providerId].models || [];
    activeModel = models.includes(model) ? model : models[0];
    resetHistoryForProviderSwitch(prev, providerId);
    persistLocalSession();
    refreshModelSelect();
    updateAssistSub();
    scheduleCloudSave();
  }

  function refreshModelSelect() {
    const sel = $("assist-model");
    if (!sel) return;
    sel.innerHTML = "";

    const autoOpt = document.createElement("option");
    autoOpt.value = "auto::auto";
    const nKeys = ["gemini", "groq", "openrouter"].filter((p) => !!String(providerKeys[p] || "").trim()).length;
    autoOpt.textContent = `Auto · best available (${nKeys} key${nKeys === 1 ? "" : "s"})`;
    sel.appendChild(autoOpt);

    for (const [pid, p] of Object.entries(PROVIDERS)) {
      const group = document.createElement("optgroup");
      const hasKey = !!String(providerKeys[pid] || "").trim();
      group.label = `${p.label}${hasKey ? " · key ✓" : " · add key"}`;
      for (const model of p.models) {
        const opt = document.createElement("option");
        opt.value = modelOptionValue(pid, model);
        const cool = isModelCooling(pid, model);
        opt.textContent = hasKey
          ? `${shortModelLabel(model)}${cool ? " · max-usage cool" : ""}`
          : `${shortModelLabel(model)} (needs key)`;
        group.appendChild(opt);
      }
      sel.appendChild(group);
    }

    if (autoMode) {
      sel.value = "auto::auto";
      return;
    }
    const current = modelOptionValue(providerId, activeModel);
    if (![...sel.options].some((o) => o.value === current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = shortModelLabel(activeModel);
      sel.appendChild(opt);
    }
    sel.value = current;
  }

  function updateAssistSub() {
    const sub = $("assist-sub");
    if (!sub) return;
    if (currentUser?.email) {
      if (autoMode) {
        const pick = lastAutoPick
          ? `${PROVIDERS[lastAutoPick.provider]?.label || lastAutoPick.provider} · ${shortModelLabel(lastAutoPick.model)}`
          : "best available";
        sub.textContent = `Auto → ${pick}`;
      } else {
        const keyOk = getApiKey() ? "key ✓" : "need key";
        sub.textContent = `${providerLabel()} · ${shortModelLabel(activeModel)} · ${keyOk}`;
      }
    } else {
      sub.textContent = "AI · per-user · undo";
    }
  }

  function cooldownKey(provider, model) {
    return `${provider}::${model}`;
  }

  function isModelCooling(provider, model) {
    return Date.now() < Number(modelCooldowns[cooldownKey(provider, model)] || 0);
  }

  /** Cooldown only for max-usage / quota / TPM style unavailability */
  function markModelCooldown(provider, model, err) {
    const msg = String(err?.message || err || "");
    let ms = parseRetryAfterMs(err);
    if (/per hour|hourly|per day|daily|quota|exhausted/i.test(msg)) ms = Math.max(ms, 10 * 60 * 1000);
    else if (/tokens per minute|TPM|RPM|rate limit|429|too many requests/i.test(msg)) ms = Math.max(ms, 65 * 1000);
    else ms = Math.max(ms, 90 * 1000);
    modelCooldowns[cooldownKey(provider, model)] = Date.now() + ms;
  }

  function isMaxUsageUnavailable(err) {
    const msg = String(err?.message || err || "");
    return (
      err?.status === 429 ||
      /HTTP 429|rate limit|tokens per minute|TPM|RPM|too many requests|quota|resource exhausted|max usage|usage limit|prepay|credits are depleted|high demand|overloaded|capacity|unavailable for free/i.test(
        msg
      )
    );
  }

  function isModelGoneError(err) {
    const msg = String(err?.message || err || "");
    return /no longer available|model_not_found|not found|no endpoints|does not exist|invalid model|404/i.test(msg);
  }

  function getAutoCandidates() {
    const seen = new Set();
    const list = [];
    const push = (c) => {
      const k = cooldownKey(c.provider, c.model);
      if (seen.has(k)) return;
      if (!getApiKey(c.provider)) return;
      if (!(PROVIDERS[c.provider]?.models || []).includes(c.model)) return;
      if (isModelCooling(c.provider, c.model)) return;
      seen.add(k);
      list.push(c);
    };
    if (lastAutoPick) push(lastAutoPick);
    for (const c of AUTO_RANKED) push(c);
    for (const [pid, p] of Object.entries(PROVIDERS)) {
      for (const model of p.models || []) push({ provider: pid, model });
    }
    return list;
  }

  function clearLogDom() {
    const log = $("assist-log");
    if (log) {
      log.innerHTML = "";
      delete log.dataset.welcomed;
    }
  }

  function renderUiLog() {
    clearLogDom();
    for (const row of uiLog) {
      appendBubble(row.text, row.who, false);
    }
    const log = $("assist-log");
    if (log) log.dataset.welcomed = "1";
  }

  function clone(s) {
    return structuredClone(s);
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function snapshot(label) {
    const api = window.WorldApp;
    if (!api) return;
    undoStack.push({ label, state: clone(api.getState()) });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function persistRefresh(state, { touchPlanner } = {}) {
    const api = window.WorldApp;
    api.setState(state, { skipPersist: true });
    if (touchPlanner) api.persistPlanner();
    else {
      api.persist();
      api.refresh();
    }
  }

  function appendBubble(text, who, track = true) {
    const log = $("assist-log");
    if (!log) return null;
    const el = document.createElement("div");
    el.className = `assist-bubble assist-${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    if (track && (who === "bot" || who === "me")) {
      uiLog.push({ who, text: String(text), at: Date.now() });
      if (uiLog.length > MAX_UI_LOG) uiLog = uiLog.slice(-MAX_UI_LOG);
      persistLocalSession();
      scheduleCloudSave();
    }
    return el;
  }

  function bot(text) {
    return appendBubble(text, "bot");
  }

  function me(text) {
    return appendBubble(text, "me");
  }

  function setTyping(on) {
    const log = $("assist-log");
    if (!log) return;
    let el = log.querySelector(".assist-typing");
    if (on) {
      if (!el) {
        el = document.createElement("div");
        el.className = "assist-bubble assist-bot assist-typing";
        el.textContent = "Thinking…";
        log.appendChild(el);
      }
      log.scrollTop = log.scrollHeight;
    } else if (el) {
      el.remove();
    }
  }

  function openPanel(open) {
    const panel = $("assist-panel");
    const fab = $("assist-fab");
    if (!panel) return;
    const shouldOpen = open !== false;
    syncUserFromApp();
    panel.classList.toggle("open", shouldOpen);
    if (shouldOpen) panel.removeAttribute("hidden");
    else {
      panel.setAttribute("hidden", "");
      toggleKeyForm(false);
    }
    fab?.classList.toggle("open", shouldOpen);
    if (shouldOpen) $("assist-input")?.focus();
  }

  function systemPrompt() {
    const who = currentUser?.email || "local user";
    const name = currentUser?.displayName || who;
    return [
      "You are the Mister Worldwide AI travel assistant.",
      `You are helping ${name} (${who}), an allowlisted user.`,
      "Data is PRIVATE to this signed-in user. You manage countries, Google Maps saved places on a 3D globe, and Travel Planner trips.",
      "Planner slots: breakfast, brunch, lunch, afternoon, dinner, drinks, dessert, show, activity, hotel, transport.",
      "Use planner_create_trip, planner_add_segment, planner_suggest_day (prefer use_ai:false), planner_add_to_day, get_planner_snapshot, import_google_maps_csv, import_maps_urls.",
      "Categories include: pizza, burger, sushi, ramen, bagel, museum, landmark, park, and more.",
      "Places are grouped by country and city. CSV format: Name,Description,Latitude,Longitude,Url.",
      "ALWAYS use tools to read or change data — never invent places or countries.",
      "If ambiguous, ask a short clarifying question BEFORE mutating.",
      "After changes, briefly confirm what changed and offer undo if useful.",
      `Today's date is ${todayISO()}.`,
    ].join(" ");
  }

  function resolveCountryId(hint, state) {
    const t = String(hint || "").trim().toLowerCase();
    if (!t) return null;
    const c = (state.countries || []).find(
      (x) => x.id === t || x.name.toLowerCase() === t || x.name.toLowerCase().includes(t)
    );
    return c?.id || null;
  }

  function formatPlace(p, state) {
    const country = state.countries.find((c) => c.id === p.countryId);
    return {
      id: p.id,
      name: p.name,
      city: p.city,
      country: country?.name || p.countryId,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      url: p.url || "",
    };
  }

  async function runTool(name, args) {
    const api = window.WorldApp;
    if (!api?.getState?.()) return { ok: false, error: "App not ready." };
    args = args || {};

    if (name === "get_world_snapshot") {
      const state = api.getState();
      const limit = Math.min(50, Math.max(1, Number(args.recent_limit) || 15));
      let countries = state.countries || [];
      if (args.country) {
        const id = resolveCountryId(args.country, state);
        countries = id ? countries.filter((c) => c.id === id) : countries.filter((c) => c.name.toLowerCase().includes(String(args.country).toLowerCase()));
      }
      const recent = (state.places || []).slice(-limit).map((p) => formatPlace(p, state)).reverse();
      return {
        ok: true,
        countryCount: (state.countries || []).length,
        placeCount: (state.places || []).length,
        countries: countries.map((c) => ({ id: c.id, name: c.name, iso: c.iso, placeCount: c.placeCount, lat: c.lat, lng: c.lng })),
        categories: state.categories || [],
        recentPlaces: recent,
      };
    }

    if (name === "search_places") {
      const state = api.getState();
      let list = [...(state.places || [])];
      const q = String(args.query || "").toLowerCase().trim();
      if (q) list = list.filter((p) => `${p.name} ${p.city} ${p.description}`.toLowerCase().includes(q));
      if (args.country) {
        const id = resolveCountryId(args.country, state);
        if (id) list = list.filter((p) => p.countryId === id);
      }
      if (args.city) list = list.filter((p) => p.city.toLowerCase().includes(String(args.city).toLowerCase()));
      if (args.category) list = list.filter((p) => p.category === args.category);
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
      list = list.slice(0, limit);
      return { ok: true, count: list.length, places: list.map((p) => formatPlace(p, state)) };
    }

    if (name === "add_place") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      const lat = Number(args.lat), lng = Number(args.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: "Invalid coordinates" };
      snapshot(`Add place ${args.name}`);
      const country = state.countries.find((c) => c.id === countryId);
      const place = {
        id: WorldStore.nextPlaceId(state),
        countryId,
        name: args.name,
        city: args.city || "Other",
        lat, lng,
        url: args.url || "",
        description: args.description || `${args.city || "Other"} | ${country.name} | ${args.url || ""}`,
        category: args.category || PlaceCategorize.categorize(args.name, args.description || ""),
      };
      state.places.push(place);
      WorldStore.recalcCountry(state, countryId);
      persistRefresh(state);
      return { ok: true, place: formatPlace(place, state) };
    }

    if (name === "update_place") {
      snapshot(`Update place ${args.id}`);
      const state = api.getState();
      const place = (state.places || []).find((p) => p.id === args.id);
      if (!place) return { ok: false, error: "Place not found" };
      const prevCountry = place.countryId;
      if (args.name != null) place.name = args.name;
      if (args.city != null) place.city = args.city;
      if (args.lat != null) place.lat = Number(args.lat);
      if (args.lng != null) place.lng = Number(args.lng);
      if (args.url != null) place.url = args.url;
      if (args.category != null) place.category = args.category;
      if (args.country) {
        const cid = resolveCountryId(args.country, state);
        if (cid) place.countryId = cid;
      }
      WorldStore.recalcCountry(state, prevCountry);
      WorldStore.recalcCountry(state, place.countryId);
      persistRefresh(state);
      return { ok: true, place: formatPlace(place, state) };
    }

    if (name === "delete_place") {
      snapshot(`Delete place ${args.id}`);
      const state = api.getState();
      const place = (state.places || []).find((p) => p.id === args.id);
      if (!place) return { ok: false, error: "Place not found" };
      state.places = state.places.filter((p) => p.id !== args.id);
      WorldStore.recalcCountry(state, place.countryId);
      persistRefresh(state);
      return { ok: true, deleted: args.id };
    }

    if (name === "add_country") {
      snapshot(`Add country ${args.name}`);
      const state = api.getState();
      const id = String(args.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (state.countries.find((c) => c.id === id)) return { ok: false, error: "Country already exists" };
      const country = {
        id, name: args.name, iso: String(args.iso).toLowerCase().slice(0, 2),
        lat: Number(args.lat), lng: Number(args.lng), placeCount: 0,
      };
      state.countries.push(country);
      persistRefresh(state);
      return { ok: true, country };
    }

    if (name === "update_country") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      const country = state.countries.find((c) => c.id === countryId);
      if (!country) return { ok: false, error: "Country not found" };
      snapshot(`Update country ${country.name}`);
      if (args.name != null) country.name = args.name;
      if (args.iso != null) country.iso = String(args.iso).toLowerCase().slice(0, 2);
      if (args.lat != null) country.lat = Number(args.lat);
      if (args.lng != null) country.lng = Number(args.lng);
      persistRefresh(state);
      return { ok: true, country: { id: country.id, name: country.name, iso: country.iso, lat: country.lat, lng: country.lng, placeCount: country.placeCount } };
    }

    if (name === "remove_country") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      snapshot(`Remove country ${countryId}`);
      const removed = (state.places || []).filter((p) => p.countryId === countryId).length;
      state.countries = state.countries.filter((c) => c.id !== countryId);
      state.places = state.places.filter((p) => p.countryId !== countryId);
      persistRefresh(state);
      return { ok: true, removed, placesRemoved: removed };
    }

    if (name === "delete_places") {
      const state = api.getState();
      let list = [...(state.places || [])];
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      if (ids.length) {
        list = list.filter((p) => ids.includes(p.id));
      } else {
        if (args.country) {
          const cid = resolveCountryId(args.country, state);
          if (cid) list = list.filter((p) => p.countryId === cid);
        }
        if (args.city) list = list.filter((p) => p.city.toLowerCase().includes(String(args.city).toLowerCase()));
        if (args.category) list = list.filter((p) => p.category === args.category);
        if (args.query) {
          const q = String(args.query).toLowerCase();
          list = list.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q));
        }
      }
      if (!list.length) return { ok: false, error: "No matching places to delete" };
      snapshot(`Delete ${list.length} places`);
      const removeIds = new Set(list.map((p) => p.id));
      const touched = new Set(list.map((p) => p.countryId));
      state.places = state.places.filter((p) => !removeIds.has(p.id));
      for (const cid of touched) WorldStore.recalcCountry(state, cid);
      persistRefresh(state);
      return { ok: true, deleted: list.length, ids: [...removeIds].slice(0, 20) };
    }

    if (name === "import_csv_places") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      snapshot(`Import CSV to ${countryId}`);
      try {
        const added = WorldStore.importCsvPlaces(state, countryId, args.csv_text);
        persistRefresh(state);
        return { ok: true, imported: added.length, places: added.slice(0, 5).map((p) => formatPlace(p, state)) };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }

    if (name === "undo_last_change") {
      if (!undoStack.length) return { ok: false, error: "Nothing to undo" };
      const last = undoStack.pop();
      persistRefresh(clone(last.state));
      return { ok: true, reverted: last.label };
    }

    if (name === "get_planner_snapshot") {
      const state = api.getState();
      WorldPlanner.ensurePlanner(state);
      const trip = args.trip_id
        ? state.planner.trips.find((t) => t.id === args.trip_id)
        : WorldPlanner.getActiveTrip(state);
      if (!trip) {
        return {
          ok: true,
          trips: (state.planner.trips || []).map((t) => ({
            id: t.id, name: t.name, city: t.city, countryId: t.countryId, dayCount: t.dayCount,
          })),
        };
      }
      return {
        ok: true,
        trip: {
          id: trip.id, name: trip.name, city: trip.city, countryId: trip.countryId, dayCount: trip.dayCount,
          days: (trip.days || []).map((d) => ({
            day: d.day,
            slots: Object.fromEntries(
              Object.entries(d.slots || {}).map(([k, v]) => [k, (v || []).map((e) => ({ name: e.name, note: e.note }))])
            ),
          })),
          suggestions: (trip.suggestions || []).slice(0, 12).map((s) => ({ name: s.name, slot: s.slot, reason: s.reason })),
        },
      };
    }

    if (name === "planner_create_trip") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      snapshot(`Create trip ${args.city}`);
      const trip = WorldPlanner.createTrip(state, {
        countryId,
        city: args.city || "Other",
        name: args.name,
        dayCount: Number(args.days) || 3,
      });
      persistRefresh(state, { touchPlanner: true });
      return { ok: true, trip: { id: trip.id, name: trip.name, city: trip.city, dayCount: trip.dayCount } };
    }

    if (name === "planner_add_to_day") {
      const state = api.getState();
      const place = (state.places || []).find((p) => p.id === args.place_id);
      if (!place) return { ok: false, error: "Place not found" };
      const trip = args.trip_id
        ? WorldPlanner.ensurePlanner(state).trips.find((t) => t.id === args.trip_id)
        : WorldPlanner.getActiveTrip(state);
      if (!trip) return { ok: false, error: "No active trip — create one first" };
      snapshot(`Add ${place.name} to day ${args.day}`);
      WorldPlanner.addPlace(state, trip.id, Number(args.day) || 1, args.slot, place, args.note || "");
      persistRefresh(state, { touchPlanner: true });
      return { ok: true, added: place.name, day: args.day, slot: args.slot };
    }

    if (name === "planner_suggest_day") {
      const state = api.getState();
      const trip = args.trip_id
        ? WorldPlanner.ensurePlanner(state).trips.find((t) => t.id === args.trip_id)
        : WorldPlanner.getActiveTrip(state);
      if (!trip) return { ok: false, error: "No active trip" };
      const dayNum = Number(args.day) || 1;
      const opts = { hour: args.hour, weather: args.weather };
      if (args.use_ai) await WorldPlanner.aiSuggestDay(state, trip, dayNum, opts);
      else WorldPlanner.localSuggestDay(state, trip, dayNum, opts);
      persistRefresh(state, { touchPlanner: true });
      return {
        ok: true,
        source: args.use_ai ? "ai" : "local",
        suggestions: (trip.suggestions || []).slice(0, 15).map((s) => ({
          name: s.name, slot: s.slot, reason: s.reason, placeId: s.placeId,
        })),
      };
    }

    if (name === "planner_add_segment") {
      const state = api.getState();
      const countryId = resolveCountryId(args.country, state);
      if (!countryId) return { ok: false, error: "Country not found" };
      const trip = args.trip_id
        ? WorldPlanner.ensurePlanner(state).trips.find((t) => t.id === args.trip_id)
        : WorldPlanner.getActiveTrip(state);
      if (!trip) return { ok: false, error: "No active trip" };
      snapshot(`Add segment ${args.city}`);
      WorldPlanner.addSegment(state, trip.id, {
        countryId, city: args.city, startDate: args.start_date, endDate: args.end_date,
      });
      persistRefresh(state, { touchPlanner: true });
      return { ok: true, segments: trip.segments.length };
    }

    if (name === "import_google_maps_csv") {
      const state = api.getState();
      if (!args.csv_text) return { ok: false, error: "csv_text required" };
      snapshot("Import Google Maps CSV");
      try {
        const r = WorldMapsImport.importText(state, args.csv_text);
        persistRefresh(state);
        return {
          ok: true,
          added: r.added.length,
          skipped: r.skipped.length,
          sample: r.added.slice(0, 5).map((p) => ({ name: p.name, city: p.city, category: p.category })),
        };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }

    if (name === "import_maps_urls") {
      const state = api.getState();
      if (!args.urls) return { ok: false, error: "urls required" };
      snapshot("Import Google Maps URLs");
      try {
        const countryId = args.country ? resolveCountryId(args.country, state) : null;
        const country = countryId ? state.countries.find((c) => c.id === countryId) : null;
        const r = await WorldMapsImport.importMapsUrls(state, args.urls, {
          countryId,
          countryName: country?.name,
          city: args.city,
        });
        persistRefresh(state);
        return {
          ok: true,
          added: r.added.length,
          skipped: r.skipped.length,
          geocoded: r.geocoded || 0,
          sample: r.added.slice(0, 5).map((p) => ({ name: p.name, city: p.city, category: p.category })),
        };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }

    return { ok: false, error: `Unknown tool: ${name}` };
  }

  function geminiTypeToJson(t) {
    const u = String(t || "STRING").toUpperCase();
    if (u === "NUMBER") return "number";
    if (u === "INTEGER") return "integer";
    if (u === "BOOLEAN") return "boolean";
    if (u === "ARRAY") return "array";
    if (u === "OBJECT") return "object";
    return "string";
  }

  function toolsOpenAI() {
    return TOOLS.map((t) => {
      const props = {};
      const src = t.parameters?.properties || {};
      for (const [k, v] of Object.entries(src)) {
        const jsonType = geminiTypeToJson(v.type);
        // Groq validates strictly — models often send numbers as strings or vice versa; never null
        if (jsonType === "number" || jsonType === "integer" || (t.name === "update_assumption" && k === "value") || (t.name === "set_month_override" && k === "value")) {
          props[k] = {
            anyOf: [{ type: "string" }, { type: "number" }],
            description: (v.description || k) + " (string or number; never null)",
          };
          continue;
        }
        const prop = { type: jsonType };
        if (v.description) prop.description = v.description;
        props[k] = prop;
      }
      const parameters = {
        type: "object",
        properties: props,
      };
      const req = t.parameters?.required;
      if (Array.isArray(req) && req.length) parameters.required = req;
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters,
        },
      };
    });
  }

  function isLocalHost() {
    const host = String(location.hostname || "");
    return !host || host === "localhost" || host === "127.0.0.1";
  }

  /** Ordered endpoints: Netlify Function only (redirect proxies break POST on mobile). */
  function llmEndpoints(provider) {
    const p = PROVIDERS[provider];
    const urls = [];
    if (location.protocol.startsWith("http")) {
      urls.push(`/.netlify/functions/llm?provider=${encodeURIComponent(provider)}`);
    }
    if (isLocalHost() && p?.directBase) {
      urls.push(`${p.directBase}/chat/completions`);
    }
    return urls;
  }

  function cloneGeminiPart(p) {
    if (!p || typeof p !== "object") return p;
    const out = {};
    if (p.text != null) out.text = p.text;
    if (p.functionCall) {
      out.functionCall = { ...p.functionCall };
      if (typeof out.functionCall.args === "string") {
        try { out.functionCall.args = JSON.parse(out.functionCall.args); } catch { /* */ }
      }
    }
    if (p.functionResponse) {
      out.functionResponse = {
        name: p.functionResponse.name,
        response: p.functionResponse.response ?? {},
      };
    }
    if (p.thought_signature != null) out.thought_signature = p.thought_signature;
    if (p.thoughtSignature != null) out.thoughtSignature = p.thoughtSignature;
    return out;
  }

  function extractMapsUrlsFromText(text) {
    const urls = [];
    const re = /https?:\/\/[^\s<>"']+/gi;
    for (const m of String(text || "").matchAll(re)) {
      const u = m[0].replace(/[),.;]+$/, "");
      if (WorldMapsImport?.isMapsUrl?.(u)) urls.push(u);
    }
    return [...new Set(urls)];
  }

  async function directImportMapsUrls(text) {
    const urls = extractMapsUrlsFromText(text);
    if (!urls.length) return null;
    const state = window.WorldApp?.getState?.();
    if (!state) throw new Error("App not ready");
    const r = await WorldMapsImport.importMapsUrls(state, urls.join("\n"));
    window.WorldApp.persist();
    window.WorldApp.refresh();
    return { urls, ...r };
  }

  function parseLlmError(data, res, rawText, label) {
    const msg =
      (typeof data?.error === "string" && data.error) ||
      data?.error?.message ||
      data?.error?.metadata?.raw ||
      data?.message ||
      (rawText && !rawText.trim().startsWith("<")
        ? rawText.trim().slice(0, 240)
        : "") ||
      res.statusText ||
      `${label} request failed`;
    if (/^\s*</.test(rawText || "") || /<!DOCTYPE|Mister Worldwide/i.test(rawText || "")) {
      return `Proxy not live (got HTML). Redeploy Netlify with netlify/functions, then hard-refresh. Or try: key openrouter sk-or-…`;
    }
    return `HTTP ${res.status}: ${msg}`;
  }

  async function geminiGenerate(contents, modelName) {
    const key = getApiKey();
    if (!key) throw new Error("NO_API_KEY");
    const model = modelName || activeModel;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || "Gemini request failed";
      const err = new Error(msg);
      err.status = res.status;
      err.model = model;
      throw err;
    }
    return data;
  }

  async function geminiGenerateWithFallback(contents) {
    // Auto mode owns cross-model failover; only hit the selected model here
    if (autoMode) {
      const data = await geminiGenerate(contents, activeModel);
      return data;
    }
    let lastErr = null;
    const tryOrder = [activeModel, ...GEMINI_MODELS.filter((m) => m !== activeModel)];
    for (const model of tryOrder) {
      try {
        const data = await geminiGenerate(contents, model);
        activeModel = model;
        refreshModelSelect();
        return data;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        if (/no longer available|not found|not supported|INVALID_ARGUMENT.*model/i.test(msg)) {
          continue;
        }
        if (typeof isMaxUsageUnavailable === "function" && isMaxUsageUnavailable(e)) {
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error("No Gemini model available");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function parseRetryAfterMs(err) {
    const msg = String(err?.message || err);
    const m = msg.match(/try again in\s+([\d.]+)\s*s/i);
    if (m) return Math.ceil(Number(m[1]) * 1000) + 250;
    if (err?.status === 429 || /rate limit|tokens per minute|TPM|RPM/i.test(msg)) {
      return 8000;
    }
    return 0;
  }

  function isRateLimitError(err) {
    const msg = String(err?.message || err);
    return err?.status === 429 || /HTTP 429|rate limit|tokens per minute|TPM|RPM|too many requests/i.test(msg);
  }

  /** Drop older turns so free-tier TPM stays under Groq limits */
  function trimMessagesForLlm(messages) {
    if (!messages?.length) return messages;
    const system = messages[0]?.role === "system" ? [messages[0]] : [];
    const rest = messages[0]?.role === "system" ? messages.slice(1) : messages.slice();
    if (rest.length <= MAX_HISTORY_LLM) return messages;
    // Keep tail, but don't start mid tool-result without its assistant tool_calls
    let start = rest.length - MAX_HISTORY_LLM;
    while (start > 0 && rest[start]?.role === "tool") start -= 1;
    return system.concat(rest.slice(start));
  }

  async function openAIChatAt(url, messages, model) {
    const key = getApiKey();
    if (!key) throw new Error("NO_API_KEY");
    const p = PROVIDERS[providerId];
    const trimmed = trimMessagesForLlm(messages);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = location.origin || "https://moneyplanneretc.netlify.app";
      headers["X-Title"] = "Mister Worldwide";
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: trimmed,
        tools: toolsOpenAI(),
        tool_choice: "auto",
        temperature: 0.4,
        max_tokens: providerId === "groq" ? 1024 : 2048,
      }),
    });

    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = {};
    }

    if (!res.ok) {
      const err = new Error(parseLlmError(data, res, rawText, p.label));
      err.status = res.status;
      err.model = model;
      err.url = url;
      throw err;
    }
    if (!data?.choices) {
      const err = new Error(
        parseLlmError(
          data,
          { status: res.status, statusText: "No choices in response" },
          rawText,
          p.label
        )
      );
      err.status = res.status;
      err.model = model;
      throw err;
    }
    return data;
  }

  async function openAIChat(messages, modelName) {
    const p = PROVIDERS[providerId];
    const model = modelName || activeModel || p.models[0];
    const endpoints = llmEndpoints(providerId);
    let lastErr = null;

    for (const url of endpoints) {
      try {
        return await openAIChatAt(url, messages, model);
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        // Bad key / billing — don't bother other endpoints
        if (/NO_API_KEY|401|invalid.*api.?key|incorrect api key|Unauthorized|prepay|credits are depleted/i.test(msg)) {
          throw e;
        }
        // Rate limit is per-model, not per-endpoint — bubble up for model fallback
        if (isRateLimitError(e)) {
          throw e;
        }
        // CORS / network — try next endpoint
        if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) {
          continue;
        }
        // HTML / missing function — try next
        if (/Proxy not live|404|502|503/i.test(msg)) {
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error(`${p.label} request failed (no reachable endpoint)`);
  }

  async function openAIChatWithFallback(messages) {
    const p = PROVIDERS[providerId];
    if (autoMode) {
      return openAIChat(messages, activeModel);
    }
    let lastErr = null;
    const preferred = p.models || [];
    const tryOrder = [
      ...preferred.filter((m) => m === activeModel),
      ...preferred.filter((m) => m !== activeModel),
    ];
    if (providerId === "groq" && /70b/i.test(activeModel || "")) {
      tryOrder.length = 0;
      tryOrder.push(...preferred);
    }
    if (providerId === "openrouter" && activeModel && !preferred.includes(activeModel)) {
      tryOrder.length = 0;
      tryOrder.push(...preferred);
    }

    for (const model of tryOrder) {
      try {
        const data = await openAIChat(messages, model);
        activeModel = model;
        refreshModelSelect();
        return data;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        if (/not found|does not exist|no endpoints|invalid model|model_not_found|unavailable for free|no longer available|is not a valid model/i.test(msg)) {
          continue;
        }
        if (isRateLimitError(e)) {
          const waitMs = Math.min(parseRetryAfterMs(e), 20000);
          if (waitMs > 0 && model === tryOrder[tryOrder.length - 1]) {
            await sleep(waitMs);
            try {
              const data = await openAIChat(messages, model);
              activeModel = model;
              refreshModelSelect();
              return data;
            } catch (e2) {
              lastErr = e2;
            }
          }
          continue;
        }
        throw e;
      }
    }
    if (isRateLimitError(lastErr)) {
      throw new Error(
        `${lastErr.message}\n\nTip: wait ~20s, or send a short message. Free Groq TPM is tight — we now prefer the 8B model.`
      );
    }
    throw lastErr || new Error(`No ${p.label} model available`);
  }

  function extractModelParts(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textBits = [];
    const calls = [];
    for (const p of parts) {
      if (p.text) textBits.push(p.text);
      if (p.functionCall) {
        let args = p.functionCall.args || {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch (_) {
            args = {};
          }
        }
        calls.push({
          name: p.functionCall.name,
          args,
          id: p.functionCall.id || null,
        });
      }
    }
    return { text: textBits.join("\n").trim(), calls, rawParts: parts };
  }

  function extractOpenAIParts(data) {
    const msg = data?.choices?.[0]?.message || {};
    const text = String(msg.content || "").trim();
    const calls = [];
    for (const tc of msg.tool_calls || []) {
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch (_) {
        args = {};
      }
      calls.push({
        id: tc.id || `call_${calls.length}`,
        name: tc.function?.name,
        args,
      });
    }
    return { text, calls, rawMessage: msg };
  }

  /** Convert stored Gemini-style history → OpenAI chat messages */
  function historyToOpenAIMessages(contents) {
    const msgs = [{ role: "system", content: systemPrompt() }];
    let pendingCallIds = [];

    for (const c of contents || []) {
      if (c.role === "user") {
        const textParts = (c.parts || []).filter((p) => p.text);
        const fnParts = (c.parts || []).filter((p) => p.functionResponse);
        if (fnParts.length) {
          fnParts.forEach((p, i) => {
            const fr = p.functionResponse;
            msgs.push({
              role: "tool",
              tool_call_id: fr.id || pendingCallIds[i] || `call_${i}`,
              content: JSON.stringify(fr.response ?? {}),
            });
          });
          pendingCallIds = [];
        } else if (textParts.length) {
          msgs.push({ role: "user", content: textParts.map((p) => p.text).join("\n") });
        }
      } else if (c.role === "model") {
        const text = (c.parts || []).filter((p) => p.text).map((p) => p.text).join("\n");
        const callParts = (c.parts || []).filter((p) => p.functionCall);
        if (callParts.length) {
          pendingCallIds = callParts.map((p, i) => p.functionCall.id || `call_${Date.now()}_${i}`);
          msgs.push({
            role: "assistant",
            content: text || null,
            tool_calls: callParts.map((p, i) => ({
              id: pendingCallIds[i],
              type: "function",
              function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args || {}),
              },
            })),
          });
        } else {
          msgs.push({ role: "assistant", content: text || "" });
        }
      }
    }
    return msgs;
  }

  /** Keep only text turns (drops tool call/response) — safe when switching providers */
  function textOnlyHistory(history) {
    const out = [];
    for (const turn of history || []) {
      const texts = (turn.parts || [])
        .filter((p) => p.text)
        .map((p) => String(p.text))
        .filter(Boolean);
      if (!texts.length) continue;
      const role = turn.role === "model" ? "model" : "user";
      if (out.length && out[out.length - 1].role === role) {
        out[out.length - 1].parts[0].text += "\n" + texts.join("\n");
      } else {
        out.push({ role, parts: [{ text: texts.join("\n") }] });
      }
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out;
  }

  /**
   * Gemini requires strict turn order:
   * user → model → (user functionResponse ↔ model functionCall)* → …
   * Truncation / Groq history often breaks this.
   */
  function sanitizeGeminiHistory(history) {
    const out = [];
    for (const turn of history || []) {
      const parts = Array.isArray(turn.parts) ? turn.parts : [];
      const textParts = parts.filter((p) => p.text);
      const callParts = parts.filter((p) => p.functionCall);
      const respParts = parts.filter((p) => p.functionResponse);

      if (turn.role === "user") {
        if (respParts.length) {
          const prev = out[out.length - 1];
          const prevHasCall =
            prev?.role === "model" && (prev.parts || []).some((p) => p.functionCall);
          if (!prevHasCall) continue;
          out.push({
            role: "user",
            parts: respParts.map((p) => ({
              functionResponse: {
                name: p.functionResponse.name,
                response: p.functionResponse.response ?? {},
              },
            })),
          });
          continue;
        }
        if (!textParts.length) continue;
        const text = textParts.map((p) => p.text).join("\n");
        if (out.length && out[out.length - 1].role === "user") {
          const prevParts = out[out.length - 1].parts || [];
          if (prevParts.some((p) => p.functionResponse)) {
            // user text must wait for model after functionResponse — still valid
            out.push({ role: "user", parts: [{ text }] });
          } else {
            out[out.length - 1].parts[0].text += "\n" + text;
          }
        } else {
          out.push({ role: "user", parts: [{ text }] });
        }
        continue;
      }

      if (turn.role === "model") {
        const prev = out[out.length - 1];
        if (!prev || prev.role !== "user") continue;
        if (callParts.length) {
          out.push({
            role: "model",
            parts: callParts.map((p) => cloneGeminiPart(p)),
          });
        } else if (textParts.length) {
          out.push({
            role: "model",
            parts: [{ text: textParts.map((p) => p.text).join("\n") }],
          });
        }
      }
    }
    // Drop trailing incomplete functionCall (no response yet)
    if (out.length) {
      const last = out[out.length - 1];
      if (last.role === "model" && (last.parts || []).some((p) => p.functionCall)) {
        out.pop();
      }
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out;
  }

  function trimGeminiHistory(history, max) {
    let h = sanitizeGeminiHistory(history);
    if (h.length <= max) return h;
    h = h.slice(-max);
    return sanitizeGeminiHistory(h);
  }

  async function runAgentGemini(userText, opts = {}) {
    if (!opts.resume) {
      chatHistory.push({ role: "user", parts: [{ text: userText }] });
    }
    chatHistory = trimGeminiHistory(chatHistory, MAX_HISTORY);

    let contents = sanitizeGeminiHistory(chatHistory.slice());
    if (!contents.length) {
      contents = [{ role: "user", parts: [{ text: userText || "" }] }];
      chatHistory = contents.slice();
    }

    let finalText = "";
    let guard = 0;

    const generate = async (c) => {
      try {
        return await geminiGenerateWithFallback(c);
      } catch (e) {
        const msg = String(e.message || e);
        if (/thought_signature/i.test(msg)) {
          chatHistory = textOnlyHistory(chatHistory);
          if (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== "user") {
            chatHistory.push({ role: "user", parts: [{ text: userText }] });
          }
          contents = chatHistory.slice();
          return geminiGenerateWithFallback(contents);
        }
        if (!/function call turn|function response turn|must alternate/i.test(msg)) throw e;
        // Broken history (often after Groq/OpenRouter) — retry text-only
        chatHistory = textOnlyHistory(chatHistory);
        if (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== "user") {
          chatHistory.push({ role: "user", parts: [{ text: userText }] });
        } else {
          chatHistory[chatHistory.length - 1] = { role: "user", parts: [{ text: userText }] };
        }
        contents = chatHistory.slice();
        return geminiGenerateWithFallback(contents);
      }
    };

    while (guard++ < 8) {
      const data = await generate(contents);
      const { text, calls, rawParts } = extractModelParts(data);

      if (!calls.length) {
        finalText = text || "Done.";
        const parts = (rawParts || []).filter((p) => p.text || p.functionCall).map((p) => cloneGeminiPart(p));
        chatHistory.push({
          role: "model",
          parts: parts.length ? parts : [{ text: finalText }],
        });
        chatHistory = sanitizeGeminiHistory(chatHistory);
        break;
      }

      const modelParts = (rawParts || [])
        .filter((p) => p.functionCall || p.text)
        .map((p) => cloneGeminiPart(p));
      const modelTurn = { role: "model", parts: modelParts.length ? modelParts : rawParts.map((p) => cloneGeminiPart(p)) };
      contents = contents.concat([modelTurn]);
      chatHistory.push(modelTurn);

      const fnParts = [];
      for (const call of calls) {
        let result;
        try {
          result = await runTool(call.name, call.args);
        } catch (e) {
          result = { ok: false, error: String(e.message || e) };
        }
        fnParts.push({
          functionResponse: {
            name: call.name,
            response: result,
          },
        });
      }
      const userFn = { role: "user", parts: fnParts };
      contents = contents.concat([userFn]);
      chatHistory.push(userFn);
      persistLocalSession();
    }

    chatHistory = sanitizeGeminiHistory(chatHistory);
    persistLocalSession();
    scheduleCloudSave();
    return finalText || "I finished the updates.";
  }

  async function runAgentOpenAI(userText, opts = {}) {
    if (!opts.resume) {
      chatHistory.push({ role: "user", parts: [{ text: userText }] });
    }
    chatHistory = trimGeminiHistory(chatHistory, MAX_HISTORY);

    const buildMessages = () => historyToOpenAIMessages(sanitizeGeminiHistory(chatHistory));

    let messages = buildMessages();
    let finalText = "";
    let guard = 0;

    const generate = async (msgs) => {
      try {
        return await openAIChatWithFallback(msgs);
      } catch (e) {
        const msg = String(e.message || e);
        if (!/tool|function call|function response|messages|invalid|400/i.test(msg)) throw e;
        // Broken cross-provider history — retry text-only for ALL OpenAI-compatible models
        chatHistory = textOnlyHistory(chatHistory);
        if (!chatHistory.length || chatHistory[chatHistory.length - 1].role !== "user") {
          chatHistory.push({ role: "user", parts: [{ text: userText }] });
        } else {
          chatHistory[chatHistory.length - 1] = { role: "user", parts: [{ text: userText }] };
        }
        messages = historyToOpenAIMessages(chatHistory);
        return openAIChatWithFallback(messages);
      }
    };

    while (guard++ < 8) {
      const data = await generate(messages);
      const { text, calls, rawMessage } = extractOpenAIParts(data);

      if (!calls.length) {
        finalText = text || "Done.";
        chatHistory.push({ role: "model", parts: [{ text: finalText }] });
        chatHistory = sanitizeGeminiHistory(chatHistory);
        break;
      }

      const modelParts = [];
      if (text) modelParts.push({ text });
      for (const call of calls) {
        modelParts.push({
          functionCall: { name: call.name, args: call.args, id: call.id },
        });
      }
      chatHistory.push({ role: "model", parts: modelParts });
      messages.push({
        role: "assistant",
        content: rawMessage.content || null,
        tool_calls: rawMessage.tool_calls,
      });

      const fnParts = [];
      for (const call of calls) {
        let result;
        try {
          result = await runTool(call.name, call.args);
        } catch (e) {
          result = { ok: false, error: String(e.message || e) };
        }
        fnParts.push({
          functionResponse: {
            name: call.name,
            id: call.id,
            response: result,
          },
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      chatHistory.push({ role: "user", parts: fnParts });
      persistLocalSession();
    }

    chatHistory = sanitizeGeminiHistory(chatHistory);
    persistLocalSession();
    scheduleCloudSave();
    return finalText || "I finished the updates.";
  }

  async function runAgentAuto(userText) {
    const candidates = getAutoCandidates();
    if (!candidates.length) {
      throw new Error(
        "Auto: no models available (add keys, or all are cooling after max-usage). Try again shortly."
      );
    }

    chatHistory.push({ role: "user", parts: [{ text: userText }] });
    const baseLen = chatHistory.length;
    let lastErr = null;
    const tried = [];

    for (const c of candidates) {
      chatHistory = chatHistory.slice(0, baseLen);
      const prev = providerId;
      providerId = c.provider;
      activeModel = c.model;
      if (prev !== providerId) {
        const userMsg = chatHistory[chatHistory.length - 1];
        chatHistory = textOnlyHistory(chatHistory.slice(0, -1));
        if (userMsg) chatHistory.push(userMsg);
      }
      updateAssistSub();
      tried.push(`${PROVIDERS[c.provider]?.label || c.provider}/${shortModelLabel(c.model)}`);

      try {
        const reply =
          providerId === "gemini"
            ? await runAgentGemini(userText, { resume: true })
            : await runAgentOpenAI(userText, { resume: true });
        lastAutoPick = { provider: c.provider, model: c.model };
        persistLocalSession();
        refreshModelSelect();
        updateAssistSub();
        scheduleCloudSave();
        return reply;
      } catch (e) {
        lastErr = e;
        chatHistory = chatHistory.slice(0, baseLen);
        if (isMaxUsageUnavailable(e) || isModelGoneError(e)) {
          markModelCooldown(c.provider, c.model, e);
          continue;
        }
        if (/401|invalid.*api.?key|API_KEY|Unauthorized|NO_API_KEY/i.test(String(e.message || e))) {
          markModelCooldown(c.provider, c.model, e);
          continue;
        }
        // Unexpected error — still try next in Auto
        markModelCooldown(c.provider, c.model, e);
        continue;
      }
    }

    persistLocalSession();
    refreshModelSelect();
    updateAssistSub();
    throw new Error(
      `Auto: all candidates hit max-usage or failed (${tried.join(" → ")}).\n` +
        `${lastErr?.message || "Try again in a minute."}`
    );
  }

  async function runAgent(userText) {
    if (autoMode) return runAgentAuto(userText);
    if (providerId === "groq" || providerId === "openrouter") {
      return runAgentOpenAI(userText);
    }
    return runAgentGemini(userText);
  }

  function showKeySetup() {
    bot(
      `This AI profile is for ${currentUser?.email || "you"} only.\n\n` +
        "Free options (pick one):\n" +
        "• Groq — https://console.groq.com/keys\n" +
        "  then: key groq gsk_...\n" +
        "• OpenRouter free — https://openrouter.ai/keys\n" +
        "  then: key openrouter sk-or-...\n" +
        "• Gemini free project — https://aistudio.google.com/apikey\n" +
        "  then: key gemini YOUR_KEY\n\n" +
        "Or click Key. Keys sync per allowlisted user across browsers."
    );
  }

  function parseKeyCommand(text) {
    const m = text.match(/^(?:key|apikey|api\s*key)\s+(.+)$/i);
    if (!m) return null;
    const rest = m[1].trim();
    const withProv = rest.match(/^(gemini|groq|openrouter|or|open-router)\s+(.+)$/i);
    if (withProv) {
      return { provider: normalizeProvider(withProv[1]), key: withProv[2].trim() };
    }
    return { provider: resolveKeyProvider(rest, null), key: rest };
  }

  async function handleMessage(raw) {
    const text = String(raw || "").trim();
    if (!text || busy) return;
    if (!ensureAssistantUser()) return;
    me(text);

    const keyCmd = parseKeyCommand(text);
    if (keyCmd) {
      const savedAs = setApiKey(keyCmd.key, keyCmd.provider);
      bot(
        `${PROVIDERS[savedAs].label} key saved for ${currentUser.email} (app + cloud).\n` +
          "It will still be there after redeploy — just sign in. Pick a model in the dropdown."
      );
      return;
    }

    const mapsUrls = extractMapsUrlsFromText(text);
    if (mapsUrls.length) {
      me(text);
      try {
        const r = await directImportMapsUrls(text);
        const names = (r.added || []).slice(0, 3).map((p) => p.name).join(", ");
        bot(
          `Imported ${r.added.length} place${r.added.length === 1 ? "" : "s"} from Google Maps` +
            `${r.geocoded ? ` (${r.geocoded} geocoded)` : ""}` +
            `${r.skipped?.length ? ` · ${r.skipped.length} skipped as duplicates` : ""}` +
            `${names ? `\n${names}${r.added.length > 3 ? "…" : ""}` : ""}`
        );
      } catch (e) {
        bot(`Could not import Maps URL: ${e.message || e}\nTry Import → Maps URL, or paste in the country panel.`);
      }
      return;
    }

    if (/^provider\s+(gemini|groq|openrouter|or)\s*$/i.test(text)) {
      const p = normalizeProvider(text.split(/\s+/)[1]);
      setActiveModel(p, PROVIDERS[p].models[0]);
      scheduleCloudSave();
      bot(
        `Provider set to ${providerLabel()}. ${getApiKey() ? "Ready — pick a model above." : `Add a key: key ${p} YOUR_KEY`}`
      );
      return;
    }
    if (/^(clear\s+key|remove\s+key)$/i.test(text)) {
      clearApiKey(providerId);
      scheduleCloudSave();
      bot(`${providerLabel()} key cleared (other providers kept).`);
      return;
    }
    if (/^(undo|revert)\b/i.test(text) && !getApiKey()) {
      const r = runTool("undo_last_change", {});
      bot(r.ok ? `Reverted: ${r.reverted}` : r.error);
      return;
    }

    if (!getApiKey() && !(autoMode && (providerKeys.gemini || providerKeys.groq || providerKeys.openrouter))) {
      showKeySetup();
      return;
    }

    if (!window.WorldApp?.getState?.()) {
      bot("App still loading — try again in a moment.");
      return;
    }

    busy = true;
    setTyping(true);
    $("assist-input")?.setAttribute("disabled", "disabled");
    try {
      const reply = await runAgent(text);
      setTyping(false);
      bot(reply);
    } catch (e) {
      setTyping(false);
      const msg = String(e.message || e);
      if (msg === "NO_API_KEY") showKeySetup();
      else if (/thought_signature/i.test(msg) && providerId === "gemini") {
        chatHistory = textOnlyHistory(chatHistory);
        persistLocalSession();
        bot(
          "Gemini tool error — chat history reset. Retry your message.\n" +
            "Tip: use gemini-2.5-flash-lite, or paste Maps URLs directly (imports without AI)."
        );
      } else if (/Failed to fetch|NetworkError|CORS/i.test(msg) && providerId === "groq") {
        bot(
          "Groq blocked from this host (CORS). Redeploy Netlify (proxy), or use OpenRouter free:\n" +
            "key openrouter sk-or-…"
        );
      } else if (/API_KEY_INVALID|invalid.*api.?key|incorrect api key|401|Unauthorized/i.test(msg)) {
        bot(`That ${providerLabel()} key looks invalid. Send: key ${providerId} YOUR_NEW_KEY`);
      } else if (/prepay|credits|billing|quota|rate limit/i.test(msg) && providerId === "gemini") {
        bot(
          `Gemini billing issue: ${msg}\n\n` +
            "Switch to free Groq or OpenRouter:\n" +
            "key groq gsk_…\n" +
            "key openrouter sk-or-…"
        );
      } else {
        bot(`AI error (${providerLabel()}): ${msg}\nRetry, or send a new key with: key …`);
      }
    } finally {
      busy = false;
      $("assist-input")?.removeAttribute("disabled");
      $("assist-input")?.focus();
    }
  }

  function doUndo() {
    const r = runTool("undo_last_change", {});
    openPanel(true);
    bot(r.ok ? `Reverted: ${r.reverted}` : r.error || "Nothing to undo.");
  }

  function welcomeIfNeeded() {
    if (uiLog.length) return;
    if (getApiKey() || (autoMode && (providerKeys.gemini || providerKeys.groq || providerKeys.openrouter))) {
      bot(
        `Hi ${currentUser?.displayName || currentUser?.email || "there"} — your private AI chat is ready` +
          (autoMode ? " (Auto mode)." : ` (${providerLabel()}).`) +
          "\nI can search places, add countries, import CSV, and update your globe.\nTry: “show museums in Japan”"
      );
    } else {
      bot(
        `Hi ${currentUser?.displayName || currentUser?.email || "there"} — this AI chat is only yours.\n` +
          "Add a free key (Groq / OpenRouter / Gemini) via Key, then pick Auto or a model.\n" +
          "`key groq gsk_…` · `key openrouter sk-or-…` · `key gemini AIza…`"
      );
    }
  }

  async function bindUser(user) {
    // persist previous
    if (currentUser) {
      persistLocalSession();
      scheduleCloudSave();
    }

    undoStack = [];
    busy = false;
    setTyping(false);

    if (!user?.email) {
      currentUser = null;
      chatHistory = [];
      uiLog = [];
      providerId = "gemini";
      providerKeys = emptyKeys();
      activeModel = GEMINI_MODELS[0];
      autoMode = true;
      lastAutoPick = null;
      modelCooldowns = {};
      clearLogDom();
      refreshModelSelect();
      updateAssistSub();
      return;
    }

    currentUser = {
      uid: user.uid || null,
      email: String(user.email).trim().toLowerCase(),
      displayName: user.displayName || String(user.email).split("@")[0],
    };

    const local = loadLocalSession();
    chatHistory = local.chatHistory || [];
    uiLog = local.uiLog || [];
    const localKeys = { ...emptyKeys(), ...local.keys };
    providerKeys = { ...localKeys };
    providerId = normalizeProvider(local.provider || "gemini");
    activeModel = local.model || PROVIDERS[providerId].models[0];
    autoMode = local.autoMode !== false;
    lastAutoPick = local.lastAutoPick || null;
    modelCooldowns = local.modelCooldowns || {};

    let pushLocalKeysToCloud = false;

    // Prefer cloud session for this uid (keys + model + chat follow the user)
    if (currentUser.uid && currentUser.uid !== "local" && window.WorldCloud?.loadAssistantChat) {
      try {
        const cloud = await WorldCloud.loadAssistantChat(currentUser.uid);
        if (cloud) {
          const cloudUi = Array.isArray(cloud.uiLog) ? cloud.uiLog : [];
          const cloudHist = Array.isArray(cloud.chatHistory) ? cloud.chatHistory : [];
          if (cloudUi.length >= uiLog.length) uiLog = cloudUi;
          if (cloudHist.length >= chatHistory.length) chatHistory = cloudHist;
          const cloudKeys = migrateKeys(cloud);
          const merged = emptyKeys();
          for (const pid of Object.keys(merged)) {
            if (cloudKeys[pid]) {
              merged[pid] = cloudKeys[pid];
            } else if (localKeys[pid]) {
              merged[pid] = localKeys[pid];
              pushLocalKeysToCloud = true;
            }
          }
          providerKeys = merged;
          if (cloud.provider) providerId = normalizeProvider(cloud.provider);
          if (cloud.model && (PROVIDERS[providerId].models || []).includes(cloud.model)) {
            activeModel = cloud.model;
          } else if (!(PROVIDERS[providerId].models || []).includes(activeModel)) {
            activeModel = PROVIDERS[providerId].models[0];
          }
          if (cloud.autoMode != null) autoMode = !!cloud.autoMode;
          if (cloud.lastAutoPick) lastAutoPick = cloud.lastAutoPick;
          if (cloud.modelCooldowns && typeof cloud.modelCooldowns === "object") {
            modelCooldowns = { ...modelCooldowns, ...cloud.modelCooldowns };
          }
        } else {
          // No cloud doc yet — upload local keys/chat
          pushLocalKeysToCloud = !!(localKeys.gemini || localKeys.groq || localKeys.openrouter);
        }
      } catch (e) {
        console.warn("Assistant cloud load failed", e);
      }
    }

    // migrate legacy global key into this user once
    if (!getApiKey("gemini") && !getApiKey("groq") && !getApiKey("openrouter")) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        setApiKey(legacy, detectProviderFromKey(legacy) || "gemini");
        localStorage.removeItem(LEGACY_KEY);
        pushLocalKeysToCloud = false; // setApiKey already flushed
      }
    }

    renderUiLog();
    welcomeIfNeeded();
    persistLocalSession();
    refreshModelSelect();
    updateAssistSub();
    if (pushLocalKeysToCloud) await flushCloudSave();
    else scheduleCloudSave();
  }

  function unbindUser() {
    if (currentUser) {
      persistLocalSession();
      scheduleCloudSave();
    }
    currentUser = null;
    chatHistory = [];
    uiLog = [];
    undoStack = [];
    clearLogDom();
    refreshModelSelect();
    updateAssistSub();
  }

  function initUi() {
    if (uiBound) return;
    const fab = $("assist-fab");
    const panel = $("assist-panel");
    const form = $("assist-form");
    const closeBtn = $("assist-close");
    const undoBtn = $("assist-undo");
    const keyBtn = $("assist-key");
    const modelSel = $("assist-model");
    if (!fab || !panel || !form) return;
    uiBound = true;

    fab.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = !panel.classList.contains("open");
      openPanel(willOpen);
    });
    closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      openPanel(false);
    });
    undoBtn?.addEventListener("click", () => doUndo());

    modelSel?.addEventListener("change", () => {
      const parsed = parseModelOptionValue(modelSel.value);
      if (!parsed) return;
      setActiveModel(parsed.provider, parsed.model);
      scheduleCloudSave();
      if (parsed.provider === "auto" || autoMode) {
        const n = getAutoCandidates().length;
        bot(
          "Auto mode on — tries the best available model with a key, skips ones at max usage / quota, keeps chat context.\n" +
            "Ready candidates right now: " +
            n +
            "."
        );
        return;
      }
      const has = !!getApiKey(parsed.provider);
      bot(
        has
          ? `Model: ${PROVIDERS[parsed.provider].label} · ${shortModelLabel(parsed.model)} (using saved key).`
          : `Model set to ${shortModelLabel(parsed.model)} — add a ${PROVIDERS[parsed.provider].label} key first (Key button).`
      );
    });

    keyBtn?.addEventListener("click", () => {
      openPanel(true);
      syncUserFromApp();
      if (!currentUser && WorldCloud?.configured) {
        bot("Sign in first — each allowlisted user has their own AI key.");
        return;
      }
      if (!currentUser) {
        currentUser = { uid: "local", email: "local@device", displayName: "Local" };
      }
      toggleKeyForm(true);
    });

    $("assist-key-save")?.addEventListener("click", (e) => {
      e.preventDefault();
      saveKeyFromForm();
    });
    $("assist-key-clear")?.addEventListener("click", (e) => {
      e.preventDefault();
      clearKeyFromForm();
    });
    $("assist-key-provider")?.addEventListener("change", () => {
      const prov = $("assist-key-provider")?.value;
      const input = $("assist-key-input");
      if (input) {
        const cur = getApiKey(prov);
        input.placeholder = cur ? "Paste new key to replace" : "Paste your API key";
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("assist-input");
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      handleMessage(v);
    });

    refreshModelSelect();
  }

  window.WorldAssistant = {
    initUi,
    bindUser,
    unbindUser,
    handleMessage,
    open: () => openPanel(true),
    undo: doUndo,
    hasKey: () => !!getApiKey(),
    getApiKey,
    provider: () => providerId,
    model: () => activeModel,
    currentUser: () => currentUser,
  };
})();
