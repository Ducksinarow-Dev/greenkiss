import React, { useRef, useState } from 'react';
import {
  C, FONT_CAPS, uid, inp, nowISO, addTask, getProjects, getUsers, triggerToast,
} from '../globals.js';
import { Icon, Btn, OBtn, Modal } from './shared.jsx';

/* ─── Zenkit → Task Manager importer (#64) ─────────────────────────────
   One-time bulk move of the shop's business lists out of Zenkit To Do and
   into the GK Task Manager. Zenkit exports a list as CSV; this parses that
   file into GK tasks, previews them, lets the user pick a target project +
   default assignee, then creates them one at a time through the normal
   collision-safe addTask() path (per-record task_save in REMOTE_MODE) — no
   bulk whole-collection write, same discipline as every other writer.

   No CDN library: a small quote-aware CSV parser lives here (Zenkit CSV is
   plain, comma-separated, double-quoted). Columns are matched by header name
   so we don't depend on Zenkit's exact column order, which varies by list. */

/* ─── CSV parsing ─────────────────────────────────────────────────── */

/** Quote-aware CSV → string[][]. Handles quoted fields with embedded commas,
 * escaped "" quotes, and both \r\n and \n row breaks. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  // flush trailing field/row (file may not end in a newline)
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // drop fully-blank rows (trailing newline artifacts)
  return rows.filter(r => r.some(c => (c || "").trim() !== ""));
}

/** Pick the first header whose name matches any of the given regexes, and
 * return its column index — or -1. Case-insensitive on trimmed headers. */
function findCol(headers, ...res) {
  for (const re of res) {
    const idx = headers.findIndex(h => re.test((h || "").trim()));
    if (idx !== -1) return idx;
  }
  return -1;
}

const TRUEY = /^(1|true|yes|y|done|complete[d]?|checked|✓|✔|x)$/i;

/** Best-effort date → local YYYY-MM-DD. Zenkit exports ISO or locale strings;
 * anything unparseable becomes "" so a bad date never blocks the import. */
function toISODate(raw) {
  const v = (raw || "").trim();
  if (!v) return "";
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Split a subtask/checklist cell into individual items. Zenkit joins them
 * with newlines; some exports use ";" or "|". Leading checkbox markers and
 * bullets are stripped, and a checked marker flags the subtask done. */
function splitSubtasks(raw) {
  const v = (raw || "").trim();
  if (!v) return [];
  return v.split(/\n|;|\|/).map(part => {
    let t = part.trim();
    if (!t) return null;
    const checked = /^(\[[xX✓✔]\]|☑|✅|✔|✓)/.test(t);
    t = t.replace(/^(\[[ xX✓✔]?\]|☐|☑|✅|✔|✓|▢|◻|[-*•])\s*/, "").trim();
    return t ? { text: t, done: checked } : null;
  }).filter(Boolean);
}

/** headers + data rows → parsed GK-shaped task drafts + the detected column
 * map (surfaced in the preview so the user can sanity-check the guess). */
function rowsToTasks(rows) {
  if (!rows.length) return { tasks: [], map: {}, headers: [] };
  const headers = rows[0];
  const map = {
    title: findCol(headers, /^(title|name|task|item|to.?do)$/i, /title|name|task|item/i),
    desc: findCol(headers, /^(description|notes?|details?)$/i, /descr|note|detail/i),
    due: findCol(headers, /^(due|due ?date|deadline|date)$/i, /due|deadline|date/i),
    done: findCol(headers, /^(done|completed?|status|checked|state)$/i, /done|complet|checked|status/i),
    subs: findCol(headers, /^(sub.?tasks?|check.?list|children)$/i, /sub.?task|check.?list|children/i),
    priority: findCol(headers, /^(priority|importance)$/i, /priorit|important/i),
  };
  // No recognizable title column → fall back to the first column.
  if (map.title === -1) map.title = 0;

  const at = (r, i) => (i >= 0 && i < r.length ? r[i] : "") || "";
  const priorityOf = (v) => {
    const t = (v || "").trim().toLowerCase();
    if (/urgent|critical|highest/.test(t)) return "urgent";
    if (/high/.test(t)) return "high";
    if (/low/.test(t)) return "low";
    return "medium";
  };

  const tasks = rows.slice(1).map(r => {
    const title = at(r, map.title).trim();
    if (!title) return null; // an item with no title isn't a task
    const done = TRUEY.test(at(r, map.done).trim());
    return {
      title,
      description: at(r, map.desc).trim(),
      dueDate: toISODate(at(r, map.due)),
      done,
      priority: map.priority !== -1 ? priorityOf(at(r, map.priority)) : "medium",
      subTasks: splitSubtasks(at(r, map.subs)),
    };
  }).filter(Boolean);

  return { tasks, map, headers };
}

/* ─── Preview + options modal ─────────────────────────────────────── */

function ColMapRow({ label, headers, idx }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ color: C.mut, width: 74, flexShrink: 0, fontFamily: FONT_CAPS, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10.5 }}>{label}</span>
      {idx === -1
        ? <span style={{ color: C.faint, fontStyle: "italic" }}>not found</span>
        : <span style={{ color: C.txt, fontWeight: 600, background: C.inset, border: `1px solid ${C.bdr}`, borderRadius: 6, padding: "1px 7px" }}>{(headers[idx] || "").trim() || `Column ${idx + 1}`}</span>}
    </div>
  );
}

function ImportModal({ parsed, fileName, user, onClose, onDone }) {
  const projects = getProjects();
  const users = getUsers();
  const { tasks, map, headers } = parsed;
  const [projectId, setProjectId] = useState("");
  const [assignedTo, setAssignedTo] = useState(user?.id || "");
  const [includeDone, setIncludeDone] = useState(true);
  const [busy, setBusy] = useState(false);

  const toImport = includeDone ? tasks : tasks.filter(t => !t.done);
  const doneCount = tasks.filter(t => t.done).length;
  const subTotal = toImport.reduce((n, t) => n + t.subTasks.length, 0);

  const runImport = () => {
    setBusy(true);
    // One collision-safe addTask per row — never a whole-collection write.
    toImport.forEach(t => {
      addTask({
        type: "task",
        title: t.title,
        description: t.description,
        status: t.done ? "done" : "todo",
        priority: t.priority,
        assignedTo,
        dueDate: t.dueDate,
        startDate: "",
        relatedSopId: "",
        projectId,
        subTasks: t.subTasks.map(s => ({ id: uid(), text: s.text, done: !!s.done, assigneeId: "", dueDate: "", priority: "medium" })),
        tagIds: [], links: [], recurrence: "none",
        importedFrom: "zenkit", createdAt: nowISO(),
      });
    });
    triggerToast(`Imported ${toImport.length} task${toImport.length === 1 ? "" : "s"} from Zenkit`);
    setBusy(false);
    onDone(toImport.length);
  };

  return (
    <Modal onClose={onClose} closeOnEsc cardStyle={{ maxWidth: 620, maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="move_to_inbox" size={20} style={{ color: C.moss }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>Import from Zenkit</div>
          <div style={{ fontSize: 12.5, color: C.mut }}>{fileName} · {tasks.length} item{tasks.length === 1 ? "" : "s"} found</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 4 }}><Icon name="close" size={20} /></button>
      </div>

      <div style={{ padding: "16px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Detected columns — so the user can catch a bad header guess */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", marginBottom: 7 }}>Detected columns</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 18px", background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 10, padding: "10px 12px" }}>
            <ColMapRow label="Title" headers={headers} idx={map.title} />
            <ColMapRow label="Notes" headers={headers} idx={map.desc} />
            <ColMapRow label="Due" headers={headers} idx={map.due} />
            <ColMapRow label="Done" headers={headers} idx={map.done} />
            <ColMapRow label="Subtasks" headers={headers} idx={map.subs} />
            <ColMapRow label="Priority" headers={headers} idx={map.priority} />
          </div>
        </div>

        {/* Where the imported tasks land */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Add to project</span>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inp({ fontSize: 14 })}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name || "Untitled project"}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Assign all to</span>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={inp({ fontSize: 14 })}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        </div>

        {doneCount > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.txt2, cursor: "pointer" }}>
            <input type="checkbox" checked={includeDone} onChange={e => setIncludeDone(e.target.checked)} />
            Include {doneCount} already-completed item{doneCount === 1 ? "" : "s"} (imported into Done)
          </label>
        )}

        {/* Preview of what will be created */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", marginBottom: 7 }}>
            Preview — {toImport.length} task{toImport.length === 1 ? "" : "s"}{subTotal > 0 ? `, ${subTotal} subtask${subTotal === 1 ? "" : "s"}` : ""}
          </div>
          <div style={{ border: `1.5px solid ${C.bdr}`, borderRadius: 10, overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
            {toImport.slice(0, 50).map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderTop: i ? `1px solid ${C.bdr}` : "none", background: t.done ? C.bg : C.sur }}>
                <Icon name={t.done ? "check_circle" : "radio_button_unchecked"} size={16} style={{ color: t.done ? C.moss : C.faint, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13.5, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                {t.subTasks.length > 0 && <span style={{ fontSize: 11, color: C.mut, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="checklist" size={13} />{t.subTasks.length}</span>}
                {t.dueDate && <span style={{ fontSize: 11, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>{t.dueDate}</span>}
              </div>
            ))}
            {toImport.length > 50 && <div style={{ padding: "7px 12px", fontSize: 12, color: C.mut, borderTop: `1px solid ${C.bdr}` }}>+ {toImport.length - 50} more…</div>}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 22px", borderTop: `1.5px solid ${C.bdr}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <OBtn onClick={onClose}>Cancel</OBtn>
        <Btn onClick={runImport} disabled={busy || toImport.length === 0}>
          <Icon name="move_to_inbox" size={16} />{busy ? "Importing…" : `Import ${toImport.length} task${toImport.length === 1 ? "" : "s"}`}
        </Btn>
      </div>
    </Modal>
  );
}

/* ─── Import button — editor/admin only, sits next to New Task ─────── */

function ImportZenkitButton({ user, onImported }) {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null); // {tasks, map, headers}
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");

  const onFile = async (file) => {
    if (!file) return;
    setErr("");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const result = rowsToTasks(rows);
      if (!result.tasks.length) throw new Error("No tasks found in that CSV — check it's a Zenkit list export.");
      setFileName(file.name);
      setParsed(result);
    } catch (e) {
      setErr(e.message || "Couldn't read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <label style={{
        fontSize: 14, fontWeight: 600, color: C.txt2, cursor: "pointer", padding: "9px 16px",
        borderRadius: 9, border: `1.5px solid ${C.bdr}`, background: C.sur, display: "inline-flex",
        textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em", alignItems: "center", gap: 7,
      }} title="Import a Zenkit To Do list (CSV export)">
        <Icon name="move_to_inbox" size={16} />Import
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
          onChange={e => onFile(e.target.files?.[0])} />
      </label>
      {err && (
        <span style={{ fontSize: 12, color: C.red, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 260 }}>
          <Icon name="error" size={14} />{err}
        </span>
      )}
      {parsed && (
        <ImportModal parsed={parsed} fileName={fileName} user={user}
          onClose={() => setParsed(null)}
          onDone={(n) => { setParsed(null); onImported && onImported(n); }} />
      )}
    </>
  );
}

export default ImportZenkitButton;
