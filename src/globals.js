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
 * @typedef {{id:string,type:"heading",text:string}} HeadingBlock
 * @typedef {{id:string,type:"text",text:string}} TextBlock
 * @typedef {{id:string,type:"links",title?:string,links:LinkItem[]}} LinksBlock
 * @typedef {{id:string,type:"image",src:string,caption:string}} ImageBlock
 * @typedef {{id:string,type:"checklist",title:string,items:ChecklistItem[]}} ChecklistBlock
 * @typedef {HeadingBlock|TextBlock|LinksBlock|ImageBlock|ChecklistBlock} Block
 *
 * @typedef {Object} SOP
 * @property {string} id
 * @property {string} title
 * @property {string} categoryId
 * @property {"draft"|"published"|"archived"} status
 * @property {Block[]} blocks
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} updatedBy
 *
 * @typedef {Object} SubTask
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 * @property {string} [assigneeId] user id
 * @property {string} [dueDate] ISO date (yyyy-mm-dd)
 *
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {"todo"|"in-progress"|"done"} status
 * @property {"low"|"medium"|"high"|"urgent"} priority
 * @property {string} assignedTo user id
 * @property {string} dueDate ISO date (yyyy-mm-dd)
 * @property {string} relatedSopId
 * @property {string} [projectId] linked Project.id, empty for standalone tasks
 * @property {SubTask[]} subTasks
 * @property {string} createdAt
 * @property {number} [order]
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {"active"|"on_hold"|"done"|"archived"} status
 * @property {string} startDate ISO date (yyyy-mm-dd)
 * @property {string} dueDate ISO date (yyyy-mm-dd)
 * @property {string} leadId user id
 * @property {string[]} memberIds user ids
 * @property {string} color hex
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
const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
};
const fmtDateShort = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
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
const isRemoteMode = () => REMOTE_MODE;
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
const setCurrentUser = (u) => sessionStorage.setItem("gkCurrentUser", JSON.stringify(u));
const clearCurrentUser = () => sessionStorage.removeItem("gkCurrentUser");

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
function remoteLogout() {
  apiCall("logout", { method: "POST" }).catch(() => {});
  _setToken("");
  clearCurrentUser();
  _remoteWarm = false;
  _cache.clear();
}

/* ─── SHARED INPUT STYLE ─────────────────────────────────────────── */
const inp = (ex = {}) => ({
  background: C.inset, border: `1.5px solid ${C.bdr}`, color: C.txt,
  borderRadius: 8, padding: "10px 13px", fontSize: 15, outline: "none",
  fontFamily: "'Jost',system-ui,sans-serif", width: "100%",
  transition: "border-color .15s", ...ex,
});

/* ─── ROLE HELPERS ───────────────────────────────────────────────────
   viewer  = read SOPs + view tasks only
   editor  = full SOP/task CRUD
   admin   = editor + manage users + manage categories */
const ROLE_LABELS = { admin: "Admin", editor: "Editor", viewer: "Viewer" };
const canEdit = (user) => user && (user.role === "admin" || user.role === "editor");
const isAdmin = (user) => user && user.role === "admin";

/* ─── SEED DATA (dev mode only — remote mode is seeded once via schema.sql) ─
   Runs once against empty storage so the UI demos well immediately. */
function seedIfEmpty() {
  if (REMOTE_MODE) return;
  const users = db.getSync("users");
  if (!users) {
    db.setSync("users", [
      { id: uid(), name: "Hayden", pin: "1234", role: "admin" },
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
}

/* ─── CATEGORY STORAGE ───────────────────────────────────────────── */
/** @returns {Category[]} */
const getCategories = () => db.getSync("categories") || [];
/** @param {Category[]} c */
const saveCategories = (c) => db.setSync("categories", c);
const addCategory = (name, color) => {
  const cats = getCategories();
  const next = [...cats, { id: uid(), name, color, createdAt: nowISO() }];
  saveCategories(next);
  return next;
};
const updateCategory = (id, changes) => {
  const next = getCategories().map(c => c.id === id ? { ...c, ...changes } : c);
  saveCategories(next);
  return next;
};
const deleteCategory = (id) => {
  saveCategories(getCategories().filter(c => c.id !== id));
  // Leave SOPs uncategorized rather than deleting them.
  const sops = getSOPs().map(s => s.categoryId === id ? { ...s, categoryId: "" } : s);
  saveSOPs(sops);
};

/* ─── SOP STORAGE ────────────────────────────────────────────────── */
/** @returns {SOP[]} */
const getSOPs = () => db.getSync("sops") || [];
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
  const next = [...getSOPs(), sop];
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
const deleteSOP = (id) => saveSOPs(getSOPs().filter(s => s.id !== id));
/** Copies a SOP as a new Draft "(copy)" — goes through the normal create path. */
const duplicateSOP = (sop) => {
  const copy = {
    ...sop, id: uid(), title: (sop.title || "Untitled SOP") + " (copy)", status: "draft",
    blocks: (sop.blocks || []).map(b => ({ ...b, id: uid() })),
    createdAt: nowISO(), updatedAt: nowISO(), updatedBy: getCurrentUser()?.name || "",
  };
  return addSOP(copy);
};

const defSOP = (categoryId = "") => ({
  id: uid(),
  title: "",
  categoryId,
  status: "draft",
  blocks: [],
  createdAt: nowISO(),
  updatedAt: nowISO(),
  updatedBy: getCurrentUser()?.name || "",
});

/** Full-text search across title + all block text/labels/urls/captions. */
const sopMatchesSearch = (sop, query) => {
  if (!query) return true;
  const q = query.toLowerCase();
  if ((sop.title || "").toLowerCase().includes(q)) return true;
  return (sop.blocks || []).some(b => {
    if (b.type === "heading" || b.type === "text") return (b.text || "").toLowerCase().includes(q);
    if (b.type === "image") return (b.caption || "").toLowerCase().includes(q);
    if (b.type === "checklist") return (b.items || []).some(i => (i.text || "").toLowerCase().includes(q));
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
  const acks = getAcks();
  const forSop = { ...(acks[sopId] || {}) };
  forSop[userId] = { at: nowISO(), version: sopUpdatedAt };
  saveAcks({ ...acks, [sopId]: forSop });
}
/** @returns {AckEntry|null} */
function getAckFor(sopId, userId) {
  const acks = getAcks();
  return (acks[sopId] && acks[sopId][userId]) || null;
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
const getTasks = () => db.getSync("tasks") || [];
/** @param {Task[]} t */
const saveTasks = (t) => db.setSync("tasks", t);
const addTask = (task) => {
  const next = [...getTasks(), { id: uid(), createdAt: nowISO(), subTasks: [], ...task }];
  saveTasks(next);
  return next;
};
const updateTask = (id, changes) => {
  const next = getTasks().map(t => t.id === id ? { ...t, ...changes } : t);
  saveTasks(next);
};
const deleteTask = (id) => saveTasks(getTasks().filter(t => t.id !== id));

const TASK_STATUSES = [
  { key: "todo", label: "To Do", col: C.faint },
  { key: "in-progress", label: "In Progress", col: C.txt2 },
  { key: "done", label: "Done", col: C.moss },
];
const taskStatusMeta = Object.fromEntries(TASK_STATUSES.map(s => [s.key, s]));

const TASK_PRIORITIES = [
  { key: "low", label: "Low", col: C.faint },
  { key: "medium", label: "Medium", col: C.txt2 },
  { key: "high", label: "High", col: C.clay },
  { key: "urgent", label: "Urgent", col: C.red },
];
const taskPriorityMeta = Object.fromEntries(TASK_PRIORITIES.map(p => [p.key, p]));

/** True if a date string is in the past (before today) and the item isn't
 * already done. Shared by task cards, project timelines, and My Dashboard. */
const isOverdue = (dateStr, done) => !!dateStr && !done && new Date(dateStr) < new Date(new Date().toDateString());
const isDueToday = (dateStr) => !!dateStr && dateStr === new Date().toISOString().slice(0, 10);
/** True if a date string falls within the next 7 days (inclusive of today, exclusive of overdue). */
const isDueThisWeek = (dateStr) => {
  if (!dateStr) return false;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const d = new Date(dateStr);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  return d >= today && d <= in7;
};

/* ─── PROJECT STORAGE ────────────────────────────────────────────── */
/** @returns {Project[]} */
const getProjects = () => db.getSync("projects") || [];
/** @param {Project[]} p */
const saveProjects = (p) => db.setSync("projects", p);
/** @param {string} id @returns {Project|null} */
const getProject = (id) => getProjects().find(p => p.id === id) || null;
const addProject = (project) => {
  const next = [...getProjects(), { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), memberIds: [], ...project }];
  saveProjects(next);
  return next;
};
const updateProject = (id, changes) => {
  const next = getProjects().map(p => p.id === id ? { ...p, ...changes, updatedAt: nowISO() } : p);
  saveProjects(next);
};
const deleteProject = (id) => {
  saveProjects(getProjects().filter(p => p.id !== id));
  // Unlink rather than delete — a project's tasks survive as standalone tasks.
  saveTasks(getTasks().map(t => t.projectId === id ? { ...t, projectId: "" } : t));
};
const defProject = () => ({
  id: uid(), name: "", description: "", status: "active", startDate: "", dueDate: "",
  leadId: "", memberIds: [], color: C.moss, createdAt: nowISO(), updatedAt: nowISO(),
});

const PROJECT_STATUSES = [
  { key: "active", label: "Active", col: C.moss },
  { key: "on_hold", label: "On Hold", col: C.clay },
  { key: "done", label: "Done", col: C.txt2 },
  { key: "archived", label: "Archived", col: C.faint },
];
const projectStatusMeta = Object.fromEntries(PROJECT_STATUSES.map(s => [s.key, s]));

/** Live progress for a project — counts its linked tasks, not subtasks.
 * @param {string} projectId @param {Task[]} allTasks
 * @returns {{done:number, total:number, pct:number}} */
const projectProgress = (projectId, allTasks) => {
  const tasks = (allTasks || []).filter(t => t.projectId === projectId);
  const done = tasks.filter(t => t.status === "done").length;
  const total = tasks.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
};

/* ─── USER STORAGE ───────────────────────────────────────────────── *
 * Dev mode: full CRUD against the local "users" list (incl. plaintext
 * PIN, as v1). Remote mode: getUsers() stays a synchronous read of the
 * lightweight {id,name} roster (for assignment dropdowns/avatars —
 * warmed by remoteBootstrap/refreshRoster); mutations route through the
 * admin-only users_* actions and then refresh that roster. Admin Panel's
 * own listing needs role info too, so it uses fetchUsersFull() instead
 * of getUsers() directly. */
/** @returns {User[]} */
const getUsers = () => db.getSync("users") || [];
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
async function backupList() { const res = await apiCall("backup_list", { method: "GET" }); return res.backups || []; }
function backupDownloadUrl(file) {
  const t = _getToken();
  return API_BASE + "?action=backup_download&file=" + encodeURIComponent(file) + (t ? "&token=" + encodeURIComponent(t) : "");
}
async function backupRestore(file) { return apiCall("backup_restore", { method: "POST", body: { file } }); }

const EXPORT_KEYS = ["sops", "categories", "tasks", "acks", "projects", "campaigns", "content"];
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
  for (const k of Object.keys(data)) {
    if (k === "users" && REMOTE_MODE) continue; // remote users aren't importable this way
    await db.set(k, data[k]);
  }
}

export {
  C, setTheme, getTheme, CATEGORY_COLORS, LOGIN_BG, LOGIN_BG_DEEP,
  REMOTE_MODE, isRemoteMode, isRemoteWarm, remoteBootstrap, remoteLogin, remoteLoginOptions, remoteLogout, apiCall,
  db, uid, nowISO, fmtDate, fmtDateShort,
  getCurrentUser, setCurrentUser, clearCurrentUser,
  _gkRefs, confirmDelete, triggerSaved, inp, ROLE_LABELS, canEdit, isAdmin,
  seedIfEmpty,
  getCategories, saveCategories, addCategory, updateCategory, deleteCategory,
  getSOPs, saveSOPs, getSOP, addSOP, updateSOP, deleteSOP, duplicateSOP, defSOP, sopMatchesSearch, sopExcerpt,
  getRevisions, getRevision, restoreRevision,
  getAcks, saveAcks, ackSop, getAckFor, isAckStale,
  fileToCompressedDataURL, processAndStoreImage,
  getTasks, saveTasks, addTask, updateTask, deleteTask, TASK_STATUSES, taskStatusMeta, TASK_PRIORITIES, taskPriorityMeta,
  isOverdue, isDueToday, isDueThisWeek,
  getProjects, saveProjects, getProject, addProject, updateProject, deleteProject, defProject,
  PROJECT_STATUSES, projectStatusMeta, projectProgress,
  getUsers, saveUsers, addUser, updateUser, deleteUser, fetchUsersFull, refreshRoster, changeOwnPin,
  backupRun, backupList, backupDownloadUrl, backupRestore, exportAllData, importAllData,
};
