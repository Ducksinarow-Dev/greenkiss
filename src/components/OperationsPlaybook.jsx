import React, { useState, useEffect, useRef } from 'react';
import {
  C, FONT_CAPS, uid, inp, canEdit, confirmDelete, triggerSaved,
  getPlaybook, savePlaybook, seedPlaybookIfEmpty,
  getContacts, addContact, updateContact, deleteContact,
  getPlaybookRevs, addPlaybookRev, getCurrentUser, fmtDate, nowISO, copyMagnet,
} from '../globals.js';
import { Icon, IconBtn, Btn, OBtn, EmptyState } from './shared.jsx';
import { BlocksEditor } from './SOPEditor.jsx';
import { ViewerBlock } from './SOPViewer.jsx';

/* Playbook change history (R3 #6) — same two-pane layout as the SOP
   HistoryPanel: versions (author + date) on the left, preview on the right,
   with "restore entire version" or a single page. Every restore snapshots
   the current state first, so restores are themselves undoable. */
function PlaybookHistoryModal({ onClose, onRestored }) {
  const revs = getPlaybookRevs();
  const [previewId, setPreviewId] = useState(revs[0]?.id || null);
  const preview = revs.find(r => r.id === previewId) || null;

  const restoreAll = async () => {
    const ok = await confirmDelete(`Restore the entire playbook from ${fmtDate(preview.savedAt)}? The current version is saved to history first, so nothing is lost.`);
    if (!ok) return;
    addPlaybookRev("before restore");
    savePlaybook(JSON.parse(JSON.stringify(preview.snapshot)));
    triggerSaved(); onRestored(); onClose();
  };
  const restoreSection = async (sec) => {
    const ok = await confirmDelete(`Restore the page "${sec.title || "Untitled"}" from ${fmtDate(preview.savedAt)}? Only that page is replaced; the current version is saved to history first.`);
    if (!ok) return;
    addPlaybookRev("before restore");
    const current = getPlaybook() || { sections: [] };
    const restored = JSON.parse(JSON.stringify(sec));
    const exists = (current.sections || []).some(s => s.id === restored.id);
    savePlaybook({
      ...current,
      sections: exists
        ? current.sections.map(s => s.id === restored.id ? restored : s)
        : [...(current.sections || []), restored], // page was deleted since — re-add it
    });
    triggerSaved(); onRestored(); onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 550, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 680, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: `1.5px solid ${C.bdr}` }}>
          <Icon name="history" size={20} style={{ color: C.moss, marginRight: 10 }} />
          <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Playbook History</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 210, flexShrink: 0, borderRight: `1.5px solid ${C.bdr}`, overflowY: "auto", padding: 8 }}>
            {revs.length === 0 && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>No versions yet — finishing an edit records one automatically.</div>}
            {revs.map(r => (
              <button key={r.id} onClick={() => setPreviewId(r.id)} style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 8, border: "none",
                background: previewId === r.id ? C.mossSoft : "transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: 2,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: previewId === r.id ? C.moss : C.txt }}>{fmtDate(r.savedAt)}</div>
                <div style={{ fontSize: 12, color: C.mut }}>{r.savedBy || "Unknown"}</div>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: 20, overflowY: "auto" }}>
            {!preview && <div style={{ fontSize: 14, color: C.mut }}>Pick a version on the left to preview it.</div>}
            {preview && (
              <div>
                <div style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 12 }}>
                  {fmtDate(preview.savedAt)} · {preview.savedBy || "Unknown"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                  {(preview.snapshot.sections || []).map(sec => (
                    <div key={sec.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: C.txt2 }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sec.title || "Untitled"} <span style={{ color: C.faint, fontSize: 12 }}>· {(sec.blocks || []).length} block{(sec.blocks || []).length === 1 ? "" : "s"}</span>
                      </span>
                      <button onClick={() => restoreSection(sec)}
                        style={{ background: "none", border: "none", color: C.moss, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, flexShrink: 0 }}>
                        Restore page
                      </button>
                    </div>
                  ))}
                </div>
                <Btn onClick={restoreAll}><Icon name="restore" size={16} />Restore entire version</Btn>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Key Contacts is a live view over the `contacts` collection (not one of
 * the editable Playbook sections) — names with contact info shown right
 * beside them, per the source doc's "Key Contacts" page. */
function KeyContactsPage({ user }) {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  const contacts = getContacts();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: "", role: "", email: "", phone: "" });
  const canManage = canEdit(user);

  const startAdd = () => { setDraft({ name: "", role: "", email: "", phone: "" }); setEditingId(null); setAdding(true); };
  const startEdit = (c) => { setDraft({ name: c.name || "", role: c.role || "", email: c.email || "", phone: c.phone || "" }); setEditingId(c.id); setAdding(true); };
  const save = () => {
    if (!draft.name.trim()) return;
    if (editingId) updateContact(editingId, draft); else addContact(draft);
    triggerSaved(); setAdding(false); bump();
  };
  const remove = async (id) => {
    const ok = await confirmDelete("Remove this contact?");
    if (!ok) return;
    deleteContact(id); triggerSaved(); bump();
  };

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 18px" }}>Key Contacts</h1>
      {contacts.length === 0 && !adding && (
        <EmptyState icon="badge" title="No contacts yet" sub="Add internal team members or vendor contacts."
          action={canManage && <Btn onClick={startAdd}><Icon name="add" size={16} />Add contact</Btn>} />
      )}
      {contacts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {contacts.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 140 }}>
                <div style={{ fontWeight: 700, color: C.txt, fontSize: 15 }}>{c.name}</div>
                {c.role && <div style={{ fontSize: 12, color: C.mut }}>{c.role}</div>}
              </div>
              <div style={{ flex: 1, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: C.txt2 }}>
                {c.email && <span>{c.email}</span>}
                {c.phone && <span>{c.phone}</span>}
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 4 }}>
                  <IconBtn icon="edit" title="Edit" onClick={() => startEdit(c)} />
                  <IconBtn icon="delete" danger title="Remove" onClick={() => remove(c.id)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage && (adding ? (
        <div style={{ padding: 16, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name" style={{ ...inp({ fontSize: 14 }) }} />
          <input value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })} placeholder="Role (optional)" style={{ ...inp({ fontSize: 14 }) }} />
          <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email (optional)" style={{ ...inp({ fontSize: 14 }) }} />
          <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone (optional)" style={{ ...inp({ fontSize: 14 }) }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <OBtn onClick={() => setAdding(false)}>Cancel</OBtn>
            <Btn onClick={save} disabled={!draft.name.trim()}>Save</Btn>
          </div>
        </div>
      ) : contacts.length > 0 && (
        <OBtn onClick={startAdd}><Icon name="add" size={16} />Add contact</OBtn>
      ))}
    </div>
  );
}

function SectionNavButton({ active, title, onClick, canManage, draggable, onDragStart, onDragOver, onDrop, isDragOver }) {
  return (
    <button onClick={onClick} draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "9px 12px", borderRadius: 8, border: "none",
        background: active ? C.mossSoft : (isDragOver ? C.s2 : "transparent"),
        color: active ? C.moss : C.txt2, fontWeight: active ? 700 : 500, fontSize: 13.5,
        cursor: canManage ? "grab" : "pointer", fontFamily: "inherit", marginBottom: 2,
      }}>{title}</button>
  );
}

/** Operations Playbook — standalone nav section, split into sub-pages per
 * the source doc's numbered sections (Phase 5). Each sub-page is 100%
 * editable using the exact same block system as SOPs (BlocksEditor), but
 * renders as a formatted document (ViewerBlock, no card chrome) rather
 * than the SOP library's card-and-chip look. */
function OperationsPlaybook({ user, focusSectionId, onClearFocus, onNavigateSop, onNavigateOut }) {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  useEffect(() => { if (seedPlaybookIfEmpty()) bump(); }, []);

  const playbook = getPlaybook() || { sections: [] };
  const sections = playbook.sections || [];
  const [activeId, setActiveId] = useState(null);
  const [showContacts, setShowContacts] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const dragIndex = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const canManage = canEdit(user);

  useEffect(() => {
    if (focusSectionId) { setActiveId(focusSectionId); setShowContacts(false); setEditMode(false); onClearFocus && onClearFocus(); }
  }, [focusSectionId, onClearFocus]);

  useEffect(() => {
    if (!activeId && !showContacts && sections.length) setActiveId(sections[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length]);

  const active = sections.find(s => s.id === activeId) || null;

  const updateSection = (id, changes) => {
    // Author attribution (R3 #6): every edit stamps who + when on the section.
    const stamp = { updatedBy: getCurrentUser()?.name || "", updatedAt: nowISO() };
    savePlaybook({ ...playbook, sections: sections.map(s => s.id === id ? { ...s, ...changes, ...stamp } : s) });
    triggerSaved(); bump();
  };
  const finishEditing = () => {
    // Leaving edit mode is the revision boundary — one history entry per
    // editing session, not per keystroke (deduped inside addPlaybookRev).
    addPlaybookRev();
    setEditMode(false);
  };
  const addSection = () => {
    const s = { id: uid(), title: "New Section", blocks: [], updatedBy: getCurrentUser()?.name || "", updatedAt: nowISO() };
    savePlaybook({ ...playbook, sections: [...sections, s] });
    setActiveId(s.id); setShowContacts(false); setEditMode(true); triggerSaved(); bump();
  };
  const deleteSection = async (id) => {
    const ok = await confirmDelete("Delete this section? It stays restorable from Playbook History.");
    if (!ok) return;
    addPlaybookRev("before delete"); // snapshot WITH the section, so it's restorable
    const next = sections.filter(s => s.id !== id);
    savePlaybook({ ...playbook, sections: next });
    if (activeId === id) setActiveId(next[0]?.id || null);
    triggerSaved(); bump();
  };
  const onDragStart = (e, idx) => { dragIndex.current = idx; e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === idx) { setDragOverIdx(null); return; }
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    savePlaybook({ ...playbook, sections: next });
    dragIndex.current = null; setDragOverIdx(null); triggerSaved(); bump();
  };

  // sop/form mentions leave the Playbook entirely (goToSop); a "playbook"
  // mention just switches the active sub-page in place.
  const onNavigate = (kind, id, blockId) => {
    if (kind === "playbook") { setActiveId(id); setShowContacts(false); setEditMode(false); return; }
    if (kind === "task") { onNavigateOut && onNavigateOut("task", id); return; }
    onNavigateSop && onNavigateSop(id, blockId);
  };
  // Magnet-link navigation surface for ItemLink/RichTextView inside sections.
  const nav = {
    goToSop: (id, blockId) => onNavigate("sop", id, blockId),
    goToTask: (id) => onNavigate("task", id),
    goToPlaybookSection: (id) => onNavigate("playbook", id),
  };

  return (
    <div className="gk-fade-in" style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
      <div style={{ width: 220, flexShrink: 0, position: "sticky", top: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: C.txt, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS, marginBottom: 16 }}>Playbook</div>
        <nav>
          <SectionNavButton title="Key Contacts" active={showContacts}
            onClick={() => { setShowContacts(true); setEditMode(false); }} />
          {sections.map((s, i) => (
            <SectionNavButton key={s.id} title={s.title || "Untitled"} active={!showContacts && activeId === s.id}
              onClick={() => { setActiveId(s.id); setShowContacts(false); setEditMode(false); }}
              canManage={canManage} draggable={canManage}
              onDragStart={e => onDragStart(e, i)} onDragOver={e => onDragOver(e, i)} onDrop={e => onDrop(e, i)}
              isDragOver={dragOverIdx === i} />
          ))}
        </nav>
        {canManage && (
          <button onClick={addSection} style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1.5px dashed ${C.bdr2}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: C.mut, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>
            <Icon name="add" size={14} />Add section
          </button>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        {showContacts ? (
          <KeyContactsPage user={user} />
        ) : !active ? (
          <EmptyState icon="menu_book" title="No sections yet" sub="Add the first section of your playbook."
            action={canManage && <Btn onClick={addSection}><Icon name="add" size={16} />Add section</Btn>} />
        ) : editMode ? (
          <div>
            <input value={active.title} onChange={e => updateSection(active.id, { title: e.target.value })}
              placeholder="Section title…"
              style={{ ...inp({ fontSize: 24, fontWeight: 800, padding: "6px 4px", border: "1.5px solid transparent", background: "transparent", marginBottom: 16 }) }}
              onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
              onBlur={e => e.target.style.border = "1.5px solid transparent"} />
            <BlocksEditor blocks={active.blocks || []} onChange={blocks => updateSection(active.id, { blocks })}
              docMagnet={{ kind: "playbook", id: active.id }}
              trailing={<Btn onClick={finishEditing}>Done</Btn>} />
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: 0, flex: 1 }}>{active.title || "Untitled"}</h1>
              <IconBtn icon="my_location" title="Copy magnet link to this page" onClick={() => copyMagnet("playbook", active.id)} />
              {canManage && <IconBtn icon="history" title="Playbook history" onClick={() => setShowHistory(true)} />}
              {canManage && <IconBtn icon="edit" title="Edit section" onClick={() => setEditMode(true)} />}
              {canManage && <IconBtn icon="delete" danger title="Delete section" onClick={() => deleteSection(active.id)} />}
            </div>
            {/* change-log attribution: who last touched this page, and when */}
            {active.updatedBy && (
              <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 16 }}>Edited by {active.updatedBy} · {fmtDate(active.updatedAt)}</div>
            )}
            {(active.blocks || []).length === 0 && <div style={{ color: C.mut, fontSize: 15 }}>This section has no content yet.</div>}
            {(active.blocks || []).map(b => <ViewerBlock key={b.id} block={b} onNavigate={onNavigate} nav={nav} hideFillHint />)}
          </div>
        )}
      </div>

      {showHistory && <PlaybookHistoryModal onClose={() => setShowHistory(false)} onRestored={() => { setActiveId(a => a); bump(); }} />}
    </div>
  );
}

export default OperationsPlaybook;
