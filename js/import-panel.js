/**
 * Standalone Google Maps / Takeout import panel.
 */
window.WorldImportPanel = (() => {
  const $ = (id) => document.getElementById(id);
  let open = false;
  let activeTab = "takeout";

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function render(state) {
    const panel = $("import-panel");
    if (!panel) return;

    panel.innerHTML = `
      <header class="import-head">
        <div>
          <strong>Import Places</strong>
          <p class="muted assist-sub">Google Takeout ZIP or My Maps CSV</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="import-close">✕</button>
      </header>
      <div class="import-tabs">
        <button type="button" class="import-tab ${activeTab === "takeout" ? "active" : ""}" data-tab="takeout">Takeout ZIP</button>
        <button type="button" class="import-tab ${activeTab === "csv" ? "active" : ""}" data-tab="csv">Paste CSV</button>
      </div>
      <div class="import-body">
        ${activeTab === "takeout" ? `
          <section class="import-section">
            <p class="muted assist-sub">Upload your Google Takeout ZIP (Saved places → CSV lists). Places are matched by URL, geocoded when needed, and assigned to countries &amp; categories automatically.</p>
            <label class="import-drop" id="import-drop">
              <input type="file" id="import-zip-file" accept=".zip,application/zip" hidden />
              <span class="import-drop-icon">📦</span>
              <span>Tap to choose Takeout ZIP</span>
              <span class="muted assist-sub">takeout-*.zip</span>
            </label>
            <p class="import-status muted" id="import-status"></p>
            <ul class="import-log" id="import-log"></ul>
          </section>
        ` : `
          <section class="import-section">
            <p class="muted assist-sub">My Maps export: Name, Description, Latitude, Longitude, Url<br/>Description: City | Country | URL</p>
            <textarea id="import-paste" class="import-paste" rows="10" placeholder="Name,Description,Latitude,Longitude,Url"></textarea>
            <button type="button" class="btn btn-primary btn-sm" id="import-paste-btn">Import CSV</button>
            <p class="import-status muted" id="import-result"></p>
          </section>
        `}
      </div>`;

    bind(state);
  }

  function bind(state) {
    $("import-close")?.addEventListener("click", () => toggle(false));

    document.querySelectorAll(".import-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        render(state);
      });
    });

    const zipInput = $("import-zip-file");
    const drop = $("import-drop");
    drop?.addEventListener("click", () => zipInput?.click());
    drop?.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop?.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      const file = e.dataTransfer?.files?.[0];
      if (file) runZipImport(state, file);
    });
    zipInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) runZipImport(state, file);
      e.target.value = "";
    });

    $("import-paste-btn")?.addEventListener("click", () => {
      const text = $("import-paste")?.value?.trim();
      if (!text) return WorldApp.toast("Paste CSV first", "warn");
      try {
        const r = WorldMapsImport.importText(state, text);
        WorldApp.persist();
        WorldApp.refresh();
        const el = $("import-result");
        if (el) {
          el.textContent = `Added ${r.added.length} · skipped ${r.skipped.length}${r.newCountries.length ? ` · ${r.newCountries.length} new countries` : ""}`;
        }
        WorldApp.toast(`Imported ${r.added.length} places`);
      } catch (e) {
        WorldApp.toast(e.message || "Import failed", "error");
      }
    });
  }

  async function runZipImport(state, file) {
    const status = $("import-status");
    const log = $("import-log");
    if (status) status.textContent = "Processing…";
    if (log) log.innerHTML = "";

    const appendLog = (msg) => {
      if (!log) return;
      const li = document.createElement("li");
      li.textContent = msg;
      log.appendChild(li);
      log.scrollTop = log.scrollHeight;
    };

    try {
      const r = await WorldMapsImport.importTakeoutZip(state, file, (msg) => {
        if (status) status.textContent = msg;
        appendLog(msg);
      });
      WorldApp.persist();
      WorldApp.refresh();
      const summary = `Done: ${r.added.length} added, ${r.skipped.length} skipped, ${r.files} lists${r.geocoded ? `, ${r.geocoded} geocoded` : ""}${r.newCountries.length ? `, ${r.newCountries.length} new countries` : ""}`;
      if (status) status.textContent = summary;
      appendLog(summary);
      WorldApp.toast(`Imported ${r.added.length} places`);
    } catch (e) {
      if (status) status.textContent = e.message || "Import failed";
      WorldApp.toast(e.message || "Import failed", "error");
    }
  }

  function toggle(on) {
    open = on != null ? !!on : !open;
    const panel = $("import-panel");
    if (!panel) return;
    panel.classList.toggle("open", open);
    panel.hidden = !open;
    if (open) render(WorldApp.getState());
  }

  function init() {
    $("btn-import-maps")?.addEventListener("click", () => toggle(true));
  }

  return { init, toggle, open: () => toggle(true) };
})();
