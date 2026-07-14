/* ─── THE GREEN KISS — shared constants, tokens, and storage layer ───
   Mirrors the DuckTracks db.get/db.set write-through cache pattern so a real
   backend (PHP/MySQL or otherwise) can be dropped in later without touching
   any component code — every call here is already async-shaped. */

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
 * @typedef {{id:string,type:"heading",text:string}} HeadingBlock
 * @typedef {{id:string,type:"text",text:string}} TextBlock
 * @typedef {{id:string,type:"links",title?:string,links:LinkItem[]}} LinksBlock
 * @typedef {{id:string,type:"image",src:string,caption:string}} ImageBlock
 * @typedef {HeadingBlock|TextBlock|LinksBlock|ImageBlock} Block
 *
 * @typedef {Object} SOP
 * @property {string} id
 * @property {string} title
 * @property {string} categoryId
 * @property {"draft"|"published"} status
 * @property {Block[]} blocks
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} updatedBy
 *
 * @typedef {Object} SubTask
 * @property {string} id
 * @property {string} label
 * @property {boolean} done
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
 * @property {SubTask[]} subTasks
 * @property {string} createdAt
 * @property {number} [order]
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} pin
 * @property {"admin"|"editor"|"viewer"} role
 */

/* ─── COLOR TOKENS ───────────────────────────────────────────────────
   Domain: a botanical / apothecary workroom — kraft paper, pressed
   leaves, moss, clay plant tags, greenhouse glass. The accent is a
   refined moss green (desaturated, not neon); the neutral scale reads
   warm (kraft/parchment) rather than clinical blue-gray, since this is
   a plant-and-product craft business, not a SaaS dashboard.
   Elevation: base (bg) -> sur -> s2, each a whisper-quiet lightness
   step. Sidebar shares the canvas background (bordered, not boxed). */
const C_LIGHT = {
  bg: "#f6f4ee",      // parchment canvas
  sur: "#fffdf9",     // card surface, barely lighter than bg
  s2: "#efece2",      // raised-within-surface (dropdown, hover row)
  inset: "#eeece0",   // input backgrounds (receive content, sit lower)
  bdr: "rgba(63,52,38,0.14)",   // standard border, quiet
  bdr2: "rgba(63,52,38,0.28)",  // emphasis border
  bdrFocus: "#3f6b52",          // focus ring / max emphasis

  txt: "#2b271f",     // primary text (warm charcoal ink)
  txt2: "#5a5346",    // secondary text
  mut: "#847c6c",     // tertiary / metadata
  faint: "#a89f8c",   // muted / placeholder / disabled

  moss: "#3f6b52",       // brand accent — refined moss green
  mossDeep: "#2c4d3a",   // pressed/hover state of accent
  mossSoft: "rgba(63,107,82,0.12)",
  clay: "#b56a4a",       // secondary/warm accent — terracotta (warnings, sparingly)
  dew: "#e8efe6",        // pale mint highlight (selected rows, success tint)

  red: "#b3412f",
  orange: "#b5772f",
  green: "#3f6b52",
  blue: "#3d6478",

  shadowSm: "0 1px 2px rgba(43,39,31,0.06)",
  shadowMd: "0 6px 20px rgba(43,39,31,0.10)",
};
const C_DARK = {
  bg: "#1b1d18",
  sur: "#222420",
  s2: "#282a25",
  inset: "#26281f",
  bdr: "rgba(230,225,210,0.12)",
  bdr2: "rgba(230,225,210,0.24)",
  bdrFocus: "#6ea886",

  txt: "#ece8dd",
  txt2: "#c3bda9",
  mut: "#938c78",
  faint: "#6d6857",

  moss: "#6ea886",
  mossDeep: "#8fc2a3",
  mossSoft: "rgba(110,168,134,0.16)",
  clay: "#d18f6c",
  dew: "#25352a",

  red: "#d17b68",
  orange: "#d19a63",
  green: "#6ea886",
  blue: "#7ba3b8",

  shadowSm: "0 1px 2px rgba(0,0,0,0.25)",
  shadowMd: "0 10px 30px rgba(0,0,0,0.4)",
};
const C = Object.assign({}, C_LIGHT);
const setTheme = (theme) => {
  Object.assign(C, theme === "dark" ? C_DARK : C_LIGHT);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
  try { localStorage.setItem("gk_theme", theme); } catch {}
};
const getTheme = () => { try { return localStorage.getItem("gk_theme") || "light"; } catch { return "light"; } };
setTheme(getTheme());

/* ─── CATEGORY PALETTE (choices offered when creating a category) ──── */
const CATEGORY_COLORS = ["#3f6b52", "#b56a4a", "#5a7a9a", "#8a7a4a", "#7a5a8a", "#4a8a7a", "#a34f5c"];

/* ─── STORAGE (localStorage-backed, async-shaped) ───────────────────
   Same write-through cache shape as DuckTracks' db object: db.get/db.set
   return promises so a real backend can replace the localStorage guts
   later without any component-level changes. */
const _cache = new Map();
function _hydrate(key) {
  if (_cache.has(key)) return _cache.get(key);
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
    try { localStorage.setItem("gk_" + k, JSON.stringify(v)); } catch {}
  },
  /** Synchronous read for render-time use (localStorage is fast/local; keeps
   * components simple since v1 has no network latency to hide). */
  getSync: (k) => _hydrate(k),
  setSync: (k, v) => {
    _cache.set(k, v);
    try { localStorage.setItem("gk_" + k, JSON.stringify(v)); } catch {}
  },
};

/* ─── UTILS ──────────────────────────────────────────────────────── */
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

/* ─── USER SESSION (sessionStorage, mirrors DuckTracks) ─────────────── */
const getCurrentUser = () => { try { return JSON.parse(sessionStorage.getItem("gkCurrentUser") || "null"); } catch { return null; } };
const setCurrentUser = (u) => sessionStorage.setItem("gkCurrentUser", JSON.stringify(u));
const clearCurrentUser = () => sessionStorage.removeItem("gkCurrentUser");

/* ─── GLOBAL CROSS-COMPONENT REFS (confirm dialog / toast) ──────────── */
const _gkRefs = { confirmResolve: null, setConfirmState: null, showSavedToast: null };
/** Promise-based confirm — resolves true/false. ConfirmDialog.jsx renders the modal. */
function confirmDelete(msg) {
  return new Promise(resolve => {
    _gkRefs.confirmResolve = resolve;
    if (_gkRefs.setConfirmState) _gkRefs.setConfirmState({ open: true, msg });
    else resolve(false);
  });
}
function triggerSaved() { if (_gkRefs.showSavedToast) _gkRefs.showSavedToast(); }

/* ─── SHARED INPUT STYLE ─────────────────────────────────────────── */
const inp = (ex = {}) => ({
  background: C.inset, border: `1.5px solid ${C.bdr}`, color: C.txt,
  borderRadius: 8, padding: "10px 13px", fontSize: 15, outline: "none",
  fontFamily: "'Manrope',system-ui,sans-serif", width: "100%",
  transition: "border-color .15s", ...ex,
});

/* ─── ROLE HELPERS ───────────────────────────────────────────────────
   viewer  = read SOPs + view tasks only
   editor  = full SOP/task CRUD
   admin   = editor + manage users + manage categories */
const ROLE_LABELS = { admin: "Admin", editor: "Editor", viewer: "Viewer" };
const canEdit = (user) => user && (user.role === "admin" || user.role === "editor");
const isAdmin = (user) => user && user.role === "admin";

/* ─── SEED DATA ──────────────────────────────────────────────────────
   Runs once against empty storage so the UI demos well immediately. */
function seedIfEmpty() {
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
      { id: uid(), name: "Opening & Closing", color: "#3f6b52", createdAt: nowISO() },
      { id: uid(), name: "Product Handling", color: "#b56a4a", createdAt: nowISO() },
      { id: uid(), name: "Customer Service", color: "#5a7a9a", createdAt: nowISO() },
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
const addSOP = (sop) => {
  const next = [...getSOPs(), sop];
  saveSOPs(next);
  return sop;
};
const updateSOP = (id, changes) => {
  const next = getSOPs().map(s => s.id === id ? { ...s, ...changes, updatedAt: nowISO() } : s);
  saveSOPs(next);
};
const deleteSOP = (id) => saveSOPs(getSOPs().filter(s => s.id !== id));

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

/* ─── IMAGE UPLOAD HELPER ─────────────────────────────────────────
   Downscales to max 1400px on the long edge and re-encodes as JPEG
   (quality 0.82) so a handful of uploaded photos don't blow up
   localStorage's ~5-10MB quota. */
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
  { key: "in-progress", label: "In Progress", col: "#5a7a9a" },
  { key: "done", label: "Done", col: C.moss },
];
const taskStatusMeta = Object.fromEntries(TASK_STATUSES.map(s => [s.key, s]));

const TASK_PRIORITIES = [
  { key: "low", label: "Low", col: C.faint },
  { key: "medium", label: "Medium", col: "#5a7a9a" },
  { key: "high", label: "High", col: C.clay },
  { key: "urgent", label: "Urgent", col: C.red },
];
const taskPriorityMeta = Object.fromEntries(TASK_PRIORITIES.map(p => [p.key, p]));

/* ─── USER STORAGE ───────────────────────────────────────────────── */
/** @returns {User[]} */
const getUsers = () => db.getSync("users") || [];
/** @param {User[]} u */
const saveUsers = (u) => db.setSync("users", u);
const addUser = (user) => {
  const next = [...getUsers(), { id: uid(), ...user }];
  saveUsers(next);
  return next;
};
const updateUser = (id, changes) => {
  const next = getUsers().map(u => u.id === id ? { ...u, ...changes } : u);
  saveUsers(next);
};
const deleteUser = (id) => saveUsers(getUsers().filter(u => u.id !== id));

export {
  C, setTheme, getTheme, CATEGORY_COLORS,
  db, uid, nowISO, fmtDate, fmtDateShort,
  getCurrentUser, setCurrentUser, clearCurrentUser,
  _gkRefs, confirmDelete, triggerSaved, inp, ROLE_LABELS, canEdit, isAdmin,
  seedIfEmpty,
  getCategories, saveCategories, addCategory, updateCategory, deleteCategory,
  getSOPs, saveSOPs, getSOP, addSOP, updateSOP, deleteSOP, defSOP, sopMatchesSearch, sopExcerpt,
  fileToCompressedDataURL,
  getTasks, saveTasks, addTask, updateTask, deleteTask, TASK_STATUSES, taskStatusMeta, TASK_PRIORITIES, taskPriorityMeta,
  getUsers, saveUsers, addUser, updateUser, deleteUser,
};
