import React, { useState, useEffect } from 'react';
import { C, FONT_CAPS, getTheme, setTheme, clearCurrentUser, isAdmin, changeOwnPin, triggerSaved, triggerToast, getIcsSubscribeUrl } from '../globals.js';
import { Icon, Avatar, Btn, OBtn, IconBtn, lbl } from './shared.jsx';
import gkLogo from '../assets/gk-logo.svg';

/* Nav order per Hayden (R4): Dashboard ‖ work sections ‖ documentation
   sections — `divider` entries render as thin separators. Admin is NOT in
   this list; it's pinned at the bottom of the sidebar for admins. */
const NAV_ITEMS = [
  { key: "dashboard", label: "My Dashboard", icon: "dashboard" },
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
      <form onSubmit={submit} onClick={e => e.stopPropagation()} data-1p-ignore data-lpignore="true" data-form-type="other" className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 360, padding: 26, display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>Change my PIN</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div>
          <label style={lbl()}>Current PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={current}
            onChange={e => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 8))} style={fieldStyle} />
        </div>
        <div>
          <label style={lbl()}>New PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={next}
            onChange={e => setNext(e.target.value.replace(/\D/g, "").slice(0, 8))} style={fieldStyle} />
        </div>
        <div>
          <label style={lbl()}>Confirm new PIN</label>
          <input type="password" inputMode="numeric" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={confirm}
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

function CalendarSyncModal({ onClose }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState("loading"); // loading | ready | unavailable
  useEffect(() => {
    let alive = true;
    getIcsSubscribeUrl()
      .then(u => { if (alive) { setUrl(u); setState(u ? "ready" : "unavailable"); } })
      .catch(() => { if (alive) setState("unavailable"); });
    return () => { alive = false; };
  }, []);
  const copy = () => {
    try { navigator.clipboard.writeText(url); triggerToast("Calendar link copied"); } catch {}
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 600, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 440, padding: 26, display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>Sync to Google Calendar</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        {state === "loading" && <div style={{ fontSize: 13, color: C.mut }}>Preparing your calendar link…</div>}
        {state === "unavailable" && (
          <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
            Calendar sync is only available on the live site (it needs the server to generate your feed). It won't work in local development.
          </div>
        )}
        {state === "ready" && (
          <>
            <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
              Content items assigned to you (or on a campaign you're on) show up in Google Calendar. Add this once:
              Google Calendar → <b>Other calendars</b> + → <b>From URL</b> → paste the link below.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={url} onFocus={e => e.target.select()}
                style={{ flex: 1, minWidth: 0, background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: "9px 11px", fontSize: 12, color: C.txt, outline: "none", fontFamily: "'IBM Plex Mono',monospace" }} />
              <Btn type="button" onClick={copy}><Icon name="content_copy" size={16} />Copy</Btn>
            </div>
            <div style={{ fontSize: 12, color: C.faint }}>Keep this link private — anyone with it can see your assigned content.</div>
          </>
        )}
      </div>
    </div>
  );
}

function NavButton({ it, active, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9,
        border: "none", cursor: "pointer", textAlign: "left", width: "100%",
        background: active ? C.mossSoft : "transparent",
        color: active ? C.moss : C.txt2, fontWeight: active ? 600 : 500, fontSize: 13,
        textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em",
        transition: "all .15s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.s2; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon name={it.icon} size={20} style={{ color: active ? C.moss : C.faint }} />
      {it.label}
    </button>
  );
}

function Sidebar({ section, setSection, user, onLogout, onToggleTheme }) {
  const [showPinModal, setShowPinModal] = useState(false);
  const [showCalSync, setShowCalSync] = useState(false);
  const theme = getTheme();

  return (
    <div style={{
      width: 232, flexShrink: 0, background: C.bg, borderRight: `1.5px solid ${C.bdr}`,
      display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0,
    }}>
      {/* Wordmark — real GK mark, recolored pure black via CSS filter (it
          can't be recolored by fill, the asset is a flattened raster). */}
      <div style={{ padding: "26px 20px 22px", display: "flex", alignItems: "center", gap: 11 }}>
        <img src={gkLogo} alt="" aria-hidden="true" style={
          theme === "dark"
            ? { width: 32, height: 32, flexShrink: 0, filter: "invert(1)", mixBlendMode: "screen" }
            : { width: 32, height: 32, flexShrink: 0, mixBlendMode: "multiply" }
        } />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, letterSpacing: "0.04em", lineHeight: 1.2, textTransform: "uppercase", fontFamily: FONT_CAPS }}>The Green Kiss</div>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: FONT_CAPS, marginTop: 2 }}>Ops</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV_ITEMS.map((it, i) => it.divider
          ? <div key={"div" + i} style={{ height: 1, background: C.bdr, margin: "7px 10px" }} />
          : <NavButton key={it.key} it={it} active={section === it.key} onClick={() => setSection(it.key)} />
        )}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Admin — pinned at the bottom, admins only (R4 nav order). */}
      {isAdmin(user) && (
        <div style={{ padding: "8px 12px", borderTop: `1.5px solid ${C.bdr}` }}>
          <NavButton it={{ key: "admin", label: "Admin Panel", icon: "tune" }} active={section === "admin"} onClick={() => setSection("admin")} />
        </div>
      )}

      {/* Current user + logout */}
      <div style={{ padding: 14, borderTop: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={user?.name} size={32} />
        <button onClick={() => setShowPinModal(true)} title="Change my PIN"
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: "inherit" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: C.mut, textTransform: "capitalize" }}>{user?.role}</div>
        </button>
        <button onClick={() => setShowCalSync(true)} title="Sync to Google Calendar"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 6, borderRadius: 7, display: "flex" }}
          onMouseEnter={e => e.currentTarget.style.background = C.s2}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <Icon name="event_available" size={19} />
        </button>
        <button onClick={onToggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 6, borderRadius: 7, display: "flex" }}
          onMouseEnter={e => e.currentTarget.style.background = C.s2}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={19} />
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
      {showCalSync && <CalendarSyncModal onClose={() => setShowCalSync(false)} />}
    </div>
  );
}

export default Sidebar;
