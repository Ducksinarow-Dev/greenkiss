import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, uid, inp, canEdit, confirmDelete, triggerSaved, triggerToast,
  getImageRepo, saveImageRepoBlock, deleteImageRepoBlock, seedImageRepoIfEmpty, letterOf,
} from '../globals.js';
import { Icon, IconBtn, Btn, OBtn, SectionHeader, EmptyState, ItemLink } from './shared.jsx';

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");

/* Per-brand login credentials (migrated from the live site) — some vendor
   portals are login-gated, so the brand's link is useless without these.
   Password is masked with a reveal toggle; both fields copy to clipboard. */
function CopyRow({ label, value, mono, secret }) {
  const [show, setShow] = useState(!secret);
  const copy = () => { try { navigator.clipboard.writeText(value); triggerToast("Copied"); } catch { /* clipboard blocked */ } };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS, width: 42, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, color: C.txt, fontFamily: mono ? "'IBM Plex Mono',monospace" : "inherit", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {show ? value : "•".repeat(Math.min(10, value.length || 6))}
      </span>
      {secret && <IconBtn icon={show ? "visibility_off" : "visibility"} title={show ? "Hide" : "Show"} onClick={() => setShow(s => !s)} />}
      <IconBtn icon="content_copy" title="Copy" onClick={copy} />
    </div>
  );
}
function LoginBox({ user, pass }) {
  return (
    <div style={{ marginTop: 6, background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: "8px 11px", display: "flex", flexDirection: "column", gap: 4, maxWidth: 380 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS, marginBottom: 2 }}>
        <Icon name="key" size={14} />Login
      </div>
      {user && <CopyRow label="User" value={user} />}
      {pass && <CopyRow label="Pass" value={pass} mono secret />}
    </div>
  );
}

/* Alphabetical vendor image-repository directory (recreates
   team.thegreenkiss.com). Standalone page, one kv doc. Blocks are brand
   "title" rows (name + external link) or free "text" notes, each grouped by
   its `letter` — A–Z, or 0–9 for brands starting with a digit. Floating
   0–9/A–Z menu filters to one group; a return icon restores the full
   scrollable list; a return-to-top button appears on scroll. Editing gives
   each block a page-specific letter dropdown. */
function ImageRepository({ user }) {
  const [, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  useEffect(() => { if (seedImageRepoIfEmpty()) bump(); }, []);

  const doc = getImageRepo() || { blocks: [] };
  const blocks = doc.blocks || [];
  const canManage = canEdit(user);

  const [editMode, setEditMode] = useState(false);
  const [active, setActive] = useState(null); // active letter filter, null = show all
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // One entry at a time, merged server-side — writing the whole doc meant two
  // staff editing this page silently overwrote each other's entries. Image
  // Repository is the section every staff member has by default, so it's the
  // most-shared editing surface in the app.
  const saveBlock = (block) => { saveImageRepoBlock(block); triggerSaved(); bump(); };
  const addBlock = (type) => saveBlock(type === "text"
    ? { id: uid(), type: "text", text: "", letter: "" }
    : { id: uid(), type: "title", text: "", url: "", letter: "" });
  const patch = (id, changes) => {
    const block = blocks.find(b => b.id === id);
    if (block) saveBlock({ ...block, ...changes });
  };
  const remove = async (id) => {
    const ok = await confirmDelete("Remove this entry?");
    if (ok) { deleteImageRepoBlock(id); triggerSaved(); bump(); }
  };

  // letter -> blocks (in doc order). Non-alphanumeric groups under "#".
  const byLetter = {};
  blocks.forEach(b => { const l = letterOf(b); (byLetter[l] = byLetter[l] || []).push(b); });
  const has = (l) => (byLetter[l] || []).length > 0;
  // A–Z always shows (empty letters read as gaps in the alphabet), but digits
  // only appear once a brand actually files under one — a permanent 0–9 row
  // would be ten dead chips for the one or two numeric names we ever have.
  const groups = [...DIGITS.filter(has), ...LETTERS];

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Image Repository"
        sub="Vendor image libraries, A–Z. Click a brand to open its repository."
        right={canManage && (
          <OBtn active={editMode} onClick={() => { setEditMode(e => !e); setActive(null); }}>
            <Icon name={editMode ? "done" : "edit"} size={16} />{editMode ? "Done" : "Edit"}
          </OBtn>
        )} />

      {editMode ? (
        <EditView blocks={blocks} onPatch={patch} onRemove={remove} onAdd={addBlock} onDone={() => { setEditMode(false); setActive(null); }} />
      ) : blocks.length === 0 ? (
        <EmptyState icon="perm_media" title="No repositories yet"
          sub="Add vendor image libraries so staff can find them by brand."
          action={canManage && <Btn onClick={() => setEditMode(true)}><Icon name="add" size={16} />Add entries</Btn>} />
      ) : (
        <>
          {/* Floating 0–9/A–Z menu — sticks to the top of the viewport on scroll */}
          <div style={{
            position: "sticky", top: 0, zIndex: 20, background: C.bg,
            borderBottom: `1.5px solid ${C.bdr}`, padding: "10px 0", marginBottom: 8,
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
          }}>
            <button onClick={() => setActive(null)} title="Show all brands"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30,
                borderRadius: 7, border: `1.5px solid ${active === null ? C.moss : C.bdr}`,
                background: active === null ? C.mossSoft : C.sur, color: active === null ? C.moss : C.mut,
                cursor: "pointer", marginRight: 4,
              }}>
              <Icon name="restart_alt" size={17} />
            </button>
            {groups.map(l => {
              const on = has(l), sel = active === l;
              return (
                <button key={l} onClick={() => setActive(l)} disabled={false}
                  style={{
                    width: 26, height: 30, borderRadius: 7, border: "none", cursor: "pointer",
                    background: sel ? C.moss : "transparent",
                    color: sel ? "#fff" : (on ? C.txt : C.faint),
                    fontFamily: FONT_CAPS, fontWeight: on ? 700 : 400, fontSize: 13.5,
                    opacity: on ? 1 : 0.5, transition: "all .12s",
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = C.s2; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}
                >{l}</button>
              );
            })}
          </div>

          <div style={{ maxWidth: 760 }}>
            {(active === null ? groups : [active]).map(l => (
              <LetterSection key={l} letter={l} items={byLetter[l] || []} />
            ))}
            {active === null && byLetter["#"] && byLetter["#"].length > 0 && (
              <LetterSection letter="#" items={byLetter["#"]} />
            )}
          </div>
        </>
      )}

      {showTop && !editMode && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} title="Return to top"
          style={{
            position: "fixed", bottom: 32, right: 48, width: 44, height: 44, borderRadius: 99,
            border: `1.5px solid ${C.bdr2}`, background: C.sur, color: C.moss, cursor: "pointer",
            boxShadow: C.shadowMd, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40,
          }}>
          <Icon name="arrow_upward" size={22} />
        </button>
      )}
    </div>
  );
}

/* One letter's block — anchored so letter clicks land here. Empty letters
   render a faded capital + note (per spec), so the A–Z reads complete. */
function LetterSection({ letter, items }) {
  return (
    <div id={"repo-" + letter} style={{ scrollMarginTop: 64, marginBottom: 26 }}>
      <div style={{
        fontSize: 22, fontWeight: 700, fontFamily: FONT_CAPS, letterSpacing: "0.04em",
        color: items.length ? C.moss : C.faint, borderBottom: `1.5px solid ${C.bdr}`,
        paddingBottom: 6, marginBottom: 12, opacity: items.length ? 1 : 0.6,
      }}>{letter}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13.5, color: C.faint, fontStyle: "italic" }}>Currently no brands under this letter.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(b => b.type === "text" ? (
            <div key={b.id} style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{b.text}</div>
          ) : (
            <div key={b.id} style={{ fontSize: 16 }}>
              {b.url
                ? <ItemLink url={b.url}>{b.text || b.url}</ItemLink>
                : <span style={{ color: C.txt, fontWeight: 600 }}>{b.text || "Untitled"}</span>}
              {b.note && <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 3 }}>{b.note}</div>}
              {(b.user || b.pass) && <LoginBox user={b.user} pass={b.pass} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Edit mode — flat, reorder-free list of block rows; each row has the
   page-specific letter dropdown (defaulting to the title's first letter via
   letterOf). Only title-with-link and text blocks, per spec. */
function EditView({ blocks, onPatch, onRemove, onAdd, onDone }) {
  // Which brands have their note / login editors revealed — transient UI
  // only, never persisted to the saved doc.
  const [noteOpen, setNoteOpen] = useState({});
  const [loginOpen, setLoginOpen] = useState({});
  const letterSelect = (b) => (
    <select value={letterOf(b)} onChange={e => onPatch(b.id, { letter: e.target.value })}
      title="Letter" style={inp({ width: 62, flex: "0 0 auto", fontSize: 13, padding: "8px 6px" })}>
      {LETTERS.map(l => <option key={l} value={l}>{l}</option>)}
      {/* Digits are always offered here — the filter bar hides the unused
          ones, so this dropdown is how a numeric group gets created. */}
      {DIGITS.map(d => <option key={d} value={d}>{d}</option>)}
      <option value="#">#</option>
    </select>
  );
  return (
    <div style={{ maxWidth: 760 }}>
      {/* Add controls float at the top and stick on scroll (#36) so they stay
          reachable while editing a long A–Z list. */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20, background: C.bg,
        borderBottom: `1.5px solid ${C.bdr}`, padding: "10px 0", marginBottom: 12,
        display: "flex", gap: 10, flexWrap: "wrap",
      }}>
        <OBtn onClick={() => onAdd("title")}><Icon name="add_link" size={16} />Add brand</OBtn>
        <OBtn onClick={() => onAdd("text")}><Icon name="add" size={16} />Add note</OBtn>
        {onDone && <Btn onClick={onDone} style={{ marginLeft: "auto" }}><Icon name="done" size={16} />Done</Btn>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map(b => (
          <div key={b.id} style={{
            display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap",
            background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 10, padding: "10px 12px",
          }}>
            {letterSelect(b)}
            <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6 }}>
              {b.type === "text" ? (
                <textarea value={b.text} onChange={e => onPatch(b.id, { text: e.target.value })}
                  placeholder="Note…" rows={2} style={inp({ fontSize: 14, lineHeight: 1.5 })} />
              ) : (
                <>
                  <input value={b.text} onChange={e => onPatch(b.id, { text: e.target.value })}
                    placeholder="Brand name" style={inp({ fontSize: 14, fontWeight: 600 })} />
                  <input value={b.url || ""} onChange={e => onPatch(b.id, { url: e.target.value })}
                    placeholder="https://… (image repository link)" style={inp({ fontSize: 13 })} />
                  {/* Optional note attached to this brand (#37) — shown once
                      added, or via the Add note link below. */}
                  {(b.note != null && b.note !== "") || noteOpen[b.id] ? (
                    <textarea value={b.note || ""} onChange={e => onPatch(b.id, { note: e.target.value })}
                      placeholder="Note for this brand…" rows={2} autoFocus={noteOpen[b.id] && !b.note}
                      style={inp({ fontSize: 13, lineHeight: 1.5 })} />
                  ) : (
                    <button onClick={() => setNoteOpen(o => ({ ...o, [b.id]: true }))}
                      style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: C.moss, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                      <Icon name="add_comment" size={15} />Add note
                    </button>
                  )}
                  {/* Optional per-brand login for portals that are login-gated. */}
                  {(b.user != null && b.user !== "") || (b.pass != null && b.pass !== "") || loginOpen[b.id] ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input value={b.user || ""} onChange={e => onPatch(b.id, { user: e.target.value })}
                        placeholder="Login user / email" style={inp({ fontSize: 13, flex: "1 1 160px" })} />
                      <input value={b.pass || ""} onChange={e => onPatch(b.id, { pass: e.target.value })}
                        placeholder="Password" style={inp({ fontSize: 13, flex: "1 1 120px", fontFamily: "'IBM Plex Mono',monospace" })} />
                    </div>
                  ) : (
                    <button onClick={() => setLoginOpen(o => ({ ...o, [b.id]: true }))}
                      style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: C.moss, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                      <Icon name="key" size={15} />Add login
                    </button>
                  )}
                </>
              )}
            </div>
            <IconBtn icon="delete" danger title="Remove" onClick={() => onRemove(b.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ImageRepository;
