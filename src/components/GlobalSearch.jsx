import React, { useState, useEffect, useRef } from 'react';
import { C, FONT_CAPS, globalSearch, navigateItem } from '../globals.js';
import { Icon } from './shared.jsx';

/* System-wide search (#55). A command-palette overlay opened with Cmd/Ctrl+K
   (or the sidebar Search button). Fans one query across every entity via
   globalSearch() and deep-links the chosen result through the app-wide
   navigateItem() surface. Keyboard: ↑/↓ to move, Enter to open, Esc to close.
   Mounted once in App next to the delivery toasts. */
function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  // Global hotkey: Cmd/Ctrl+K toggles the palette anywhere in the app.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setOpen(o => !o); }
      else if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Let a sidebar button (or anything) request the palette.
    const openEvt = () => setOpen(true);
    window.addEventListener("gk:open-search", openEvt);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("gk:open-search", openEvt); };
  }, [open]);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  useEffect(() => { setActive(0); }, [q]);

  if (!open) return null;

  const groups = globalSearch(q);
  const flat = groups.flatMap(g => g.items.map(it => ({ ...it, group: g.label })));
  const go = (item) => { navigateItem(item.kind, item.id); setOpen(false); };

  const onInputKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) go(flat[active]); }
  };

  let idx = -1; // running index across groups, to match `active`
  return (
    <div onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 800, padding: "10vh 20px 20px" }}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in"
        style={{ width: "100%", maxWidth: 620, maxHeight: "72vh", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, boxShadow: C.shadowMd, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1.5px solid ${C.bdr}` }}>
          <Icon name="search" size={20} style={{ color: C.mut }} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onInputKey}
            placeholder="Search everything — SOPs, tasks, projects, people, products…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: C.txt, fontFamily: "inherit" }} />
          <span style={{ fontSize: 11, color: C.faint, fontFamily: FONT_CAPS, border: `1px solid ${C.bdr}`, borderRadius: 6, padding: "2px 6px" }}>ESC</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {!q && <div style={{ padding: "24px 12px", fontSize: 13.5, color: C.faint, textAlign: "center" }}>Start typing to search across the whole hub.</div>}
          {q && flat.length === 0 && <div style={{ padding: "24px 12px", fontSize: 13.5, color: C.faint, textAlign: "center" }}>No matches for “{q}”.</div>}
          {groups.map(g => (
            <div key={g.label} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 4px", fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONT_CAPS }}>
                <Icon name={g.icon} size={14} style={{ color: C.faint }} />{g.label}
              </div>
              {g.items.map(it => {
                idx++;
                const isActive = idx === active;
                return (
                  <button key={it.kind + it.id} type="button" onClick={() => go(it)}
                    onMouseEnter={() => setActive(flat.findIndex(f => f.kind === it.kind && f.id === it.id))}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 11px", background: isActive ? C.mossSoft : "transparent", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: isActive ? C.moss : C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                    <span style={{ fontSize: 11.5, color: C.faint, flexShrink: 0 }}>{it.sub}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default GlobalSearch;
