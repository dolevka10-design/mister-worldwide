/**
 * Firebase Auth (allowlist) + compact Firestore sync for Mister Worldwide.
 * Cloud docs store planner + user place deltas only (never the 2.5MB seed dump).
 */
window.WorldCloud = (() => {
  const cfg = window.FIREBASE_CONFIG;
  const configured =
    cfg?.apiKey && !String(cfg.apiKey).startsWith("PASTE_") &&
    cfg?.projectId && !String(cfg.projectId).startsWith("PASTE_");

  const SAVE_DEBOUNCE_MS = 2500;
  const QUOTA_PAUSE_MS = 15 * 60 * 1000;

  let auth = null, db = null, saveTimer = null, unsubDoc = null, applyingRemote = false;
  let quotaPausedUntil = 0;
  let lastAckedGen = 0;
  let lastToastAt = 0;
  let inFlight = null;

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function allowedEmails() {
    return (window.ALLOWED_EMAILS || [])
      .map(normalizeEmail)
      .filter((e) => e && !e.includes("example.com"));
  }

  function isAllowedEmail(email) {
    const list = allowedEmails();
    return list.length > 0 && list.includes(normalizeEmail(email));
  }

  function docPath(uid) {
    return `worldData/${uid}`;
  }

  const APP_NAME = "misterWorldwide";
  const REDIRECT_PENDING_KEY = "mw-google-redirect-pending";
  let googleSignInFlight = null;

  function preferGoogleRedirect() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/i.test(ua)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) return true;
    if (/Android/i.test(ua)) return true;
    // Popups are unreliable in embedded / storage-partitioned browsers.
    if (window.self !== window.top) return true;
    return false;
  }

  function isGoogleSignInBusy() {
    return !!googleSignInFlight;
  }

  function initFirebase() {
    if (!configured || typeof firebase === "undefined") return { ok: false };
    const app = firebase.apps.some((a) => a.name === APP_NAME)
      ? firebase.app(APP_NAME)
      : firebase.initializeApp(cfg, APP_NAME);
    auth = firebase.auth(app);
    db = firebase.firestore(app);
    return { ok: true };
  }

  async function ensureAuthPersistence() {
    if (!auth?.setPersistence) return;
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      console.warn("Auth persistence fallback", e);
    }
  }

  function googleAuthProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  function isRedirectRecoverableError(e) {
    const msg = String(e?.message || e?.code || "");
    return /missing initial state|auth\/no-auth-event/i.test(msg);
  }

  function cleanStaleAuthUrl() {
    const hash = location.hash || "";
    if (!/apiKey=|authUser=|error=/.test(hash)) return;
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch { /* */ }
  }

  async function completeRedirectSignIn() {
    if (!auth) return null;
    await ensureAuthPersistence();
    try {
      const result = await auth.getRedirectResult();
      try { sessionStorage.removeItem(REDIRECT_PENDING_KEY); } catch { /* */ }
      if (result?.user) return enforceAllowlist(result.user);
    } catch (e) {
      try { sessionStorage.removeItem(REDIRECT_PENDING_KEY); } catch { /* */ }
      cleanStaleAuthUrl();
      if (!isRedirectRecoverableError(e)) throw e;
      console.warn("Ignored stale Google redirect state", e);
    }
    return null;
  }

  function shouldFallbackToRedirect(e) {
    const code = e?.code || "";
    return code === "auth/popup-blocked"
      || code === "auth/operation-not-supported-in-this-environment";
  }

  async function rejectUnauthorizedUser(user) {
    try { if (user?.delete) await user.delete(); } catch { await auth.signOut(); }
    try { if (auth.currentUser) await auth.signOut(); } catch { /* */ }
  }

  async function enforceAllowlist(user) {
    if (!user) return null;
    if (!isAllowedEmail(user.email)) {
      await rejectUnauthorizedUser(user);
      const err = new Error("Access denied.");
      err.code = "auth/not-allowlisted";
      throw err;
    }
    return user;
  }

  async function signIn(email, password) {
    if (!isAllowedEmail(email)) throw Object.assign(new Error("Access denied."), { code: "auth/not-allowlisted" });
    return enforceAllowlist((await auth.signInWithEmailAndPassword(email.trim(), password)).user);
  }

  async function signUp(email, password) {
    if (!isAllowedEmail(email)) throw Object.assign(new Error("Access denied."), { code: "auth/not-allowlisted" });
    return enforceAllowlist((await auth.createUserWithEmailAndPassword(email.trim(), password)).user);
  }

  async function signInWithGoogle() {
    if (googleSignInFlight) return googleSignInFlight;
    googleSignInFlight = signInWithGoogleInner().finally(() => { googleSignInFlight = null; });
    return googleSignInFlight;
  }

  async function signInWithGoogleInner() {
    await ensureAuthPersistence();
    const provider = googleAuthProvider();
    if (preferGoogleRedirect()) {
      try { sessionStorage.setItem(REDIRECT_PENDING_KEY, "1"); } catch { /* */ }
      await auth.signInWithRedirect(provider);
      return null;
    }
    try {
      return enforceAllowlist((await auth.signInWithPopup(provider)).user);
    } catch (e) {
      if (e?.code === "auth/popup-closed-by-user") throw e;
      if (e?.code === "auth/cancelled-popup-request") {
        const err = new Error("Google sign-in is already opening — wait for the window, then try again.");
        err.code = "auth/cancelled-popup-request";
        throw err;
      }
      if (!shouldFallbackToRedirect(e)) throw e;
      try { sessionStorage.setItem(REDIRECT_PENDING_KEY, "1"); } catch { /* */ }
      await auth.signInWithRedirect(provider);
      return null;
    }
  }

  async function signOut() {
    if (auth) await auth.signOut();
  }

  function onAuthStateChanged(cb) {
    if (!auth) return () => {};
    return auth.onAuthStateChanged(async (user) => {
      try {
        if (user) user = await enforceAllowlist(user);
        cb(user);
      } catch (e) {
        cb(null, e);
      }
    });
  }

  function isQuotaError(e) {
    const msg = String(e?.message || e?.code || "").toLowerCase();
    return /quota|resource.exhausted|limit exceeded|exceeds|too (large|big)|invalid-argument/.test(msg)
      || e?.code === "resource-exhausted";
  }

  function isQuotaPaused() {
    return Date.now() < quotaPausedUntil;
  }

  function pauseQuota(e) {
    quotaPausedUntil = Date.now() + QUOTA_PAUSE_MS;
    const now = Date.now();
    if (now - lastToastAt > 20000) {
      lastToastAt = now;
      WorldApp?.toast?.("Cloud sync paused. Trips still save on this device.", "warn");
    }
    console.warn("Cloud quota/size — paused", e);
  }

  function compactPayload(state) {
    return WorldStore.packCloudPayload(state);
  }

  async function loadFromCloud(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await db.doc(docPath(uid)).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn("Cloud load failed", e);
      if (isQuotaError(e)) pauseQuota(e);
      return null;
    }
  }

  async function writeDoc(uid, state) {
    if (!db || !uid || applyingRemote) return { ok: false, skipped: true };
    if (isQuotaPaused()) return { ok: false, paused: true };
    const gen = ++lastWriteGen;
    const payload = {
      ...compactPayload(state),
      writeGen: gen,
      savedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.doc(docPath(uid)).set(payload, { merge: false });
      lastAckedGen = gen;
      return { ok: true, gen };
    } catch (e) {
      if (isQuotaError(e)) {
        pauseQuota(e);
        return { ok: false, error: e, quota: true };
      }
      console.warn("Cloud save failed", e);
      WorldApp?.toast?.("Cloud save failed — kept on this device.", "warn");
      return { ok: false, error: e };
    }
  }

  function scheduleSave(uid, state, delay = SAVE_DEBOUNCE_MS) {
    if (!db || !uid || applyingRemote || isQuotaPaused()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const latest = window.WorldApp?.getState?.() || state;
      inFlight = writeDoc(uid, latest).finally(() => { inFlight = null; });
    }, delay);
  }

  function listenCloud(uid, onData) {
    if (!db || !uid) return () => {};
    if (unsubDoc) unsubDoc();
    unsubDoc = db.doc(docPath(uid)).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const remote = snap.data();
        if (remote?.writeGen && remote.writeGen === lastAckedGen) return;
        applyingRemote = true;
        try { onData(remote); } finally { applyingRemote = false; }
      },
      (e) => {
        console.warn("Cloud listen failed", e);
        if (isQuotaError(e)) pauseQuota(e);
      }
    );
    return () => { if (unsubDoc) unsubDoc(); unsubDoc = null; };
  }

  function isApplyingRemote() { return applyingRemote; }

  async function saveAssistantChat(uid, payload) {
    if (!db || !uid || isQuotaPaused()) return;
    try {
      await db.doc(`assistantChats/${uid}`).set(payload, { merge: true });
    } catch (e) {
      if (isQuotaError(e)) pauseQuota(e);
      else console.warn("Assistant chat save failed", e);
    }
  }

  async function loadAssistantChat(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await db.doc(`assistantChats/${uid}`).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn("Assistant chat load failed", e);
      return null;
    }
  }

  function flushSave(uid, state) {
    if (!db || !uid) return Promise.resolve({ ok: false, skipped: true });
    clearTimeout(saveTimer);
    return writeDoc(uid, state);
  }

  function resumeQuota() {
    quotaPausedUntil = 0;
  }

  return {
    configured, initFirebase, completeRedirectSignIn, isGoogleSignInBusy, isAllowedEmail, isQuotaError, isQuotaPaused, resumeQuota,
    signIn, signUp, signInWithGoogle, signOut, onAuthStateChanged,
    loadFromCloud, scheduleSave, flushSave, listenCloud, isApplyingRemote,
    saveAssistantChat, loadAssistantChat,
  };
})();
