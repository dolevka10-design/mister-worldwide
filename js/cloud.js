/**
 * Firebase Auth (allowlist) + Firestore sync for Mister Worldwide.
 */
window.WorldCloud = (() => {
  const cfg = window.FIREBASE_CONFIG;
  const configured =
    cfg?.apiKey && !String(cfg.apiKey).startsWith("PASTE_") &&
    cfg?.projectId && !String(cfg.projectId).startsWith("PASTE_");

  let auth = null, db = null, saveTimer = null, unsubDoc = null, applyingRemote = false;

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

  function initFirebase() {
    if (!configured || typeof firebase === "undefined") return { ok: false };
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    return { ok: true };
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
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return enforceAllowlist((await auth.signInWithPopup(provider)).user);
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

  async function loadFromCloud(uid) {
    if (!db || !uid) return null;
    try {
      const snap = await db.doc(docPath(uid)).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn("Cloud load failed", e);
      if (isQuotaError(e)) WorldApp?.toast?.("Cloud sync paused (quota). Using data on this device.", "warn");
      return null;
    }
  }

  function isQuotaError(e) {
    const msg = String(e?.message || e?.code || "").toLowerCase();
    return /quota|resource.exhausted|limit exceeded/.test(msg);
  }

  function scheduleSave(uid, state, delay = 500) {
    if (!db || !uid || applyingRemote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await db.doc(docPath(uid)).set({ ...state, savedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (e) {
        console.warn("Cloud save failed", e);
        if (isQuotaError(e)) WorldApp?.toast?.("Cloud sync paused (quota). Changes still save on this device.", "warn");
      }
    }, delay);
  }

  function listenCloud(uid, onData) {
    if (!db || !uid) return () => {};
    if (unsubDoc) unsubDoc();
    unsubDoc = db.doc(docPath(uid)).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        applyingRemote = true;
        try { onData(snap.data()); } finally { applyingRemote = false; }
      },
      (e) => {
        console.warn("Cloud listen failed", e);
        if (isQuotaError(e)) WorldApp?.toast?.("Cloud sync paused (quota). Trips still work on this device.", "warn");
      }
    );
    return () => { if (unsubDoc) unsubDoc(); unsubDoc = null; };
  }

  function isApplyingRemote() { return applyingRemote; }

  async function saveAssistantChat(uid, payload) {
    if (!db || !uid) return;
    await db.doc(`assistantChats/${uid}`).set(payload, { merge: true });
  }

  async function loadAssistantChat(uid) {
    if (!db || !uid) return null;
    const snap = await db.doc(`assistantChats/${uid}`).get();
    return snap.exists ? snap.data() : null;
  }

  function flushSave(uid, state) {
    if (!db || !uid) return Promise.resolve({ ok: false, skipped: true });
    clearTimeout(saveTimer);
    return db.doc(docPath(uid)).set(
      { ...state, savedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    ).then(() => ({ ok: true })).catch((e) => {
      console.warn("Cloud save failed", e);
      if (isQuotaError(e)) WorldApp?.toast?.("Cloud sync paused (quota). Changes still save on this device.", "warn");
      return { ok: false, error: e };
    });
  }

  return {
    configured, initFirebase, isAllowedEmail, isQuotaError,
    signIn, signUp, signInWithGoogle, signOut, onAuthStateChanged,
    loadFromCloud, scheduleSave, flushSave, listenCloud, isApplyingRemote,
    saveAssistantChat, loadAssistantChat,
  };
})();
