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
function _remoteCollectionSave(action, bodyKey, item, cacheKey) {
  apiCall(action, { method: "POST", body: { [bodyKey]: item } }).then(res => {
    if (res && res[cacheKey]) _cache.set(cacheKey, res[cacheKey]);
    _setOffline(false);
  }).catch(() => _setOffline(true));
}
function _remoteCollectionDelete(action, id, cacheKey) {
  apiCall(action, { method: "POST", body: { id } }).then(res => {
    if (res && res[cacheKey]) _cache.set(cacheKey, res[cacheKey]);
    _setOffline(false);
  }).catch(() => _setOffline(true));
}

/* ─── CATEGORY STORAGE ───────────────────────────────────────────── */
/** @returns {Category[]} */
const getCategories = () => db.getSync("categories") || [];
/** @param {Category[]} c */
const saveCategories = (c) => db.setSync("categories", c);
const addCategory = (name, color) => {
  const newCat = { id: uid(), name, color, createdAt: nowISO() };
  const next = [...getCategories(), newCat];
  if (REMOTE_MODE) { _cache.set("categories", next); _remoteCollectionSave("category_save", "category", newCat, "categories"); return newCat; }
  saveCategories(next);
  return newCat;
};
const updateCategory = (id, changes) => {
  const next = getCategories().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) {
    _cache.set("categories", next);
    _remoteCollectionSave("category_save", "category", next.find(c => c.id === id), "categories");
    return next;
  }
  saveCategories(next);
  return next;
};
const deleteCategory = (id) => {
  const next = getCategories().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("categories", next); _remoteCollectionDelete("category_delete", id, "categories"); }
  else saveCategories(next);
  // Leave SOPs uncategorized rather than deleting them — bulk cascade stays
  // on the plain saveSOPs path either way (not "an edit" worth per-record merging).
  const sops = getSOPs().map(s => s.categoryId === id ? { ...s, categoryId: "" } : s);
  saveSOPs(sops);
};

/* ─── TAG STORAGE (#8 — foundation for tag chips + create-on-the-fly) ─
   Same per-record collision-safe shape as categories. Colors are drawn
   from the same CATEGORY_COLORS swatch set so tag chips visually match
   the rest of the app's "ingredient label" tag treatment. */
/** @returns {Tag[]} */
const getTags = () => db.getSync("tags") || [];
/** @param {Tag[]} t */
const saveTags = (t) => db.setSync("tags", t);
const addTag = (name, color) => {
  const newTag = { id: uid(), name, color, createdAt: nowISO() };
  const next = [...getTags(), newTag];
  if (REMOTE_MODE) { _cache.set("tags", next); _remoteCollectionSave("tag_save", "tag", newTag, "tags"); return newTag; }
  saveTags(next);
  return newTag;
};
const updateTag = (id, changes) => {
  const next = getTags().map(t => t.id === id ? { ...t, ...changes } : t);
  if (REMOTE_MODE) { _cache.set("tags", next); _remoteCollectionSave("tag_save", "tag", next.find(t => t.id === id), "tags"); return next; }
  saveTags(next);
  return next;
};
const deleteTag = (id) => {
  const next = getTags().filter(t => t.id !== id);
  if (REMOTE_MODE) { _cache.set("tags", next); _remoteCollectionDelete("tag_delete", id, "tags"); }
  else saveTags(next);
  // Unlink rather than cascade-fail — tasks just lose the tag chip.
  saveTasks(getTasks().map(t => (t.tagIds || []).includes(id) ? { ...t, tagIds: t.tagIds.filter(x => x !== id) } : t));
};

/* ─── CONTACT STORAGE (internal team + vendor contacts for Playbook Key
   Contacts and @person mentions) — same per-record collision-safe shape
   as tags/categories. ──────────────────────────────────────────────── */
/** @returns {Contact[]} */
const getContacts = () => db.getSync("contacts") || [];
/** @param {Contact[]} c */
const saveContacts = (c) => db.setSync("contacts", c);
const addContact = (contact) => {
  const newContact = { id: uid(), createdAt: nowISO(), ...contact };
  const next = [...getContacts(), newContact];
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionSave("contact_save", "contact", newContact, "contacts"); return newContact; }
  saveContacts(next);
  return newContact;
};
const updateContact = (id, changes) => {
  const next = getContacts().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionSave("contact_save", "contact", next.find(c => c.id === id), "contacts"); return next; }
  saveContacts(next);
  return next;
};
const deleteContact = (id) => {
  const next = getContacts().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("contacts", next); _remoteCollectionDelete("contact_delete", id, "contacts"); }
  else saveContacts(next);
};

/* ─── ALERT STORAGE (#9 — "Alert staff member" overflow action) ──────
   Any authenticated user may create (flagging something for a manager is
   a viewer-appropriate action); delete is restricted server-side to the
   alert's target, its creator, or an admin. */
/** @returns {Alert[]} */
const getAlerts = () => db.getSync("alerts") || [];
/** @param {Alert[]} a */
const saveAlerts = (a) => db.setSync("alerts", a);
const addAlert = (taskId, toUserId) => {
  const me = getCurrentUser();
  const newAlert = { id: uid(), taskId, fromUserId: me?.id || "", toUserId, at: nowISO() };
  const next = [...getAlerts(), newAlert];
  if (REMOTE_MODE) { _cache.set("alerts", next); _remoteCollectionSave("alert_save", "alert", newAlert, "alerts"); return newAlert; }
  saveAlerts(next);
  return newAlert;
};
const deleteAlert = (id) => {
  const next = getAlerts().filter(a => a.id !== id);
  if (REMOTE_MODE) { _cache.set("alerts", next); _remoteCollectionDelete("alert_delete", id, "alerts"); }
  else saveAlerts(next);
};

/* ─── TASK TEMPLATE STORAGE (#9 — "Templates" overflow action) ──────── */
/** @returns {TaskTemplate[]} */
const getTaskTemplates = () => db.getSync("taskTemplates") || [];
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
  if (REMOTE_MODE) { _cache.set("taskTemplates", next); _remoteCollectionSave("template_save", "template", newTpl, "taskTemplates"); return newTpl; }
  saveTaskTemplates(next);
  return newTpl;
};
const deleteTaskTemplate = (id) => {
  const next = getTaskTemplates().filter(t => t.id !== id);
  if (REMOTE_MODE) { _cache.set("taskTemplates", next); _remoteCollectionDelete("template_delete", id, "taskTemplates"); }
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

/** True if a document has any block that captures per-run fill state
 * (checklist / list-with-entry / completion) — gates whether SOPViewer
 * shows the Instances "Today's Run" UI at all (Phase 2). Reference-only
 * docs (vendor directory, appendices) have none of these and behave
 * exactly as a plain read-only document. */
const hasFillableBlocks = (blocks) => (blocks || []).some(b =>
  b.type === "checklist" || b.type === "completion" || (b.type === "list" && b.withEntry)
);

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
const getAllInstances = () => db.getSync("instances") || [];
/** @param {Instance[]} i */
const saveInstances = (i) => db.setSync("instances", i);
/** @param {string} docId @returns {Instance[]} newest first */
const getInstances = (docId) => getAllInstances().filter(i => i.docId === docId).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
const addInstance = (instance) => {
  const newInstance = { id: uid(), values: {}, ...instance };
  const next = [...getAllInstances(), newInstance];
  if (REMOTE_MODE) { _cache.set("instances", next); _remoteCollectionSave("instance_save", "instance", newInstance, "instances"); return newInstance; }
  saveInstances(next);
  return newInstance;
};
const updateInstance = (id, changes) => {
  const next = getAllInstances().map(i => i.id === id ? { ...i, ...changes } : i);
  if (REMOTE_MODE) { _cache.set("instances", next); _remoteCollectionSave("instance_save", "instance", next.find(i => i.id === id), "instances"); return next; }
  saveInstances(next);
  return next;
};
const deleteInstance = (id) => {
  const next = getAllInstances().filter(i => i.id !== id);
  if (REMOTE_MODE) { _cache.set("instances", next); _remoteCollectionDelete("instance_delete", id, "instances"); }
  else saveInstances(next);
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
/** Today's instance for a doc, if any — in progress OR already completed
 * (getInstances is newest-first, so this is the latest one). Used so the
 * "Today's Run" strip shows the right state (Continue / Completed today)
 * across page reloads, not just within the session that completed it. */
const getTodayInstance = (docId) => {
  const today = todayLocalISO();
  return getInstances(docId).find(i => i.date === today) || null;
};

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
const MENTION_RE = /@\[([^\]]+)\]\((sop|form|contact|playbook):([\w-]+)\)/g;

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
  getSOPs().forEach(s => {
    if (matches(s.title)) out.push({ kind: s.kind === "form" ? "form" : "sop", id: s.id, label: s.title || "Untitled", sub: s.kind === "form" ? "Form" : "SOP" });
  });
  getContacts().forEach(c => {
    if (matches(c.name)) out.push({ kind: "contact", id: c.id, label: c.name, sub: c.role || "Contact" });
  });
  const playbook = db.getSync("playbook") || { sections: [] };
  (playbook.sections || []).forEach(s => {
    if (matches(s.title)) out.push({ kind: "playbook", id: s.id, label: s.title, sub: "Playbook" });
  });
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
  const m = /^gk:(sop|task|playbook):([\w-]+)(?::([\w-]+))?$/.exec(url || "");
  return m ? { kind: m[1], id: m[2], blockId: m[3] || "" } : null;
}
const magnetFor = (kind, id, blockId) => `gk:${kind}:${id}${blockId ? ":" + blockId : ""}`;
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
/** One resolver for clicking any magnet link. `nav` is App.jsx's navigation
 * surface: { goToSop(id, blockId), goToTask(id), goToPlaybookSection(id) }. */
function openMagnet(url, nav) {
  const m = parseMagnet(url);
  if (!m || !nav) return false;
  if (m.kind === "sop" && nav.goToSop) nav.goToSop(m.id, m.blockId);
  else if (m.kind === "task" && nav.goToTask) nav.goToTask(m.id);
  else if (m.kind === "playbook" && nav.goToPlaybookSection) nav.goToPlaybookSection(m.id);
  else return false;
  return true;
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
  return out.slice(0, 10);
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
    `<span data-mention="${kind}:${id}" style="display:inline-flex;padding:0 6px;border-radius:5px;background:${C.mossSoft};color:${C.moss};font-weight:600;cursor:pointer;font-size:0.94em">${escapeHtml(label)}</span>`);
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
const getPlaybookRevs = () => db.getSync("playbookRevs") || [];
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
   carries a `letter` used to group A–Z. `letterOf` defaults an unset
   letter to the title's first letter (non-A–Z falls in the "#" group). */
const getImageRepo = () => db.getSync("imagerepo") || null;
const saveImageRepo = (doc) => db.setSync("imagerepo", doc);
const letterOf = (b) => {
  if (b && b.letter) return b.letter;
  const c = ((b && b.text) || "").trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
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
    ["G", "Glow Jar — Second Image Collection", "https://photos.google.com/share/AF1QipNwvJr3JhmTZfumwwiHnW5vpfe9S0UmAE1nS_0tg3Mq"],
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
    ["J", "Joni", "https://drive.google.com/drive/folders/1tAgII3srN0kEbemmspezQy9M1-wpBEOl"],
    ["J", "Josh Rosebrook", "https://joshrosebrookwholesale.com/pages/assets-education"],
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
    ["P", "100% Pure", "https://toolbox.puritycosmetics.com/partners/login.php"],
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
  saveImageRepo({ blocks: rows.map(([letter, text, url]) => ({ id: uid(), type: "title", text, url, letter })) });
  return true;
}

/* ─── TOOLS & PROMPTS REPOSITORY ──────────────────────────────────────
   Flat list of team tools and reusable prompts. One generic kv doc
   {items:[{id,type:"tool"|"prompt",title,body,url,tags,createdAt}]} —
   same zero-backend pattern as the image repo / playbook. */
const getToolsPrompts = () => db.getSync("toolsPrompts") || { items: [] };
const saveToolsPrompts = (doc) => db.setSync("toolsPrompts", doc);

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
  const full = { id: uid(), createdAt: nowISO(), subTasks: [], ...task };
  const next = [...getTasks(), full];
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionSave("task_save", "task", full, "tasks"); return next; }
  saveTasks(next);
  return next;
};
const updateTask = (id, changes) => {
  const next = getTasks().map(t => t.id === id ? { ...t, ...changes } : t);
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionSave("task_save", "task", next.find(t => t.id === id), "tasks"); return; }
  saveTasks(next);
};
const deleteTask = (id) => {
  const next = getTasks().filter(t => t.id !== id);
  if (REMOTE_MODE) { _cache.set("tasks", next); _remoteCollectionDelete("task_delete", id, "tasks"); return; }
  saveTasks(next);
};

const TASK_STATUSES = [
  { key: "todo", label: "To Do", col: C.faint },
  { key: "in-progress", label: "In Progress", col: C.txt2 },
  { key: "reassigned", label: "Reassigned", col: "#a8bdb2" },
  { key: "review", label: "Review Before Closing", col: C.clay },
  { key: "done", label: "Done", col: C.moss },
];
const taskStatusMeta = Object.fromEntries(TASK_STATUSES.map(s => [s.key, s]));
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
  assignedTo: "", dueDate: "", relatedSopId: "", projectId: "", subTasks: [], tagIds: [], recurrence: "none", links: [],
});

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
const PROJECT_STATUS_KEYS = ["upcoming", "in_progress", "approval", "done", "archived"];
function normalizeProjectStatus(status) {
  if (status === "active") return "in_progress";
  if (status === "on_hold") return "upcoming";
  if (PROJECT_STATUS_KEYS.includes(status)) return status;
  return "upcoming";
}
/** @returns {Project[]} */
const getProjects = () => (db.getSync("projects") || []).map(p => ({ ...p, status: normalizeProjectStatus(p.status) }));
/** @param {Project[]} p */
const saveProjects = (p) => db.setSync("projects", p);
/** @param {string} id @returns {Project|null} */
const getProject = (id) => getProjects().find(p => p.id === id) || null;
const addProject = (project) => {
  const full = { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), memberIds: [], status: "upcoming", ...project };
  const next = [...getProjects(), full];
  if (REMOTE_MODE) { _cache.set("projects", next); _remoteCollectionSave("project_save", "project", full, "projects"); return next; }
  saveProjects(next);
  return next;
};
const updateProject = (id, changes) => {
  const next = getProjects().map(p => p.id === id ? { ...p, ...changes, updatedAt: nowISO() } : p);
  if (REMOTE_MODE) { _cache.set("projects", next); _remoteCollectionSave("project_save", "project", next.find(p => p.id === id), "projects"); return; }
  saveProjects(next);
};
const deleteProject = (id) => {
  const next = getProjects().filter(p => p.id !== id);
  if (REMOTE_MODE) { _cache.set("projects", next); _remoteCollectionDelete("project_delete", id, "projects"); }
  else saveProjects(next);
  // Unlink rather than delete — a project's tasks survive as standalone tasks
  // (bulk cascade write, stays on the plain saveTasks path either way).
  saveTasks(getTasks().map(t => t.projectId === id ? { ...t, projectId: "" } : t));
};
const defProject = () => ({
  id: uid(), name: "", description: "", status: "upcoming", startDate: "", dueDate: "",
  leadId: "", memberIds: [], color: C.moss, createdAt: nowISO(), updatedAt: nowISO(),
});

const PROJECT_STATUSES = [
  { key: "upcoming", label: "Upcoming", col: C.faint },
  { key: "in_progress", label: "In Progress", col: C.txt2 },
  { key: "approval", label: "Approval", col: C.clay },
  { key: "done", label: "Done", col: C.moss },
  { key: "archived", label: "Archived", col: C.faint },
];
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
const getCampaigns = () => db.getSync("campaigns") || [];
/** @param {Campaign[]} c */
const saveCampaigns = (c) => db.setSync("campaigns", c);
/** @param {string} id @returns {Campaign|null} */
const getCampaign = (id) => getCampaigns().find(c => c.id === id) || null;
const addCampaign = (campaign) => {
  const full = { id: uid(), createdAt: nowISO(), ...campaign };
  const next = [...getCampaigns(), full];
  if (REMOTE_MODE) { _cache.set("campaigns", next); _remoteCollectionSave("campaign_save", "campaign", full, "campaigns"); return next; }
  saveCampaigns(next);
  return next;
};
const updateCampaign = (id, changes) => {
  const next = getCampaigns().map(c => c.id === id ? { ...c, ...changes } : c);
  if (REMOTE_MODE) { _cache.set("campaigns", next); _remoteCollectionSave("campaign_save", "campaign", next.find(c => c.id === id), "campaigns"); return; }
  saveCampaigns(next);
};
const deleteCampaign = (id) => {
  const next = getCampaigns().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("campaigns", next); _remoteCollectionDelete("campaign_delete", id, "campaigns"); }
  else saveCampaigns(next);
  // Unlink rather than delete — a campaign's content items survive uncampaigned
  // (bulk cascade write, stays on the plain saveContentItems path either way).
  saveContentItems(getContentItems().map(c => c.campaignId === id ? { ...c, campaignId: "" } : c));
};
const defCampaign = () => ({
  id: uid(), name: "", description: "", startDate: "", endDate: "",
  status: "planning", color: C.moss, assigneeIds: [], createdAt: nowISO(),
});

/* ─── CONTENT ITEM STORAGE ───────────────────────────────────────── */
/** @returns {ContentItem[]} */
const getContentItems = () => db.getSync("content") || [];
/** @param {ContentItem[]} c */
const saveContentItems = (c) => db.setSync("content", c);
/** @param {string} id @returns {ContentItem|null} */
const getContentItem = (id) => getContentItems().find(c => c.id === id) || null;
const addContentItem = (item) => {
  const full = { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), images: [], links: [], ...item };
  const next = [...getContentItems(), full];
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionSave("content_save", "item", full, "content"); return next; }
  saveContentItems(next);
  return next;
};
const updateContentItem = (id, changes) => {
  const next = getContentItems().map(c => c.id === id ? { ...c, ...changes, updatedAt: nowISO() } : c);
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionSave("content_save", "item", next.find(c => c.id === id), "content"); return; }
  saveContentItems(next);
};
const deleteContentItem = (id) => {
  const next = getContentItems().filter(c => c.id !== id);
  if (REMOTE_MODE) { _cache.set("content", next); _remoteCollectionDelete("content_delete", id, "content"); return; }
  saveContentItems(next);
};
const defContentItem = (channel = "gbp") => ({
  id: uid(), campaignId: "", channel, title: "", status: "idea", publishDate: "",
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

const EXPORT_KEYS = ["sops", "categories", "tasks", "acks", "projects", "campaigns", "content", "contacts", "instances", "playbook"];
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
  C, setTheme, getTheme, FONT_CAPS, FONT_BODY, CATEGORY_COLORS, LOGIN_BG, LOGIN_BG_DEEP,
  REMOTE_MODE, isRemoteMode, isRemoteWarm, remoteBootstrap, remoteLogin, remoteLoginOptions, remoteLogout, apiCall,
  db, uid, nowISO, fmtDate, fmtDateShort,
  getCurrentUser, setCurrentUser, clearCurrentUser,
  _gkRefs, confirmDelete, triggerSaved, inp, ROLE_LABELS, canEdit, isAdmin,
  seedIfEmpty,
  getCategories, saveCategories, addCategory, updateCategory, deleteCategory,
  getTags, saveTags, addTag, updateTag, deleteTag,
  getAlerts, saveAlerts, addAlert, deleteAlert,
  getTaskTemplates, saveTaskTemplates, addTaskTemplate, deleteTaskTemplate, taskFromTemplate, snapshotTaskForTemplate,
  getSOPs, saveSOPs, getSOP, addSOP, updateSOP, deleteSOP, duplicateSOP, defSOP, sopMatchesSearch, sopExcerpt,
  getAllHeadingTexts, getAllTypePrefixes, seedStandardSections, hasFillableBlocks, asListBlock, blockBg, taskFromSop, sopHasTaskRoles,
  isMagnet, parseMagnet, magnetFor, copyMagnet, openMagnet, getLinkSearchCandidates, sanitizeHtml, escapeHtml, mentionTokensToHtml, triggerToast,
  getPlaybookRevs, addPlaybookRev,
  getContacts, saveContacts, addContact, updateContact, deleteContact,
  getAllInstances, saveInstances, getInstances, addInstance, updateInstance, deleteInstance, getTodayInstance, todayLocalISO,
  newSubmission, stampEditLog, formColor,
  parseMentionText, getMentionCandidates, findBacklinks,
  getPlaybook, savePlaybook, seedPlaybookIfEmpty,
  getImageRepo, saveImageRepo, seedImageRepoIfEmpty, letterOf,
  getToolsPrompts, saveToolsPrompts,
  fetchOmnisendCampaigns, fetchOmnisendCampaignStats, getIcsSubscribeUrl,
  getRevisions, getRevision, restoreRevision,
  getAcks, saveAcks, ackSop, getAckFor, isAckStale,
  fileToCompressedDataURL, processAndStoreImage,
  getTasks, saveTasks, addTask, updateTask, deleteTask, TASK_STATUSES, TASK_BOARD_STATUSES, taskStatusMeta, TASK_PRIORITIES, taskPriorityMeta,
  TASK_TYPES, taskTypeMeta, taskType,
  RECURRENCE_OPTIONS, advanceDate, completeTaskWithRecurrence,
  toggleFavourite, duplicateTask, mergeTaskInto, convertTaskToProject, convertTaskToSubtask, emptyTaskShape,
  sortTasksForUser, dispatchTaskAction,
  isOverdue, isDueToday, isDueThisWeek,
  getProjects, saveProjects, getProject, addProject, updateProject, deleteProject, defProject,
  PROJECT_STATUSES, PROJECT_BOARD_STATUSES, projectStatusMeta, projectProgress, normalizeProjectStatus,
  getCampaigns, saveCampaigns, getCampaign, addCampaign, updateCampaign, deleteCampaign, defCampaign,
  CAMPAIGN_STATUSES, campaignStatusMeta,
  getContentItems, saveContentItems, getContentItem, addContentItem, updateContentItem, deleteContentItem, defContentItem,
  campaignChannelCounts, CONTENT_CHANNELS, contentChannelMeta, CONTENT_STATUSES, contentStatusMeta,
  GBP_CTA_TYPES, GBP_CATEGORIES,
  getUsers, saveUsers, addUser, updateUser, deleteUser, fetchUsersFull, refreshRoster, changeOwnPin,
  backupRun, backupList, backupDownloadUrl, backupRestore, exportAllData, importAllData,
  adminDeploy, fetchLastDeploy, releaseList, releaseRollback,
};
