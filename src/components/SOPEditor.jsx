import React, { useState, useRef, useEffect } from 'react';
import {
  C, uid, getCategories, updateSOP, addSOP, deleteSOP, duplicateSOP, confirmDelete, triggerSaved,
  getCurrentUser, processAndStoreImage, inp,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon } from './shared.jsx';
import HistoryPanel from './HistoryPanel.jsx';

const BLOCK_DEFS = [
  { type: "heading", label: "Heading", icon: "title" },
  { type: "text", label: "Text", icon: "notes" },
  { type: "checklist", label: "Checklist", icon: "checklist" },
  { type: "links", label: "Link Group", icon: "link" },
  { type: "image", label: "Image", icon: "image" },
];

function newBlock(type) {
  if (type === "heading") return { id: uid(), type: "heading", text: "" };
  if (type === "text") return { id: uid(), type: "text", text: "" };
  if (type === "checklist") return { id: uid(), type: "checklist", title: "Checklist", items: [] };
  if (type === "links") return { id: uid(), type: "links", title: "Links", links: [] };
  if (type === "image") return { id: uid(), type: "image", src: "", caption: "" };
  return null;
}

/* ─── Individual block editors ──────────────────────────────────── */

function HeadingBlockEditor({ block, onChange }) {
  return (
    <input value={block.text} onChange={e => onChange({ ...block, text: e.target.value })}
      placeholder="Section heading…"
      style={{ ...inp({ fontSize: 19, fontWeight: 800, padding: "10px 12px", border: `1.5px solid transparent`, background: "transparent" }) }}
      onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
      onBlur={e => e.target.style.border = `1.5px solid transparent`}
    />
  );
}

function TextBlockEditor({ block, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; }
  }, [block.text]);
  return (
    <textarea ref={ref} value={block.text} onChange={e => onChange({ ...block, text: e.target.value })}
      placeholder="Write the procedure here. Line breaks are preserved."
      rows={3}
      style={{ ...inp({ fontSize: 15, lineHeight: 1.65, minHeight: 80 }) }}
    />
  );
}

function LinksBlockEditor({ block, onChange }) {
  const links = block.links || [];
  const setLinks = (l) => onChange({ ...block, links: l });
  return (
    <div>
      <input value={block.title ?? "Links"} onChange={e => onChange({ ...block, title: e.target.value })}
        placeholder="Group title"
        style={{ ...inp({ fontSize: 14, fontWeight: 700, padding: "7px 10px", marginBottom: 10, maxWidth: 260 }) }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {links.map((l) => (
          <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={l.label} onChange={e => setLinks(links.map(x => x.id === l.id ? { ...x, label: e.target.value } : x))}
              placeholder="Label" style={{ ...inp({ fontSize: 14, padding: "8px 10px", flex: "0 0 40%" }) }} />
            <input value={l.url} onChange={e => setLinks(links.map(x => x.id === l.id ? { ...x, url: e.target.value } : x))}
              placeholder="https://…" style={{ ...inp({ fontSize: 14, padding: "8px 10px", flex: 1 }) }} />
            <IconBtn icon="close" danger title="Remove link" onClick={() => setLinks(links.filter(x => x.id !== l.id))} />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setLinks([...links, { id: uid(), label: "", url: "" }])}
        style={{ marginTop: 10, background: "none", border: `1.5px dashed ${C.bdr2}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, color: C.mut, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="add" size={15} />Add link
      </button>
    </div>
  );
}

function ImageBlockEditor({ block, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const src = await processAndStoreImage(file);
      onChange({ ...block, src });
    } catch (e) {
      setErr(e.message || "Upload failed.");
    } finally { setBusy(false); }
  };
  return (
    <div>
      {block.src ? (
        <div style={{ position: "relative", marginBottom: 10 }}>
          <img src={block.src} alt="" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, border: `1.5px solid ${C.bdr}`, display: "block" }} />
          <button type="button" onClick={() => onChange({ ...block, src: "" })}
            style={{ position: "absolute", top: 8, right: 8, background: "rgba(10,12,10,0.6)", color: "#fff", border: "none", borderRadius: 7, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.moss, cursor: busy ? "default" : "pointer", padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.moss}55`, background: C.mossSoft, display: "flex", alignItems: "center", gap: 6, opacity: busy ? 0.7 : 1, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {busy ? <Icon name="progress_activity" size={16} style={{ animation: "gkspin 1s linear infinite" }} /> : <Icon name="upload" size={16} />}
            {busy ? "Uploading…" : "Upload image"}
            <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={e => onFile(e.target.files?.[0])} />
          </label>
          <span style={{ fontSize: 13, color: C.mut }}>or</span>
          <input placeholder="Paste an image URL"
            style={{ ...inp({ fontSize: 13, padding: "8px 10px", width: 240 }) }}
            onBlur={e => { if (e.target.value.trim()) onChange({ ...block, src: e.target.value.trim() }); }}
            onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) onChange({ ...block, src: e.target.value.trim() }); }} />
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}><Icon name="error" size={14} />{err}</div>}
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>Images are downscaled to 1400px on the long edge before saving.</div>
      <input value={block.caption} onChange={e => onChange({ ...block, caption: e.target.value })}
        placeholder="Caption (optional)" style={{ ...inp({ fontSize: 13, padding: "8px 10px" }) }} />
    </div>
  );
}

function ChecklistBlockEditor({ block, onChange }) {
  const items = block.items || [];
  const setItems = (i) => onChange({ ...block, items: i });
  const [draft, setDraft] = useState("");
  const addItem = () => {
    if (!draft.trim()) return;
    setItems([...items, { id: uid(), text: draft.trim() }]);
    setDraft("");
  };
  return (
    <div>
      <input value={block.title ?? "Checklist"} onChange={e => onChange({ ...block, title: e.target.value })}
        placeholder="Checklist title"
        style={{ ...inp({ fontSize: 14, fontWeight: 700, padding: "7px 10px", marginBottom: 10, maxWidth: 260 }) }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="drag_indicator" size={16} style={{ color: C.faint, cursor: "grab" }} />
            <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${C.bdr2}`, flexShrink: 0 }} />
            <input value={it.text} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, text: e.target.value } : x))}
              placeholder="Checklist item…" style={{ ...inp({ fontSize: 14, padding: "7px 10px", flex: 1 }) }} />
            <IconBtn icon="arrow_upward" title="Move up" onClick={() => { if (idx === 0) return; const n = [...items]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; setItems(n); }} />
            <IconBtn icon="arrow_downward" title="Move down" onClick={() => { if (idx === items.length - 1) return; const n = [...items]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; setItems(n); }} />
            <IconBtn icon="close" danger title="Remove item" onClick={() => setItems(items.filter(x => x.id !== it.id))} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a checklist item…"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          style={{ ...inp({ fontSize: 14, padding: "8px 10px" }) }} />
        <OBtn onClick={addItem} style={{ padding: "8px 14px", flexShrink: 0 }}><Icon name="add" size={15} />Add</OBtn>
      </div>
    </div>
  );
}

/* ─── Block wrapper: drag handle + type icon + delete ───────────── */
function BlockRow({ block, index, onChange, onDelete, onDragStart, onDragOver, onDrop, isDragOver }) {
  const def = BLOCK_DEFS.find(d => d.type === block.type);
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
      style={{
        display: "flex", gap: 10, alignItems: "flex-start", background: C.sur,
        border: `1.5px solid ${isDragOver ? C.moss : C.bdr}`, borderRadius: 12, padding: "14px 14px 14px 8px",
        boxShadow: isDragOver ? `0 0 0 2px ${C.mossSoft}` : "none", transition: "border-color .1s",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 6, cursor: "grab", flexShrink: 0 }} title="Drag to reorder">
        <Icon name="drag_indicator" size={18} style={{ color: C.faint }} />
        <Icon name={def?.icon || "notes"} size={15} style={{ color: C.mut }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === "heading" && <HeadingBlockEditor block={block} onChange={onChange} />}
        {block.type === "text" && <TextBlockEditor block={block} onChange={onChange} />}
        {block.type === "checklist" && <ChecklistBlockEditor block={block} onChange={onChange} />}
        {block.type === "links" && <LinksBlockEditor block={block} onChange={onChange} />}
        {block.type === "image" && <ImageBlockEditor block={block} onChange={onChange} />}
      </div>
      <IconBtn icon="delete" danger title="Delete block" onClick={onDelete} style={{ flexShrink: 0 }} />
    </div>
  );
}

/* ─── Add-block menu ─────────────────────────────────────────────── */
function AddBlockMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <OBtn onClick={() => setOpen(o => !o)}><Icon name="add" size={16} />Add block</OBtn>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, background: C.sur, border: `1.5px solid ${C.bdr}`,
          borderRadius: 10, boxShadow: C.shadowMd, padding: 6, zIndex: 20, minWidth: 180,
        }} onMouseLeave={() => setOpen(false)}>
          {BLOCK_DEFS.map(d => (
            <button key={d.type} onClick={() => { onAdd(d.type); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: C.txt, borderRadius: 7, textAlign: "left" }}
              onMouseEnter={e => e.currentTarget.style.background = C.s2}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <Icon name={d.icon} size={17} style={{ color: C.moss }} />{d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main editor ────────────────────────────────────────────────── */
function SOPEditor({ sop, isNew, onClose, onSaved, onDeleted }) {
  const categories = getCategories();
  const [title, setTitle] = useState(sop.title || "");
  const [categoryId, setCategoryId] = useState(sop.categoryId || "");
  const [status, setStatus] = useState(sop.status || "draft");
  const [blocks, setBlocks] = useState(sop.blocks || []);
  const dragIndex = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const saveTimer = useRef(null);

  const persist = (nextBlocks, nextTitle, nextCat, nextStatus) => {
    const changes = {
      title: nextTitle ?? title, categoryId: nextCat ?? categoryId, status: nextStatus ?? status,
      blocks: nextBlocks ?? blocks, updatedBy: getCurrentUser()?.name || "",
    };
    if (isNew) { addSOP({ ...sop, ...changes }); }
    else { updateSOP(sop.id, changes); }
    triggerSaved();
  };

  // Debounced autosave on any field change — never loses work on navigation.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(), 500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, categoryId, status, blocks]);

  useEffect(() => () => { clearTimeout(saveTimer.current); persist(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateBlock = (id, next) => setBlocks(bs => bs.map(b => b.id === id ? next : b));
  const deleteBlockAt = async (id) => {
    const ok = await confirmDelete("Delete this block? This can't be undone.");
    if (ok) setBlocks(bs => bs.filter(b => b.id !== id));
  };
  const addBlockType = (type) => { const b = newBlock(type); if (b) setBlocks(bs => [...bs, b]); };

  const onDragStart = (e, idx) => { dragIndex.current = idx; e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === idx) { setDragOverIdx(null); return; }
    setBlocks(bs => {
      const next = [...bs];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    dragIndex.current = null;
    setDragOverIdx(null);
  };

  const handleClose = () => { persist(); onClose(); onSaved && onSaved(); };
  const handleDelete = async () => {
    const ok = await confirmDelete(`Delete "${title || "this SOP"}"? This can't be undone.`);
    if (!ok) return;
    deleteSOP(sop.id);
    triggerSaved();
    onDeleted && onDeleted();
  };
  const handleDuplicate = () => {
    persist();
    duplicateSOP({ ...sop, title, categoryId, status, blocks });
    triggerSaved();
    handleClose();
  };
  const handleRestored = (restored) => {
    if (restored) {
      setTitle(restored.title || "");
      setCategoryId(restored.categoryId || "");
      setStatus(restored.status || "draft");
      setBlocks(restored.blocks || []);
    }
    setShowHistory(false);
  };

  return (
    <div className="gk-fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back" onClick={handleClose} />
        <div style={{ fontSize: 14, color: C.mut, fontWeight: 600 }}>{isNew ? "New SOP" : "Editing SOP"}</div>
        <div style={{ flex: 1 }} />
        {!isNew && <IconBtn icon="history" title="Version history" onClick={() => setShowHistory(true)} />}
        {!isNew && <IconBtn icon="content_copy" title="Duplicate SOP" onClick={handleDuplicate} />}
        {!isNew && <IconBtn icon="delete" danger title="Delete SOP" onClick={handleDelete} />}
      </div>

      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="SOP title…"
        style={{ ...inp({ fontSize: 28, fontWeight: 800, padding: "8px 4px", border: "1.5px solid transparent", background: "transparent", marginBottom: 14 }) }}
        onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
        onBlur={e => e.target.style.border = "1.5px solid transparent"} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 26 }}>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...inp({ width: "auto", fontSize: 14, padding: "8px 12px" }) }}>
          <option value="">Uncategorized</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}` }}>
          {["draft", "published"].map(s => (
            <button key={s} onClick={() => setStatus(s)} style={{
              padding: "6px 16px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
              background: status === s ? (s === "published" ? C.moss : C.sur) : "transparent",
              color: status === s ? (s === "published" ? "#fff" : C.txt) : C.mut,
            }}>{s}</button>
          ))}
        </div>
        {status === "archived" ? (
          <OBtn onClick={() => setStatus("draft")}><Icon name="unarchive" size={15} />Archived — restore to Draft</OBtn>
        ) : (
          <OBtn onClick={() => setStatus("archived")}><Icon name="archive" size={15} />Archive</OBtn>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        {blocks.map((b, i) => (
          <BlockRow key={b.id} block={b} index={i}
            onChange={next => updateBlock(b.id, next)}
            onDelete={() => deleteBlockAt(b.id)}
            onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            isDragOver={dragOverIdx === i}
          />
        ))}
        {blocks.length === 0 && (
          <div style={{ padding: "36px 20px", textAlign: "center", color: C.mut, fontSize: 14, border: `1.5px dashed ${C.bdr}`, borderRadius: 12 }}>
            No content yet. Add your first block below.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <AddBlockMenu onAdd={addBlockType} />
        <Btn onClick={handleClose}>Done</Btn>
      </div>

      {showHistory && <HistoryPanel sopId={sop.id} onClose={() => setShowHistory(false)} onRestored={handleRestored} />}
    </div>
  );
}

export default SOPEditor;
