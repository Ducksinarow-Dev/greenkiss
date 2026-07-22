import React, { useState, useEffect, useRef } from 'react';
import {
  C, FONT_CAPS, getCategories, addCategory, updateCategory, deleteCategory, confirmDelete, triggerSaved,
  getCurrentUser, CATEGORY_COLORS, ROLE_LABELS, inp,
  fetchUsersFull, addUser, updateUser, deleteUser,
  REMOTE_MODE, backupRun, backupList, backupDownloadUrl, backupRestore,
  exportAllData, importAllData, fmtDate, apiCall, adminDeploy, fetchLastDeploy,
  releaseList, releaseRollback,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, SectionHeader, Avatar, lbl } from './shared.jsx';

/* ─── USERS ──────────────────────────────────────────────────────── */
function UserRow({ u, isSelf, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(u.name);
  const [pin, setPin] = useState("");
  const [role, setRole] = useState(u.role || "viewer");

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: C.s2, borderRadius: 10, flexWrap: "wrap" }}>
        <input value={name} onChange={e => setName(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", flex: "1 1 140px" })} />
        <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="New PIN (optional)" style={inp({ fontSize: 14, padding: "7px 10px", width: 150, flex: "0 0 auto", fontFamily: "'IBM Plex Mono',monospace" })} />
        <select value={role} onChange={e => setRole(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", width: "auto", flex: "0 0 auto" })}>
          {Object.keys(ROLE_LABELS).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <IconBtn icon="check" title="Save" onClick={() => { onUpdate({ name: name.trim() || u.name, pin, role }); setEditing(false); }} style={{ color: C.moss }} />
        <IconBtn icon="close" title="Cancel" onClick={() => { setName(u.name); setPin(""); setRole(u.role || "viewer"); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10 }}
      onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <Avatar name={u.name} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{u.name}{isSelf && <span style={{ fontSize: 12, color: C.mut, fontWeight: 500 }}> (you)</span>}</div>
        <div style={{ fontSize: 12, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>
          {u.pin ? "PIN " + "•".repeat(String(u.pin).length || 4) : "PIN protected"}
        </div>
      </div>
      <Pill color={u.role === "admin" ? C.moss : u.role === "editor" ? C.txt2 : C.faint}>{ROLE_LABELS[u.role] || u.role}</Pill>
      <IconBtn icon="edit" title="Edit" onClick={() => setEditing(true)} />
      {!isSelf && <IconBtn icon="delete" danger title="Remove user" onClick={onDelete} />}
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const me = getCurrentUser();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("editor");

  const load = () => {
    setLoading(true); setError("");
    fetchUsersFull().then(setUsers).catch(e => setError(e.message || "Could not load users.")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim() || !pin.trim()) return;
    try {
      await addUser({ name: name.trim(), pin: pin.trim(), role });
      triggerSaved();
      setName(""); setPin(""); setRole("editor"); setAdding(false);
      load();
    } catch (e) { setError(e.message || "Could not create user."); }
  };

  const removeUser = async (u) => {
    const ok = await confirmDelete(`Remove ${u.name}? They won't be able to log in anymore.`);
    if (!ok) return;
    try { await deleteUser(u.id); triggerSaved(); load(); }
    catch (e) { setError(e.message || "Could not remove user."); }
  };

  const doUpdate = async (u, changes) => {
    try { await updateUser(u.id, changes); triggerSaved(); load(); }
    catch (e) { setError(e.message || "Could not update user."); }
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Users</div>
        <OBtn onClick={() => setAdding(a => !a)}><Icon name="person_add" size={16} />Add user</OBtn>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 8, padding: "12px 18px", background: C.bg, borderBottom: `1.5px solid ${C.bdr}`, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 140px" })} />
          <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" style={inp({ fontSize: 14, padding: "8px 11px", width: 100, flex: "0 0 auto", fontFamily: "'IBM Plex Mono',monospace" })} />
          <select value={role} onChange={e => setRole(e.target.value)} style={inp({ fontSize: 14, padding: "8px 11px", width: "auto", flex: "0 0 auto" })}>
            {Object.keys(ROLE_LABELS).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <Btn onClick={create} disabled={!name.trim() || !pin.trim()} style={{ padding: "8px 16px" }}>Create</Btn>
        </div>
      )}
      {error && <div style={{ padding: "10px 18px", fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {loading && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>Loading…</div>}
        {!loading && users.map(u => <UserRow key={u.id} u={u} isSelf={me?.id === u.id}
          onUpdate={c => doUpdate(u, c)}
          onDelete={() => removeUser(u)} />)}
        {!loading && users.length === 0 && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>No users.</div>}
      </div>
    </div>
  );
}

/* ─── CATEGORIES ─────────────────────────────────────────────────── */
function CategoryRow({ cat, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: C.s2, borderRadius: 10, flexWrap: "wrap" }}>
        <input value={name} onChange={e => setName(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", flex: "1 1 140px" })} />
        <div style={{ display: "flex", gap: 5 }}>
          {CATEGORY_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: 99, background: c, border: color === c ? `2px solid ${C.txt}` : "2px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
        <IconBtn icon="check" title="Save" onClick={() => { onUpdate({ name: name.trim() || cat.name, color }); setEditing(false); }} style={{ color: C.moss }} />
        <IconBtn icon="close" title="Cancel" onClick={() => { setName(cat.name); setColor(cat.color); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10 }}
      onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div style={{ width: 14, height: 14, borderRadius: 4, background: cat.color, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.txt }}>{cat.name}</div>
      <IconBtn icon="edit" title="Edit" onClick={() => setEditing(true)} />
      <IconBtn icon="delete" danger title="Delete category" onClick={onDelete} />
    </div>
  );
}

function CategoriesPanel({ bump }) {
  const categories = getCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);

  const create = () => {
    if (!name.trim()) return;
    addCategory(name.trim(), color);
    triggerSaved();
    setName(""); setColor(CATEGORY_COLORS[0]); setAdding(false); bump();
  };
  const removeCategory = async (cat) => {
    const ok = await confirmDelete(`Delete "${cat.name}"? Any SOPs in this category will become uncategorized — they won't be deleted.`);
    if (!ok) return;
    deleteCategory(cat.id); triggerSaved(); bump();
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Categories</div>
        <OBtn onClick={() => setAdding(a => !a)}><Icon name="add" size={16} />Add category</OBtn>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 10, padding: "12px 18px", background: C.bg, borderBottom: `1.5px solid ${C.bdr}`, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 160px" })} />
          <div style={{ display: "flex", gap: 5 }}>
            {CATEGORY_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 99, background: c, border: color === c ? `2px solid ${C.txt}` : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
          <Btn onClick={create} disabled={!name.trim()} style={{ padding: "8px 16px" }}>Create</Btn>
        </div>
      )}
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {categories.map(c => <CategoryRow key={c.id} cat={c}
          onUpdate={ch => { updateCategory(c.id, ch); triggerSaved(); bump(); }}
          onDelete={() => removeCategory(c)} />)}
        {categories.length === 0 && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>No categories.</div>}
      </div>
    </div>
  );
}

/* ─── BACKUPS (remote mode only — dev mode has no server to back up) ─ */
function RestoreConfirmModal({ file, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toUpperCase() === "RESTORE";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 700, padding: 20 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, padding: "30px 32px", maxWidth: 420, width: "90%",
        boxShadow: C.shadowMd, border: `1.5px solid ${C.red}55`,
      }}>
        <div style={{ marginBottom: 12 }}><Icon name="dangerous" size={34} style={{ color: C.red }} /></div>
        <div style={{ fontSize: 18, color: C.txt, fontWeight: 800, marginBottom: 8 }}>Restore this backup?</div>
        <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.6, marginBottom: 16 }}>
          This replaces <strong>everything</strong> currently in the database — SOPs, categories, tasks, users, and version history — with the contents of <code>{file}</code>. A safety snapshot of the current state is taken first, but this is otherwise irreversible from here. Everyone will be logged out.
        </div>
        <div style={lbl({ fontSize: 13 })}>Type RESTORE to confirm:</div>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="RESTORE"
          style={inp({ marginBottom: 20, textAlign: "center", fontWeight: 700, letterSpacing: 1 })} />
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <OBtn onClick={onCancel}>Cancel</OBtn>
          <Btn disabled={!ready || busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
            style={{ background: C.red }}>
            {busy ? "Restoring…" : "Restore & log everyone out"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function BackupsPanel() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [restoreTarget, setRestoreTarget] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    backupList().then(setBackups).catch(e => setError(e.message || "Could not load backups.")).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true); setError("");
    try { await backupRun(); triggerSaved(); load(); }
    catch (e) { setError(e.message || "Backup failed."); }
    finally { setRunning(false); }
  };

  const doRestore = async () => {
    try {
      await backupRestore(restoreTarget);
      setRestoreTarget(null);
      // The server clears all tokens on restore — bounce to login cleanly.
      window.location.reload();
    } catch (e) {
      setError(e.message || "Restore failed.");
    }
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Backups</div>
        <div style={{ fontSize: 12, color: C.faint, marginRight: 12 }}>Auto-backs up daily on write; kept 60 deep</div>
        <Btn onClick={runNow} disabled={running}><Icon name="backup" size={16} />{running ? "Backing up…" : "Back up now"}</Btn>
      </div>
      {error && <div style={{ padding: "10px 18px", fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {loading && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>Loading…</div>}
        {!loading && backups.length === 0 && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>No backups yet.</div>}
        {!loading && backups.map(b => (
          <div key={b.file} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10 }}
            onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <Icon name="folder_zip" size={18} style={{ color: C.faint }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{fmtDate(b.createdAt)}</div>
              <div style={{ fontSize: 12, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>{b.file} · {b.sizeMB} MB</div>
            </div>
            <a href={backupDownloadUrl(b.file)} target="_blank" rel="noreferrer" title="Download" style={{ display: "flex" }}>
              <IconBtn icon="download" title="Download" />
            </a>
            <IconBtn icon="settings_backup_restore" danger title="Restore this backup" onClick={() => setRestoreTarget(b.file)} />
          </div>
        ))}
      </div>
      {restoreTarget && (
        <RestoreConfirmModal file={restoreTarget} onCancel={() => setRestoreTarget(null)} onConfirm={doRestore} />
      )}
    </div>
  );
}

/* ─── EXPORT / IMPORT (works in both modes) ──────────────────────── */
function ExportImportPanel() {
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const doExport = () => {
    const data = exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `greenkiss-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file) => {
    if (!file) return;
    setError("");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That doesn't look like a valid export file.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const ok = await confirmDelete("Import this file? This replaces ALL current SOPs, categories, tasks, and read receipts. This can't be undone.");
    if (!ok) { if (fileRef.current) fileRef.current.value = ""; return; }
    setImporting(true);
    try {
      await importAllData(parsed);
      triggerSaved();
      window.location.reload();
    } catch (e) {
      setError(e.message || "Could not import this file.");
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Export / Import</div>
      </div>
      <div style={{ padding: 18, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <OBtn onClick={doExport}><Icon name="download" size={16} />Download full export</OBtn>
        <label style={{
          fontSize: 14, fontWeight: 600, color: C.moss, cursor: importing ? "default" : "pointer", padding: "9px 18px",
          borderRadius: 9, border: `1.5px solid ${C.moss}55`, background: C.mossSoft, display: "inline-flex",
          textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em",
          alignItems: "center", gap: 7, opacity: importing ? 0.6 : 1,
        }}>
          <Icon name="upload" size={16} />{importing ? "Importing…" : "Import JSON"}
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} disabled={importing}
            onChange={e => onFile(e.target.files?.[0])} />
        </label>
        <div style={{ fontSize: 13, color: C.faint }}>Belt-and-suspenders manual backup — works offline too.</div>
      </div>
      {error && <div style={{ padding: "0 18px 16px", fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

/* ─── SOFTWARE UPDATE (deploy button, remote mode only) ─────────────
   Deploy is otherwise entirely manual now (npm run release just publishes
   the release branch — see DEPLOY.md) precisely so an unreviewed deploy
   never lands mid-shift. This button is the only trigger. */
const GITHUB_RELEASE_COMMIT_URL = "https://api.github.com/repos/Ducksinarow-Dev/greenkiss/commits/release";

function DeployConfirmModal({ onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 700, padding: 20 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, padding: "30px 32px", maxWidth: 420, width: "90%",
        boxShadow: C.shadowMd, border: `1.5px solid ${C.bdr}`,
      }}>
        <div style={{ marginBottom: 12 }}><Icon name="rocket_launch" size={34} style={{ color: C.moss }} /></div>
        <div style={{ fontSize: 18, color: C.txt, fontWeight: 800, marginBottom: 8 }}>Deploy the latest release?</div>
        <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.6, marginBottom: 20 }}>
          This will deploy the latest release to the live site. Continue?
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <OBtn onClick={onCancel} disabled={busy}>Cancel</OBtn>
          <Btn disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
            {busy ? "Deploying…" : "Deploy now"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── PREVIOUS BUILDS / ROLLBACK (#13) ────────────────────────────────
   No git surgery — cPanel's deploy can only redeploy the checked-out
   branch HEAD, so this restores files from a local snapshot api.php takes
   before every deploy (see admin_deploy/snapshotCurrentBuild in api.php).
   Collapsed by default; loads lazily on first expand. */
function RollbackConfirmModal({ release, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 700, padding: 20 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, padding: "30px 32px", maxWidth: 420, width: "90%",
        boxShadow: C.shadowMd, border: `1.5px solid ${C.red}55`,
      }}>
        <div style={{ marginBottom: 12 }}><Icon name="settings_backup_restore" size={34} style={{ color: C.red }} /></div>
        <div style={{ fontSize: 18, color: C.txt, fontWeight: 800, marginBottom: 8 }}>Roll back to v{release.version}?</div>
        <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.6, marginBottom: 20 }}>
          This replaces the live build with v{release.version}{release.commit ? ` (${release.commit})` : ""}. Data is not affected — only the app's code reverts. The current build is snapshotted first, so this can be undone too.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <OBtn onClick={onCancel} disabled={busy}>Cancel</OBtn>
          <Btn disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }} style={{ background: C.red }}>
            {busy ? "Rolling back…" : "Roll back now"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function PreviousBuildsSection({ onRolledBack }) {
  const [open, setOpen] = useState(false);
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    releaseList().then(setReleases).catch(e => setError(e.message || "Could not load snapshots.")).finally(() => setLoading(false));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const doRollback = async () => {
    try {
      await releaseRollback(target.name);
      triggerSaved();
      setTarget(null);
      load();
      onRolledBack && onRolledBack();
    } catch (e) {
      setError(e.message || "Rollback failed.");
      setTarget(null);
    }
  };

  return (
    <div style={{ borderTop: `1.5px solid ${C.bdr}` }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 18px",
        background: "none", border: "none", cursor: "pointer", fontFamily: FONT_CAPS, fontSize: 13,
        fontWeight: 700, color: C.txt2, textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        <Icon name={open ? "expand_less" : "expand_more"} size={17} />
        Previous builds
      </button>
      {open && (
        <div style={{ padding: "0 18px 16px" }}>
          {loading && <div style={{ fontSize: 13, color: C.mut }}>Loading…</div>}
          {error && <div style={{ fontSize: 13, color: C.red, fontWeight: 600, marginBottom: 8 }}>{error}</div>}
          {!loading && releases.length === 0 && (
            <div style={{ fontSize: 13, color: C.faint }}>Snapshots appear after your next deploy.</div>
          )}
          {!loading && releases.map(r => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1.5px solid ${C.bdr}` }}>
              <div style={{ flex: 1, fontSize: 13, color: C.txt }}>
                v{r.version}{r.commit ? ` · ${r.commit}` : ""} · {fmtDate(r.snapshotAt)}
              </div>
              <OBtn onClick={() => setTarget(r)} style={{ padding: "5px 12px", fontSize: 12 }}>Roll back</OBtn>
            </div>
          ))}
        </div>
      )}
      {target && <RollbackConfirmModal release={target} onCancel={() => setTarget(null)} onConfirm={doRollback} />}
    </div>
  );
}

function DeployPanel() {
  const [versionInfo, setVersionInfo] = useState(null);
  const [lastDeploy, setLastDeploy] = useState(null);
  const [ghSha, setGhSha] = useState(null);
  const [ghMsg, setGhMsg] = useState("");
  const [ghError, setGhError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [finishing, setFinishing] = useState(false);
  // True while this panel is mounted — a page reload wipes everything, but if
  // the admin navigates away mid-poll we stop touching state.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = () => {
    setLoading(true);
    Promise.all([
      apiCall("version_info", { method: "GET" }).catch(() => null),
      fetchLastDeploy().catch(() => null),
    ]).then(([vi, ld]) => { setVersionInfo(vi); setLastDeploy(ld); }).finally(() => setLoading(false));
    // Public repo, no auth needed — plain fetch straight from the browser.
    fetch(GITHUB_RELEASE_COMMIT_URL)
      .then(r => { if (!r.ok) throw new Error("GitHub check failed (" + r.status + ")"); return r.json(); })
      .then(data => { setGhSha(data.sha || null); setGhMsg(data.commit?.message || ""); })
      .catch(e => setGhError(e.message || "Could not check GitHub for the latest release."));
  };
  useEffect(() => { load(); }, []);

  const deployedCommit = versionInfo?.commit || "";
  // The release branch's own SHA never equals the main-branch commit the
  // deployed build was stamped with — every release is a distinct commit on
  // the release branch. But release.sh writes the source commit into the
  // message ("Release v0.1.3 (54b6fa4 on main)"), so parse and compare that,
  // with the version number as a fallback signal.
  const ghSrcSha = (ghMsg.match(/\(([0-9a-f]{7,40}) on /) || [])[1] || null;
  const ghVersion = (ghMsg.match(/Release v([\d.]+)/) || [])[1] || null;
  const upToDate =
    !!(ghSrcSha && deployedCommit && (ghSrcSha.startsWith(deployedCommit) || deployedCommit.startsWith(ghSrcSha))) ||
    !!(ghVersion && versionInfo?.version && ghVersion === versionInfo.version);

  // cPanel copies the new build into public_html asynchronously — admin_deploy
  // returns before VERSION on disk actually flips. Poll it until it reports the
  // new build, then reload so the admin lands on the new bundle instead of the
  // stale one this session is still running. Bounded so a stuck/failed deploy
  // surfaces a manual-reload prompt rather than spinning forever.
  const pollUntilLive = (prevVersion, prevCommit, target) => {
    const started = Date.now();
    const TIMEOUT_MS = 120000;
    const giveUp = () => {
      if (!alive.current) return;
      setFinishing(false);
      setResult({ ok: true, message: "Update triggered, but the new build hasn't appeared yet. Give it a minute and reload the page; if it's still on the old version, use cPanel's Manage → Pull or Deploy." });
    };
    const tick = () => {
      if (!alive.current) return;
      apiCall("version_info", { method: "GET" }).then(vi => {
        const v = vi?.version || null, c = vi?.commit || "";
        const live = target
          ? v === target
          : (!!v && v !== prevVersion) || (!!c && c !== prevCommit);
        if (live) { window.location.reload(); return; }
        if (Date.now() - started > TIMEOUT_MS) return giveUp();
        setTimeout(tick, 3000);
      }).catch(() => {
        // api.php can briefly refuse mid-copy — keep trying until the timeout.
        if (Date.now() - started > TIMEOUT_MS) return giveUp();
        setTimeout(tick, 3000);
      });
    };
    setTimeout(tick, 3000); // give the first file copy a head start
  };

  const doDeploy = async () => {
    setResult(null);
    const prevVersion = versionInfo?.version || null;
    const prevCommit = versionInfo?.commit || "";
    const target = ghVersion; // the pending release version, if GitHub check succeeded
    try {
      const res = await adminDeploy();
      setConfirming(false);
      // Deploy succeeding while the pull silently failed just redeploys the
      // old commit — surface the per-step notes so that's visible, not silent.
      const pullNote = (res?.notes || []).find(n => n.toLowerCase().includes("pull") && n.toLowerCase().includes("fail"));
      if (pullNote) {
        setResult({ ok: true, message: "Deploy ran, but pulling the new release failed — the site may still be on the old version. " + pullNote });
        triggerSaved();
        load();
        return;
      }
      // Auto-reload once the new build is confirmed live.
      triggerSaved();
      setFinishing(true);
      pollUntilLive(prevVersion, prevCommit, target);
    } catch (e) {
      setResult({ ok: false, message: e.message || "Deploy failed." });
      setConfirming(false);
    }
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Software Update</div>
        <Btn onClick={() => setConfirming(true)} disabled={loading || finishing}><Icon name="rocket_launch" size={16} />Update Now</Btn>
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && <div style={{ fontSize: 14, color: C.mut }}>Checking…</div>}
        {!loading && (
          <>
            <div style={{ fontSize: 14, color: C.txt }}>
              Currently deployed: <strong>v{versionInfo?.version || "?"}</strong>
              {deployedCommit ? ` · ${deployedCommit}` : ""}
              {versionInfo?.date ? ` · ${versionInfo.date}` : ""}
            </div>
            {ghError && <div style={{ fontSize: 13, color: C.faint }}>{ghError}</div>}
            {!ghError && ghSha && (
              <div>
                <Pill color={upToDate ? C.moss : C.clay}>
                  {upToDate ? "Up to date" : `Update available (${ghVersion ? "v" + ghVersion : ghSha.slice(0, 7)} pending)`}
                </Pill>
              </div>
            )}
            {lastDeploy && (
              <div style={{ fontSize: 13, color: C.mut }}>
                {lastDeploy.rollback
                  ? `Rolled back to v${lastDeploy.version || "?"} by ${lastDeploy.deployedBy || "unknown"}, ${fmtDate(lastDeploy.deployedAt)}`
                  : `Last deployed: ${lastDeploy.version ? "v" + lastDeploy.version + " " : ""}by ${lastDeploy.deployedBy || "unknown"}, ${fmtDate(lastDeploy.deployedAt)}`}
              </div>
            )}
          </>
        )}
        {finishing && (
          <div style={{ fontSize: 13, fontWeight: 600, color: C.moss, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Icon name="progress_activity" size={16} style={{ animation: "gkspin 1s linear infinite" }} />
            Update in progress — this page will reload automatically once the new version is live.
            <button type="button" onClick={() => window.location.reload()}
              style={{ background: "none", border: "none", color: C.moss, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: 0 }}>
              Reload now
            </button>
          </div>
        )}
        {result && (
          <div style={{ fontSize: 13, fontWeight: 600, color: result.ok ? C.moss : C.red }}>
            {result.message}
            {!result.ok && (
              <div style={{ fontWeight: 400, color: C.mut, marginTop: 4 }}>
                cPanel's own Git Version Control page remains available as a manual fallback if this keeps failing.
              </div>
            )}
          </div>
        )}
      </div>
      <PreviousBuildsSection onRolledBack={load} />
      {confirming && <DeployConfirmModal onCancel={() => setConfirming(false)} onConfirm={doDeploy} />}
    </div>
  );
}

function AdminPanel() {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  return (
    <div className="gk-fade-in">
      <SectionHeader title="Admin Panel" sub="Manage users, categories, and backups" />
      {/* Two-up on desktop (#25). Order pairs Users|Software Update and
          Categories|Backups per the grid's row flow. */}
      <div className="gk-admin-grid">
        <UsersPanel />
        {REMOTE_MODE && <DeployPanel />}
        <CategoriesPanel bump={bump} />
        {REMOTE_MODE && <BackupsPanel />}
        <ExportImportPanel />
      </div>
    </div>
  );
}

export default AdminPanel;
