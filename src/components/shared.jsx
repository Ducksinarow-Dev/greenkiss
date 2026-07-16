import React, { useState, useEffect } from 'react';
import { C, FONT_CAPS } from '../globals.js';

/* Design intent (interface-design skill):
   Who: shop staff + admins of The Green Kiss, often mid-shift, checking a
   procedure or updating a task between customers.
   Feel: the real Green Kiss retail identity — a minimalist natural-beauty
   counter. White marble, sage ceramic, black ink ingredient labels, one
   petal of pink for accent. Thin, airy, uppercase-tracked type, the way
   their own site treats nav and buttons — not a warm craft workroom.
   Palette: C.moss (sage — primary/active), C.sur/C.bg (white surfaces),
   C.txt (near-black ink), C.clay (pink — sparing highlight), C.red (rose —
   destructive/urgent only).
   Depth: borders-only, 1.5px, low-opacity — quiet, technical, matches a
   staff tool rather than a shadow-heavy consumer app.
   Typography: Jost, uppercase + letterspaced for buttons/nav/labels/
   headers (the signature carried over from their retail site); IBM Plex
   Mono stays for dates/short data.
   Signature: Pill reads as an ingredient-label tag — thin outline, no
   fill, uppercase letterspaced — rather than a solid filled badge. */

function Icon({ name, size = 18, style }) {
  return <span className="material-symbols-outlined" style={{ fontSize: size, lineHeight: 1, ...style }}>{name}</span>;
}

/** Shared uppercase-letterspaced label style for form fields. */
function lbl(ex = {}) {
  return {
    fontSize: 12, fontWeight: 600, color: C.txt2, display: "block", marginBottom: 7,
    textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT_CAPS, ...ex,
  };
}

/** Primary action button — solid sage green, uppercase letterspaced label. */
function Btn({ children, onClick, style, disabled, type = "button", title }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      style={{
        background: disabled ? C.faint : C.moss, color: "#fff", border: "none",
        borderRadius: 9, padding: "10px 20px", fontSize: 14, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.07em",
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: FONT_CAPS,
        display: "inline-flex", alignItems: "center", gap: 7,
        opacity: disabled ? 0.7 : 1, transition: "background .15s",
        ...(style || {}),
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = C.mossDeep; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = C.moss; }}
    >{children}</button>
  );
}

/** Secondary / outline button. */
function OBtn({ children, onClick, style, active, disabled, title, type = "button" }) {
  const [hov, setHov] = useState(false);
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: active ? C.mossSoft : (hov ? C.s2 : C.sur), color: active ? C.moss : C.txt,
        border: `1.5px solid ${active ? C.moss : C.bdr}`, borderRadius: 9,
        padding: "9px 18px", fontSize: 14, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: FONT_CAPS, fontWeight: active ? 600 : 500,
        textTransform: "uppercase", letterSpacing: "0.07em",
        display: "inline-flex", alignItems: "center", gap: 7,
        opacity: disabled ? 0.5 : 1, transition: "all .15s",
        ...(style || {}),
      }}
    >{children}</button>
  );
}

/** Quiet icon-only button (delete, edit, drag handle actions). */
function IconBtn({ icon, onClick, title, style, danger }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick} title={title}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? (danger ? C.red + "14" : C.s2) : "transparent",
        border: "none", borderRadius: 7, padding: 6, cursor: "pointer",
        color: danger ? C.red : (hov ? C.txt : C.mut), display: "flex",
        alignItems: "center", justifyContent: "center", transition: "all .15s",
        ...(style || {}),
      }}
    ><Icon name={icon} /></button>
  );
}

/** Signature tag: reads like an ingredient-label chip on skincare
 * packaging — thin outline, no fill, uppercase letterspaced — rather
 * than a solid filled badge. Used for categories, status, priority,
 * and role everywhere in the app. */
function Pill({ children, color, style }) {
  color = color || C.moss;
  return (
    <span style={{
      background: "transparent", color, borderRadius: 99, padding: "3px 11px",
      fontSize: 11, fontWeight: 600, border: `1px solid ${color}55`,
      textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS,
      whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4,
      ...(style || {}),
    }}>{children}</span>
  );
}

function Chk({ checked, onChange, label, size = 18 }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
      <div onClick={onChange} role="checkbox" aria-checked={checked} tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange && onChange(); } }}
        style={{
          width: size, height: size, borderRadius: 5, flexShrink: 0,
          border: `1.5px solid ${checked ? C.moss : C.bdr2}`, background: checked ? C.moss : C.sur,
          display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
        }}>
        {checked && <svg width={size - 6} height={size - 6} viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </div>
      {label && <span style={{ fontSize: 15, color: checked ? C.txt : C.txt2 }}>{label}</span>}
    </label>
  );
}

/** Section heading used at the top of each main view. */
function SectionHeader({ title, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
      <div>
        <div style={{ fontSize: 26, fontWeight: 600, color: C.txt, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS }}>{title}</div>
        {sub && <div style={{ fontSize: 14, color: C.mut, marginTop: 6 }}>{sub}</div>}
      </div>
      {right && <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{right}</div>}
    </div>
  );
}

function EmptyState({ icon, title, sub, action }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "64px 24px", textAlign: "center", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14,
    }}>
      <div style={{ width: 52, height: 52, borderRadius: 99, background: C.mossSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Icon name={icon} size={26} style={{ color: C.moss }} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 14, color: C.mut, maxWidth: 380, marginBottom: action ? 20 : 0 }}>{sub}</div>}
      {action}
    </div>
  );
}

/** Small colored initial-letter avatar for a user. */
function Avatar({ name, size = 26, color }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 99, background: color || C.moss,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      color: "#fff", fontWeight: 700, fontSize: size * 0.42,
    }}>{(name || "?").charAt(0).toUpperCase()}</div>
  );
}

/** Shared right-hand slide-over panel — used for the "Done" bucket on both
 * the Task Manager and Projects boards (#6/#14) so completed items stay
 * reachable without permanently occupying board width. Scrim click + ESC
 * both close it, matching the modal dismissal pattern used elsewhere. */
function SlideOver({ title, icon, onClose, children, width = 420 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 560 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,12,10,0.32)" }} />
      <div className="gk-slide-in" style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width, maxWidth: "92vw",
        background: C.sur, borderLeft: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 20px", borderBottom: `1.5px solid ${C.bdr}`, flexShrink: 0 }}>
          {icon && <Icon name={icon} size={19} style={{ color: C.moss }} />}
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, flex: 1, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS }}>{title}</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/** Small icon-only button matching the tile's four-icon metadata row —
 * always visible as an outline placeholder even when unset, filled/tinted
 * once a value is set. Shared by TaskCard's assignee/date/priority/tags
 * row and the hover pill (#8/#9). */
function MetaIconBtn({ icon, label, active, activeColor, onClick, children, title }) {
  const [hov, setHov] = useState(false);
  const color = active ? (activeColor || C.moss) : C.faint;
  return (
    <button type="button" onClick={onClick} title={title || label}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 5, height: 24, padding: children ? "0 8px 0 6px" : 0,
        width: children ? "auto" : 24, justifyContent: "center",
        borderRadius: 7, border: `1.5px solid ${active ? color + "55" : C.bdr}`,
        background: hov ? (active ? color + "16" : C.s2) : (active ? color + "0d" : "transparent"),
        color, cursor: "pointer", transition: "all .12s", flexShrink: 0,
      }}>
      <Icon name={icon} size={15} />
      {children && <span style={{ fontSize: 11, fontWeight: 600, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 84 }}>{children}</span>}
    </button>
  );
}

/** Generic anchored popover — click-outside + ESC to close, clamps itself
 * to stay on-screen near viewport edges. `anchorRect` is a DOMRect captured
 * at open time (getBoundingClientRect of the triggering icon button).
 * Shared by every #8 metadata popover (assignee/date/priority/tags) so
 * positioning/dismissal logic lives in exactly one place. */
function Popover({ anchorRect, onClose, children, width = 260 }) {
  const ref = React.useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("keydown", onKey);
    // Delay attaching the outside-click listener one tick so the same click
    // that opened the popover (via the anchor button) doesn't instantly close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); clearTimeout(t); };
  }, [onClose]);

  if (!anchorRect) return null;
  const margin = 10;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  if (left + width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - width - margin);
  const estHeight = 320; // clamp guess; popover content scrolls internally past this
  if (top + estHeight + margin > window.innerHeight) top = Math.max(margin, anchorRect.top - estHeight - 6);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 700 }} onClick={e => e.stopPropagation()}>
      <div ref={ref} className="gk-fade-in" style={{
        position: "fixed", left, top, width, maxWidth: "calc(100vw - 20px)", maxHeight: "70vh", overflowY: "auto",
        background: C.sur, border: `1.5px solid ${C.bdr2}`, borderRadius: 12, boxShadow: C.shadowMd,
        padding: 10, zIndex: 701,
      }}>{children}</div>
    </div>
  );
}

export { Icon, Btn, OBtn, IconBtn, Pill, Chk, SectionHeader, EmptyState, Avatar, lbl, SlideOver, MetaIconBtn, Popover };
