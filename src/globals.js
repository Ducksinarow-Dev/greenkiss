/* ─── THE GREEN KISS — shared constants, tokens, and storage layer ───
   Dev mode (vite dev / gkForceRemote="0"): localStorage-backed, exactly as
   before, including seeding.
   Remote mode (built + served from the same origin as api.php, OR
   gkForceRemote="1" for local testing): a real PHP/MySQL backend. After
   login, the entire kv_store is pulled once (`kv_all`) into the same
   in-memory cache dev mode already uses — every component below keeps
   using db.get/db.set/getSync/setSync exactly as written; only the guts
   of those four functions know a network is involved. */

/* ─── TYPEDEFS ───────────────────────────────────────────────────────
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} createdAt
 *
 * @typedef {Object} LinkItem
 * @property {string} id
 * @property {string} label
 * @property {string} url
 *
 * @typedef {Object} ChecklistItem
 * @property {string} id
 * @property {string} text
 *
 * Every block also carries optional `width?:number` (33|40|50|60|100),
 * `bg?:string` (emphasis background key, see BLOCK_BGS), `num?:number`
 * (a "number at will" that feeds the index block), and `taskRole?:string`
 * (""|"description"|"checklist" — Run-SOP routing, R3 Phase C).
 * @typedef {{id:string,type:"heading",text:string,description?:string}} HeadingBlock
 * @typedef {{id:string,type:"text",text:string,html?:string}} TextBlock html = optional rich formatting (R3 B3); text stays the synced plain version
 * @typedef {{id:string,type:"divider"}} DividerBlock
 * @typedef {{id:string,type:"links",title?:string,links:LinkItem[]}} LinksBlock
 * @typedef {{id:string,type:"image",src:string,caption:string}} ImageBlock
 * @typedef {{id:string,text:string,value?:string,url?:string}} ListItem
 * @typedef {{id:string,type:"list",style:"plain"|"bulleted"|"numbered",withEntry?:boolean,checkboxes?:boolean,items:ListItem[]}} ListBlock plain+withEntry renders as a bold-label "Date Received: ___" form slot
 * @typedef {{id:string,type:"completion"}} CompletionBlock
 * @typedef {{id:string,type:"index"}} IndexBlock
 * @typedef {{id:string,type:"checklist",title:string,items:ChecklistItem[]}} ChecklistBlock legacy — normalized to a checkbox ListBlock on read (asListBlock)
 * @typedef {HeadingBlock|TextBlock|DividerBlock|LinksBlock|ImageBlock|ListBlock|CompletionBlock|IndexBlock|ChecklistBlock} Block
 *
 * @typedef {Object} SOP
 * @property {string} id
 * @property {string} title
 * @property {string} categoryId
 * @property {"draft"|"published"|"archived"} status
 * @property {"sop"|"form"} [kind] defaults to "sop" when absent (#Forms)
 * @property {string} [code] free-text document code, e.g. "SOP-OPS-001"
 * @property {string} [typePrefix] free-text type label, e.g. "SOP"/"WI"/"CL"/"FRM"
 * @property {Block[]} blocks
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} updatedBy
 *
 * @typedef {Object} Contact
 * @property {string} id
 * @property {string} name
 * @property {string} [role]
 * @property {string} [email]
 * @property {string} [phone]
 * @property {string} [notes]
 * @property {string} [userId] linked login user, if any
 * @property {string} createdAt
 *
 * @typedef {Object.<string, Object>} InstanceValues blockId -> block-specific fill state
 *
 * @typedef {Object} Instance
 * @property {string} id
 * @property {string} docId SOP.id being filled out
 * @property {"sop"|"form"} docKind
 * @property {string} date ISO date (yyyy-mm-dd) this run belongs to
 * @property {Block[]} blocksSnapshot frozen copy of the template at start time
 * @property {string} startedBy user id
 * @property {string} startedAt ISO timestamp
 * @property {"in_progress"|"completed"} status
 * @property {InstanceValues} values
 * @property {string} [completedBy] user id
 * @property {string} [completedAt] ISO timestamp
 *
 * @typedef {Object} SubTask
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 * @property {string} [assigneeId] user id
 * @property {string} [dueDate] ISO date (yyyy-mm-dd)
 * @property {"low"|"medium"|"high"|"urgent"} [priority] (#8/#9 tile anatomy)
 *
 * @typedef {Object} Tag
 * @property {string} id
 * @property {string} name
 * @property {string} color hex, from CATEGORY_COLORS
 * @property {string} createdAt
 *
 * @typedef {"none"|"daily"|"weekly"|"monthly"} Recurrence
 *
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {"todo"|"in-progress"|"reassigned"|"review"|"done"} status
 * @property {"low"|"medium"|"high"|"urgent"} priority
 * @property {string} assignedTo user id
 * @property {string} dueDate ISO date (yyyy-mm-dd)
 * @property {string} relatedSopId
 * @property {string} [projectId] linked Project.id, empty for standalone tasks
 * @property {SubTask[]} subTasks
 * @property {"task"|"note"|"milestone"} [type] defaults to "task" when absent
 * @property {string[]} [tagIds] (#8)
 * @property {Recurrence} [recurrence] (#8) defaults to "none" when absent
 * @property {string[]} [favouritedBy] user ids who've starred this task (#9)
 * @property {{id:string, label:string, url:string}[]} [links] (R4 D2) web or gk: magnet links
 * @property {boolean} [archived] (#9) hidden from board + dashboard when true
 * @property {string} createdAt
 * @property {number} [order]
 *
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} taskId
 * @property {string} fromUserId
 * @property {string} toUserId
 * @property {string} at ISO timestamp
 *
 * @typedef {Object} TaskTemplate
 * @property {string} id
 * @property {string} name
 * @property {Object} snapshot stripped Task shape (no id/status/assignee/dates)
 * @property {string} createdAt
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {"upcoming"|"in_progress"|"approval"|"done"|"archived"} status
 * @property {string} startDate ISO date (yyyy-mm-dd)
 * @property {string} dueDate ISO date (yyyy-mm-dd)
 * @property {string} leadId user id
 * @property {string[]} memberIds user ids
 * @property {string} color hex
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} Campaign
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} startDate ISO date (yyyy-mm-dd)
 * @property {string} endDate ISO date (yyyy-mm-dd)
 * @property {"planning"|"active"|"done"} status
 * @property {string} color hex
 * @property {string} createdAt
 *
 * @typedef {Object} ContentImage
 * @property {string} id
 * @property {string} src
 * @property {string} caption
 *
 * @typedef {Object} ContentItem
 * @property {string} id
 * @property {string} [campaignId] Campaign.id, empty for uncampaigned items
 * @property {"gbp"|"blog"|"email"|"instagram"} channel
 * @property {string} title
 * @property {"idea"|"draft"|"scheduled"|"published"} status
 * @property {string} publishDate ISO date (yyyy-mm-dd)
 * @property {string} assigneeId user id
 * @property {string} body
 * @property {ContentImage[]} images
 * @property {LinkItem[]} links
 * @property {string} notes
 * @property {string} [ctaType] gbp — Book/Order/Buy/Learn more/Sign up/Call
 * @property {string} [ctaUrl] gbp
 * @property {"update"|"offer"|"event"} [category] gbp
 * @property {string} [targetKeyword] blog
 * @property {string} [url] blog — slug/url
 * @property {string} [subjectLine] email
 * @property {string} [previewText] email
 * @property {string} [caption] instagram — separate from body (used as the IG caption)
 * @property {string} [hashtags] instagram
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} [pin] dev mode only — never present in remote mode
 * @property {"admin"|"editor"|"viewer"} [role] absent for the lightweight roster
 *
 * @typedef {Object} AckEntry
 * @property {string} at ISO timestamp
 * @property {string} version the SOP's updatedAt at the time it was acked
 *
 * @typedef {Object.<string, Object.<string, AckEntry>>} AckMap sopId -> userId -> AckEntry
 *
 * @typedef {Object} Revision
 * @property {string|number} id
 * @property {string} savedAt
 * @property {string} savedBy
 * @property {Object} [snapshot]
 */

/* ─── COLOR TOKENS ───────────────────────────────────────────────────
   Domain: The Green Kiss's real identity — a minimalist natural beauty
   counter. Think: a sage-green ceramic dish on a white marble counter,
   black ink ingredient labels, a single blush petal for accent. Clean,
   airy, un-warm. White/black carry the structure; brand sage (#799385)
   does the work moss used to do; pink/rose are reserved for the two
   places a boutique skincare brand actually uses color — a small badge
   (pink) and an urgent/destructive flag (rose) — never a wash of color.
   Elevation: base (bg) -> sur -> s2, each a whisper-quiet lightness
   step. Sidebar shares the canvas background (bordered, not boxed). */
const C_LIGHT = {
  bg: "#fafaf9",      // canvas — barely-there off-white, not stark
  sur: "#ffffff",     // card surface — true white, raised off canvas
  s2: "#f1f1ef",      // raised-within-surface (dropdown, hover row)
  inset: "#f0f0ee",   // input backgrounds (receive content, sit lower)
  bdr: "rgba(16,18,17,0.10)",   // standard border, quiet
  bdr2: "rgba(16,18,17,0.22)",  // emphasis border
  bdrFocus: "#799385",          // focus ring / max emphasis — brand sage

  txt: "#151715",     // primary text (near-black ink)
  txt2: "#494e4b",    // secondary text
  mut: "#7a827d",     // tertiary / metadata
  faint: "#a9afab",   // muted / placeholder / disabled

  moss: "#799385",       // brand accent — sage green
  mossDeep: "#5f7669",   // pressed/hover state of accent
  mossSoft: "rgba(121,147,133,0.14)",
  clay: "#EB97A6",       // primary accent — soft pink (small badges/highlights only)
  dew: "rgba(121,147,133,0.08)",   // pale sage highlight (selected rows)

  red: "#B63E59",     // secondary accent — deep rose (destructive/overdue/urgent)
  orange: "#EB97A6",  // warning/highlight — mapped to the pink accent, used sparingly
  green: "#799385",
  blue: "#494e4b",    // neutral informational tone (kept out of the accent family)

  shadowSm: "0 1px 2px rgba(16,18,17,0.05)",
  shadowMd: "0 6px 20px rgba(16,18,17,0.09)",
};
const C_DARK = {
  bg: "#101210",
  sur: "#171917",
  s2: "#1e211e",
  inset: "#1c1f1c",
  bdr: "rgba(240,240,235,0.10)",
  bdr2: "rgba(240,240,235,0.22)",
  bdrFocus: "#8fab9d",

  txt: "#f2f1ee",
  txt2: "#c7cbc7",
  mut: "#8f958f",
  faint: "#666b66",

  moss: "#8fab9d",
  mossDeep: "#a8c3b7",
  mossSoft: "rgba(143,171,157,0.18)",
  clay: "#f0aebb",
  dew: "rgba(143,171,157,0.10)",

  red: "#d1728a",
  orange: "#f0aebb",
  green: "#8fab9d",
  blue: "#c7cbc7",

  shadowSm: "0 1px 2px rgba(0,0,0,0.28)",
  shadowMd: "0 10px 30px rgba(0,0,0,0.42)",
};
const C = Object.assign({}, C_LIGHT);

/* ─── TYPOGRAPHY (#3) ─────────────────────────────────────────────────
   Jost stays ONLY for the uppercase letterspaced treatment (nav, section
   headers, buttons, pills/labels) — the signature carried over from the
   Green Kiss retail site. Everything else (body copy, card titles, form
   fields, table cells) runs on Manrope, loaded alongside it in index.html.
   IBM Plex Mono is untouched — dates, PINs, build stamp keep using it
   directly at their own call sites. */
const FONT_CAPS = "'Jost',system-ui,sans-serif";
const FONT_BODY = "'Manrope',system-ui,sans-serif";

const setTheme = (theme) => {
  Object.assign(C, theme === "dark" ? C_DARK : C_LIGHT);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.setProperty("--gk-focus", C.bdrFocus);
  }
  try { localStorage.setItem("gk_theme", theme); } catch {}
};
const getTheme = () => { try { return localStorage.getItem("gk_theme") || "light"; } catch { return "light"; } };
setTheme(getTheme());

/* ─── LOGIN SCREEN BRAND (fixed — not theme-swapped; this is a
   deliberate brand moment, always deep sage bg + white card) ───────── */
const LOGIN_BG = "#3f4d46";       // deepened #799385
const LOGIN_BG_DEEP = "#2e3934";  // gradient end, a shade deeper still

/* ─── CATEGORY / CAMPAIGN PALETTE (brand-safe swatches offered when
   creating a category or content campaign) ──────────────────────────── */
const CATEGORY_COLORS = ["#799385", "#4f6358", "#a8bdb2", "#B63E59", "#EB97A6", "#2a2a28", "#8f948f"];

/* ─── REMOTE MODE DETECTION ──────────────────────────────────────────
   Remote mode = built + served from the same origin as api.php. In dev
   (vite dev server) import.meta.env.PROD is false, so dev keeps the exact
   v1 localStorage behavior. localStorage.gkForceRemote overrides either
   way, for testing the remote path against a locally-proxied api.php. */
const REMOTE_MODE = (() => {
  try {
    const override = localStorage.getItem("gkForceRemote");
    if (override === "1") return true;
    if (override === "0") return false;
  } catch {}
  return typeof import.meta !== "undefined" && !!import.meta.env && !!import.meta.env.PROD;
})();

const API_BASE = "api.php";

/* ─── UTILS (used below, hoisted here) ───────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);
const nowISO = () => new Date().toISOString();
/** Parse a stored date. A bare "YYYY-MM-DD" (our task/project date shape) must
 * be read as LOCAL midnight — `new Date("2026-07-16")` parses as UTC midnight,
 * which lands on the previous calendar day in any timezone behind UTC, so a
 * task due today would render "yesterday" and read as overdue. Full ISO
 * timestamps (with a "T") keep their exact instant. */
const parseDate = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
};
const fmtDate = (iso) => {
  if (!iso) return "";
  try { return parseDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};
const fmtDateShort = (iso) => {
  if (!iso) return "";
  try { return parseDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return iso; }
};

/* ─── SESSION TOKEN (remote mode) ─────────────────────────────────────
   Alongside the existing gkCurrentUser (id/name/role, both modes), remote
   mode also stores the bearer token. Dev mode never touches this. */
const _getToken = () => { try { return sessionStorage.getItem("gkToken") || ""; } catch { return ""; } };
const _setToken = (t) => { try { if (t) sessionStorage.setItem("gkToken", t); else sessionStorage.removeItem("gkToken"); } catch {} };

/* ─── GLOBAL CROSS-COMPONENT REFS (confirm dialog / toast / offline) ── */
const _gkRefs = { confirmResolve: null, setConfirmState: null, showSavedToast: null, setOffline: null };
/** Promise-based confirm — resolves true/false. ConfirmDialog.jsx renders the modal. */
function confirmDelete(msg) {
  return new Promise(resolve => {
    _gkRefs.confirmResolve = resolve;
    if (_gkRefs.setConfirmState) _gkRefs.setConfirmState({ open: true, msg });
    else resolve(false);
  });
}
function triggerSaved() { if (_gkRefs.showSavedToast) _gkRefs.showSavedToast(); }
/** Generic top-right toast with a custom message ("Copied", etc.) — same
 * component as the Saved toast, different text. */
function triggerToast(msg) { if (_gkRefs.showSavedToast) _gkRefs.showSavedToast(msg); }
function _setOffline(v) { if (_gkRefs.setOffline) _gkRefs.setOffline(v); }

/* ─── LOW-LEVEL API CLIENT (remote mode only) ────────────────────────
   Every write is fire-and-retry-once from the caller's point of view —
   db.setSync doesn't await this, it just kicks it off; failures surface
   as the small "offline" indicator rather than blocking the UI. Direct
   awaiters (login, uploads, admin actions, history) get real errors. */
async function apiCall(action, opts = {}) {
  const { method = "GET", body, auth = true, query } = opts;
  let url = API_BASE + "?action=" + encodeURIComponent(action);
  if (query) {
    for (const k in query) url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(query[k]);
  }
  const headers = {};
  if (auth) {
    const t = _getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
  }
  let payload;
  if (method !== "GET") {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      payload = body;
    } else {
      headers["Content-Type"] = "application/json";
      payload = body !== undefined ? JSON.stringify(body) : undefined;
    }
  }
  const res = await fetch(url, { method, headers, body: payload });
  if (res.status === 401 && auth) {
    _setToken("");
    clearCurrentUser();
    _remoteWarm = false;
    if (typeof window !== "undefined") window.location.reload();
    throw new Error("Session expired — please log in again.");
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || ("Request failed (" + res.status + ")"));
  return data || {};
}

async function _remoteKvSet(key, value) {
  const attempt = () => apiCall("kv_set", { method: "POST", body: { key, value } });
  try {
    await attempt();
    _setOffline(false);
  } catch {
    try {
      await attempt();
      _setOffline(false);
    } catch {
      _setOffline(true);
    }
  }
}

/* ─── STORAGE (write-through cache; localStorage in dev, kv_store API in
   remote mode — same Map either way, so getSync/setSync never change
   shape for the ~30 call sites across components). ─────────────────── */
const _cache = new Map();
function _hydrate(key) {
  if (_cache.has(key)) return _cache.get(key);
  if (REMOTE_MODE) return null; // remote mode only ever has what kv_all loaded
  try {
    const raw = localStorage.getItem("gk_" + key);
    const v = raw ? JSON.parse(raw) : null;
    _cache.set(key, v);
    return v;
  } catch { return null; }
}
const db = {
  /** @param {string} k @returns {Promise<any>} */
  get: async (k) => _hydrate(k),
  /** @param {string} k @param {any} v @returns {Promise<void>} */
  set: async (k, v) => {
    _cache.set(k, v);
    if (REMOTE_MODE) { await _remoteKvSet(k, v); return; }
    try { localStorage.setItem("gk_" + k, JSON.stringify(v)); } catch {}
  },
  /** Synchronous read for render-time use (in-memory cache is always
   * fully warm by the time components render — see remoteBootstrap). */
  getSync: (k) => _hydrate(k),
  /** Like getSync but guarantees an array. Guards render-time .map/.filter
   * against a corrupted or wrong-typed value (a truthy non-array would slip
   * past `|| []` and crash the whole render layer). */
  getListSync: (k) => { const v = _hydrate(k); return Array.isArray(v) ? v : []; },
  setSync: (k, v) => {
    _cache.set(k, v);
    if (REMOTE_MODE) { _remoteKvSet(k, v); return; } // fire-and-forget, matches dev-mode call sites
    try { localStorage.setItem("gk_" + k, JSON.stringify(v)); } catch {}
  },
};

/* ─── REMOTE BOOTSTRAP ────────────────────────────────────────────────
   Runs once right after login (and once on page reload if a session is
   already stored). Warms the same _cache Map dev mode seeds locally. */
let _remoteWarm = false;
const isRemoteWarm = () => !REMOTE_MODE || _remoteWarm;
async function remoteBootstrap() {
  const [all, roster] = await Promise.all([
    apiCall("kv_all", { method: "GET" }),
    apiCall("login_options", { method: "GET", auth: false }),
  ]);
  const data = all.data || {};
  Object.keys(data).forEach(k => _cache.set(k, data[k]));
  // Lightweight {id,name} roster for assignment dropdowns/avatars — anyone
  // can see it (no PIN, no role). Admin Panel fetches the full role-bearing
  // list separately via fetchUsersFull(), gated to admins server-side.
  _cache.set("users", roster.users || []);
  _remoteWarm = true;
}

/* ─── USER SESSION (sessionStorage, mirrors DuckTracks) ─────────────── */
const getCurrentUser = () => { try { return JSON.parse(sessionStorage.getItem("gkCurrentUser") || "null"); } catch { return null; } };
const setCurrentUser = (u) => { sessionStorage.setItem("gkCurrentUser", JSON.stringify(u)); _devRecordLogin(u); };
const clearCurrentUser = () => { _devRecordLogout(); sessionStorage.removeItem("gkCurrentUser"); };

/* Login history (Batch 1). Remote mode records server-side (login_sessions,
   see api.php); dev mode mirrors it in a kv "loginHistory" list so the Admin
   panel has something to show and the feature works end-to-end locally. */
function _devRecordLogin(u) {
  if (REMOTE_MODE || !u || !u.id) return;
  const list = db.getSync("loginHistory") || [];
  list.unshift({ id: uid(), userId: u.id, userName: u.name, loginAt: nowISO(), lastSeen: nowISO(), logoutAt: null });
  db.setSync("loginHistory", list.slice(0, 2000));
}
function _devRecordLogout() {
  if (REMOTE_MODE) return;
  const me = getCurrentUser();
  if (!me) return;
  const list = db.getSync("loginHistory") || [];
  const idx = list.findIndex(s => s.userId === me.id && !s.logoutAt);
  if (idx < 0) return;
  list[idx] = { ...list[idx], logoutAt: nowISO(), lastSeen: nowISO() };
  db.setSync("loginHistory", list);
}
/** Admin-only staff sign-in history, normalized to the server's snake_case
 * field shape in both modes so the panel reads one format. */
async function fetchLoginHistory() {
  if (REMOTE_MODE) {
    const res = await apiCall("login_history", { method: "GET" });
    return res.sessions || [];
  }
  return (db.getSync("loginHistory") || []).map(s => ({
    id: s.id, user_id: s.userId, user_name: s.userName,
    login_at: s.loginAt, last_seen: s.lastSeen, logout_at: s.logoutAt,
  }));
}

/* Presence (#49). A user is "online" if their session last_seen is within
   ONLINE_MS. Server advances last_seen on every authed request (requireAuth),
   so the window is a live activity clock. Cached module-side + refreshed by a
   poll in App; components read isUserOnline() synchronously. */
const PRESENCE_ONLINE_MS = 5 * 60 * 1000;
let _presence = {}; // userId -> last_seen ISO (most recent open session)
const _presenceSubs = new Set(); // components re-render on each presence refresh
const subscribePresence = (fn) => { _presenceSubs.add(fn); return () => _presenceSubs.delete(fn); };
/** Fetch presence (per-user latest last_seen) and cache it. Dev mode derives
 * it from the local loginHistory mirror so the indicator works offline too. */
async function refreshPresence() {
  try {
    let rows;
    if (REMOTE_MODE) {
      const res = await apiCall("presence", { method: "GET" });
      rows = res.presence || [];
    } else {
      const map = {};
      (db.getSync("loginHistory") || []).forEach(s => {
        if (s.logoutAt) return;
        if (!map[s.userId] || s.lastSeen > map[s.userId]) map[s.userId] = s.lastSeen;
      });
      // The current user is active right now (their local session is live).
      const me = getCurrentUser();
      if (me) map[me.id] = nowISO();
      rows = Object.entries(map).map(([user_id, last_seen]) => ({ user_id, last_seen }));
    }
    const next = {};
    rows.forEach(r => { if (r.user_id && r.last_seen) next[r.user_id] = r.last_seen; });
    _presence = next;
  } catch { /* leave last-known presence on a failed poll */ }
  _presenceSubs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  return _presence;
}
/** Synchronous read of the cached presence: true if seen within ONLINE_MS. */
function isUserOnline(userId) {
  const seen = _presence[userId];
  if (!seen) return false;
  return (Date.now() - new Date(seen).getTime()) < PRESENCE_ONLINE_MS;
}

/** Remote login: POSTs {name, pin}, stores token+user, warms the cache.
 * Throws with a user-facing message on failure. */
async function remoteLogin(name, pin) {
  const res = await apiCall("login", { method: "POST", auth: false, body: { name, pin } });
  _setToken(res.token);
  setCurrentUser(res.user);
  await remoteBootstrap();
  return res.user;
}
async function remoteLoginOptions() {
  const res = await apiCall("login_options", { method: "GET", auth: false });
  return res.users || [];
}
/* ─── SHARED INPUT STYLE ─────────────────────────────────────────── */
const inp = (ex = {}) => ({
  background: C.inset, border: `1.5px solid ${C.bdr}`, color: C.txt,
  borderRadius: 8, padding: "10px 13px", fontSize: 15, outline: "none",
  fontFamily: FONT_BODY, width: "100%",
  transition: "border-color .15s", ...ex,
});

/* ─── ROLE HELPERS ───────────────────────────────────────────────────
   viewer  = read SOPs + view tasks only
   editor  = full SOP/task CRUD
   admin   = editor + manage users + manage categories */
const ROLE_LABELS = { admin: "Admin", editor: "Editor", viewer: "Viewer" };
const canEdit = (user) => user && (user.role === "admin" || user.role === "editor");
const isAdmin = (user) => user && user.role === "admin";

/* ─── SIDEBAR NAV + PER-USER ACCESS (#38) ─────────────────────────────
   Single source of truth for the sidebar (Sidebar renders it; Admin Panel
   builds its access checkboxes from it). `divider:true` entries render as
   separators and aren't toggleable. Admin Panel itself is NOT here — it's
   pinned separately and stays admin-only.

   Access: non-admins see only the sections listed in the `navAccess` kv doc
   (`{ [userId]: [sectionKey,...] }`); admins bypass the filter entirely.
   A user with no entry defaults to Image Repository only — the deliberate
   rollout default (staff get one ready section, more get flipped on per
   user). */
const NAV_ITEMS = [
  { key: "dashboard", label: "My Dashboard", icon: "dashboard" },
  { key: "chat", label: "Chat", icon: "forum" },
  { key: "store", label: "Store Goals", icon: "speed" },
  { divider: true },
  { key: "tasks", label: "Task Manager", icon: "checklist" },
  { key: "projects", label: "Projects", icon: "folder_special" },
  { key: "calendar", label: "Content Calendar", icon: "calendar_month" },
  { divider: true },
  { key: "library", label: "SOP Library", icon: "menu_book" },
  { key: "forms", label: "Forms", icon: "description" },
  { key: "imagerepo", label: "Image Repository", icon: "perm_media" },
  { key: "toolsprompts", label: "Tools & Prompts", icon: "auto_awesome" },
  { divider: true },
  { key: "playbook", label: "Operations Playbook", icon: "import_contacts" },
  { key: "announcements", label: "Announcements", icon: "campaign" },
  { key: "waitlist", label: "Waitlist", icon: "support_agent" },
];
const NAV_SECTIONS = NAV_ITEMS.filter(it => !it.divider); // toggleable {key,label,icon}
const DEFAULT_NAV_ACCESS = ["imagerepo"];
const getNavAccess = () => db.getSync("navAccess") || {};
/** Raw stored access list for one user (or the rollout default). Admin Panel
 * prefills its checkboxes from this; does NOT apply the admin-all bypass. */
const getUserSections = (userId) => {
  const list = getNavAccess()[userId];
  return Array.isArray(list) ? list : DEFAULT_NAV_ACCESS.slice();
};
const setUserSections = (userId, keys) => {
  const next = { ...getNavAccess(), [userId]: keys };
  // Merged per-user server-side: two admins editing different staff members
  // were overwriting each other's changes with a whole-map write.
  if (REMOTE_MODE) {
    _cache.set("navAccess", next);
    apiCall("nav_access_save", { method: "POST", body: { userId, sections: keys } }).then(res => {
      if (res && res.navAccess) _cache.set("navAccess", res.navAccess);
      _setOffline(false);
    }).catch(() => _setOffline(true));
    return;
  }
  saveNavAccess(next);
};
const saveNavAccess = (m) => db.setSync("navAccess", m);
/** Effective visible section keys for a user — admins get everything. */
const sectionsForUser = (user) =>
  isAdmin(user) ? NAV_SECTIONS.map(s => s.key) : getUserSections(user?.id);

/* ─── STAFF GROUPS (Batch 1) ──────────────────────────────────────────
   Lightweight labels a staff member can hold several of (Ops, Floor,
   Sales, …). Used to target announcements, chat channels and callbacks
   at a whole group at once. Two generic kv docs, so they ride the plain
   kv_set endpoint with no dedicated PHP action:
     groups     = [{ id, name, color, parentId }]  (parentId reserved for
                  a future hierarchy — always null for now, flat in the UI)
     userGroups = { [userId]: [groupId, …] }
   Membership lives keyed by user rather than on the users table so it
   works identically in dev and remote mode (remote users are server-side
   and we don't want to widen that API just for a label). */
const getGroups = () => db.getListSync("groups");
const saveGroups = (list) => db.setSync("groups", list);
const addGroup = (name, color, parentId = null) => {
  const g = { id: uid(), name: (name || "").trim(), color: color || CATEGORY_COLORS[0], parentId: parentId || null };
  saveGroups([...getGroups(), g]);
  return g;
};
const updateGroup = (id, changes) =>
  saveGroups(getGroups().map(g => g.id === id ? { ...g, ...changes } : g));
/** Removing a group also strips it from every member so no dangling ids
    are left behind in userGroups. */
const deleteGroup = (id) => {
  saveGroups(getGroups().filter(g => g.id !== id));
  const map = getUserGroupsMap();
  let touched = false;
  const next = {};
  for (const [uidKey, ids] of Object.entries(map)) {
    const kept = (ids || []).filter(g => g !== id);
    if (kept.length !== (ids || []).length) touched = true;
    next[uidKey] = kept;
  }
  if (touched) db.setSync("userGroups", next);
};
const getUserGroupsMap = () => db.getSync("userGroups") || {};
/** Group ids a single user belongs to. */
const getUserGroups = (userId) => {
  const ids = getUserGroupsMap()[userId];
  return Array.isArray(ids) ? ids : [];
};
const setUserGroups = (userId, groupIds) =>
  db.setSync("userGroups", { ...getUserGroupsMap(), [userId]: groupIds });
/** User ids that belong to a group — the reverse lookup targeting uses. */
const userIdsInGroup = (groupId) =>
  Object.entries(getUserGroupsMap()).filter(([, ids]) => (ids || []).includes(groupId)).map(([id]) => id);

/* ─── ANNOUNCEMENTS + NEWS (Batch 2) ─────────────────────────────────
   One store, two kinds:
     kind:"announcement" — an active push. Shows as a bottom-right toast or
       a full-screen must-acknowledge blocker. delivery is "now" (to anyone
       currently in the app, surfaced on the next poll) or "signin" (queued
       for each person's next login). requireAck records who's confirmed.
     kind:"news" — a passive "Current News" dashboard card, grouped by
       section (General/Sales/…), auto-expiring, no acknowledgement.
   Targeting is shared: audience "all" | "groups" | "users". Read receipts
   live in a separate nested map (announcementAcks), merged server-side the
   same way SOP acks are, so simultaneous acks never clobber each other. */
const ANNOUNCEMENT_SURFACES = [
  { key: "toast", label: "Toast — corner popup", icon: "notifications" },
  { key: "fullscreen", label: "Full screen — blocks the app", icon: "full_screen" },
];
const ANNOUNCEMENT_DELIVERY = [
  { key: "signin", label: "At next sign-in" },
  { key: "now", label: "Live now" },
];
// Section dot colors need a dark-mode variant like everything else driven off
// C; `color` resolves against the current theme at read time so news dots don't
// stay light-theme in dark mode. Pairs are [light, dark].
const _newsSection = (key, label, light, dark) =>
  ({ key, label, get color() { return getTheme() === "dark" ? dark : light; } });
const NEWS_SECTIONS = [
  _newsSection("general", "General", "#799385", "#8fab9d"),
  _newsSection("sales", "Sales", "#B63E59", "#d1728a"),
  _newsSection("product", "Product", "#4f6358", "#6f8a7d"),
  _newsSection("events", "Events", "#B98A3E", "#d7ab5e"),
];
const newsSectionMeta = (key) => NEWS_SECTIONS.find(s => s.key === key) || NEWS_SECTIONS[0];

const getAnnouncements = () => db.getListSync("announcements");
const saveAnnouncements = (list) => db.setSync("announcements", list);
function defAnnouncement(kind, user) {
  return {
    id: uid(), kind: kind || "announcement",
    title: "", body: "",
    audience: "all", groupIds: [], userIds: [],
    surface: "toast", delivery: "signin", requireAck: true,
    section: "general",
    publishAt: nowISO(), expiresAt: null,
    createdBy: user?.id || "", createdByName: user?.name || "",
    createdAt: nowISO(), updatedAt: nowISO(),
  };
}
function addAnnouncement(a) {
  const rec = { ...a, id: a.id || uid(), createdAt: a.createdAt || nowISO(), updatedAt: nowISO() };
  saveAnnouncements([rec, ...getAnnouncements()]);
  return rec;
}
function updateAnnouncement(id, changes) {
  saveAnnouncements(getAnnouncements().map(a => a.id === id ? { ...a, ...changes, updatedAt: nowISO() } : a));
}
function deleteAnnouncement(id) {
  saveAnnouncements(getAnnouncements().filter(a => a.id !== id));
  const acks = getAnnouncementAcks();
  if (acks[id]) { const next = { ...acks }; delete next[id]; db.setSync("announcementAcks", next); }
}
/** Live right now: publish window open and not yet expired. */
function announcementIsLive(a, at = Date.now()) {
  const pub = a.publishAt ? new Date(a.publishAt).getTime() : 0;
  if (pub > at) return false;
  if (a.expiresAt && new Date(a.expiresAt).getTime() <= at) return false;
  return true;
}
/** Does this post's audience include the given user? */
function announcementTargetsUser(a, user) {
  if (!user) return false;
  if (a.audience === "all") return true;
  if (a.audience === "users") return (a.userIds || []).includes(user.id);
  if (a.audience === "groups") {
    const mine = new Set(getUserGroups(user.id));
    return (a.groupIds || []).some(g => mine.has(g));
  }
  return false;
}
/** Live posts of a kind ("announcement"/"news", or all) aimed at this user. */
function announcementsForUser(user, kind) {
  return getAnnouncements().filter(a =>
    (!kind || a.kind === kind) && announcementIsLive(a) && announcementTargetsUser(a, user));
}
/** Concrete recipient ids, for read-receipt math (audience → user ids). */
function announcementRecipientIds(a) {
  if (a.audience === "all") return getUsers().map(u => u.id);
  if (a.audience === "users") return [...(a.userIds || [])];
  if (a.audience === "groups") {
    const set = new Set();
    (a.groupIds || []).forEach(g => userIdsInGroup(g).forEach(id => set.add(id)));
    return [...set];
  }
  return [];
}
const getAnnouncementAcks = () => db.getSync("announcementAcks") || {};
const hasAckedAnnouncement = (id, userId) => !!(getAnnouncementAcks()[id] || {})[userId];
const announcementAckList = (id) => Object.entries(getAnnouncementAcks()[id] || {}).map(([userId, v]) => ({ userId, at: v.at }));
/** Record one user's acknowledgement. Merged server-side (like SOP acks) so
    many people acking the same announcement never overwrite each other. */
function ackAnnouncement(id, userId) {
  const at = nowISO();
  const acks = getAnnouncementAcks();
  const forA = { ...(acks[id] || {}) };
  forA[userId] = { at };
  const next = { ...acks, [id]: forA };
  if (REMOTE_MODE) {
    _cache.set("announcementAcks", next);
    apiCall("announcement_ack_save", { method: "POST", body: { announcementId: id, userId, at } }).then(res => {
      if (res && res.acks) _cache.set("announcementAcks", res.acks);
      _setOffline(false);
    }).catch(() => _setOffline(true));
    return;
  }
  db.setSync("announcementAcks", next);
}

/* ─── WAITLIST + CALLBACKS (Batch 4) ─────────────────────────────────
   Clients waitlist for out-of-stock products. When stock lands, ops logs a
   callback that targets sales staff and/or a group; those people get a
   must-acknowledge toast + a dashboard strip, then work the waitlist for
   that product (call each client, mark fulfilled) and close the callback.
   Generic kv docs; callbackAcks merges server-side like announcement acks. */
// Clients ------------------------------------------------------------------
const getClients = () => db.getListSync("clients");
const saveClients = (l) => db.setSync("clients", l);
const addClient = (c) => {
  const rec = { id: uid(), name: (c.name || "").trim(), phone: c.phone || "", email: c.email || "", notes: c.notes || "", createdAt: nowISO() };
  saveClients([...getClients(), rec]);
  return rec;
};
const updateClient = (id, ch) => saveClients(getClients().map(c => c.id === id ? { ...c, ...ch } : c));
const deleteClient = (id) => saveClients(getClients().filter(c => c.id !== id));
// Products (manual, each with a list of links) -----------------------------
const getProducts = () => db.getListSync("products");
const saveProducts = (l) => db.setSync("products", l);
const addProduct = (p) => {
  const rec = { id: uid(), name: (p.name || "").trim(), collection: p.collection || "", links: p.links || [], createdAt: nowISO() };
  saveProducts([...getProducts(), rec]);
  return rec;
};
const updateProduct = (id, ch) => saveProducts(getProducts().map(p => p.id === id ? { ...p, ...ch } : p));
const deleteProduct = (id) => saveProducts(getProducts().filter(p => p.id !== id));
// Waitlist entries (client wants product) ----------------------------------
const getWaitlist = () => db.getListSync("waitlist");
const saveWaitlist = (l) => db.setSync("waitlist", l);
const addWaitlistEntry = (e) => {
  const rec = { id: uid(), clientId: e.clientId, productId: e.productId, note: e.note || "", fulfilled: false, fulfilledAt: null, createdAt: nowISO() };
  saveWaitlist([rec, ...getWaitlist()]);
  return rec;
};
const updateWaitlistEntry = (id, ch) => saveWaitlist(getWaitlist().map(e => e.id === id ? { ...e, ...ch } : e));
const deleteWaitlistEntry = (id) => saveWaitlist(getWaitlist().filter(e => e.id !== id));
const waitlistForProduct = (productId) => getWaitlist().filter(e => e.productId === productId);
// Callbacks ----------------------------------------------------------------
const getCallbacks = () => db.getListSync("callbacks");
const saveCallbacks = (l) => db.setSync("callbacks", l);
const defCallback = (user) => ({
  id: uid(), productId: "", assigneeIds: [], groupIds: [], status: "open", note: "",
  createdBy: user?.id || "", createdByName: user?.name || "", createdAt: nowISO(), doneAt: null,
});
const addCallback = (c) => {
  const rec = { ...c, id: c.id || uid(), createdAt: c.createdAt || nowISO() };
  saveCallbacks([rec, ...getCallbacks()]);
  return rec;
};
const updateCallback = (id, ch) => saveCallbacks(getCallbacks().map(c => c.id === id ? { ...c, ...ch } : c));
const deleteCallback = (id) => {
  saveCallbacks(getCallbacks().filter(c => c.id !== id));
  const a = getCallbackAcks();
  if (a[id]) { const n = { ...a }; delete n[id]; db.setSync("callbackAcks", n); }
};
/** Does this callback target the given user (named assignee or via a group)? */
const callbackTargetsUser = (cb, user) => {
  if (!user) return false;
  if ((cb.assigneeIds || []).includes(user.id)) return true;
  const mine = new Set(getUserGroups(user.id));
  return (cb.groupIds || []).some(g => mine.has(g));
};
const openCallbacksForUser = (user) => getCallbacks().filter(c => c.status === "open" && callbackTargetsUser(c, user));
// Callback acknowledgements (merged server-side, same as announcement acks)-
const getCallbackAcks = () => db.getSync("callbackAcks") || {};
const hasAckedCallback = (id, userId) => !!(getCallbackAcks()[id] || {})[userId];
function ackCallback(id, userId) {
  const at = nowISO();
  const acks = getCallbackAcks();
  const forC = { ...(acks[id] || {}) };
  forC[userId] = { at };
  const next = { ...acks, [id]: forC };
  if (REMOTE_MODE) {
    _cache.set("callbackAcks", next);
    apiCall("callback_ack_save", { method: "POST", body: { callbackId: id, userId, at } }).then(res => {
      if (res && res.acks) _cache.set("callbackAcks", res.acks);
      _setOffline(false);
    }).catch(() => _setOffline(true));
    return;
  }
  db.setSync("callbackAcks", next);
}

/* ─── STAFF CHAT (Phase 1) ────────────────────────────────────────────
   Remote mode talks to the chat_* endpoints (messages live in real tables,
   not kv). Dev mode mirrors the same shape in localStorage kv so the whole
   UI works in the preview without a server — low volume, fine for testing.
   Built as a self-contained slice so it can be lifted into DuckTracks. */
const _chatCh = () => db.getListSync("chatChannels");
const _chatMsg = () => db.getListSync("chatMessages");
const _chatReads = () => db.getSync("chatReads") || {};
const _chatLastRead = (uidv, cid) => (_chatReads()[uidv] || {})[cid] || 0;
const _chatSetRead = (uidv, cid, v) => {
  const r = _chatReads(); r[uidv] = r[uidv] || {}; r[uidv][cid] = Math.max(r[uidv][cid] || 0, v);
  db.setSync("chatReads", r);
};
const _chatVisible = (me) => _chatCh().filter(c => !c.archived && (c.visibility === "public" || (c.memberIds || []).includes(me?.id)));

async function chatBootstrap() {
  if (REMOTE_MODE) { const res = await apiCall("chat_bootstrap", { method: "GET" }); return res.channels || []; }
  const me = getCurrentUser();
  const msgs = _chatMsg();
  return _chatVisible(me).map(c => {
    const cm = msgs.filter(m => m.channelId === c.id && !m.deletedAt);
    const last = cm[cm.length - 1];
    const lastId = last ? last.id : 0;
    const lr = _chatLastRead(me.id, c.id); // unread = everything since you last read (no history catch-up)
    return {
      id: c.id, name: c.name, kind: c.kind, visibility: c.visibility, createdBy: c.createdBy,
      memberIds: c.memberIds || [], lastMsgId: lastId, unread: cm.filter(m => m.id > lr && m.userId !== me.id).length,
      lastMessage: last ? { userId: last.userId, body: last.body, createdAt: last.createdAt } : null,
    };
  });
}
async function chatChannelCreate({ name, kind = "channel", visibility = "public", memberIds = [] }) {
  if (REMOTE_MODE) { const res = await apiCall("chat_channel_create", { method: "POST", body: { name, kind, visibility, memberIds } }); return res.id; }
  const me = getCurrentUser();
  const id = "ch_" + uid();
  const rec = { id, name: (name || "").trim(), kind, visibility, createdBy: me?.id || "", memberIds: Array.from(new Set([me?.id, ...memberIds].filter(Boolean))), createdAt: nowISO(), archived: false };
  db.setSync("chatChannels", [..._chatCh(), rec]);
  return id;
}
/** Unread messages worth a toast: DM/group messages + @mentions of me,
 * newer than the given cursor. */
async function chatAlerts(sinceId = 0) {
  if (REMOTE_MODE) { const res = await apiCall("chat_alerts", { method: "GET", query: { sinceId } }); return res.messages || []; }
  const me = getCurrentUser();
  const chById = Object.fromEntries(_chatCh().map(c => [c.id, c]));
  const like = "(user:" + me.id + ")";
  return _chatMsg().filter(m => {
    const c = chById[m.channelId];
    if (!c || c.archived || !(c.memberIds || []).includes(me.id)) return false;
    if (m.userId === me.id || m.deletedAt || m.id <= sinceId) return false;
    if (m.id <= _chatLastRead(me.id, m.channelId)) return false;
    return c.kind === "dm" || c.kind === "group" || (m.body || "").includes(like);
  }).sort((a, b) => a.id - b.id).slice(-10)
    .map(m => ({ id: m.id, channel_id: m.channelId, user_id: m.userId, body: m.body, channel_kind: chById[m.channelId].kind, channel_name: chById[m.channelId].name }));
}
async function chatOpenDM(userId) {
  if (REMOTE_MODE) { const res = await apiCall("chat_dm_open", { method: "POST", body: { userId } }); return res.id; }
  const me = getCurrentUser();
  const existing = _chatCh().find(c => c.kind === "dm" && !c.archived && (c.memberIds || []).length === 2 && c.memberIds.includes(me.id) && c.memberIds.includes(userId));
  if (existing) return existing.id;
  const id = "ch_" + uid();
  db.setSync("chatChannels", [..._chatCh(), { id, name: "", kind: "dm", visibility: "private", createdBy: me.id, memberIds: [me.id, userId], createdAt: nowISO(), archived: false }]);
  return id;
}
async function chatFetchMessages(channelId, beforeId = 0) {
  if (REMOTE_MODE) { const res = await apiCall("chat_messages", { method: "GET", query: { channelId, beforeId } }); return res.messages || []; }
  let cm = _chatMsg().filter(m => m.channelId === channelId);
  if (beforeId > 0) cm = cm.filter(m => m.id < beforeId);
  return cm.slice(-50).map(m => ({ id: m.id, user_id: m.userId, body: m.body, created_at: m.createdAt, edited_at: m.editedAt || null, deleted_at: m.deletedAt || null }));
}
async function chatSend(channelId, body) {
  const text = (body || "").trim();
  if (!text) return null;
  if (REMOTE_MODE) { const res = await apiCall("chat_send", { method: "POST", body: { channelId, body: text } }); return res.message; }
  const me = getCurrentUser();
  const all = _chatMsg();
  const id = all.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
  const msg = { id, channelId, userId: me?.id || "", body: text, createdAt: nowISO() };
  db.setSync("chatMessages", [...all, msg]);
  _chatSetRead(me.id, channelId, id);
  return { id, user_id: msg.userId, body: text, created_at: msg.createdAt };
}
async function chatEditMessage(id, body) {
  const text = (body || "").trim();
  if (!text) return;
  if (REMOTE_MODE) { await apiCall("chat_edit", { method: "POST", body: { id, body: text } }); return; }
  db.setSync("chatMessages", _chatMsg().map(m => m.id === id ? { ...m, body: text, editedAt: nowISO() } : m));
}
async function chatDeleteMessage(id) {
  if (REMOTE_MODE) { await apiCall("chat_delete", { method: "POST", body: { id } }); return; }
  db.setSync("chatMessages", _chatMsg().map(m => m.id === id ? { ...m, deletedAt: nowISO() } : m));
}
async function chatArchiveChannel(channelId) {
  if (REMOTE_MODE) { await apiCall("chat_channel_archive", { method: "POST", body: { channelId } }); return; }
  db.setSync("chatChannels", _chatCh().map(c => c.id === channelId ? { ...c, archived: true } : c));
}
async function chatMarkRead(channelId, upToMsgId = 0) {
  if (REMOTE_MODE) { await apiCall("chat_mark_read", { method: "POST", body: { channelId, upToMsgId } }); return; }
  const me = getCurrentUser();
  let upTo = upToMsgId;
  if (!upTo) { const cm = _chatMsg().filter(m => m.channelId === channelId); upTo = cm.length ? cm[cm.length - 1].id : 0; }
  _chatSetRead(me.id, channelId, upTo);
}
async function chatPoll(openChannelId = "", sinceId = 0) {
  if (REMOTE_MODE) { const res = await apiCall("chat_poll", { method: "GET", query: { openChannelId, sinceId } }); return { channels: res.channels || [], newMessages: res.newMessages || [] }; }
  const me = getCurrentUser();
  const msgs = _chatMsg();
  const channels = _chatVisible(me).map(c => {
    const cm = msgs.filter(m => m.channelId === c.id && !m.deletedAt);
    const lr = _chatLastRead(me.id, c.id);
    return { id: c.id, lastMsgId: cm.length ? cm[cm.length - 1].id : 0, unread: cm.filter(m => m.id > lr && m.userId !== me.id).length };
  });
  const newMessages = openChannelId
    ? msgs.filter(m => m.channelId === openChannelId && m.id > sinceId).map(m => ({ id: m.id, user_id: m.userId, body: m.body, created_at: m.createdAt }))
    : [];
  return { channels, newMessages };
}

/* ─── SEED DATA (dev mode only — remote mode is seeded once via schema.sql) ─
   Runs once against empty storage so the UI demos well immediately. */
function seedIfEmpty() {
  if (REMOTE_MODE) return;
  const users = db.getSync("users");
  if (!users) {
    // Admin Panel is restricted to Hayden + Megan (role: admin) — see schema.sql
    // for the remote-mode equivalent seed. Other staff default to editor/viewer.
    db.setSync("users", [
      { id: uid(), name: "Hayden", pin: "1234", role: "admin" },
      { id: uid(), name: "Megan", pin: "1234", role: "admin" },
      { id: uid(), name: "Jessica", pin: "1234", role: "editor" },
      { id: uid(), name: "Liz", pin: "1234", role: "editor" },
    ]);
  }
  const categories = db.getSync("categories");
  let cats = categories;
  if (!cats) {
    cats = [
      { id: uid(), name: "Opening & Closing", color: "#799385", createdAt: nowISO() },
      { id: uid(), name: "Product Handling", color: "#B63E59", createdAt: nowISO() },
      { id: uid(), name: "Customer Service", color: "#4f6358", createdAt: nowISO() },
    ];
    db.setSync("categories", cats);
  }
  const sops = db.getSync("sops");
  if (!sops) {
    const catOpen = cats.find(c => c.name === "Opening & Closing") || cats[0];
    const catProduct = cats.find(c => c.name === "Product Handling") || cats[1];
    /** @type {SOP[]} */
    const seeded = [
      {
        id: uid(),
        title: "Morning Opening Checklist",
        categoryId: catOpen.id,
        status: "published",
        blocks: [
          { id: uid(), type: "heading", text: "Before You Unlock the Front Door" },
          { id: uid(), type: "text", text: "Arrive 20 minutes before opening. Turn on all display lighting and the front sign. Check the walk-in cooler temperature log and initial it.\n\nWipe down all counters and the register area before setting out today's float." },
          { id: uid(), type: "heading", text: "Register Setup" },
          { id: uid(), type: "text", text: "Count the starting float against yesterday's closing count. Log any discrepancy immediately and flag your shift lead, don't wait until end of day." },
          { id: uid(), type: "checklist", title: "Opening Checklist", items: [
            { id: uid(), text: "Lights and front sign on" },
            { id: uid(), text: "Cooler temp logged and initialed" },
            { id: uid(), text: "Counters and register area wiped down" },
            { id: uid(), text: "Float counted and discrepancies flagged" },
          ] },
          { id: uid(), type: "links", title: "Reference Links", links: [
            { id: uid(), label: "POS system login", url: "https://example.com/pos" },
            { id: uid(), label: "Opening checklist (printable)", url: "https://example.com/checklist.pdf" },
          ] },
        ],
        createdAt: nowISO(),
        updatedAt: nowISO(),
        updatedBy: "Hayden",
      },
      {
        id: uid(),
        title: "Receiving & Shelving New Product",
        categoryId: catProduct.id,
        status: "published",
        blocks: [
          { id: uid(), type: "heading", text: "Receiving" },
          { id: uid(), type: "text", text: "Check every delivery against the packing slip before signing. Inspect for damage, especially glass containers and anything refrigerated.\n\nDate-stamp perishables immediately with the receiving date, not the delivery date." },
          { id: uid(), type: "image", src: "", caption: "Example of a correctly labeled shelf tag" },
          { id: uid(), type: "heading", text: "Shelving" },
          { id: uid(), type: "text", text: "Oldest stock goes to the front. Rotate every restock, don't just add to the back. Anything within 2 weeks of its use-by date gets moved to the discount shelf and logged." },
        ],
        createdAt: nowISO(),
        updatedAt: nowISO(),
        updatedBy: "Hayden",
      },
    ];
    db.setSync("sops", seeded);
  }
  const tasks = db.getSync("tasks");
  if (!tasks) {
    const seededUsers = db.getSync("users") || [];
    const hayden = seededUsers[0];
    /** @type {Task[]} */
    const seededTasks = [
      { id: uid(), title: "Restock lavender bundles from back stock", description: "Front display is running low, pull from the walk-in.", status: "todo", priority: "medium", assignedTo: hayden?.id || "", dueDate: "", relatedSopId: "", subTasks: [], createdAt: nowISO() },
      { id: uid(), title: "Review new supplier packing slip discrepancy", description: "Two jars short on last week's tincture order — follow up with supplier.", status: "in-progress", priority: "high", assignedTo: hayden?.id || "", dueDate: "", relatedSopId: "", subTasks: [], createdAt: nowISO() },
    ];
    db.setSync("tasks", seededTasks);
  }
  const projects = db.getSync("projects");
  if (!projects) {
    const seededUsers = db.getSync("users") || [];
    const hayden = seededUsers[0];
    const megan = seededUsers[1];
    const dayMs = 86400000;
    /** @type {Project} */
    const proj = {
      id: uid(), name: "Spring Refresh Display", description: "Refresh the front window and counter display to bring in the new spring restock.",
      status: "active", startDate: new Date(Date.now() - 5 * dayMs).toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 14 * dayMs).toISOString().slice(0, 10),
      leadId: hayden?.id || "", memberIds: [hayden?.id, megan?.id].filter(Boolean),
      color: C.moss, createdAt: nowISO(), updatedAt: nowISO(),
    };
    db.setSync("projects", [proj]);
    const existingTasks = db.getSync("tasks") || [];
    /** @type {Task[]} */
    const projTasks = [
      { id: uid(), title: "Source spring display props", description: "Ceramic dishes, dried florals, new signage stand.", status: "in-progress", priority: "high", assignedTo: hayden?.id || "", dueDate: new Date(Date.now() - 3 * dayMs).toISOString().slice(0, 10), relatedSopId: "", projectId: proj.id, subTasks: [], createdAt: nowISO() },
      { id: uid(), title: "Set up new display and photograph it", description: "Photograph the finished display for social + GBP once it's live.", status: "todo", priority: "medium", assignedTo: megan?.id || hayden?.id || "", dueDate: new Date(Date.now() + 7 * dayMs).toISOString().slice(0, 10), relatedSopId: "", projectId: proj.id, subTasks: [], createdAt: nowISO() },
    ];
    db.setSync("tasks", [...existingTasks, ...projTasks]);
  }
  const campaigns = db.getSync("campaigns");
  if (!campaigns) {
    const seededUsers = db.getSync("users") || [];
    const hayden = seededUsers[0];
    const dayMs = 86400000;
    /** @type {Campaign} */
    const camp = {
      id: uid(), name: "Spring Botanicals Launch", description: "Cross-channel push for the new spring botanical line.",
      startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 21 * dayMs).toISOString().slice(0, 10),
      status: "active", color: C.clay, createdAt: nowISO(),
    };
    db.setSync("campaigns", [camp]);
    /** @type {ContentItem[]} */
    const items = [
      {
        id: uid(), campaignId: camp.id, channel: "gbp", title: "New spring botanicals have arrived", status: "scheduled",
        publishDate: new Date(Date.now() + 2 * dayMs).toISOString().slice(0, 10), assigneeId: hayden?.id || "",
        body: "Our spring botanical restock is here — rosewater, calendula, and fresh-pressed oils now on the shelf.",
        images: [], links: [], notes: "",
        ctaType: "learn_more", ctaUrl: "", category: "update",
        targetKeyword: "", url: "", subjectLine: "", previewText: "", caption: "", hashtags: "",
        createdAt: nowISO(), updatedAt: nowISO(),
      },
      {
        id: uid(), campaignId: camp.id, channel: "instagram", title: "Spring botanicals unboxing reel", status: "idea",
        publishDate: new Date(Date.now() + 4 * dayMs).toISOString().slice(0, 10), assigneeId: "",
        body: "", images: [], links: [], notes: "Short unboxing + shelf styling reel.",
        ctaType: "", ctaUrl: "", category: "update",
        targetKeyword: "", url: "", subjectLine: "", previewText: "",
        caption: "Spring just walked in the door.", hashtags: "#greenkiss #naturalbeauty #springrestock",
        createdAt: nowISO(), updatedAt: nowISO(),
      },
      {
        id: uid(), campaignId: camp.id, channel: "email", title: "Spring Botanicals — Newsletter Feature", status: "draft",
        publishDate: new Date(Date.now() + 6 * dayMs).toISOString().slice(0, 10), assigneeId: hayden?.id || "",
        body: "Feature the new spring botanical line as the lead story in this month's newsletter.",
        images: [], links: [], notes: "",
        ctaType: "", ctaUrl: "", category: "update",
        targetKeyword: "", url: "", subjectLine: "Fresh in: spring botanicals", previewText: "New arrivals to brighten your routine",
        caption: "", hashtags: "",
        createdAt: nowISO(), updatedAt: nowISO(),
      },
    ];
    db.setSync("content", items);
  }
}

/* ─── REMOTE COLLECTION HELPERS (Phase — concurrency fix) ────────────
   Mirrors _remoteSopSave: fires the dedicated per-record action, and on
   success replaces the in-memory cache with the server's authoritative
   merged list, so the UI reflects the real merged truth (not just this
   client's optimistic local guess) once the request lands. Fire-and-forget
   from the caller's point of view, matching every other setSync call site. */
/* Every collection the server may echo back on a write. A delete that cascades
   returns BOTH its own collection and the cascaded one (project_delete →
   {projects, tasks}), so the client refreshes both from real server data
   instead of rewriting the second one from its own stale copy. */
const _SERVER_COLLECTIONS = [
  "sops", "categories", "tasks", "projects", "campaigns", "content", "contacts",
  "instances", "tags", "alerts", "taskTemplates", "acks", "navAccess",
];
function _applyServerCollections(res) {
  if (!res) return;
  _SERVER_COLLECTIONS.forEach(k => { if (res[k] !== undefined) _cache.set(k, res[k]); });
}
function _remoteCollectionSave(action, bodyKey, item) {
  apiCall(action, { method: "POST", body: { [bodyKey]: item } }).then(res => {
    _applyServerCollections(res);
    _setOffline(false);
  }).catch(() => _setOffline(true));
}
function _remoteCollectionDelete(action, id) {
  apiCall(action, { method: "POST", body: { id } }).then(res => {
    _applyServerCollections(res);
    _setOffline(false);
  }).catch(() => _setOffline(true));
}

/* ─── SINGLE-DOCUMENT SECTIONS — per-item writes ──────────────────────
   Image Repository, Tools & Prompts and the Playbook's pages are each one kv
   doc wrapping a list of identified items. Writing the whole doc meant two
   editors on the same page silently overwrote each other's entries, so
   add/edit/remove now send just the one item and the server merges it.

   The whole-doc save* helpers below stay for the genuinely whole-list intents —
   reordering, and restoring a whole document from history — where losing a race
   costs an ordering rather than someone's content. */
function _docItemWrite(kvKey, field, item, id) {
  const doc = db.getSync(kvKey) || {};
  const list = Array.isArray(doc[field]) ? doc[field] : [];
  const nextList = item
    ? (list.some(x => x.id === item.id) ? list.map(x => x.id === item.id ? item : x) : [...list, item])
    : list.filter(x => x.id !== id);
  const next = { ...doc, [field]: nextList };
  if (REMOTE_MODE) {
    _cache.set(kvKey, next); // optimistic; replaced by the server's merged doc
    const body = item ? { key: kvKey, item } : { key: kvKey, id };
    apiCall(item ? "doc_item_save" : "doc_item_delete", { method: "POST", body }).then(res => {
      if (res && res.doc) _cache.set(kvKey, res.doc);
      _setOffline(false);
    }).catch(() => _setOffline(true));
    return next;
  }
  db.setSync(kvKey, next);
  return next;
}
const saveImageRepoBlock = (block) => _docItemWrite("imagerepo", "blocks", block);
const deleteImageRepoBlock = (id) => _docItemWrite("imagerepo", "blocks", null, id);
const saveToolsPromptsItem = (item) => _docItemWrite("toolsPrompts", "items", item);
const deleteToolsPromptsItem = (id) => _docItemWrite("toolsPrompts", "items", null, id);
const savePlaybookSection = (section) => _docItemWrite("playbook", "sections", section);
const deletePlaybookSection = (id) => _docItemWrite("playbook", "sections", null, id);

/* ─── CACHE REFRESH ───────────────────────────────────────────────────
   The kv cache is warmed once at login and never again, so a tab left open all
   day builds its writes from an ever-staler view of the data. Re-pulling on
   focus bounds that to "since you last looked at this tab". One request. */
async function refreshCache() {
  if (!REMOTE_MODE || !_remoteWarm) return false;
  const all = await apiCall("kv_all", { method: "GET" });
  const data = all.data || {};
  // Note: "users" is the roster from login_options, not a kv row, so kv_all
  // never contains it and this can't clobber it.
  Object.keys(data).forEach(k => _cache.set(k, data[k]));
  return true;
}

/* ─── CATEGORY STORAGE ───────────────────────────────────────────── */
/** @returns {Category[]} */
const getCategories = () => db.getListSync("categories");
/** @param {Category[]} c */
const saveCategories = (c) => db.setSync("categories", c);
const addCategory = (name, color) => {
  const newCat = { id: uid(), name, color, createdAt: nowISO() };
  const next = [...getCategories(), newCat];
  if (REMOTE_MODE) { _cache.set("categories", next); _remoteCollectionSave("category_save", "category", newCat); return newCat; }
  saveCategories(next);
  return newCat;
};
const updateCategory = (id, changes) => {
  const next = getCategories().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) {
    _cache.set("categories", next);
    _remoteCollectionSave("category_save", "category", next.find(c => c.id === id));
    return next;
  }
  saveCategories(next);
  return next;
};
const deleteCategory = (id) => {
  const next = getCategories().filter(c => c.id !== id);
  // Leave SOPs uncategorized rather than deleting them. In remote mode the
  // server runs that cascade against current data and echoes both collections
  // back — writing it from here was a whole-array kv_set built from a cache
  // warmed at login, which silently dropped any SOP added since.
  const uncategorized = getSOPs().map(s => s.categoryId === id ? { ...s, categoryId: "" } : s);
  if (REMOTE_MODE) {
    _cache.set("categories", next);
    _cache.set("sops", uncategorized); // optimistic; server's version wins
    _remoteCollectionDelete("category_delete", id);
    return;
  }
  saveCategories(next);
  saveSOPs(uncategorized);
};

/* ─── TAG STORAGE (#8 — foundation for tag chips + create-on-the-fly) ─
   Same per-record collision-safe shape as categories. Colors are drawn
   from the same CATEGORY_COLORS swatch set so tag chips visually match
   the rest of the app's "ingredient label" tag treatment. */
/** @returns {Tag[]} */
const getTags = () => db.getListSync("tags");
/** @param {Tag[]} t */
const saveTags = (t) => db.setSync("tags", t);
const addTag = (name, color) => {
  const newTag = { id: uid(), name, color, createdAt: nowISO() };
  const next = [...getTags(), newTag];
  if (REMOTE_MODE) { _cache.set("tags", next); _remoteCollectionSave("tag_save", "tag", newTag); return newTag; }
  saveTags(next);
  return newTag;
};

/* ─── CONTACT STORAGE (internal team + vendor contacts for Playbook Key
   Contacts and @person mentions) — same per-record collision-safe shape
   as tags/categories. ──────────────────────────────────────────────── */
/** @returns {Contact[]} */
const getContacts = () => db.getListSync("contacts");
/** @param {Contact[]} c */
const saveContacts = (c) => db.setSync("contacts", c);
const addContact = (contact) => {
  const newContact = { id: uid(), createdAt: nowISO(), ...contact };
  const next = [...getContacts(), newContact];
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionSave("contact_save", "contact", newContact); return newContact; }
  saveContacts(next);
  return newContact;
};
const updateContact = (id, changes) => {
  const next = getContacts().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionSave("contact_save", "contact", next.find(c => c.id === id)); return next; }
  saveContacts(next);
  return next;
};
const deleteContact = (id) => {
  const next = getContacts().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionDelete("contact_delete", id); }
  else saveContacts(next);
};

/* ─── ALERT STORAGE (#9 — "Alert staff member" overflow action) ──────
   Any authenticated user may create (flagging something for a manager is
   a viewer-appropriate action); delete is restricted server-side to the
   alert's target, its creator, or an admin. */
/** @returns {Alert[]} */
const getAlerts = () => db.getListSync("alerts");
/** @param {Alert[]} a */
const saveAlerts = (a) => db.setSync("alerts", a);
const addAlert = (taskId, toUserId) => {
  const me = getCurrentUser();
  const newAlert = { id: uid(), taskId, fromUserId: me?.id || "", toUserId, at: nowISO() };
  const next = [...getAlerts(), newAlert];
  if (REMOTE_MODE) { _cache.set("alerts", next); _remoteCollectionSave("alert_save", "alert", newAlert); return newAlert; }
  saveAlerts(next);
  return newAlert;
};
const deleteAlert = (id) => {
  const next = getAlerts().filter(a => a.id !== id);
  if (REMOTE_MODE) { _cache.set("alerts", next); _remoteCollectionDelete("alert_delete", id); }
  else saveAlerts(next);
};

/* ─── TASK TEMPLATE STORAGE (#9 — "Templates" overflow action) ──────── */
/** @returns {TaskTemplate[]} */
const getTaskTemplates = () => db.getListSync("taskTemplates");
/** @param {TaskTemplate[]} t */
const saveTaskTemplates = (t) => db.setSync("taskTemplates", t);
/** Strips id/status/assignee/dates so the template is a reusable shape,
 * not a frozen copy of one specific task. Subtasks keep their text/priority
 * but lose assignee/dates/done for the same reason. */
const snapshotTaskForTemplate = (task) => ({
  title: task.title, description: task.description || "", type: task.type || "task",
  priority: task.priority || "medium", tagIds: task.tagIds || [], relatedSopId: task.relatedSopId || "",
  subTasks: (task.subTasks || []).map(s => ({ text: s.text, priority: s.priority || "medium" })),
});
const addTaskTemplate = (name, task) => {
  const newTpl = { id: uid(), name, snapshot: snapshotTaskForTemplate(task), createdAt: nowISO() };
  const next = [...getTaskTemplates(), newTpl];
  if (REMOTE_MODE) { _cache.set("taskTemplates", next); _remoteCollectionSave("template_save", "template", newTpl); return newTpl; }
  saveTaskTemplates(next);
  return newTpl;
};
const deleteTaskTemplate = (id) => {
  const next = getTaskTemplates().filter(t => t.id !== id);
  if (REMOTE_MODE) { _cache.set("taskTemplates", next); _remoteCollectionDelete("template_delete", id); }
  else saveTaskTemplates(next);
};
/** Builds a fresh Task from a template — into a specific column/project,
 * never overwriting anything. */
const taskFromTemplate = (tpl, extra = {}) => {
  const snap = tpl.snapshot || {};
  return {
    id: uid(), createdAt: nowISO(), title: snap.title || "", description: snap.description || "",
    status: "todo", priority: snap.priority || "medium", type: snap.type || "task",
    assignedTo: "", dueDate: "", relatedSopId: snap.relatedSopId || "", projectId: "",
    tagIds: [...(snap.tagIds || [])],
    subTasks: (snap.subTasks || []).map(s => ({ id: uid(), text: s.text, done: false, assigneeId: "", dueDate: "", priority: s.priority || "medium" })),
    ...extra,
  };
};

/* ─── SOP STORAGE ────────────────────────────────────────────────── */
/** @returns {SOP[]} */
const getSOPs = () => db.getListSync("sops");
/** @param {SOP[]} s */
const saveSOPs = (s) => db.setSync("sops", s);
/** @param {string} id @returns {SOP|null} */
const getSOP = (id) => getSOPs().find(s => s.id === id) || null;

// Content-level SOP writes (create/update) route through the dedicated
// sop_save action in remote mode so the server can snapshot the prior
// version into `revisions`. Bulk rewrites of the whole list (delete,
// category-cascade uncategorize) stay on the plain saveSOPs/kv_set path —
// those aren't "an edit" worth versioning.
function _remoteSopSave(sop) {
  apiCall("sop_save", { method: "POST", body: { sop } }).then(res => {
    if (res && res.sops) _cache.set("sops", res.sops);
    _setOffline(false);
  }).catch(() => _setOffline(true));
}
// Dev-mode revision snapshots (mirrors the server's revisions table,
// capped at 10 per SOP as specced for local storage vs. the server's 20).
function _devSnapshotIfChanged(prevSop, nextSop) {
  if (!prevSop) return;
  const strip = (s) => { const { updatedAt, updatedBy, ...rest } = s || {}; return rest; };
  if (JSON.stringify(strip(prevSop)) === JSON.stringify(strip(nextSop))) return;
  const key = "rev:" + prevSop.id;
  const list = db.getSync(key) || [];
  const entry = {
    id: uid(), savedAt: nowISO(), savedBy: prevSop.updatedBy || "",
    snapshot: { title: prevSop.title, categoryId: prevSop.categoryId, status: prevSop.status, blocks: prevSop.blocks },
  };
  db.setSync(key, [entry, ...list].slice(0, 10));
}

const addSOP = (sop) => {
  // Upsert by id — SOPEditor's debounced autosave and unmount cleanup can
  // both fire for a brand-new SOP; blind append duplicated it (server's
  // sop_save already upserts, this makes dev mode and the cache match).
  const next = [...getSOPs().filter(s => s.id !== sop.id), sop];
  if (REMOTE_MODE) { _cache.set("sops", next); _remoteSopSave(sop); return sop; }
  saveSOPs(next);
  return sop;
};
const updateSOP = (id, changes) => {
  const prev = getSOP(id);
  const next = getSOPs().map(s => s.id === id ? { ...s, ...changes, updatedAt: nowISO() } : s);
  const updated = next.find(s => s.id === id);
  if (REMOTE_MODE) { _cache.set("sops", next); _remoteSopSave(updated); return; }
  _devSnapshotIfChanged(prev, updated);
  saveSOPs(next);
};
const deleteSOP = (id) => {
  const next = getSOPs().filter(s => s.id !== id);
  // Remote mode filters server-side. Doing it here shipped the whole remaining
  // array as a kv_set, so deleting one SOP wiped every SOP a coworker had
  // created since this tab loaded.
  if (REMOTE_MODE) { _cache.set("sops", next); _remoteCollectionDelete("sop_delete", id); return; }
  saveSOPs(next);
};
/** Copies a SOP as a new Draft "(copy)" — goes through the normal create path. */
const duplicateSOP = (sop) => {
  const copy = {
    ...sop, id: uid(), title: (sop.title || "Untitled SOP") + " (copy)", status: "draft",
    blocks: (sop.blocks || []).map(b => ({ ...b, id: uid() })),
    createdAt: nowISO(), updatedAt: nowISO(), updatedBy: getCurrentUser()?.name || "",
  };
  return addSOP(copy);
};

/** SOP/Form lifecycle. "archived" is reachable via the editor's restore/
 * archive controls rather than the draft⇄published toggle. */
const SOP_STATUSES = [
  { key: "draft", label: "Draft", col: C.faint },
  { key: "published", label: "Published", col: C.moss },
  { key: "archived", label: "Archived", col: C.faint },
];
const sopStatusMeta = Object.fromEntries(SOP_STATUSES.map(s => [s.key, s]));

const defSOP = (categoryId = "", kind = "sop") => ({
  id: uid(),
  title: "",
  categoryId,
  status: "draft",
  kind,
  code: "",
  typePrefix: "",
  // New SOPs open with an index block at the top (auto-builds a TOC from
  // headings + numbered blocks; deletable). Forms don't need indexes (R4).
  blocks: kind === "form" ? [] : [{ id: uid(), type: "index" }],
  createdAt: nowISO(),
  updatedAt: nowISO(),
  updatedBy: getCurrentUser()?.name || "",
});

/** Per-block emphasis background (#7) — resolves a stored key to a theme-aware
 * color (so the value survives light/dark swaps). Shared by editor + viewer. */
const blockBg = (key) => {
  if (key === "sage") return C.mossSoft;
  if (key === "clay") return C.clay + "22";
  if (key === "neutral") return C.s2;
  return "transparent";
};

/** Legacy `checklist` blocks normalize to a checkbox `list` block on read, so
 * one code path (list editor/viewer) handles both and old data re-saves as a
 * list. Non-checklist blocks pass through untouched. */
const asListBlock = (b) => {
  if (!b || b.type !== "checklist") return b;
  return {
    id: b.id, type: "list", style: "bulleted", checkboxes: true, withEntry: false,
    width: b.width, bg: b.bg, num: b.num,
    items: (b.items || []).map(it => ({ id: it.id, text: it.text || "", value: "", url: it.url || "" })),
  };
};

/** True if any block on the SOP has been routed for the Run-SOP task
 * (taskRole set) — the "Run SOP" button gates on this so the one-time
 * block-routing setup can't be skipped. */
const sopHasTaskRoles = (sop) => (sop?.blocks || []).some(b => b.taskRole === "description" || b.taskRole === "checklist");

/** Builds a draft Task from an SOP for the "Run SOP" flow. Routing is
 * explicit per block (`block.taskRole`, saved with the SOP): "description"
 * blocks contribute their plain text to the description, "checklist" list
 * blocks contribute their items as subtasks, everything else is skipped.
 * The description opens with a compact auto-summary (title, code, section
 * headings) so the task reads at a glance without duplicating the doc. */
function taskFromSop(sop, user) {
  const lines = [];
  const subTasks = [];
  const sections = (sop.blocks || []).map(asListBlock)
    .filter(b => b.type === "heading" && (b.text || "").trim())
    .map(b => (b.num != null ? `${b.num}. ` : "") + b.text.trim());
  (sop.blocks || []).forEach(raw => {
    const b = asListBlock(raw);
    if (b.taskRole === "checklist" && b.type === "list") {
      (b.items || []).forEach(it => subTasks.push({ id: uid(), text: it.text || "", done: false, assigneeId: "", dueDate: "", priority: "medium" }));
      return;
    }
    if (b.taskRole !== "description") return;
    if (b.type === "heading") { lines.push((b.text || "").toUpperCase()); if (b.description) lines.push(b.description); }
    else if (b.type === "text") { if (b.text) lines.push(b.text); }
    else if (b.type === "list") {
      const rows = (b.items || []).map((it, i) => (b.style === "numbered" ? `${i + 1}. ` : "• ") + (it.text || "") + (b.withEntry ? ": ______" : ""));
      if (rows.length) lines.push(rows.join("\n"));
    }
  });
  const summary = [
    `Run of ${sop.title || "SOP"}${sop.code ? ` (${sop.code})` : ""}.`,
    sections.length ? `Sections: ${sections.join(" · ")}.` : "",
  ].filter(Boolean).join("\n");
  return {
    id: uid(), createdAt: nowISO(),
    title: `${sop.title || "SOP"} — ${todayLocalISO()}`,
    description: [summary, ...lines].filter(Boolean).join("\n\n"),
    status: "todo", priority: "medium", type: "task",
    assignedTo: user?.id || "", dueDate: todayLocalISO(), relatedSopId: sop.id, projectId: "",
    subTasks, tagIds: [], fromSopRun: true,
  };
}

/** Distinct heading texts used across every SOP/Form, most-recently-updated
 * document first — feeds the heading autocomplete `<datalist>` so headings
 * converge on consistent naming without a hardcoded list (Phase 1). */
const getAllHeadingTexts = () => {
  const seen = new Set();
  const out = [];
  [...getSOPs()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).forEach(s => {
    (s.blocks || []).forEach(b => {
      if (b.type === "heading" && b.text && !seen.has(b.text)) { seen.add(b.text); out.push(b.text); }
    });
  });
  return out;
};

/** Type-prefix suggestions for the SOP editor's code field (#Phase 4) —
 * whatever's already in use across every SOP, plus the doc's standard set,
 * never enforced (the field stays free text). */
const getAllTypePrefixes = () => {
  const standard = ["SOP", "WI", "CL", "FRM", "TMP", "LOG", "APP", "POL", "REF", "DOC"];
  const used = getSOPs().map(s => s.typePrefix).filter(Boolean);
  return Array.from(new Set([...standard, ...used]));
};

/** The 12 numbered sections from the Green Kiss Operations Management
 * System doc, seeded as `categories` on request (never automatically) —
 * name-collision-safe so re-running never duplicates, and never touches
 * categories that already exist. Colors cycle through CATEGORY_COLORS. */
const STANDARD_SECTIONS = [
  "01. Operations", "02. Order Management", "03. Inventory Management",
  "04. Purchasing & Vendor Management", "05. Product Management", "06. Shopify Administration",
  "07. Finance & Administration", "08. Health, Safety & Security", "09. Team Communication & HR",
  "10. Marketing & Merchandising", "11. Reporting & Continuous Improvement", "12. References & Standards",
];
function seedStandardSections() {
  const existing = getCategories();
  const existingNames = new Set(existing.map(c => c.name));
  const toAdd = STANDARD_SECTIONS.filter(name => !existingNames.has(name));
  toAdd.forEach((name, i) => addCategory(name, CATEGORY_COLORS[i % CATEGORY_COLORS.length]));
  return toAdd.length;
}

/** Full-text search across title + all block text/labels/urls/captions. */
const sopMatchesSearch = (sop, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  if ((sop.title || "").toLowerCase().includes(q)) return true;
  return (sop.blocks || []).some(b => {
    if (b.type === "heading") return (b.text || "").toLowerCase().includes(q) || (b.description || "").toLowerCase().includes(q);
    if (b.type === "text") return (b.text || "").toLowerCase().includes(q);
    if (b.type === "image") return (b.caption || "").toLowerCase().includes(q);
    if (b.type === "checklist" || b.type === "list") return (b.items || []).some(i => (i.text || "").toLowerCase().includes(q));
    if (b.type === "links") return (b.links || []).some(l => (l.label || "").toLowerCase().includes(q) || (l.url || "").toLowerCase().includes(q));
    return false;
  });
};

/** Short plain-text excerpt for card previews. */
const sopExcerpt = (sop, maxLen = 140) => {
  const firstText = (sop.blocks || []).find(b => b.type === "text" || b.type === "heading");
  const raw = firstText ? firstText.text : "";
  const flat = (raw || "").replace(/\s+/g, " ").trim();
  return flat.length > maxLen ? flat.slice(0, maxLen).trim() + "…" : flat;
};

/* ─── INSTANCE STORAGE (Phase 2 — dated, attributed "daily run" fill-outs
   of a SOP or Form). Same per-record collision-safe shape as tags/contacts.
   blocksSnapshot is frozen at start time so editing the live template
   later never rewrites a past run's history. ─────────────────────────── */
/** @returns {Instance[]} */
const getAllInstances = () => db.getListSync("instances");
/** @param {Instance[]} i */
const saveInstances = (i) => db.setSync("instances", i);
/** @param {string} docId @returns {Instance[]} newest first */
const getInstances = (docId) => getAllInstances().filter(i => i.docId === docId).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
const addInstance = (instance) => {
  const newInstance = { id: uid(), values: {}, ...instance };
  const next = [...getAllInstances(), newInstance];
  if (REMOTE_MODE) { _cache.set("instances", next); _remoteCollectionSave("instance_save", "instance", newInstance); return newInstance; }
  saveInstances(next);
  return newInstance;
};
const updateInstance = (id, changes) => {
  const next = getAllInstances().map(i => i.id === id ? { ...i, ...changes } : i);
  if (REMOTE_MODE) { _cache.set("instances", next); _remoteCollectionSave("instance_save", "instance", next.find(i => i.id === id)); return next; }
  saveInstances(next);
  return next;
};
/** Today's calendar date in the browser's own timezone, not UTC — plain
 * `nowISO().slice(0,10)` rolls over at UTC midnight, which is late
 * afternoon/evening in North American timezones, so an opening/closing
 * checklist run near end-of-day would otherwise get silently tagged with
 * tomorrow's date. */
const todayLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Shared timeline/Gantt helpers (#53/#56) — used by both the project manager
   and the campaign manager so the two Gantts behave identically. */
const MS_DAY = 86400000;
const daysBetween = (a, b) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_DAY);
const addDaysISO = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIMELINE_ZOOMS = [{ key: "week", label: "Week", px: 30 }, { key: "month", label: "Month", px: 11 }, { key: "quarter", label: "Quarter", px: 4.6 }];

/* Form submissions (R4): a submission is an instance of a form — dated,
   attributed, snapshotting the template so later template edits never
   rewrite records. `values[blockId]` holds per-block fill state, `notes`
   per-block freeform notes (addable before AND after submitting), and
   `editLog` the non-editable post-submission change history. */
function newSubmission(sop, user) {
  return addInstance({
    docId: sop.id, docKind: "form", date: todayLocalISO(),
    blocksSnapshot: JSON.parse(JSON.stringify(sop.blocks || [])),
    startedBy: user?.name || "", startedAt: nowISO(),
    status: "in_progress", values: {}, notes: {}, editLog: [],
  });
}
/** Appends an edit-log entry when a SUBMITTED record is changed — deduped
 * so one editing session (same user, same minute) is one log line. */
function stampEditLog(inst, user) {
  if (inst.status !== "submitted") return inst.editLog || [];
  const log = inst.editLog || [];
  const by = user?.name || "";
  const at = nowISO();
  const last = log[log.length - 1];
  if (last && last.by === by && at.slice(0, 16) === (last.at || "").slice(0, 16)) return log;
  return [...log, { by, at }];
}
/** Stable per-form color for the submissions calendar dots. */
const formColor = (formId) => {
  let h = 0;
  for (const ch of String(formId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
};

/* ─── INTERNAL LINKING — mentions + backlinks (Phase 3) ───────────────
   Mentions are stored inline in plain text as `@[Label](kind:id)` — no
   rich-text editor needed, diffable, and trivially regex-parseable. kind
   is one of "sop"/"form"/"contact"/"playbook". Backlinks aren't a
   maintained reverse index (nothing to keep in sync or drift) — they're
   computed by scanning every document's text at render time, which is
   trivially fast at this data scale (dozens–low hundreds of documents). */
/** The kinds an @-mention token can carry. MENTION_RE is derived from this so
 * the parser, picker (getMentionCandidates) and navigator (setMagnetNav) can
 * all validate against one list instead of three hand-kept copies. */
const MENTION_KINDS = ["sop", "form", "contact", "playbook", "user", "task", "product", "client", "content", "campaign", "callback"];
const MENTION_RE = new RegExp(`@\\[([^\\]]+)\\]\\((${MENTION_KINDS.join("|")}):([\\w-]+)\\)`, "g");

/** Splits text into {text} and {mention:{kind,id,label}} segments, in order. */
function parseMentionText(text) {
  const out = [];
  let last = 0;
  const re = new RegExp(MENTION_RE);
  let m;
  while ((m = re.exec(text || ""))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ mention: { label: m[1], kind: m[2], id: m[3] } });
    last = m.index + m[0].length;
  }
  if (last < (text || "").length) out.push({ text: text.slice(last) });
  return out;
}

/** Every place a document's own free-text lives, for mention scanning
 * (backlinks) — heading text/description, text blocks, list item labels,
 * link labels. Checklist items and completion notes are per-run fill
 * state, not template content, so they're not scanned. */
function documentTextFields(blocks) {
  const out = [];
  (blocks || []).forEach(b => {
    if (b.type === "heading") { out.push(b.text || ""); out.push(b.description || ""); }
    else if (b.type === "text") out.push(b.text || "");
    else if (b.type === "list") (b.items || []).forEach(i => out.push(i.text || ""));
    else if (b.type === "links") (b.links || []).forEach(l => out.push(l.label || ""));
  });
  return out;
}

/** Search candidates for the @mention popover — SOPs, Forms, Contacts,
 * and (once seeded) Playbook sections, filtered by query. */
function getMentionCandidates(query) {
  const q = (query || "").toLowerCase();
  const matches = (s) => !q || (s || "").toLowerCase().includes(q);
  const out = [];
  // Staff first — @mentioning a person is the most common in chat (and pings
  // them). Then SOPs, contacts, tasks, playbook.
  getUsers().forEach(u => {
    if (matches(u.name)) out.push({ kind: "user", id: u.id, label: u.name, sub: "Staff" });
  });
  getSOPs().forEach(s => {
    if (matches(s.title)) out.push({ kind: s.kind === "form" ? "form" : "sop", id: s.id, label: s.title || "Untitled", sub: s.kind === "form" ? "Form" : "SOP" });
  });
  getContacts().forEach(c => {
    if (matches(c.name)) out.push({ kind: "contact", id: c.id, label: c.name, sub: c.role || "Contact" });
  });
  getTasks().forEach(t => {
    if (!t.archived && matches(t.title)) out.push({ kind: "task", id: t.id, label: t.title || "Untitled", sub: "Task" });
  });
  const playbook = db.getSync("playbook") || { sections: [] };
  (playbook.sections || []).forEach(s => {
    if (matches(s.title)) out.push({ kind: "playbook", id: s.id, label: s.title, sub: "Playbook" });
  });
  // Waitlist products/clients + content/campaigns are referenceable too (#47).
  getProducts().forEach(p => { if (matches(p.name)) out.push({ kind: "product", id: p.id, label: p.name, sub: "Product" }); });
  getClients().forEach(c => { if (matches(c.name)) out.push({ kind: "client", id: c.id, label: c.name, sub: "Client" }); });
  getContentItems().forEach(c => { if (matches(c.title)) out.push({ kind: "content", id: c.id, label: c.title || "Untitled", sub: "Content" }); });
  getCampaigns().forEach(c => { if (matches(c.name)) out.push({ kind: "campaign", id: c.id, label: c.name || "Untitled", sub: "Campaign" }); });
  return out.slice(0, 8);
}

/* ─── MAGNET LINKS (R3 A½) ────────────────────────────────────────────
   Copy-pasteable internal deep links that work in ANY url field:
     gk:sop:<sopId>              → open that SOP/Form
     gk:sop:<sopId>:<blockId>    → open it scrolled to that block (viewer
                                    blocks render id="blk-<id>")
     gk:task:<taskId>            → open Task Manager with that task's modal
     gk:playbook:<sectionId>     → open that Playbook page
   Plain strings, so no storage changes anywhere — link renderers just
   check isMagnet() and navigate internally instead of target="_blank". */
const isMagnet = (url) => typeof url === "string" && url.startsWith("gk:");
/** @returns {{kind:"sop"|"task"|"playbook", id:string, blockId?:string}|null} */
function parseMagnet(url) {
  const m = /^gk:(sop|task|playbook|product|client|content|campaign|callback|user):([\w-]+)(?::([\w-]+))?$/.exec(url || "");
  return m ? { kind: m[1], id: m[2], blockId: m[3] || "" } : null;
}
const magnetFor = (kind, id, blockId) => `gk:${kind}:${id}${blockId ? ":" + blockId : ""}`;
/** Turn raw gk: magnet URLs in free text into resolved @mention tokens, so a
 * pasted link renders as a human-readable pill (e.g. "gk:task:h58z7" → the
 * task's title) instead of a cryptic id. Used when rendering chat messages. */
function linkifyMagnets(text) {
  return (text || "").replace(/gk:(sop|task|playbook|product|client|content|campaign|callback|user):([\w-]+)(?::[\w-]+)?/g, (_whole, kind, id) => {
    let label = "";
    if (kind === "task") label = getTasks().find(t => t.id === id)?.title || "Task";
    else if (kind === "sop") label = getSOP(id)?.title || "SOP";
    else if (kind === "playbook") label = ((db.getSync("playbook") || {}).sections || []).find(s => s.id === id)?.title || "Playbook";
    else if (kind === "product") label = getProducts().find(p => p.id === id)?.name || "Product";
    else if (kind === "client") label = getClients().find(c => c.id === id)?.name || "Client";
    else if (kind === "content") label = getContentItems().find(c => c.id === id)?.title || "Content";
    else if (kind === "campaign") label = getCampaigns().find(c => c.id === id)?.name || "Campaign";
    else if (kind === "callback") { const cb = getCallbacks().find(c => c.id === id); label = cb ? (getProducts().find(p => p.id === cb.productId)?.name || "Callback") : "Callback"; }
    else if (kind === "user") label = getUsers().find(u => u.id === id)?.name || "Staff";
    return `@[${(label || "link").replace(/[[\]]/g, "")}](${kind}:${id})`;
  });
}
/** Copies a magnet link to the clipboard and toasts. */
function copyMagnet(kind, id, blockId) {
  const link = magnetFor(kind, id, blockId);
  try { navigator.clipboard.writeText(link); } catch {
    // http/older browsers: fall back to a hidden textarea copy
    const ta = document.createElement("textarea");
    ta.value = link; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
  triggerToast("Magnet link copied");
  return link;
}
/* App-wide navigation surface (Aug 2026). App registers one navigate(kind,id,
   blockId) function here, so a magnet/mention pill is clickable ANYWHERE it's
   rendered without threading nav callbacks through every component. */
let _magnetNav = null;
const setMagnetNav = (fn) => { _magnetNav = fn; };
/** Navigate to an internal item by (kind, id) via the registered surface. */
function navigateItem(kind, id, blockId) {
  if (_magnetNav) { _magnetNav(kind, id, blockId); return true; }
  return false;
}
/* App-wide "create a task from this item" surface (#47). App registers one
   creator (setSection("tasks") + prefill the new-task modal); any item view
   calls createTaskFromItem(prefill) without threading a callback prop. */
let _taskCreator = null;
const setTaskCreator = (fn) => { _taskCreator = fn; };
/** Trigger the new-task modal prefilled from another item. */
function createTaskFromItem(prefill) {
  if (_taskCreator) { _taskCreator(prefill); return true; }
  return false;
}
/* App-wide "start a callback for this product" surface (#47). App registers a
   starter that navigates to Waitlist and opens the New Callback form
   pre-targeting the product; a product row calls startCallbackForProduct(id). */
let _callbackStarter = null;
const setCallbackStarter = (fn) => { _callbackStarter = fn; };
function startCallbackForProduct(productId) {
  if (_callbackStarter) { _callbackStarter(productId); return true; }
  return false;
}

/** Build a {title, description} prefill from any linkable item, seeding the
 * description with a mention pill back to the source so the new task stays
 * linked (renders as a clickable pill; #47 "create task from this"). */
function taskPrefillFromItem(kind, id, label, extra) {
  const clean = (label || "").replace(/[[\]]/g, "");
  const token = `@[${clean || "item"}](${kind}:${id})`;
  return { title: label ? `${label}` : "", description: `From ${token}${extra ? "\n" + extra : ""}` };
}

/** One resolver for clicking any magnet link. Falls back to the app-wide nav
 * surface when an explicit `nav` object isn't passed. */
function openMagnet(url, nav) {
  const m = parseMagnet(url);
  if (!m) return false;
  if (nav) {
    if (m.kind === "sop" && nav.goToSop) { nav.goToSop(m.id, m.blockId); return true; }
    if (m.kind === "task" && nav.goToTask) { nav.goToTask(m.id); return true; }
    if (m.kind === "playbook" && nav.goToPlaybookSection) { nav.goToPlaybookSection(m.id); return true; }
  }
  return navigateItem(m.kind, m.id, m.blockId);
}

/** Search over every internal linkable target for the link popover:
 * SOPs/Forms by title + code, their NUMBERED blocks as sub-entries
 * ("SOP-OPS-001 › 3. Register Setup"), Playbook sections, and Tasks by
 * title or tag name. Returns {label, sub, url} rows (url = magnet link). */
function getLinkSearchCandidates(query) {
  const q = (query || "").toLowerCase().trim();
  const matches = (...fields) => !q || fields.some(f => (f || "").toLowerCase().includes(q));
  const out = [];
  getSOPs().forEach(s => {
    const docLabel = s.title || "Untitled";
    const docKindLabel = s.kind === "form" ? "Form" : "SOP";
    if (matches(s.title, s.code)) out.push({ label: docLabel, sub: `${docKindLabel}${s.code ? " · " + s.code : ""}`, url: magnetFor("sop", s.id) });
    (s.blocks || []).map(asListBlock).forEach(b => {
      if (b.num == null) return;
      const blockLabel = b.type === "heading" ? b.text : (b.type === "list" ? (b.items?.[0]?.text || "List") : (b.text || "").slice(0, 40));
      if (matches(blockLabel, String(b.num), s.title, s.code)) {
        out.push({ label: `${docLabel} › ${b.num}. ${blockLabel || "Block"}`, sub: docKindLabel + " block", url: magnetFor("sop", s.id, b.id) });
      }
    });
  });
  const playbook = db.getSync("playbook") || { sections: [] };
  (playbook.sections || []).forEach(s => {
    if (matches(s.title)) out.push({ label: s.title || "Untitled", sub: "Playbook", url: magnetFor("playbook", s.id) });
  });
  const tags = getTags();
  getTasks().forEach(t => {
    if (t.archived) return;
    const tagNames = (t.tagIds || []).map(id => tags.find(x => x.id === id)?.name || "");
    if (matches(t.title, ...tagNames)) out.push({ label: t.title || "Untitled task", sub: "Task" + (tagNames.filter(Boolean).length ? " · " + tagNames.filter(Boolean).join(", ") : ""), url: magnetFor("task", t.id) });
  });
  // Waitlist + content targets are linkable too (#47).
  getProducts().forEach(p => { if (matches(p.name, p.collection)) out.push({ label: p.name || "Untitled product", sub: "Product" + (p.collection ? " · " + p.collection : ""), url: magnetFor("product", p.id) }); });
  getClients().forEach(c => { if (matches(c.name)) out.push({ label: c.name || "Unnamed client", sub: "Client", url: magnetFor("client", c.id) }); });
  getContentItems().forEach(c => { if (matches(c.title)) out.push({ label: c.title || "Untitled content", sub: "Content", url: magnetFor("content", c.id) }); });
  getCampaigns().forEach(c => { if (matches(c.name)) out.push({ label: c.name || "Untitled campaign", sub: "Campaign", url: magnetFor("campaign", c.id) }); });
  getCallbacks().forEach(cb => { const pn = getProducts().find(p => p.id === cb.productId)?.name || "Callback"; if (matches(pn)) out.push({ label: pn, sub: "Callback", url: magnetFor("callback", cb.id) }); });
  return out.slice(0, 12);
}

/* ─── SYSTEM-WIDE SEARCH (#55) ────────────────────────────────────────
   One query fanned across every entity, returned as groups the command
   palette renders. Each item carries {kind,id,label,sub[,blockId]} and is
   navigated via the app-wide navigateItem() surface (extended in App to
   cover project + imagerepo). Matching reuses the same substring rule as
   the mention/link pickers; per-group caps keep the palette scannable. */
function globalSearch(query, perGroup = 6) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return [];
  const m = (...fields) => fields.some(f => (f || "").toLowerCase().includes(q));
  const groups = [];
  const add = (label, icon, kind, items) => { if (items.length) groups.push({ label, icon, kind, items: items.slice(0, perGroup) }); };

  const sops = getSOPs();
  add("SOPs", "menu_book", "sop", sops.filter(s => s.kind !== "form" && m(s.title, s.code)).map(s => ({ kind: "sop", id: s.id, label: s.title || "Untitled", sub: s.code || "SOP" })));
  add("Forms", "assignment", "form", sops.filter(s => s.kind === "form" && m(s.title, s.code)).map(s => ({ kind: "form", id: s.id, label: s.title || "Untitled", sub: s.code || "Form" })));
  add("Tasks", "check_circle", "task", getTasks().filter(t => !t.archived && m(t.title)).map(t => ({ kind: "task", id: t.id, label: t.title || "Untitled task", sub: "Task" })));
  add("Projects", "folder", "project", getProjects().filter(p => m(p.name, p.description)).map(p => ({ kind: "project", id: p.id, label: p.name || "Untitled project", sub: "Project" })));
  add("Content", "photo_camera", "content", getContentItems().filter(c => m(c.title, c.body)).map(c => ({ kind: "content", id: c.id, label: c.title || "Untitled", sub: "Content" })));
  add("Campaigns", "campaign", "campaign", getCampaigns().filter(c => m(c.name, c.description)).map(c => ({ kind: "campaign", id: c.id, label: c.name || "Untitled campaign", sub: "Campaign" })));
  add("Clients", "person", "client", getClients().filter(c => m(c.name, c.email, c.phone)).map(c => ({ kind: "client", id: c.id, label: c.name || "Unnamed", sub: "Client" })));
  add("Products", "inventory_2", "product", getProducts().filter(p => m(p.name, p.collection)).map(p => ({ kind: "product", id: p.id, label: p.name || "Untitled product", sub: p.collection || "Product" })));
  add("Callbacks", "notifications_active", "callback", getCallbacks().map(cb => ({ cb, pn: getProducts().find(p => p.id === cb.productId)?.name || "Callback" })).filter(x => m(x.pn, x.cb.note)).map(x => ({ kind: "callback", id: x.cb.id, label: x.pn, sub: x.cb.status === "done" ? "Callback · closed" : "Callback" })));
  const playbook = db.getSync("playbook") || { sections: [] };
  add("Playbook", "auto_stories", "playbook", (playbook.sections || []).filter(s => m(s.title)).map(s => ({ kind: "playbook", id: s.id, label: s.title || "Untitled", sub: "Playbook" })));
  const repo = getImageRepo();
  add("Image Repository", "photo_library", "imagerepo", ((repo && repo.blocks) || []).filter(b => b.type !== "text" && m(b.text)).map(b => ({ kind: "imagerepo", id: b.id, label: b.text || "Brand", sub: "Image library" })));
  add("Staff", "badge", "user", getUsers().filter(u => m(u.name)).map(u => ({ kind: "user", id: u.id, label: u.name, sub: "Open a DM" })));
  return groups;
}

/* ─── RICH TEXT (R3 B3) ───────────────────────────────────────────────
   WYSIWYG text blocks store sanitized HTML in block.html alongside the
   synced plain block.text (innerText), so search/excerpts/taskFromSop
   keep reading plain text untouched. Sanitizer is allowlist-lite: strips
   script/style/iframe elements, on* attributes, and javascript: hrefs —
   enough for an internal, login-gated tool where editors are staff. */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
  const root = doc.body.firstChild;
  root.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(el => el.remove());
  root.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return root.innerHTML;
}
const escapeHtml = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Replaces @[Label](kind:id) tokens inside an HTML string with clickable
 * pill spans (`data-mention="kind:id"`) — the HTML twin of MentionText,
 * used by the WYSIWYG viewer render. Tokens never contain < or >, so a
 * plain regex replace over the markup is safe. */
function mentionTokensToHtml(html) {
  return (html || "").replace(new RegExp(MENTION_RE.source, "g"), (_, label, kind, id) =>
    `<span data-mention="${kind}:${id}" style="display:inline-flex;padding:1px 9px;border-radius:999px;background:${C.mossSoft};color:${C.moss};font-weight:600;cursor:pointer;font-size:0.94em">${escapeHtml(label)}</span>`);
}

/** Every document/playbook-section that mentions the given target,
 * grouped by source — rendered as a "Referenced by" list. */
function findBacklinks(targetKind, targetId) {
  const out = [];
  const scan = (blocks, sourceKind, sourceId, sourceLabel) => {
    const hit = documentTextFields(blocks).some(t => {
      MENTION_RE.lastIndex = 0;
      let m;
      while ((m = MENTION_RE.exec(t))) { if (m[2] === targetKind && m[3] === targetId) return true; }
      return false;
    });
    if (hit) out.push({ kind: sourceKind, id: sourceId, label: sourceLabel });
  };
  getSOPs().forEach(s => scan(s.blocks, s.kind === "form" ? "form" : "sop", s.id, s.title || "Untitled"));
  const playbook = db.getSync("playbook") || { sections: [] };
  (playbook.sections || []).forEach(s => scan(s.blocks, "playbook", s.id, s.title || "Untitled"));
  return out;
}

/* ─── OPERATIONS PLAYBOOK (Phase 5) ───────────────────────────────────
   A single document, not a collection — one kv key holding {sections:[
   {id,title,blocks}]}, written through the generic kv_set path (same as
   `categories`' bulk writes), editor/admin gated server-side by default.
   Key Contacts is deliberately NOT one of these sections — it renders
   live `contacts` records instead (see OperationsPlaybook.jsx). */
const getPlaybook = () => db.getSync("playbook") || null;
const savePlaybook = (p) => db.setSync("playbook", p);

/* Playbook change history (R3 E): whole-doc snapshots with author + date,
   written at edit boundaries (leaving edit mode, section add/delete, and
   before any restore so restores are themselves undoable). Capped at 20.
   Rides the generic kv path like the playbook doc itself. */
const getPlaybookRevs = () => db.getListSync("playbookRevs");
function addPlaybookRev(label = "") {
  const playbook = getPlaybook();
  if (!playbook) return;
  const revs = getPlaybookRevs();
  const snapshot = JSON.parse(JSON.stringify(playbook));
  // Skip if identical to the newest snapshot — edit-mode exits without
  // changes shouldn't burn a history slot.
  if (revs[0] && JSON.stringify(revs[0].snapshot) === JSON.stringify(snapshot)) return;
  const entry = { id: uid(), savedAt: nowISO(), savedBy: getCurrentUser()?.name || "", label, snapshot };
  db.setSync("playbookRevs", [entry, ...revs].slice(0, 20));
}

/* ─── IMAGE REPOSITORY ────────────────────────────────────────────────
   Alphabetical directory of vendor image repositories (recreates
   team.thegreenkiss.com). One kv doc {blocks:[…]}, generic kv path, no
   backend changes — same shape as the playbook. Each block is either a
   brand "title" (text + external link) or a free "text" note; every block
   carries a `letter` used to group A–Z (or 0–9 for brands whose name starts
   with a digit). `letterOf` defaults an unset letter to the title's first
   character (anything not A–Z or 0–9 falls in the "#" group). */
const getImageRepo = () => db.getSync("imagerepo") || null;
const saveImageRepo = (doc) => db.setSync("imagerepo", doc);
const letterOf = (b) => {
  if (b && b.letter) return b.letter;
  // Prefer the brand grouping (#58) for the default letter, so a vendor's
  // galleries file under the brand's first letter rather than each gallery's.
  const src = ((b && b.brand) || (b && b.text) || "").trim();
  const c = src.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(c) ? c : "#";
};

/* Seed = the real vendor list migrated from the live site. Sub-collections
   (a vendor with more than one gallery) become their own "Vendor — Name"
   title rows under the same letter, honoring the page's "only title-with-
   link + text" block model. Editable/deletable after seeding. */
function seedImageRepoIfEmpty() {
  if (getImageRepo()) return false;
  const rows = [
    ["A", "All Good", "https://www.dropbox.com/scl/fo/dt1s0fy7b1b53q9g5fsb6/AOX9ooia67yjZ8hM_jTn33o"],
    ["B", "Bathorium", "https://drive.google.com/drive/folders/1-zt_tmi587p17-yJK7VXhbK3tw8nrvtn"],
    ["B", "Bathorium — Whole Gallery", "https://drive.google.com/drive/u/0/folders/1Brl6-Oao1i9x6y83_hUc-WzIjLn21uVj"],
    ["B", "Bathorium — Product Imagery", "https://drive.google.com/drive/u/0/folders/1q9Ql3tvMZ1xw9gSlBQq7zACWthwI8sea"],
    ["B", "Blue Lizard Sunscreen", "https://www.dropbox.com/scl/fo/e5lgk3hlfhevzca56wuqt/AJj2jkRS-G8asZG5WTWc1N0"],
    ["C", "Cardideology", "https://www.dropbox.com/scl/fo/f6ckfx7u14zp9h124vm0q/AHFqtwXPc5Kg0XeYhErVeyE"],
    ["C", "Chelsea King", "https://www.dropbox.com/scl/fo/u3ny7o4664dwt96b4328m/AC025zF98bnueEocWRtLiGE"],
    ["C", "Clear Choice", "https://www.dropbox.com/scl/fo/53rlcbpf43qn9izv3ryfy/ADEx2yyl2Yt8Lb4Qr8zEUNg"],
    ["C", "Come Clean", "https://www.dropbox.com/scl/fo/vc538ddmq35s0cl4le41q/AMab6Dr1cUDF5ghaVBN8LeQ"],
    ["C", "CV Skinlabs", "https://www.dropbox.com/scl/fo/fmhjv62b3k7ix1fb9ja4n/AJVlkZIJO_zBGCxgEXldn7U"],
    ["D", "DermaE", "https://www.dropbox.com/scl/fo/x5b1i99xb51dhpd9hpc7t/AI5pZsBvtAROamvzNoXNWfI"],
    ["F", "Fitglow", "https://www.dropbox.com/scl/fo/seyh36ryknhtpxd5pbcx9/ACXqmxNAKNyP9lBjegKlp98"],
    ["G", "Glow Jar", "https://drive.google.com/drive/folders/1qbK3AZFLxsNu5hHfo2iwu0HS45dYV1Tw"],
    ["G", "Glow Jar — Second Image Collection", "https://photos.google.com/share/AF1QipNwvJr3JhmTZfumwwiHnW5vpfe9S0UmAE1nS_0tg3Mq", { note: "May require login — ask vendor." }],
    ["G", "GJB Lifestyle Images", "https://photos.app.goo.gl/bKvajrwEzSJ3Erjr9"],
    ["G", "GJB E-comm Images", "https://photos.app.goo.gl/ouknFmXsiukANWBN6"],
    ["H", "Helena Lane", "https://www.dropbox.com/scl/fo/xlmgpqwigg325yelyx0k0/AK6u7_DyL3xPuN1YpHuTBz0"],
    ["H", "High-End Hippie", "https://photos.google.com/share/AF1QipMwdEqGPBuWCfsC0LlRUhv1YpsYo5BTsFt72-FGFCEV"],
    ["H", "High-End Hippie — Second Image Collection", "https://photos.google.com/share/AF1QipOMGIgum4hNPU6Ka7OmXyjYpf0JYxoH1odlX1_MfFQN"],
    ["H", "Honey Candles", "https://www.dropbox.com/scl/fo/19jptapd5vic2ft6bz958/AGyZChC69bby9st76i8s7wQ"],
    ["H", "Honey Candles — Seasonal Lifestyle", "https://www.dropbox.com/scl/fo/iitul2r5m6hconp5zfm5p/AFjztkA_6ZJerZx-14_Kh68"],
    ["H", "Huna", "https://www.dropbox.com/scl/fo/ep42foord7vf9j2zqogkw/AAlhogYTfVsStNm-Zjeqk6U"],
    ["H", "Hygge", "https://drive.google.com/drive/folders/1lwqQQganb79NYr_epppXkaL4BFXDxXql"],
    ["I", "Indie Lee", "https://www.dropbox.com/scl/fo/56u8vma2nwe5g5nahr2lt/AK5qmjgrhrI6JPC0YrDPqeI"],
    ["I", "Innersense", "https://www.dropbox.com/scl/fo/pczv71lsn3wc3cnm07nxb/ANiNSYqHmym3soxke34sKEk"],
    ["J", "Joni", "https://drive.google.com/drive/folders/1tAgII3srN0kEbemmspezQy9M1-wpBEOl", { note: "May need to request Google Account access for first-time users." }],
    ["J", "Josh Rosebrook", "https://joshrosebrookwholesale.com/pages/assets-education", { user: "vendors@thegreenkiss.com", pass: "Swagk23!" }],
    ["J", "JustSun", "https://www.dropbox.com/scl/fo/wrni064tye7yr121se3v9/ADgmLeiGSR2mMTg3fTdWgww"],
    ["K", "Kaia", "https://www.dropbox.com/scl/fo/ca63x9ot2svutznxcdaur/AAojR_ArwagD8bGR1VPkk4g"],
    ["K", "Karite", "https://drive.google.com/drive/folders/18riUlYNgKNETqV49NL03p2r-V7QOWI87"],
    ["L", "LaSpa", "https://drive.google.com/drive/folders/1btjsnV-9Sxf6WCM6dsMv4vyWO2oQ_Naw"],
    ["L", "Lavoh", "https://drive.google.com/drive/folders/1z6PnwtP_IVzW8cNHrA6j06SIF071oOaY"],
    ["M", "Mad Hippie", "https://www.dropbox.com/scl/fo/py3culbfbcuupnn20kfjz/AJHUJMIVnpDEUx6IXD2KuFE"],
    ["M", "MIFA", "https://www.dropbox.com/scl/fo/7t0owpfamlx6blzcz9v07/AJmu0rxRe-x3o2-p8aLI35o"],
    ["M", "Mulberry Skincare", "https://www.dropbox.com/scl/fo/gkkwhzc46e5lundbozvkd/AKXKJ5d47rU3TlnQfSntjVI"],
    ["M", "Mushroom Envy", "https://www.dropbox.com/scl/fo/sf5pigiw5qhlb9fzy0u8f/ADGMT5HeMkj8NgITVkzntio"],
    ["M", "My Daughter Fragrances", "https://www.dropbox.com/scl/fo/kpg9z9ouj515qn6pytuyk/AIq2iL4xPUj6tLk_Xpeza8I"],
    ["N", "Nala", "https://drive.google.com/drive/u/0/folders/12ZqZ7wXnraxrtZ42EHi1Xq1zRNjz7l9w"],
    ["O", "Orgaid", "https://www.dropbox.com/scl/fo/vmnd2t6c4ftnyhocx6xku/AEM2aClsgMrtRVzlw9yLDb4"],
    ["P", "100% Pure", "https://toolbox.puritycosmetics.com/partners/login.php", { user: "megan@thegreenkiss.com", pass: "Baby123!" }],
    ["P", "Plume", "https://www.dropbox.com/scl/fo/zqvldwi6eddoiha25it2y/AO8Q0ESJ2dsGl6DBOwYODSs"],
    ["S", "Sappho New Paradigm", "https://www.dropbox.com/scl/fo/iqqx5njpv3np7s2uwari3/APbxPXfWCmH0dc-eHVMPoDQ"],
    ["S", "Skwalwen Botanicals", "https://photos.google.com/share/AF1QipMB0yCR4kic223D_c10HwipZniAxDGBujhrEjVHXpr-"],
    ["S", "Smudge Sisters", "https://www.dropbox.com/scl/fo/oym2qe10luklya688a401/AEuO_hvmTXdSf8TME8l7Moo"],
    ["S", "Sunna Tan", "https://sunnapro.com/en-ca/pages/free-marketing"],
    ["S", "Suntegrity", "https://www.dropbox.com/sh/ri44wbanq73bivo/AAChbO9IFZ_FfFw7rTtzqXnga"],
    ["T", "The Bathologist", "https://drive.google.com/drive/folders/16v7XfAvI0Kf48udSCDPwGpzEx_xSXBlJ"],
    ["T", "Tok Beauty", "https://www.dropbox.com/scl/fo/584buuvvc68vmwblczksl/ACgVvA959kfQLeXrhnaP4ME"],
    ["U", "Urban Spa", "https://www.dropbox.com/scl/fo/o98k5672xn3diz4tohrhr/ABd-uQkFSBtMrT8KjBD1m7U"],
    ["V", "Viva", "https://drive.google.com/drive/folders/164GeLX_SnjlrKdSSF8myAJBHklJJgMn1"],
    ["W", "Wyld Skincare", "https://drive.google.com/drive/folders/1UhiGIeghtxUucdxB3EUKW84ZlNCqg_DS"],
  ];
  // Optional 4th tuple element carries extra fields migrated from the live
  // site — per-brand login credentials (user/pass) and/or a note.
  saveImageRepo({ blocks: rows.map(([letter, text, url, extra]) => ({ id: uid(), type: "title", text, url, letter, ...(extra || {}) })) });
  return true;
}

/* ─── TOOLS & PROMPTS REPOSITORY ──────────────────────────────────────
   Flat list of team tools and reusable prompts. One generic kv doc
   {items:[{id,type:"tool"|"prompt",title,body,url,tags,createdAt}]} —
   same zero-backend pattern as the image repo / playbook. */
const getToolsPrompts = () => db.getSync("toolsPrompts") || { items: [] };

/* ─── OMNISEND (email metrics) ────────────────────────────────────────
   The API key lives server-side; these just proxy through api.php so it
   never reaches the client. Both throw on failure (callers await + toast). */
async function fetchOmnisendCampaigns() {
  if (!REMOTE_MODE) return []; // ponytail: dev has no server proxy; UI falls back to manual fields
  const res = await apiCall("omnisend_campaigns_list", { method: "GET" });
  return res.campaigns || [];
}
async function fetchOmnisendCampaignStats(id) {
  const res = await apiCall("omnisend_campaign_stats", { method: "GET", query: { id } });
  return res.stats || null; // {opens,clicks,revenue}
}

/* ─── GOOGLE CALENDAR ICS SUBSCRIBE FEED ──────────────────────────────
   Each staffer gets one stable token; they add the feed URL once in
   Google Calendar (From URL) and it auto-refreshes. */
async function getIcsSubscribeUrl() {
  if (!REMOTE_MODE) return ""; // dev has no persistent server feed
  const res = await apiCall("ics_token_get", { method: "GET" });
  if (!res.token) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/${API_BASE}?action=calendar_feed&token=${encodeURIComponent(res.token)}`;
}

/* ─── STORE UPDATE — Shopify sales vs seasonal targets (#21) ───────────
   Live sales (today + month-to-date) come from the server-side Shopify
   proxy (token never reaches the client). Targets are a per-month-of-year
   table (seasonal) stored in kv, admin-editable. */
async function fetchShopifySales() {
  if (!REMOTE_MODE) return null; // ponytail: no server proxy in dev; UI shows "connect Shopify"
  const res = await apiCall("shopify_sales", { method: "GET" });
  return res.sales || null; // {today, monthToDate, currency, timezone, asOf}
}
/** Seasonal targets keyed by month number 1–12. @returns {{[m:string]:number}} */
const getSalesTargets = () => db.getSync("salesTargets") || {};
const saveSalesTargets = (t) => db.setSync("salesTargets", t);
/** This month's target, and a daily target = monthly ÷ days in month. */
function currentSalesTargets() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const monthly = Number(getSalesTargets()[m]) || 0;
  const daysInMonth = new Date(now.getFullYear(), m, 0).getDate();
  const daily = monthly ? monthly / daysInMonth : 0;
  return { monthly, daily, weekly: daily * 7, month: m, daysInMonth };
}
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const _mk = (title, blocks) => ({ id: uid(), title, blocks });
const _txt = (t) => ({ id: uid(), type: "text", text: t });
const _head = (t, d = "") => ({ id: uid(), type: "heading", text: t, description: d });
const _list = (items, style = "bulleted") => ({ id: uid(), type: "list", style, withEntry: false, items: items.map(t => ({ id: uid(), text: t, value: "" })) });

/** Seeds the Playbook from the Green Kiss Operations Playbook doc the first
 * time anyone opens the section — never overwrites an existing one. "Refer
 * to SOP-XXX" lines are seeded as plain text (not live @mentions) since the
 * matching SOP records may not exist yet under those exact codes; editors
 * can turn them into real links once the SOPs are in the Library. */
function seedPlaybookIfEmpty() {
  if (getPlaybook()) return false;
  savePlaybook({
    sections: [
      _mk("Purpose", [
        _txt("The purpose of this Operations Playbook is to provide a centralized reference for operational responsibilities, processes, systems, and resources used by The Green Kiss.\n\nThis playbook serves as the primary operational reference document and directs team members to detailed Standard Operating Procedures (SOPs), checklists, and supporting resources."),
        _head("Objectives"),
        _list(["Maintain operational consistency", "Support onboarding and training", "Reduce reliance on verbal instructions", "Improve efficiency and accountability", "Preserve organizational knowledge", "Support future business growth"]),
      ]),
      _mk("Scope", [
        _txt("This playbook covers:"),
        _list(["Order Management", "Fulfillment & Shipping", "Receiving", "Inventory Management", "Purchasing & Replenishment", "Vendor Management", "Product Management", "Shopify Administration", "Reporting & Operational Controls"]),
        _txt("Detailed work instructions are maintained in separate SOP documents."),
      ]),
      _mk("Document Management", [
        _txt("This document should be reviewed whenever:"),
        _list(["Operational processes change", "New vendors are added", "New software or systems are implemented", "Significant workflow improvements are introduced"]),
      ]),
      _mk("Company Overview", [
        _head("Mission", "TO BE FILLED"),
        _head("Business Model"),
        _txt("The Green Kiss is a clean beauty retailer operating both physical and online sales channels."),
        _head("Location"),
        _txt("#109 – 3531 Uptown Boulevard, Victoria, BC V8Z 0B9"),
      ]),
      _mk("Roles & Responsibilities", [
        _head("Operations Lead", "Responsible for:"),
        _list(["Inventory Management", "Purchasing", "Vendor Coordination", "Operational Reporting", "Process Improvement", "SOP Development", "Inventory Accuracy"]),
        _head("Operations Assistant", "Responsible for:"),
        _list(["Order Fulfillment", "Shipment Receiving", "Inventory Organization", "Packaging", "Sample Preparation", "Inventory Counts", "Administrative Support"]),
      ]),
      _mk("Daily Operations", [
        _head("Daily Priorities"),
        _list(["Customer Orders", "Customer Service Issues Affecting Orders", "Receiving Shipments", "Inventory Maintenance", "Administrative Projects"], "numbered"),
        _head("Opening Procedures", "Refer to CL-001 Operations Opening Checklist"),
        _head("End-of-Day Procedures", "Refer to CL-002 End-of-Day Operations Checklist"),
      ]),
      _mk("Order Management", [
        _head("Order Fulfillment", "Refer to SOP-ORD-001 Order Fulfillment & Packing"),
        _head("Shipping Procedures", "Refer to SOP-ORD-002 Shipping Procedures"),
        _head("In-Store Pickup", "Refer to SOP-ORD-003 In-Store Pickup"),
        _head("Order Exception Handling", "Refer to SOP-ORD-004 Order Exception Handling"),
      ]),
      _mk("Receiving & Inventory", [
        _head("Shipment Receiving", "Refer to SOP-INV-001 Receiving Inventory"),
        _head("Discrepancy Report", "Refer to FRM-001 Shipment Discrepancy Report"),
        _head("Inventory Management", "Refer to SOP-INV-002 Inventory Management"),
        _head("Inventory Audits", "Refer to SOP-INV-003 Inventory Audits"),
        _head("Expiry Management", "Refer to SOP-INV-004 Expiry Management"),
      ]),
      _mk("Purchasing & Vendor Management", [
        _head("Ordering Procedures", "Refer to SOP-PUR-001 Purchase Ordering"),
        _head("Tester Ordering", "Refer to SOP-PUR-002 Tester Ordering"),
        _head("Vendor Management", "Refer to SOP-PUR-003 Vendor Management"),
      ]),
      _mk("Product Management", [
        _head("New Product Setup", "Refer to SOP-PM-001 New Product Setup"),
        _head("Product Maintenance and Updates", "Refer to SOP-PM-002 Product Maintenance & Updates"),
        _head("Product Delisting", "Refer to SOP-PM-003 Product Delisting"),
      ]),
      _mk("Shopify Administration", [
        _list(["Collections", "Tags", "Markets", "Shipping Profiles", "Discount Management", "Troubleshooting Library"]),
      ]),
      _mk("Reporting", [
        _list(["Weekly Operations Reporting", "Inventory Reporting", "Vendor Reporting", "Shipping Performance Reporting"]),
      ]),
      _mk("Continuous Improvement", [
        _list(["Process Improvement Log", "Known Issues Register", "Future Projects"]),
      ]),
      _mk("Appendices", [
        _list(["Appendix A – Vendor Directory", "Appendix B – Inventory Location Map", "Appendix C – Shipping Decision Tree", "Appendix D – Shopify Quick Reference Guide", "Appendix E – Forms & Templates", "Appendix F – Definitions"]),
      ]),
    ],
  });
  return true;
}

/* ─── VERSION HISTORY (Phase 6 #3) ───────────────────────────────────
   Remote mode: hits revisions_list/revision_get/revision_restore.
   Dev mode: reads the "rev:"+sopId list this file maintains on every
   content-changing updateSOP() call, capped at 10. */
async function getRevisions(sopId) {
  if (REMOTE_MODE) {
    const res = await apiCall("revisions_list", { method: "GET", query: { sop_id: sopId } });
    return (res.revisions || []).map(r => ({ id: r.id, savedAt: r.saved_at, savedBy: r.saved_by }));
  }
  return db.getSync("rev:" + sopId) || [];
}
async function getRevision(sopId, revisionId) {
  if (REMOTE_MODE) {
    const res = await apiCall("revision_get", { method: "GET", query: { id: revisionId } });
    return res.revision;
  }
  const list = db.getSync("rev:" + sopId) || [];
  return list.find(r => r.id === revisionId) || null;
}
/** Applies the revision and returns the resulting full SOP object, so the
 * caller (SOPEditor's History panel) can sync its in-editor state — that
 * matters because the editor's own autosave-on-unmount would otherwise
 * clobber the just-restored content with whatever was still in memory. */
async function restoreRevision(sopId, revisionId) {
  if (REMOTE_MODE) {
    const res = await apiCall("revision_restore", { method: "POST", body: { id: revisionId } });
    if (res.sop) {
      const sops = getSOPs().map(s => s.id === sopId ? res.sop : s);
      _cache.set("sops", sops);
      return res.sop;
    }
    return null;
  }
  const rev = await getRevision(sopId, revisionId);
  if (!rev) return null;
  updateSOP(sopId, rev.snapshot);
  return getSOP(sopId);
}

/* ─── READ ACKNOWLEDGMENTS (Phase 6 #2) ──────────────────────────────
   kv key "acks" = { [sopId]: { [userId]: { at, version } } }. Any role
   may write this key (enforced server-side too, see api.php kv_set). */
/** @returns {AckMap} */
const getAcks = () => db.getSync("acks") || {};
const saveAcks = (a) => db.setSync("acks", a);
function ackSop(sopId, userId, sopUpdatedAt) {
  const at = nowISO();
  const acks = getAcks();
  const forSop = { ...(acks[sopId] || {}) };
  forSop[userId] = { at, version: sopUpdatedAt };
  const next = { ...acks, [sopId]: forSop };
  if (REMOTE_MODE) {
    // acks is a nested map, not an array — the server merges just this one
    // {sopId: {userId: entry}} write into whatever the DB currently has,
    // rather than ever sending the whole acks blob.
    _cache.set("acks", next);
    apiCall("ack_save", { method: "POST", body: { sopId, userId, at, version: sopUpdatedAt } }).then(res => {
      if (res && res.acks) _cache.set("acks", res.acks);
      _setOffline(false);
    }).catch(() => _setOffline(true));
    return;
  }
  saveAcks(next);
}
function isAckStale(ack, sop) {
  if (!ack) return false;
  return new Date(sop.updatedAt).getTime() > new Date(ack.version).getTime();
}

/* ─── IMAGE UPLOAD HELPER ─────────────────────────────────────────
   Downscales to max 1400px on the long edge and re-encodes as JPEG
   (quality 0.82). Dev mode keeps the base64 data-URL (small local
   storage quota). Remote mode uploads the resulting blob via the
   `upload` action and returns the server's relative URL instead. */
function _downscaleToBlob(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode image")), "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function fileToCompressedDataURL(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
/** Uploads via api.php and returns the relative URL (e.g. "uploads/202607/abc.jpg"). */
async function uploadImageBlob(blob) {
  const fd = new FormData();
  fd.append("file", blob, "image.jpg");
  const res = await apiCall("upload", { method: "POST", body: fd });
  return res.url;
}
/** Single entry point components call: dev mode -> data URL, remote -> server URL. */
async function processAndStoreImage(file, maxDim = 1400, quality = 0.82) {
  if (!REMOTE_MODE) return fileToCompressedDataURL(file, maxDim, quality);
  const blob = await _downscaleToBlob(file, maxDim, quality);
  return uploadImageBlob(blob);
}

/* ─── TASK STORAGE ───────────────────────────────────────────────── */
/** @returns {Task[]} */
const getTasks = () => db.getListSync("tasks");
/** @param {Task[]} t */
const saveTasks = (t) => db.setSync("tasks", t);
const addTask = (task) => {
  const full = { id: uid(), createdAt: nowISO(), subTasks: [], ...task };
  const next = [...getTasks(), full];
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionSave("task_save", "task", full); return next; }
  saveTasks(next);
  return next;
};
const updateTask = (id, changes) => {
  const next = getTasks().map(t => t.id === id ? { ...t, ...changes } : t);
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionSave("task_save", "task", next.find(t => t.id === id)); return; }
  saveTasks(next);
};
const deleteTask = (id) => {
  const next = getTasks().filter(t => t.id !== id);
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionDelete("task_delete", id); return; }
  saveTasks(next);
};

const TASK_STATUSES = [
  { key: "todo", label: "To Do", col: C.faint },
  { key: "in-progress", label: "In Progress", col: C.txt2 },
  { key: "reassigned", label: "Reassigned", col: "#a8bdb2" },
  { key: "review", label: "Review Before Closing", col: C.clay },
  { key: "done", label: "Done", col: C.moss },
];
/** Columns shown on the main Task Manager / project-detail board — Done
 * lives behind the slide-over panel instead (see TaskDoneSlideOver). */
const TASK_BOARD_STATUSES = TASK_STATUSES.filter(s => s.key !== "done");

/* ─── TASK TYPES (#7) ─────────────────────────────────────────────
   New types slot in as one more line here — no other code needs to change. */
const TASK_TYPES = [
  { key: "task", label: "Task", icon: "check_circle" },
  { key: "note", label: "Note", icon: "sticky_note_2" },
  { key: "milestone", label: "Milestone", icon: "flag" },
];
const taskTypeMeta = Object.fromEntries(TASK_TYPES.map(t => [t.key, t]));
/** Tasks saved before #7 have no `type` — normalize to "task" on read. */
const taskType = (task) => taskTypeMeta[task && task.type] || taskTypeMeta.task;

const TASK_PRIORITIES = [
  { key: "low", label: "Low", col: C.faint },
  { key: "medium", label: "Medium", col: C.txt2 },
  { key: "high", label: "High", col: C.clay },
  { key: "urgent", label: "Urgent", col: C.red },
];
const taskPriorityMeta = Object.fromEntries(TASK_PRIORITIES.map(p => [p.key, p]));

/* ─── RECURRENCE (#8 due-date popover) ───────────────────────────────
   v1 semantics: a task stores `recurrence` ("none"|"daily"|"weekly"|
   "monthly"). When a recurring task is marked done, a fresh copy is
   created automatically — new id, status todo, dueDate advanced from
   the CURRENT due date by the interval — while the completed one keeps
   its done state untouched. */
const RECURRENCE_OPTIONS = [
  { key: "none", label: "Does not repeat" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
/** @param {string} dateStr ISO date (yyyy-mm-dd) @param {Recurrence} recurrence */
function advanceDate(dateStr, recurrence) {
  const base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (recurrence === "daily") base.setDate(base.getDate() + 1);
  else if (recurrence === "weekly") base.setDate(base.getDate() + 7);
  else if (recurrence === "monthly") base.setMonth(base.getMonth() + 1);
  return base.toISOString().slice(0, 10);
}
/** Marks a task done/undone. If it's newly-done and recurring, spawns the
 * next occurrence as a fresh standalone task (new id, status todo, same
 * everything else, dueDate advanced). Returns nothing — caller re-reads. */
function completeTaskWithRecurrence(task) {
  const nowDone = task.status !== "done";
  updateTask(task.id, { status: nowDone ? "done" : "todo" });
  if (nowDone && task.recurrence && task.recurrence !== "none") {
    const nextDue = advanceDate(task.dueDate, task.recurrence);
    const { id, ...rest } = task;
    addTask({
      ...rest, status: "todo", dueDate: nextDue, createdAt: nowISO(),
      favouritedBy: [], archived: false,
      subTasks: (task.subTasks || []).map(s => ({ ...s, id: uid(), done: false })),
    });
  }
}

/* ─── TASK ACTIONS (#9 overflow menu) ─────────────────────────────── */
/** Favourited tasks sort to the top of their column for that user. */
function toggleFavourite(task, userId) {
  const has = (task.favouritedBy || []).includes(userId);
  const next = has ? (task.favouritedBy || []).filter(u => u !== userId) : [...(task.favouritedBy || []), userId];
  updateTask(task.id, { favouritedBy: next });
}
/** New id, "(copy)" suffix, status todo, subtasks copied with new ids + done cleared. */
function duplicateTask(task) {
  const { id, ...rest } = task;
  return addTask({
    ...rest, title: (task.title || "Untitled task") + " (copy)", status: "todo",
    createdAt: nowISO(), favouritedBy: [], archived: false,
    subTasks: (task.subTasks || []).map(s => ({ ...s, id: uid(), done: false })),
  });
}
/** Source's description appends to target's, subtasks move to target, tags
 * union, source is deleted. */
function mergeTaskInto(source, target) {
  const mergedDesc = [target.description, source.description].filter(Boolean).join("\n\n---\n\n");
  const movedSubs = (source.subTasks || []).map(s => ({ ...s, id: uid() }));
  const mergedTags = [...new Set([...(target.tagIds || []), ...(source.tagIds || [])])];
  updateTask(target.id, {
    description: mergedDesc,
    subTasks: [...(target.subTasks || []), ...movedSubs],
    tagIds: mergedTags,
  });
  deleteTask(source.id);
}
/** Creates a project named after the task; the task's subtasks become real
 * tasks with the project id (assignee/due preserved); original task deleted. */
function convertTaskToProject(task) {
  const proj = addProject({ ...defProject(), name: task.title || "Untitled project", description: task.description || "" });
  const projectRecord = Array.isArray(proj) ? proj[proj.length - 1] : proj;
  (task.subTasks || []).forEach(s => {
    addTask({
      ...emptyTaskShape(), title: s.text, status: s.done ? "done" : "todo", priority: s.priority || "medium",
      assignedTo: s.assigneeId || "", dueDate: s.dueDate || "", projectId: projectRecord.id,
    });
  });
  deleteTask(task.id);
  return projectRecord;
}
/** This task becomes a subtask on the target task; original deleted. Its
 * own subtasks/description/tags are flattened/lost (warned in the confirm). */
function convertTaskToSubtask(task, targetTask) {
  const newSub = { id: uid(), text: task.title, done: task.status === "done", assigneeId: task.assignedTo || "", dueDate: task.dueDate || "", priority: task.priority || "medium" };
  updateTask(targetTask.id, { subTasks: [...(targetTask.subTasks || []), newSub] });
  deleteTask(task.id);
}
const emptyTaskShape = () => ({
  title: "", description: "", status: "todo", priority: "medium", type: "task",
  assignedTo: "", startDate: "", dueDate: "", relatedSopId: "", projectId: "", subTasks: [], tagIds: [], recurrence: "none", links: [],
  onCalendar: false, // #53: surface this task on the visual calendar / ICS feed
});
/** #53: a task shows on the calendar if it opts in itself, OR its project does.
 * `proj` is the task's Project record (or null). */
function taskOnCalendar(task, proj) {
  return !!(task && (task.onCalendar || (proj && proj.includeTasksOnCalendar)));
}

/** Favourited-by-this-user tasks sort first, then priority (urgent→low),
 * then newest first — shared by every board that lists tasks (Task Manager
 * + Projects' embedded board both need identical column ordering). */
const TASK_PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
function sortTasksForUser(tasks, userId) {
  return [...tasks].sort((a, b) => {
    const favA = (a.favouritedBy || []).includes(userId) ? 0 : 1;
    const favB = (b.favouritedBy || []).includes(userId) ? 0 : 1;
    if (favA !== favB) return favA - favB;
    const pa = TASK_PRIORITY_ORDER[a.priority] ?? 3, pb = TASK_PRIORITY_ORDER[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

/** Centralizes every #9 overflow-menu action so Task Manager and Projects'
 * embedded task board dispatch identically. Fire-and-forget, matching every
 * other storage helper's shape — caller re-reads + bumps/toasts after. */
function dispatchTaskAction(task, action, extra, user) {
  switch (action) {
    case "favourite": toggleFavourite(task, user?.id || ""); break;
    case "alert": addAlert(task.id, extra.userId); break;
    case "duplicate": duplicateTask(task); break;
    case "merge": mergeTaskInto(task, extra.target); break;
    case "addToProject": updateTask(task.id, { projectId: extra.projectId }); break;
    case "saveTemplate": addTaskTemplate(extra.name, task); break;
    case "applyTemplate": addTask(taskFromTemplate(extra.template)); break;
    case "archive": updateTask(task.id, { archived: !task.archived }); break;
    case "unarchive": updateTask(task.id, { archived: false }); break;
    case "delete": deleteTask(task.id); break;
    case "convertProject": convertTaskToProject(task); break;
    case "convertSubtask": convertTaskToSubtask(task, extra.target); break;
    case "rename": updateTask(task.id, { title: extra.title }); break;
    case "addSubtask": updateTask(task.id, { subTasks: [...(task.subTasks || []), { id: uid(), text: extra.text, done: false, assigneeId: "", dueDate: "", priority: "medium" }] }); break;
    default: break;
  }
}

/** True if a date string is in the past (before today) and the item isn't
 * already done. Shared by task cards, project timelines, and My Dashboard. */
// All compared in LOCAL terms (see parseDate) — `new Date().toDateString()`
// is local midnight today; a bare date string parses to local midnight too.
const isOverdue = (dateStr, done) => !!dateStr && !done && parseDate(dateStr) < new Date(new Date().toDateString());
const isDueToday = (dateStr) => !!dateStr && dateStr === todayLocalISO();
/** True if a date string falls within the next 7 days (inclusive of today, exclusive of overdue). */
const isDueThisWeek = (dateStr) => {
  if (!dateStr) return false;
  const today = new Date(new Date().toDateString());
  const d = parseDate(dateStr);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  return d >= today && d <= in7;
};

/* ─── PROJECT STORAGE ────────────────────────────────────────────── */
/** Old status values map to the new #14 scheme. Applied on every read so
 * the UI never sees a stale value — no bulk migration write (collision
 * risk with concurrent live users); a project only persists its remapped
 * status once it next goes through addProject/updateProject. */
const PROJECT_STATUSES = [
  { key: "upcoming", label: "Upcoming", col: C.faint },
  { key: "in_progress", label: "In Progress", col: C.txt2 },
  { key: "approval", label: "Approval", col: C.clay },
  { key: "done", label: "Done", col: C.moss },
  { key: "archived", label: "Archived", col: C.faint },
];
const PROJECT_STATUS_KEYS = PROJECT_STATUSES.map(s => s.key);
function normalizeProjectStatus(status) {
  if (status === "active") return "in_progress";
  if (status === "on_hold") return "upcoming";
  if (PROJECT_STATUS_KEYS.includes(status)) return status;
  return "upcoming";
}
/** @returns {Project[]} */
const getProjects = () => db.getListSync("projects").map(p => ({ ...p, status: normalizeProjectStatus(p.status) }));
/** @param {Project[]} p */
const saveProjects = (p) => db.setSync("projects", p);
const addProject = (project) => {
  const full = { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), memberIds: [], status: "upcoming", ...project };
  const next = [...getProjects(), full];
  if (REMOTE_MODE) { _cache.set("projects", next); _remoteCollectionSave("project_save", "project", full); return next; }
  saveProjects(next);
  return next;
};
const updateProject = (id, changes) => {
  const next = getProjects().map(p => p.id === id ? { ...p, ...changes, updatedAt: nowISO() } : p);
  if (REMOTE_MODE) { _cache.set("projects", next); _remoteCollectionSave("project_save", "project", next.find(p => p.id === id)); return; }
  saveProjects(next);
};
const deleteProject = (id) => {
  const next = getProjects().filter(p => p.id !== id);
  // Unlink rather than delete — a project's tasks survive as standalone tasks.
  // Server-side cascade in remote mode (see deleteCategory for why).
  const unlinked = getTasks().map(t => t.projectId === id ? { ...t, projectId: "" } : t);
  if (REMOTE_MODE) {
    _cache.set("projects", next);
    _cache.set("tasks", unlinked); // optimistic; server's version wins
    _remoteCollectionDelete("project_delete", id);
    return;
  }
  saveProjects(next);
  saveTasks(unlinked);
};
const defProject = () => ({
  id: uid(), name: "", description: "", status: "upcoming", startDate: "", dueDate: "",
  leadId: "", memberIds: [], color: C.moss, includeTasksOnCalendar: false, createdAt: nowISO(), updatedAt: nowISO(),
});

const projectStatusMeta = Object.fromEntries(PROJECT_STATUSES.map(s => [s.key, s]));
/** Columns on the Projects board — Done + Archived both live in the
 * slide-over instead (see ProjectDoneSlideOver). */
const PROJECT_BOARD_STATUSES = PROJECT_STATUSES.filter(s => s.key !== "done" && s.key !== "archived");

/* ─── CAMPAIGN / CONTENT CONSTANTS ───────────────────────────────── */
const CAMPAIGN_STATUSES = [
  { key: "planning", label: "Planning", col: C.faint },
  { key: "active", label: "Active", col: C.moss },
  { key: "done", label: "Done", col: C.txt2 },
];
const campaignStatusMeta = Object.fromEntries(CAMPAIGN_STATUSES.map(s => [s.key, s]));

const CONTENT_CHANNELS = [
  { key: "gbp", label: "Google Business", icon: "storefront" },
  { key: "blog", label: "Blog", icon: "article" },
  { key: "email", label: "Email", icon: "mail" },
  { key: "instagram", label: "Instagram", icon: "photo_camera" },
];
const contentChannelMeta = Object.fromEntries(CONTENT_CHANNELS.map(c => [c.key, c]));

// Per-channel content "type" (Batch 3). Instagram is the main driver
// (post/story/reel); GBP keeps its own `category` field instead, so it's
// absent here. A channel not in this map simply shows no Type dropdown.
const CONTENT_TYPES = {
  instagram: [
    { key: "post", label: "Post" },
    { key: "story", label: "Story" },
    { key: "reel", label: "Reel" },
    { key: "carousel", label: "Carousel" },
  ],
  email: [
    { key: "newsletter", label: "Newsletter" },
    { key: "promo", label: "Promo" },
    { key: "announcement", label: "Announcement" },
  ],
  blog: [
    { key: "article", label: "Article" },
    { key: "guide", label: "How-to / Guide" },
    { key: "roundup", label: "Roundup" },
  ],
};
/** Human label for a content item's channel+type, or "" if unset/unknown. */
const contentTypeLabel = (channel, type) =>
  (CONTENT_TYPES[channel] || []).find(t => t.key === type)?.label || "";

const CONTENT_STATUSES = [
  { key: "idea", label: "Idea", col: C.faint },
  { key: "draft", label: "Draft", col: C.txt2 },
  { key: "scheduled", label: "Scheduled", col: C.clay },
  { key: "published", label: "Published", col: C.moss },
];
const contentStatusMeta = Object.fromEntries(CONTENT_STATUSES.map(s => [s.key, s]));

const GBP_CTA_TYPES = [
  { key: "", label: "None" },
  { key: "book", label: "Book" },
  { key: "order", label: "Order Online" },
  { key: "buy", label: "Buy" },
  { key: "learn_more", label: "Learn More" },
  { key: "sign_up", label: "Sign Up" },
  { key: "call", label: "Call Now" },
];
const GBP_CATEGORIES = [
  { key: "update", label: "Update" },
  { key: "offer", label: "Offer" },
  { key: "event", label: "Event" },
];

/** Live progress for a project — counts its linked tasks, not subtasks.
 * @param {string} projectId @param {Task[]} allTasks
 * @returns {{done:number, total:number, pct:number}} */
const projectProgress = (projectId, allTasks) => {
  const tasks = (allTasks || []).filter(t => t.projectId === projectId && !t.archived);
  const done = tasks.filter(t => t.status === "done").length;
  const total = tasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
};

/* ─── CAMPAIGN STORAGE ───────────────────────────────────────────── */
/** @returns {Campaign[]} */
const getCampaigns = () => db.getListSync("campaigns");
/** @param {Campaign[]} c */
const saveCampaigns = (c) => db.setSync("campaigns", c);
const addCampaign = (campaign) => {
  const full = { id: uid(), createdAt: nowISO(), ...campaign };
  const next = [...getCampaigns(), full];
  if (REMOTE_MODE) { _cache.set("campaigns", next); _remoteCollectionSave("campaign_save", "campaign", full); return next; }
  saveCampaigns(next);
  return next;
};
const updateCampaign = (id, changes) => {
  const next = getCampaigns().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) { _cache.set("campaigns", next); _remoteCollectionSave("campaign_save", "campaign", next.find(c => c.id === id)); return; }
  saveCampaigns(next);
};
const deleteCampaign = (id) => {
  const next = getCampaigns().filter(c => c.id !== id);
  // Unlink rather than delete — content items survive uncampaigned.
  // Server-side cascade in remote mode (see deleteCategory for why).
  const uncampaigned = getContentItems().map(c => c.campaignId === id ? { ...c, campaignId: "" } : c);
  if (REMOTE_MODE) {
    _cache.set("campaigns", next);
    _cache.set("content", uncampaigned); // optimistic; server's version wins
    _remoteCollectionDelete("campaign_delete", id);
    return;
  }
  saveCampaigns(next);
  saveContentItems(uncampaigned);
};
const defCampaign = () => ({
  id: uid(), name: "", description: "", startDate: "", endDate: "",
  status: "planning", color: C.moss, assigneeIds: [], createdAt: nowISO(),
});

/* ─── CONTENT ITEM STORAGE ───────────────────────────────────────── */
/** @returns {ContentItem[]} */
const getContentItems = () => db.getListSync("content");
/** @param {ContentItem[]} c */
const saveContentItems = (c) => db.setSync("content", c);
const addContentItem = (item) => {
  const full = { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), images: [], links: [], ...item };
  const next = [...getContentItems(), full];
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionSave("content_save", "item", full); return next; }
  saveContentItems(next);
  return next;
};
const updateContentItem = (id, changes) => {
  const next = getContentItems().map(c => c.id === id ? { ...c, ...changes, updatedAt: nowISO() } : c);
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionSave("content_save", "item", next.find(c => c.id === id)); return; }
  saveContentItems(next);
};
const deleteContentItem = (id) => {
  const next = getContentItems().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionDelete("content_delete", id); return; }
  saveContentItems(next);
};

/* Saved reports (#51) — named, shared report presets in the Reports area.
   Each stores its range mode (incl. dynamic presets like "last30"), channel,
   and charted metric; dynamic ranges recompute against today on open. Plain
   shared kv list (like groups/announcements). */
const getContentReports = () => db.getListSync("contentReports");
const saveContentReports = (list) => db.setSync("contentReports", list);
const addContentReport = (r) => { const rec = { id: uid(), createdAt: nowISO(), ...r }; saveContentReports([...getContentReports(), rec]); return rec; };
const deleteContentReport = (id) => saveContentReports(getContentReports().filter(r => r.id !== id));
/** Resolve a report range mode to {from,to} ISO bounds (empty = unbounded).
 * Dynamic presets are computed relative to today so they stay current. */
function reportRange(mode, customFrom, customTo) {
  const today = todayLocalISO();
  const d = parseDate(today);
  const firstOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
  switch (mode) {
    case "last7": return { from: addDaysISO(today, -6), to: today };
    case "last14": return { from: addDaysISO(today, -13), to: today };
    case "last30": return { from: addDaysISO(today, -29), to: today };
    case "last90": return { from: addDaysISO(today, -89), to: today };
    case "thisMonth": return { from: firstOf(d.getFullYear(), d.getMonth()), to: today };
    case "lastMonth": { const pm = new Date(d.getFullYear(), d.getMonth() - 1, 1); const end = new Date(d.getFullYear(), d.getMonth(), 0); return { from: firstOf(pm.getFullYear(), pm.getMonth()), to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}` }; }
    case "qtd": { const qStartMonth = Math.floor(d.getMonth() / 3) * 3; return { from: firstOf(d.getFullYear(), qStartMonth), to: today }; }
    case "ytd": return { from: `${d.getFullYear()}-01-01`, to: today };
    case "custom": return { from: customFrom || "", to: customTo || "" };
    default: return { from: "", to: "" }; // "all"
  }
}
const REPORT_RANGES = [
  { key: "all", label: "All time" },
  { key: "last7", label: "Last 7 days" },
  { key: "last14", label: "Last 14 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];
const defContentItem = (channel = "gbp") => ({
  id: uid(), campaignId: "", channel, type: "", title: "", status: "idea", startDate: "", publishDate: "",
  assigneeId: "", body: "", images: [], links: [], notes: "",
  ctaType: "", ctaUrl: "", category: "update",
  targetKeyword: "", url: "",
  subjectLine: "", previewText: "",
  caption: "", hashtags: "",
  metrics: { likes: "", shares: "", clicks: "", saves: "", sales: "" },
  omnisendCampaignId: "", omnisendStats: null, // email only; {opens,clicks,revenue,fetchedAt}
  createdAt: nowISO(), updatedAt: nowISO(),
});

/** Item counts per channel for a campaign, e.g. {gbp:2, blog:1} — used on
 * the Campaigns strip. @param {string} campaignId @param {ContentItem[]} items */
const campaignChannelCounts = (campaignId, items) => {
  const counts = {};
  (items || []).filter(i => i.campaignId === campaignId).forEach(i => { counts[i.channel] = (counts[i.channel] || 0) + 1; });
  return counts;
};

/* Multi-assignee (Batch 3). Tasks and content items can now be assigned to
   several people. New source of truth is `assigneeIds` (array); the legacy
   single fields (`assignedTo` on tasks, `assigneeId` on content) are kept in
   sync to their first entry on save so anything still reading them — the
   dashboard fallbacks, the server ICS feed — keeps working. Subtasks stay
   single-assignee by design. These readers tolerate either shape. */
const assigneesOf = (rec) =>
  Array.isArray(rec?.assigneeIds) ? rec.assigneeIds
    : rec?.assignedTo ? [rec.assignedTo]
      : rec?.assigneeId ? [rec.assigneeId]
        : [];
const isAssignedTo = (rec, userId) => assigneesOf(rec).includes(userId);

/* ─── USER STORAGE ───────────────────────────────────────────────── *
 * Dev mode: full CRUD against the local "users" list (incl. plaintext
 * PIN, as v1). Remote mode: getUsers() stays a synchronous read of the
 * lightweight {id,name} roster (for assignment dropdowns/avatars —
 * warmed by remoteBootstrap/refreshRoster); mutations route through the
 * admin-only users_* actions and then refresh that roster. Admin Panel's
 * own listing needs role info too, so it uses fetchUsersFull() instead
 * of getUsers() directly. */
/** @returns {User[]} */
const getUsers = () => db.getListSync("users");
/** @param {User[]} u */
const saveUsers = (u) => db.setSync("users", u);

async function refreshRoster() {
  if (!REMOTE_MODE) return;
  const roster = await remoteLoginOptions();
  _cache.set("users", roster);
}
/** Role-bearing list for Admin Panel. Dev mode just returns getUsers(). */
async function fetchUsersFull() {
  if (REMOTE_MODE) {
    const res = await apiCall("users_list", { method: "GET" });
    return res.users || [];
  }
  return getUsers();
}
/** Create or update a user. Returns a Promise in both modes (dev resolves
 * immediately) so Admin Panel can always `await` + refresh consistently. */
async function addUser(user) {
  if (REMOTE_MODE) {
    const res = await apiCall("users_upsert", { method: "POST", body: { name: user.name, pin: user.pin, role: user.role } });
    await refreshRoster();
    return { id: res.id, ...user };
  }
  const next = [...getUsers(), { id: uid(), ...user }];
  saveUsers(next);
  return next;
}
async function updateUser(id, changes) {
  if (REMOTE_MODE) {
    await apiCall("users_upsert", { method: "POST", body: { id, name: changes.name, pin: changes.pin || "", role: changes.role } });
    await refreshRoster();
    return;
  }
  // A blank pin means "leave unchanged" in both modes, matching the server's
  // users_upsert semantics — never overwrite a real PIN with an empty one.
  const merged = { ...changes };
  if (!merged.pin) delete merged.pin;
  const next = getUsers().map(u => u.id === id ? { ...u, ...merged } : u);
  saveUsers(next);
}
async function deleteUser(id) {
  if (REMOTE_MODE) {
    await apiCall("users_delete", { method: "POST", body: { id } });
    await refreshRoster();
    return;
  }
  saveUsers(getUsers().filter(u => u.id !== id));
}
/** Self-service PIN change. Dev mode checks the stored PIN client-side
 * (there's no server to verify against); remote mode calls change_pin. */
async function changeOwnPin(currentPin, newPin) {
  const me = getCurrentUser();
  if (!me) throw new Error("Not logged in");
  if (REMOTE_MODE) {
    await apiCall("change_pin", { method: "POST", body: { currentPin, newPin } });
    return;
  }
  const users = getUsers();
  const rec = users.find(u => u.id === me.id);
  if (!rec || String(rec.pin) !== String(currentPin)) throw new Error("Current PIN doesn't match.");
  await updateUser(me.id, { pin: newPin });
}

/* ─── BACKUPS + EXPORT/IMPORT (Phase 4) ──────────────────────────────
   Backups (list/run/download/restore) are remote-only — dev mode has no
   server to back up. Export/Import works in both modes (belt-and-
   suspenders manual path): dev mode bundles the whole localStorage kv
   set; remote mode bundles the whole in-memory cache (already fully
   warm post-login). */
async function backupRun() { return apiCall("backup_run", { method: "POST" }); }
/** @returns {Promise<{backups:Array, offsite:Object}>} — off-site status rides
 * along so the Backups tile can show a dead uploader without being asked. */
async function backupList() {
  const res = await apiCall("backup_list", { method: "GET" });
  return { backups: res.backups || [], offsite: res.offsite || { configured: false } };
}
function backupDownloadUrl(file) {
  const t = _getToken();
  return API_BASE + "?action=backup_download&file=" + encodeURIComponent(file) + (t ? "&token=" + encodeURIComponent(t) : "");
}
async function backupRestore(file) { return apiCall("backup_restore", { method: "POST", body: { file } }); }

/* ─── DEPLOY (Admin Panel "Software Update" button) ──────────────────
   Remote-only — dev mode has no cPanel to deploy. Triggers admin_deploy
   (a fresh backup, then a best-effort remote-update pull, then the actual
   cPanel Git Version Control deploy). lastDeploy is read straight from
   kv_get rather than the warm cache, since a session logged in before the
   first deploy of this feature won't have it in its bootstrap snapshot. */
async function adminDeploy() { return apiCall("admin_deploy", { method: "POST" }); }
async function fetchLastDeploy() {
  const res = await apiCall("kv_get", { method: "GET", query: { key: "lastDeploy" } });
  return res.value || null;
}

/* ─── RELEASE ROLLBACK (#13, remote-only) ─────────────────────────────
   Server keeps local snapshots of deployed builds (see api.php
   snapshotCurrentBuild) — this just lists/triggers them. No git involved:
   cPanel can only deploy the checked-out branch HEAD, so rollback restores
   files from a prior snapshot instead. */
async function releaseList() { const res = await apiCall("release_list", { method: "GET" }); return res.releases || []; }
async function releaseRollback(name) { return apiCall("release_rollback", { method: "POST", body: { name } }); }

// Every kv key the app writes. Anything missing here is silently absent from
// an Export — which matters because Export/Import is the manual belt-and-
// suspenders path an admin reaches for when they don't trust the server
// backups. imagerepo/toolsPrompts especially: Image Repository is the one
// section every staff member has by default (see DEFAULT_NAV_ACCESS).
// Deliberately excluded: icsTokens (per-user calendar credentials, regenerate
// on demand) and lastDeploy (server state, not user data).
const EXPORT_KEYS = [
  "sops", "categories", "tasks", "acks", "projects", "campaigns", "content",
  "contacts", "instances", "playbook", "playbookRevs", "tags", "alerts",
  "taskTemplates", "imagerepo", "toolsPrompts", "navAccess", "salesTargets",
  "groups", "userGroups", "announcements", "announcementAcks",
  "clients", "products", "waitlist", "callbacks", "callbackAcks",
];
/** Everything the app knows about, as one importable JSON object. */
function exportAllData() {
  const out = { exportedAt: nowISO(), app: "greenkiss", data: {} };
  EXPORT_KEYS.forEach(k => { out.data[k] = db.getSync(k); });
  if (!REMOTE_MODE) out.data.users = getUsers(); // dev mode only — remote users live server-side
  return out;
}
/** Replaces everything from a previously exported JSON object. Caller is
 * responsible for the "are you sure" confirm — this just applies it. */
async function importAllData(parsed) {
  const data = (parsed && parsed.data) || parsed || {};
  // Validate the whole payload before writing anything: a scalar where a
  // collection is expected (e.g. tasks:"oops") would otherwise persist and
  // crash the render layer on every reload. Reject up front, write nothing.
  const bad = Object.keys(data).filter(k => {
    const v = data[k];
    return v != null && typeof v !== "object"; // arrays and objects are fine; scalars are not
  });
  if (bad.length) {
    throw new Error(`Import file is malformed — these keys aren't valid data: ${bad.join(", ")}`);
  }
  for (const k of Object.keys(data)) {
    if (k === "users" && REMOTE_MODE) continue; // remote users aren't importable this way
    if (data[k] == null) continue; // skip explicit nulls rather than clobbering a collection with null
    await db.set(k, data[k]);
  }
}

export {
  C, setTheme, getTheme, FONT_CAPS, FONT_BODY, CATEGORY_COLORS, LOGIN_BG, LOGIN_BG_DEEP,
  REMOTE_MODE, isRemoteWarm, remoteBootstrap, remoteLogin, remoteLoginOptions, apiCall, refreshCache,
  db, uid, nowISO, fmtDate, fmtDateShort, parseDate, MS_DAY, daysBetween, addDaysISO, MONTHS_ABBR, TIMELINE_ZOOMS,
  getCurrentUser, setCurrentUser, clearCurrentUser, fetchLoginHistory, refreshPresence, isUserOnline, subscribePresence,
  _gkRefs, confirmDelete, triggerSaved, inp, ROLE_LABELS, canEdit, isAdmin,
  NAV_ITEMS, NAV_SECTIONS, getUserSections, setUserSections, sectionsForUser,
  getGroups, saveGroups, addGroup, updateGroup, deleteGroup,
  getUserGroups, setUserGroups, userIdsInGroup,
  ANNOUNCEMENT_SURFACES, ANNOUNCEMENT_DELIVERY, NEWS_SECTIONS, newsSectionMeta,
  getAnnouncements, saveAnnouncements, defAnnouncement, addAnnouncement, updateAnnouncement, deleteAnnouncement,
  announcementIsLive, announcementTargetsUser, announcementsForUser, announcementRecipientIds,
  getAnnouncementAcks, hasAckedAnnouncement, announcementAckList, ackAnnouncement,
  getClients, saveClients, addClient, updateClient, deleteClient,
  getProducts, saveProducts, addProduct, updateProduct, deleteProduct,
  getWaitlist, saveWaitlist, addWaitlistEntry, updateWaitlistEntry, deleteWaitlistEntry, waitlistForProduct,
  getCallbacks, saveCallbacks, defCallback, addCallback, updateCallback, deleteCallback,
  callbackTargetsUser, openCallbacksForUser,
  getCallbackAcks, hasAckedCallback, ackCallback,
  chatBootstrap, chatChannelCreate, chatOpenDM, chatFetchMessages, chatSend, chatMarkRead, chatPoll, chatAlerts,
  chatEditMessage, chatDeleteMessage, chatArchiveChannel,
  seedIfEmpty,
  getCategories, saveCategories, addCategory, updateCategory, deleteCategory,
  getTags, saveTags, addTag,
  getAlerts, saveAlerts, addAlert, deleteAlert,
  getTaskTemplates, saveTaskTemplates, addTaskTemplate, deleteTaskTemplate, taskFromTemplate, snapshotTaskForTemplate,
  getSOPs, saveSOPs, getSOP, addSOP, updateSOP, deleteSOP, duplicateSOP, defSOP, sopMatchesSearch, sopExcerpt,
  SOP_STATUSES, sopStatusMeta,
  getAllHeadingTexts, getAllTypePrefixes, seedStandardSections, asListBlock, blockBg, taskFromSop, sopHasTaskRoles,
  isMagnet, parseMagnet, magnetFor, copyMagnet, openMagnet, linkifyMagnets, setMagnetNav, navigateItem, setTaskCreator, createTaskFromItem, taskPrefillFromItem, setCallbackStarter, startCallbackForProduct, getLinkSearchCandidates, globalSearch, sanitizeHtml, escapeHtml, mentionTokensToHtml, triggerToast,
  getPlaybookRevs, addPlaybookRev,
  getContacts, saveContacts, addContact, updateContact, deleteContact,
  getAllInstances, saveInstances, getInstances, addInstance, updateInstance, todayLocalISO,
  newSubmission, stampEditLog, formColor,
  parseMentionText, getMentionCandidates, findBacklinks,
  getPlaybook, savePlaybook, savePlaybookSection, deletePlaybookSection, seedPlaybookIfEmpty,
  getImageRepo, saveImageRepo, saveImageRepoBlock, deleteImageRepoBlock, seedImageRepoIfEmpty, letterOf,
  getToolsPrompts, saveToolsPromptsItem, deleteToolsPromptsItem,
  fetchOmnisendCampaigns, fetchOmnisendCampaignStats, getIcsSubscribeUrl,
  fetchShopifySales, getSalesTargets, saveSalesTargets, currentSalesTargets, MONTH_NAMES,
  getRevisions, getRevision, restoreRevision,
  getAcks, saveAcks, ackSop, isAckStale,
  fileToCompressedDataURL, processAndStoreImage,
  getTasks, saveTasks, addTask, updateTask, deleteTask, TASK_STATUSES, TASK_BOARD_STATUSES, TASK_PRIORITIES, taskPriorityMeta,
  TASK_TYPES, taskTypeMeta, taskType,
  RECURRENCE_OPTIONS, advanceDate, completeTaskWithRecurrence,
  toggleFavourite, duplicateTask, mergeTaskInto, convertTaskToProject, convertTaskToSubtask, emptyTaskShape, taskOnCalendar,
  sortTasksForUser, dispatchTaskAction,
  isOverdue, isDueToday, isDueThisWeek,
  getProjects, saveProjects, addProject, updateProject, deleteProject, defProject,
  PROJECT_STATUSES, PROJECT_BOARD_STATUSES, projectStatusMeta, projectProgress, normalizeProjectStatus,
  getCampaigns, saveCampaigns, addCampaign, updateCampaign, deleteCampaign, defCampaign,
  CAMPAIGN_STATUSES, campaignStatusMeta,
  getContentItems, saveContentItems, addContentItem, updateContentItem, deleteContentItem, defContentItem,
  getContentReports, addContentReport, deleteContentReport, reportRange, REPORT_RANGES,
  campaignChannelCounts, CONTENT_CHANNELS, contentChannelMeta, CONTENT_STATUSES, contentStatusMeta,
  CONTENT_TYPES, contentTypeLabel, assigneesOf, isAssignedTo,
  GBP_CTA_TYPES, GBP_CATEGORIES,
  getUsers, saveUsers, addUser, updateUser, deleteUser, fetchUsersFull, refreshRoster, changeOwnPin,
  backupRun, backupList, backupDownloadUrl, backupRestore, exportAllData, importAllData,
  adminDeploy, fetchLastDeploy, releaseList, releaseRollback,
};
