import React, { useState, useRef, useEffect } from 'react';
import {
  C, FONT_CAPS, uid, getCategories, addCategory, updateSOP, addSOP, deleteSOP, duplicateSOP, confirmDelete, triggerSaved,
  getCurrentUser, processAndStoreImage, CATEGORY_COLORS, inp, getAllHeadingTexts, getAllTypePrefixes,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, MentionField } from './shared.jsx';
import HistoryPanel from './HistoryPanel.jsx';

/* ─── Inline "+ New category" popover (#4) — editors no longer need to
   leave the SOP editor to add a category. Reuses the same swatch set and
   collision-safe addCategory() path Admin Panel's category manager uses;
   Admin Panel stays the place for rename/recolor/delete. */
function NewCategoryPopover({ onCreate, onClose }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 6px)", left: 0, background: C.sur, border: `1.5px solid ${C.bdr}`,
      borderRadius: 10, boxShadow: C.shadowMd, padding: 14, zIndex: 30, minWidth: 230,
    }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt2, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", marginBottom: 9 }}>New Category</div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Category name"
        onKeyDown={e => {
          if (e.key === "Enter" && name.trim()) { e.preventDefault(); onCreate(name.trim(), color); }
          if (e.key === "Escape") onClose();
        }}
        style={{ ...inp({ fontSize: 14, padding: "7px 10px", marginBottom: 10 }) }} />
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        {CATEGORY_COLORS.map(c => (
          <button key={c} type="button" onClick={() => setColor(c)}
            style={{ width: 22, height: 22, borderRadius: 99, background: c, cursor: "pointer", border: color === c ? `2px solid ${C.txt}` : "2px solid transparent" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <OBtn onClick={onClose} style={{ padding: "6px 12px", fontSize: 12 }}>Cancel</OBtn>
        <Btn onClick={() => name.trim() && onCreate(name.trim(), color)} disabled={!name.trim()} style={{ padding: "6px 14px", fontSize: 12 }}>Create</Btn>
      </div>
    </div>
  );
}

const BLOCK_DEFS = [
  { type: "heading", label: "Title & Description", icon: "title" },
  { type: "text", label: "Text", icon: "notes" },
  { type: "list", label: "List", icon: "format_list_bulleted" },
  { type: "checklist", label: "Checklist", icon: "checklist" },
  { type: "completion", label: "Completion", icon: "task_alt" },
  { type: "links", label: "Link Group", icon: "link" },
  { type: "image", label: "Image", icon: "image" },
];

const BLOCK_WIDTHS = [33, 40, 50, 60, 100];
/** Blocks saved before Phase 1 have no `width` — normalize to 100 on read. */
const blockWidth = (b) => b?.width || 100;

function newBlock(type) {
  if (type === "heading") return { id: uid(), type: "heading", text: "", description: "" };
  if (type === "text") return { id: uid(), type: "text", text: "" };
  if (type === "list") return { id: uid(), type: "list", style: "bulleted", withEntry: false, items: [] };
  if (type === "checklist") return { id: uid(), type: "checklist", title: "Checklist", items: [] };
  if (type === "completion") return { id: uid(), type: "completion" };
  if (type === "links") return { id: uid(), type: "links", title: "Links", links: [] };
  if (type === "image") return { id: uid(), type: "image", src: "", caption: "" };
  return null;
}

/* ─── Individual block editors ──────────────────────────────────── */

/* Title & Description — heading text auto-suggests previously-used
 * headlines from other SOPs/Forms via a native <datalist> (no library),
 * so naming converges without a hardcoded list. Description is optional
 * "info attached" under the title. */
function HeadingBlockEditor({ block, onChange }) {
  const listId = "gk-heading-suggestions";
  return (
    <div>
      <input value={block.text} onChange={e => onChange({ ...block, text: e.target.value })}
        placeholder="Section heading…" list={listId}
        style={{ ...inp({ fontSize: 19, fontWeight: 800, padding: "10px 12px", border: `1.5px solid transparent`, background: "transparent" }) }}
        onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
        onBlur={e => e.target.style.border = `1.5px solid transparent`}
      />
      <datalist id={listId}>
        {getAllHeadingTexts().map(t => <option key={t} value={t} />)}
      </datalist>
      <MentionField value={block.description || ""} onChange={description => onChange({ ...block, description })}
        placeholder="Description (optional)… type @ to link something"
        style={{ ...inp({ fontSize: 14, color: C.mut, padding: "6px 12px", border: `1.5px solid transparent`, background: "transparent" }) }}
        onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
        onBlur={e => e.target.style.border = `1.5px solid transparent`}
      />
    </div>
  );
}

function TextBlockEditor({ block, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = ref.current.scrollHeight + "px"; }
  }, [block.text]);
  return (
    <MentionField ref={ref} multiline value={block.text} onChange={text => onChange({ ...block, text })}
      placeholder="Write the procedure here. Line breaks are preserved. Type @ to link a SOP, form, contact, or playbook section."
      rows={3}
      style={{ ...inp({ fontSize: 15, lineHeight: 1.65, minHeight: 80 }) }}
    />
  );
}

/* Plain/bulleted/numbered list, optionally with a trailing "entry" blank per
 * line (e.g. "Orders waiting to ship: ___") — one flexible block covers
 * both "Plain list" and "Numbered/bulleted list with note or number entry". */
function ListBlockEditor({ block, onChange }) {
  const items = block.items || [];
  const setItems = (i) => onChange({ ...block, items: i });
  const [draft, setDraft] = useState("");
  const addItem = () => {
    if (!draft.trim()) return;
    setItems([...items, { id: uid(), text: draft.trim(), value: "" }]);
    setDraft("");
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: C.s2, borderRadius: 8, padding: 2, border: `1.5px solid ${C.bdr}` }}>
          {["bulleted", "numbered"].map(s => (
            <button key={s} type="button" onClick={() => onChange({ ...block, style: s })} style={{
              padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: (block.style || "bulleted") === s ? C.sur : "transparent",
              color: (block.style || "bulleted") === s ? C.txt : C.mut,
            }}>{s === "bulleted" ? "Bulleted" : "Numbered"}</button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.txt2, cursor: "pointer" }}>
          <input type="checkbox" checked={!!block.withEntry} onChange={e => onChange({ ...block, withEntry: e.target.checked })} />
          Show entry field at end of each line
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="drag_indicator" size={16} style={{ color: C.faint, cursor: "grab" }} />
            <span style={{ fontSize: 13, color: C.faint, width: 18, flexShrink: 0, textAlign: "right" }}>{block.style === "numbered" ? `${idx + 1}.` : "•"}</span>
            <MentionField value={it.text} onChange={text => setItems(items.map(x => x.id === it.id ? { ...x, text } : x))}
              placeholder="List item… (@ to link)" style={{ ...inp({ fontSize: 14, padding: "7px 10px", flex: 1 }) }} />
            {block.withEntry && (
              <input value={it.value || ""} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, value: e.target.value } : x))}
                placeholder="___" style={{ ...inp({ fontSize: 14, padding: "7px 10px", width: 90, flexShrink: 0 }) }} />
            )}
            <IconBtn icon="arrow_upward" title="Move up" onClick={() => { if (idx === 0) return; const n = [...items]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; setItems(n); }} />
            <IconBtn icon="arrow_downward" title="Move down" onClick={() => { if (idx === items.length - 1) return; const n = [...items]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; setItems(n); }} />
            <IconBtn icon="close" danger title="Remove item" onClick={() => setItems(items.filter(x => x.id !== it.id))} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a list item…"
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
          style={{ ...inp({ fontSize: 14, padding: "8px 10px" }) }} />
        <OBtn onClick={addItem} style={{ padding: "8px 14px", flexShrink: 0 }}><Icon name="add" size={15} />Add</OBtn>
      </div>
    </div>
  );
}

/* Completion block — fixed shape matching the source docs' "Completed By /
 * Date / Notes" footer. Nothing to configure at template-authoring time;
 * the real Completed-By/Date/Notes fields only exist inside a fill-out
 * Instance (Phase 2), so the editor just previews the fixed layout. */
function CompletionBlockEditor() {
  return (
    <div style={{ padding: "12px 4px", color: C.mut, fontSize: 13 }}>
      <div style={{ fontWeight: 700, color: C.txt2, marginBottom: 8 }}>Completion</div>
      <div>Completed By: <span style={{ color: C.faint }}>auto-filled from whoever submits</span></div>
      <div>Date: <span style={{ color: C.faint }}>auto-filled with today's date</span></div>
      <div>Notes: <span style={{ color: C.faint }}>freeform, filled in when submitted</span></div>
      <div style={{ marginTop: 8, fontSize: 12 }}>Filled out and locked when staff complete a daily run — see the SOP viewer.</div>
    </div>
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
          <label style={{ fontSize: 12, fontWeight: 600, color: C.moss, cursor: busy ? "default" : "pointer", padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.moss}55`, background: C.mossSoft, display: "flex", alignItems: "center", gap: 6, opacity: busy ? 0.7 : 1, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em" }}>
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

/* ─── Block wrapper: drag handle + type icon + width picker + delete ───
   Width picker (33/40/50/60/100%) sets flexBasis on this block's outer
   wrapper; the blocks list container is a flex-wrap row, so native CSS
   handles auto-placement/wrapping — no packing algorithm needed. */
function BlockRow({ block, index, onChange, onDelete, onDragStart, onDragOver, onDrop, isDragOver }) {
  const def = BLOCK_DEFS.find(d => d.type === block.type);
  const width = blockWidth(block);
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
        flex: `0 0 calc(${width}% - 12px)`, minWidth: 0, boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 6, cursor: "grab", flexShrink: 0 }} title="Drag to reorder">
        <Icon name="drag_indicator" size={18} style={{ color: C.faint }} />
        <Icon name={def?.icon || "notes"} size={15} style={{ color: C.mut }} />
        <select value={width} onChange={e => onChange({ ...block, width: Number(e.target.value) })}
          title="Block width" onMouseDown={e => e.stopPropagation()}
          style={{
            marginTop: 4, fontSize: 10, padding: "2px 1px", borderRadius: 5, border: `1.5px solid ${C.bdr}`,
            background: C.inset, color: C.mut, cursor: "pointer", fontFamily: "inherit", width: 40,
          }}>
          {BLOCK_WIDTHS.map(w => <option key={w} value={w}>{w}%</option>)}
        </select>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === "heading" && <HeadingBlockEditor block={block} onChange={onChange} />}
        {block.type === "text" && <TextBlockEditor block={block} onChange={onChange} />}
        {block.type === "list" && <ListBlockEditor block={block} onChange={onChange} />}
        {block.type === "checklist" && <ChecklistBlockEditor block={block} onChange={onChange} />}
        {block.type === "completion" && <CompletionBlockEditor block={block} onChange={onChange} />}
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

/* ─── Reusable block-list editor: drag reorder + add/delete, no title/
   category/status chrome — shared by SOPEditor and the Operations
   Playbook's per-section editor (Phase 5) so both ride the exact same
   block system instead of two copies of this logic. */
function BlocksEditor({ blocks, onChange, trailing }) {
  const dragIndex = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const updateBlock = (id, next) => onChange(blocks.map(b => b.id === id ? next : b));
  const deleteBlockAt = async (id) => {
    const ok = await confirmDelete("Delete this block? This can't be undone.");
    if (ok) onChange(blocks.filter(b => b.id !== id));
  };
  const addBlockType = (type) => { const b = newBlock(type); if (b) onChange([...blocks, b]); };

  const onDragStart = (e, idx) => { dragIndex.current = idx; e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === idx) { setDragOverIdx(null); return; }
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onChange(next);
    dragIndex.current = null;
    setDragOverIdx(null);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        {blocks.map((b, i) => (
          <BlockRow key={b.id} block={b} index={i}
            onChange={next => updateBlock(b.id, next)}
            onDelete={() => deleteBlockAt(b.id)}
            onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
            isDragOver={dragOverIdx === i}
          />
        ))}
        {blocks.length === 0 && (
          <div style={{ flex: "0 0 100%", padding: "36px 20px", textAlign: "center", color: C.mut, fontSize: 14, border: `1.5px dashed ${C.bdr}`, borderRadius: 12 }}>
            No content yet. Add your first block below.
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <AddBlockMenu onAdd={addBlockType} />
        {trailing}
      </div>
    </div>
  );
}

/* ─── Main editor ────────────────────────────────────────────────── */
function SOPEditor({ sop, isNew, onClose, onSaved, onDeleted }) {
  const categories = getCategories();
  const [title, setTitle] = useState(sop.title || "");
  const [categoryId, setCategoryId] = useState(sop.categoryId || "");
  const [status, setStatus] = useState(sop.status || "draft");
  const [code, setCode] = useState(sop.code || "");
  const [typePrefix, setTypePrefix] = useState(sop.typePrefix || "");
  const [blocks, setBlocks] = useState(sop.blocks || []);
  const [showHistory, setShowHistory] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const saveTimer = useRef(null);

  const persist = (nextBlocks, nextTitle, nextCat, nextStatus) => {
    const changes = {
      title: nextTitle ?? title, categoryId: nextCat ?? categoryId, status: nextStatus ?? status,
      blocks: nextBlocks ?? blocks, code, typePrefix, updatedBy: getCurrentUser()?.name || "",
    };
    if (isNew) { addSOP({ ...sop, ...changes }); }
    else { updateSOP(sop.id, changes); }
    triggerSaved();
  };
  // The unmount-cleanup effect below only runs once (mount) and once
  // (unmount) — its closure would otherwise forever call the MOUNT-time
  // `persist` (closing over the SOP's original pre-edit state), reverting
  // every session's edits on close. Routing through a ref that's updated
  // every render means the cleanup always calls the latest `persist`.
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Debounced autosave on any field change — never loses work on navigation.
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(), 500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, categoryId, status, blocks, code, typePrefix]);

  useEffect(() => () => { clearTimeout(saveTimer.current); persistRef.current(); }, []);

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
    duplicateSOP({ ...sop, title, categoryId, status, blocks, code, typePrefix });
    triggerSaved();
    handleClose();
  };
  const handleRestored = (restored) => {
    if (restored) {
      setTitle(restored.title || "");
      setCategoryId(restored.categoryId || "");
      setStatus(restored.status || "draft");
      setBlocks(restored.blocks || []);
      setCode(restored.code || "");
      setTypePrefix(restored.typePrefix || "");
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

      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <input value={typePrefix} onChange={e => setTypePrefix(e.target.value)} placeholder="Type (SOP, WI, CL…)" list="gk-type-prefixes"
          style={{ ...inp({ fontSize: 12, padding: "5px 9px", width: 130, fontFamily: "'IBM Plex Mono',monospace" }) }} />
        <datalist id="gk-type-prefixes">{getAllTypePrefixes().map(p => <option key={p} value={p} />)}</datalist>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (e.g. SOP-OPS-001)"
          style={{ ...inp({ fontSize: 12, padding: "5px 9px", width: 180, fontFamily: "'IBM Plex Mono',monospace" }) }} />
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="SOP title…"
        style={{ ...inp({ fontSize: 28, fontWeight: 800, padding: "8px 4px", border: "1.5px solid transparent", background: "transparent", marginBottom: 14 }) }}
        onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
        onBlur={e => e.target.style.border = "1.5px solid transparent"} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 26 }}>
        <div style={{ position: "relative" }}>
          <select value={categoryId}
            onChange={e => { if (e.target.value === "__new__") setShowNewCat(true); else setCategoryId(e.target.value); }}
            style={{ ...inp({ width: "auto", fontSize: 14, padding: "8px 12px" }) }}>
            <option value="">Uncategorized</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ New category…</option>
          </select>
          {showNewCat && (
            <NewCategoryPopover
              onClose={() => setShowNewCat(false)}
              onCreate={(name, color) => {
                const cat = addCategory(name, color);
                triggerSaved();
                setCategoryId(cat.id);
                setShowNewCat(false);
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}` }}>
          {["draft", "published"].map(s => (
            <button key={s} onClick={() => setStatus(s)} style={{
              padding: "6px 16px", borderRadius: 7, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em",
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

      <BlocksEditor blocks={blocks} onChange={setBlocks} trailing={<Btn onClick={handleClose}>Done</Btn>} />

      {showHistory && <HistoryPanel sopId={sop.id} onClose={() => setShowHistory(false)} onRestored={handleRestored} />}
    </div>
  );
}

export default SOPEditor;
export { BlocksEditor };
