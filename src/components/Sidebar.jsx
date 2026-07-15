import React, { useState } from 'react';
import { C, getTheme, clearCurrentUser, isAdmin, changeOwnPin, triggerSaved } from '../globals.js';
import { Icon, Avatar, Btn, OBtn, IconBtn, lbl } from './shared.jsx';
import gkLogo from '../assets/gk-logo.svg';

const NAV_ITEMS = [
  { key: "dashboard", label: "My Dashboard", icon: "dashboard" },
  { key: "library", label: "SOP Library", icon: "menu_book" },
  { key: "tasks", label: "Task Manager", icon: "checklist" },
  { key: "projects", label: "Projects", icon: "folder_special" },
];

// Baked in at build time by vite.config.js's `define` (see scripts/release.sh).
// Dev server never defines these, hence the typeof guards.
const GK_VERSION = typeof __GK_VERSION__ !== "undefined" ? __GK_VERSION__ : "dev";
const GK_COMMIT = typeof __GK_COMMIT__ !== "undefined" ? __GK_COMMIT__ : "local";
const GK_BUILD_DATE = typeof __GK_BUILD_DATE__ !== "undefined" ? __GK_BUILD_DATE__ : "";

function ChangePinModal({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!next.trim()) { setError("Enter a new PIN."); return; }
    if (next !== confirm) { setError("New PIN doesn't match the confirmation."); return; }
    setBusy(true);
    try {
      await changeOwnPin(current, next);
      triggerSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Could not change PIN.");
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = {
    width: "100%", background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9,
    padding: "10px 12px", fontSize: 16, letterSpacing: 3, textAlign: "center",
    color: C.txt, outline: "none", fontFamily: "'IBM Plex Mono',monospace",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 20 }} onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 360, padding: 26, display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>Change my PIN</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div>
          <label style={lbl()}>Current PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" value={current}
            onChange={e => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 8))} style={fieldStyle} />
        </div>
        <div>
          <label style={lbl()}>New PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" value={next}
            onChange={e => setNext(e.target.value.replace(/\D/g, "").slice(0, 8))} style={fieldStyle} />
        </div>
        <div>
          <label style={lbl()}>Confirm new PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" value={confirm}
            onChange={e => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))} style={fieldStyle} />
        </div>
        {error && <div style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          <OBtn type="button" onClick={onClose}>Cancel</OBtn>
          <Btn type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Btn>
        </div>
      </form>
    </div>
  );
}

function Sidebar({ section, setSection, user, onLogout }) {
  const [showPinModal, setShowPinModal] = useState(false);
  const items = [...NAV_ITEMS];
  if (isAdmin(user)) items.push({ key: "admin", label: "Admin Panel", icon: "tune" });

  return (
    <div style={{
      width: 232, flexShrink: 0, background: C.bg, borderRight: `1.5px solid ${C.bdr}`,
      display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0,
    }}>
      {/* Wordmark — real GK mark, recolored pure black via CSS filter (it
          can't be recolored by fill, the asset is a flattened raster). */}
      <div style={{ padding: "26px 20px 22px", display: "flex", alignItems: "center", gap: 11 }}>
        <img src={gkLogo} alt="" aria-hidden="true" style={
          getTheme() === "dark"
            ? { width: 32, height: 32, flexShrink: 0, filter: "invert(1)", mixBlendMode: "screen" }
            : { width: 32, height: 32, flexShrink: 0, mixBlendMode: "multiply" }
        } />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, letterSpacing: "0.04em", lineHeight: 1.2, textTransform: "uppercase" }}>The Green Kiss</div>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>Ops</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map(it => {
          const active = section === it.key;
          return (
            <button key={it.key} onClick={() => setSection(it.key)}
              style={{
                display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9,
                border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                background: active ? C.mossSoft : "transparent",
                color: active ? C.moss : C.txt2, fontWeight: active ? 600 : 500, fontSize: 13,
                textTransform: "uppercase", letterSpacing: "0.08em",
                transition: "all .15s",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.s2; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon name={it.icon} size={20} style={{ color: active ? C.moss : C.faint }} />
              {it.label}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Current user + logout */}
      <div style={{ padding: 14, borderTop: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={user?.name} size={32} />
        <button onClick={() => setShowPinModal(true)} title="Change my PIN"
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: "inherit" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: C.mut, textTransform: "capitalize" }}>{user?.role}</div>
        </button>
        <button onClick={() => { clearCurrentUser(); onLogout(); }} title="Log out"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 6, borderRadius: 7, display: "flex" }}
          onMouseEnter={e => e.currentTarget.style.background = C.s2}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <Icon name="logout" size={19} />
        </button>
      </div>

      {/* Build info — see scripts/release.sh */}
      <div style={{ padding: "6px 14px 12px", fontSize: 10, color: C.faint, textAlign: "center", fontFamily: "'IBM Plex Mono',monospace" }}>
        Build v{GK_VERSION} · {GK_COMMIT}{GK_BUILD_DATE ? ` · ${GK_BUILD_DATE}` : ""}
      </div>

      {showPinModal && <ChangePinModal onClose={() => setShowPinModal(false)} />}
    </div>
  );
}

export default Sidebar;
