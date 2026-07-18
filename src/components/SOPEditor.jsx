import React, { useState, useRef, useEffect } from 'react';
import {
  C, FONT_CAPS, uid, getCategories, addCategory, updateSOP, addSOP, deleteSOP, duplicateSOP, confirmDelete, triggerSaved,
  getCurrentUser, processAndStoreImage, CATEGORY_COLORS, inp, getAllHeadingTexts, getAllTypePrefixes, asListBlock, blockBg,
  sanitizeHtml, escapeHtml, getMentionCandidates, copyMagnet,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, MentionField, Popover, LinkPopover } from './shared.jsx';
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
  { type: "index", label: "Index", icon: "toc" },
  { type: "heading", label: "Title & Description", icon: "title" },
  { type: "text", label: "Text", icon: "notes" },
  { type: "list", label: "List / Checklist", icon: "checklist" },
  { type: "divider", label: "Line Break", icon: "horizontal_rule" },
  { type: "completion", label: "Completion", icon: "task_alt" },
  { type: "links", label: "Link Group", icon: "link" },
  { type: "image", label: "Image", icon: "image" },
  // `checklist` is retired from the menu — legacy blocks still render (asListBlock).
];

const BLOCK_WIDTHS = [33, 40, 50, 60, 100];
/** Blocks saved before Phase 1 have no `width` — normalize to 100 on read. */
const blockWidth = (b) => b?.width || 100;

/* Per-block emphasis background (#7) — subtle brand tints, keyed so the value
   survives light/dark theme swaps (resolved against C at render time). */
const BLOCK_BGS = [
  { key: "", label: "None" },
  { key: "sage", label: "Sage" },
  { key: "clay", label: "Blush" },
  { key: "neutral", label: "Neutral" },
];

function newBlock(type) {
  if (type === "index") return { id: uid(), type: "index" };
  if (type === "heading") return { id: uid(), type: "heading", text: "", description: "" };
  if (type === "text") return { id: uid(), type: "text", text: "" };
  if (type === "list") return { id: uid(), type: "list", style: "bulleted", checkboxes: false, withEntry: false, items: [] };
  if (type === "divider") return { id: uid(), type: "divider" };
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

/* A text block whose lines all read as list items (bullets or "N.") can be
 * one-click converted to a list — the fix for "pasted bulleted content should
 * become a list." Detection + strip is a plain regex on the existing text. */
const LIST_LINE_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
function looksLikeList(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every(l => LIST_LINE_RE.test(l));
}
function textToListItems(text) {
  return (text || "").split("\n").map(l => l.trim()).filter(Boolean)
    .map(l => ({ id: uid(), text: l.replace(LIST_LINE_RE, ""), value: "", url: "" }));
}

/* WYSIWYG text block (R3 B3) — contentEditable + document.execCommand
 * (deprecated but universal, dependency-free). Stores BOTH fields on every
 * edit: `html` (sanitized formatting) and `text` (innerText) so search,
 * excerpts, and Run-SOP keep reading plain text unchanged. The DOM is only
 * written on mount/per-block — never re-controlled per keystroke — so the
 * caret is stable. */
function RichToolbarBtn({ icon, label, title, onClick, style }) {
  return (
    <button type="button" title={title} onMouseDown={e => e.preventDefault() /* keep the text selection */} onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", minWidth: 26, height: 26, padding: "0 5px",
        borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.sur, color: C.txt2, cursor: "pointer",
        fontFamily: "inherit", fontSize: 12, fontWeight: 700, ...style,
      }}>
      {icon ? <Icon name={icon} size={15} /> : label}
    </button>
  );
}

function TextBlockEditor({ block, onChange, onConvertToList }) {
  const ref = useRef(null);
  const savedRange = useRef(null);
  const [menu, setMenu] = useState(false);
  const [linkRect, setLinkRect] = useState(null);
  const [mentionRect, setMentionRect] = useState(null);
  const [mentionQuery, setMentionQuery] = useState("");

  // Write the DOM once per block — legacy plain-text blocks get escaped +
  // <br>'d on first edit and gain html from then on.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = block.html || escapeHtml(block.text || "").replace(/\n/g, "<br>");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    onChange({ ...block, html: sanitizeHtml(el.innerHTML), text: el.innerText.replace(/\n\n/g, "\n") });
  };
  const saveSel = () => { const s = window.getSelection(); if (s && s.rangeCount) savedRange.current = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => {
    ref.current?.focus();
    const r = savedRange.current;
    if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  };
  const exec = (cmd, val) => { restoreSel(); document.execCommand(cmd, false, val); sync(); };
  const selectionHtml = () => {
    const s = window.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) return "";
    const div = document.createElement("div");
    div.appendChild(s.getRangeAt(0).cloneContents());
    return div.innerHTML;
  };
  const extraBold = () => {
    restoreSel();
    const html = selectionHtml();
    if (!html) return;
    document.execCommand("insertHTML", false, `<span style="font-weight:800">${html}</span>`);
    sync();
  };
  const setLink = (url) => {
    restoreSel();
    if (!url) { document.execCommand("unlink"); sync(); return; }
    const s = window.getSelection();
    if (!s || s.isCollapsed) document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    else document.execCommand("createLink", false, url);
    sync();
  };
  const insertMention = (item) => {
    restoreSel();
    document.execCommand("insertText", false, `@[${item.label}](${item.kind}:${item.id}) `);
    sync();
    setMentionRect(null);
  };

  const canConvert = looksLikeList(block.text);
  const COLORS = [C.txt, C.moss, C.red, C.clay];

  return (
    <div>
      {/* Formatting toolbar — Bold / Extra bold / Size / Color / Link / @internal */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <RichToolbarBtn icon="format_bold" title="Bold" onClick={() => exec("bold")} />
        <RichToolbarBtn icon="format_italic" title="Italic" onClick={() => exec("italic")} />
        <RichToolbarBtn label="XB" title="Extra bold" onClick={extraBold} />
        <RichToolbarBtn label="S" title="Small text" onClick={() => exec("fontSize", 2)} style={{ fontSize: 10 }} />
        <RichToolbarBtn label="M" title="Normal text" onClick={() => exec("fontSize", 3)} />
        <RichToolbarBtn label="L" title="Large text" onClick={() => exec("fontSize", 5)} style={{ fontSize: 14 }} />
        {COLORS.map(col => (
          <RichToolbarBtn key={col} title="Text colour" onClick={() => exec("foreColor", col)}
            label=" " style={{ background: col, minWidth: 18, width: 18, height: 18, borderRadius: 9, border: `1.5px solid ${C.bdr2}` }} />
        ))}
        <RichToolbarBtn icon="link" title="Add link (web or magnet)" onClick={e => { saveSel(); setLinkRect(e.currentTarget.getBoundingClientRect()); }} />
        <RichToolbarBtn icon="alternate_email" title="Link an SOP, contact, or playbook page inline" onClick={e => { saveSel(); setMentionQuery(""); setMentionRect(e.currentTarget.getBoundingClientRect()); }} />
      </div>

      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={sync} onBlur={sync} onMouseUp={saveSel} onKeyUp={saveSel}
        data-placeholder="Write the procedure here…"
        style={{ ...inp({ fontSize: 15, lineHeight: 1.6, minHeight: 80 }), whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
      />

      {linkRect && (
        <LinkPopover anchorRect={linkRect} initial="" onSet={setLink} onClose={() => setLinkRect(null)} />
      )}
      {mentionRect && (
        <Popover anchorRect={mentionRect} onClose={() => setMentionRect(null)} width={260}>
          <input autoFocus value={mentionQuery} onChange={e => setMentionQuery(e.target.value)} placeholder="Search SOPs, contacts, playbook…"
            style={{ ...inp({ fontSize: 13, padding: "7px 9px", marginBottom: 8 }) }} />
          {getMentionCandidates(mentionQuery).map(r => (
            <button key={r.kind + r.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertMention(r)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "7px 9px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              onMouseEnter={e => e.currentTarget.style.background = C.s2}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 13.5, color: C.txt, fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: 11, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{r.sub}</span>
            </button>
          ))}
        </Popover>
      )}

      {canConvert && (
        <div style={{ position: "relative", marginTop: 6 }}>
          <button type="button" onClick={() => setMenu(m => !m)}
            style={{ background: "none", border: "none", color: C.moss, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="format_list_bulleted" size={14} />Convert to list<Icon name="expand_more" size={14} />
          </button>
          {menu && (
            <div style={{ position: "absolute", top: "100%", left: 0, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 9, boxShadow: C.shadowMd, padding: 5, zIndex: 20, minWidth: 150 }} onMouseLeave={() => setMenu(false)}>
              {[["bulleted", false, "Bulleted"], ["numbered", false, "Numbered"], ["bulleted", true, "Checklist"]].map(([style, checkboxes, label]) => (
                <button key={label} type="button"
                  onClick={() => { onConvertToList({ id: block.id, type: "list", style, checkboxes, withEntry: false, items: textToListItems(block.text), width: block.width, bg: block.bg, num: block.num, taskRole: block.taskRole }); setMenu(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.txt, borderRadius: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = C.s2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-item link editor — a clearly visible bordered "Link" button (moss
 * when a link is set) opening the shared web/internal LinkPopover. */
function ListItemLinkBtn({ url, onSet }) {
  const [rect, setRect] = useState(null);
  return (
    <>
      <button type="button" title={url ? "Edit link" : "Add a link (web or internal magnet)"}
        onClick={e => setRect(e.currentTarget.getBoundingClientRect())}
        style={{
          display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", borderRadius: 7, cursor: "pointer",
          border: `1.5px solid ${url ? C.moss : C.bdr2}`, background: url ? C.mossSoft : C.sur,
          color: url ? C.moss : C.txt2, fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, flexShrink: 0,
        }}>
        <Icon name="link" size={14} />{url ? "Linked" : "Link"}
      </button>
      {rect && <LinkPopover anchorRect={rect} initial={url || ""} onSet={onSet} onClose={() => setRect(null)} />}
    </>
  );
}

/* One flexible list block: bulleted/numbered, optional leading checkboxes
 * (folds in the old Checklist type), optional trailing entry blank per line
 * ("Orders waiting to ship: ___"), and an optional link per item. */
function ListBlockEditor({ block, onChange, onConvertToText }) {
  const items = block.items || [];
  const setItems = (i) => onChange({ ...block, items: i });
  const [draft, setDraft] = useState("");
  const addItem = () => {
    if (!draft.trim()) return;
    setItems([...items, { id: uid(), text: draft.trim(), value: "", url: "" }]);
    setDraft("");
  };
  const toggle = (k, label) => (
    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.txt2, cursor: "pointer", height: 24, whiteSpace: "nowrap" }}>
      <input type="checkbox" checked={!!block[k]} onChange={e => onChange({ ...block, [k]: e.target.checked })} style={{ margin: 0 }} />
      {label}
    </label>
  );
  const revertToText = () => {
    const text = items.map((it, i) => (block.style === "numbered" ? `${i + 1}. ` : block.style === "plain" ? "" : "• ") + (it.text || "")).join("\n");
    onConvertToText({ id: block.id, type: "text", text, width: block.width, bg: block.bg, num: block.num, taskRole: block.taskRole });
  };
  /* Header layout (R4 F3): LEFT container = style control over "Convert to
     text"; RIGHT container = the two toggles stacked — no more wrapping. */
  return (
    <div>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <div style={{ display: "flex", background: C.s2, borderRadius: 8, padding: 2, border: `1.5px solid ${C.bdr}`, height: 28, boxSizing: "border-box" }}>
            {[["plain", "Plain"], ["bulleted", "Bulleted"], ["numbered", "Numbered"]].map(([s, label]) => (
              <button key={s} type="button" onClick={() => onChange({ ...block, style: s })} style={{
                padding: "0 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: (block.style || "bulleted") === s ? C.sur : "transparent",
                color: (block.style || "bulleted") === s ? C.txt : C.mut,
              }}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={revertToText} title="Turn this list back into a plain text block"
            style={{ background: "none", border: "none", color: C.mut, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="notes" size={14} />Convert to text
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {toggle("checkboxes", "Add checkboxes to beginning of each line")}
          {toggle("withEntry", "Show entry field at end of each line")}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            <Icon name="drag_indicator" size={16} style={{ color: C.faint, cursor: "grab", flexShrink: 0 }} />
            {block.checkboxes
              ? <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${C.bdr2}`, flexShrink: 0 }} />
              : block.style === "plain"
                ? null
                : <span style={{ fontSize: 13, color: C.faint, width: 18, flexShrink: 0, textAlign: "right" }}>{block.style === "numbered" ? `${idx + 1}.` : "•"}</span>}
            <MentionField value={it.text} onChange={text => setItems(items.map(x => x.id === it.id ? { ...x, text } : x))}
              placeholder="List item… (@ to link)" style={{ ...inp({ fontSize: 14, padding: "7px 10px", flex: "1 1 140px", minWidth: 100, width: "auto" }) }} />
            {block.withEntry && (
              <input value={it.value || ""} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, value: e.target.value } : x))}
                placeholder="___" style={{ ...inp({ fontSize: 14, padding: "7px 10px", width: 80, flexShrink: 0 }) }} />
            )}
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
              <ListItemLinkBtn url={it.url} onSet={u => setItems(items.map(x => x.id === it.id ? { ...x, url: u } : x))} />
              <IconBtn icon="arrow_upward" title="Move up" onClick={() => { if (idx === 0) return; const n = [...items]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; setItems(n); }} />
              <IconBtn icon="arrow_downward" title="Move down" onClick={() => { if (idx === items.length - 1) return; const n = [...items]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; setItems(n); }} />
              <IconBtn icon="close" danger title="Remove item" onClick={() => setItems(items.filter(x => x.id !== it.id))} />
            </div>
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

/* Line-break block — a simple horizontal rule for visual separation. */
function DividerBlockEditor() {
  return <div style={{ padding: "14px 4px" }}><div style={{ height: 2, background: C.bdr2, borderRadius: 2 }} /></div>;
}

/* Completion block — fixed shape matching the source docs' "Completed By /
 * Date / Notes" footer. Nothing to configure at template-authoring time;
 * the real Completed-By/Date/Notes fields only exist inside a fill-out
 * Instance (Phase 2), so the editor just previews the fixed layout. */
function CompletionBlockEditor() {
  return (
    <div style={{ padding: "12px 4px", color: C.mut, fontSize: 13 }}>
      <div style={{ fontWeight: 700, color: C.txt2, marginBottom: 8 }}>Completion</div>
      <div>Completed By: <span style={{ color: C.faint }}>filled in when the doc is completed</span></div>
      <div>Date: <span style={{ color: C.faint }}>defaults to today</span></div>
      <div>Notes: <span style={{ color: C.faint }}>freeform</span></div>
      <div style={{ marginTop: 8, fontSize: 12 }}>A fillable footer for printed / one-off completion. For SOPs run regularly, use “Run SOP” in the viewer to push it to a dated Task instead.</div>
    </div>
  );
}

/* Index block — no config; it auto-builds a table of contents from the doc's
 * headings and any numbered block (see the viewer). */
function IndexBlockEditor() {
  return (
    <div style={{ padding: "12px 4px", color: C.mut, fontSize: 13 }}>
      <div style={{ fontWeight: 700, color: C.txt2, marginBottom: 4 }}>Index</div>
      <div style={{ fontSize: 12 }}>Auto-generated from headings and numbered blocks. Number any block (¹ field in its toolbar) to control the index.</div>
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

/* ─── Block wrapper: drag handle + type icon + number/width/bg + delete ───
   `draggable` is gated on `grab` state — only true while the drag HANDLE is
   held (onMouseDown) — because a permanently-draggable ancestor blocks mouse
   text-selection inside child inputs in Chromium (the "can't select, only
   arrow-key" bug). Reset on drag end / mouse up. */
function BlockRow({ block: raw, index, onChange, onDelete, onDragStart, onDragOver, onDrop, isDragOver, docMagnet, isForm }) {
  const block = asListBlock(raw); // legacy checklist → list, one edit path
  const def = BLOCK_DEFS.find(d => d.type === block.type) || { icon: "notes" };
  const width = blockWidth(block);
  const [grab, setGrab] = useState(false);
  return (
    <div
      draggable={grab}
      onDragStart={e => onDragStart(e, index)}
      onDragEnd={() => setGrab(false)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
      style={{
        display: "flex", gap: 10, alignItems: "flex-start", background: blockBg(block.bg) === "transparent" ? C.sur : blockBg(block.bg),
        border: `1.5px solid ${isDragOver ? C.moss : C.bdr}`, borderRadius: 12, padding: "14px 14px 14px 8px",
        boxShadow: isDragOver ? `0 0 0 2px ${C.mossSoft}` : "none", transition: "border-color .1s",
        flex: `0 0 calc(${width}% - 12px)`, minWidth: 0, boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 6, flexShrink: 0 }}>
        <span title="Drag to reorder" style={{ cursor: "grab", display: "flex" }}
          onMouseDown={() => setGrab(true)} onMouseUp={() => setGrab(false)}>
          <Icon name="drag_indicator" size={18} style={{ color: C.faint }} />
        </span>
        <Icon name={def.icon} size={15} style={{ color: C.mut }} />
        {/* number-at-will → feeds the index */}
        <input type="number" value={block.num ?? ""} title="Number (adds to index)" placeholder="#"
          onChange={e => onChange({ ...block, num: e.target.value === "" ? undefined : Number(e.target.value) })}
          style={{ marginTop: 2, width: 56, fontSize: 11, padding: "2px 3px", borderRadius: 5, border: `1.5px solid ${C.bdr}`, background: C.inset, color: C.mut, fontFamily: "inherit", textAlign: "center" }} />
        <select value={width} onChange={e => onChange({ ...block, width: Number(e.target.value) })}
          title="Block width"
          style={{ fontSize: 11, padding: "2px 1px", borderRadius: 5, border: `1.5px solid ${C.bdr}`, background: C.inset, color: C.mut, cursor: "pointer", fontFamily: "inherit", width: 56 }}>
          {BLOCK_WIDTHS.map(w => <option key={w} value={w}>{w}%</option>)}
        </select>
        <select value={block.bg || ""} onChange={e => onChange({ ...block, bg: e.target.value || undefined })}
          title="Background emphasis"
          style={{ fontSize: 11, padding: "2px 1px", borderRadius: 5, border: `1.5px solid ${C.bdr}`, background: C.inset, color: C.mut, cursor: "pointer", fontFamily: "inherit", width: 56 }}>
          {BLOCK_BGS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        {/* Run-SOP routing (R3 C): where this block goes when staff Run the SOP */}
        {!isForm && (block.type === "heading" || block.type === "text" || block.type === "list") && (
          <select value={block.taskRole || ""} onChange={e => onChange({ ...block, taskRole: e.target.value || undefined })}
            title="Task routing — what this block becomes when the SOP is run as a task"
            style={{ fontSize: 11, padding: "2px 1px", borderRadius: 5, border: `1.5px solid ${block.taskRole ? C.moss : C.bdr}`, background: block.taskRole ? C.mossSoft : C.inset, color: block.taskRole ? C.moss : C.mut, cursor: "pointer", fontFamily: "inherit", width: 56 }}>
            <option value="">Task</option>
            <option value="description">Desc</option>
            <option value="checklist">List</option>
          </select>
        )}
        {docMagnet && (
          <button type="button" title="Copy magnet link to this block (paste it in any link field)"
            onClick={() => copyMagnet(docMagnet.kind, docMagnet.id, block.id)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 20, borderRadius: 5, border: `1.5px solid ${C.bdr}`, background: C.inset, color: C.mut, cursor: "pointer" }}>
            <Icon name="my_location" size={13} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {block.type === "index" && <IndexBlockEditor />}
        {block.type === "heading" && <HeadingBlockEditor block={block} onChange={onChange} />}
        {block.type === "text" && <TextBlockEditor block={block} onChange={onChange} onConvertToList={onChange} />}
        {block.type === "list" && <ListBlockEditor block={block} onChange={onChange} onConvertToText={onChange} />}
        {block.type === "divider" && <DividerBlockEditor />}
        {block.type === "completion" && <CompletionBlockEditor block={block} onChange={onChange} />}
        {block.type === "links" && <LinksBlockEditor block={block} onChange={onChange} />}
        {block.type === "image" && <ImageBlockEditor block={block} onChange={onChange} />}
      </div>
      <IconBtn icon="delete" danger title="Delete block" onClick={onDelete} style={{ flexShrink: 0 }} />
    </div>
  );
}

/* ─── Add-block menu ─────────────────────────────────────────────── */
function AddBlockMenu({ onAdd, openUp, isForm }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <OBtn onClick={() => setOpen(o => !o)}><Icon name="add" size={16} />Add block</OBtn>
      {open && (
        <div style={{
          position: "absolute", left: 0, background: C.sur, border: `1.5px solid ${C.bdr}`,
          ...(openUp ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
          borderRadius: 10, boxShadow: C.shadowMd, padding: 6, zIndex: 20, minWidth: 180,
        }} onMouseLeave={() => setOpen(false)}>
          {BLOCK_DEFS.filter(d => !(isForm && d.type === "index")).map(d => (
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
function BlocksEditor({ blocks, onChange, trailing, docMagnet, isForm }) {
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
            isDragOver={dragOverIdx === i} docMagnet={docMagnet} isForm={isForm}
          />
        ))}
        {blocks.length === 0 && (
          <div style={{ flex: "0 0 100%", padding: "36px 20px", textAlign: "center", color: C.mut, fontSize: 14, border: `1.5px dashed ${C.bdr}`, borderRadius: 12 }}>
            No content yet. Add your first block below.
          </div>
        )}
      </div>
      {/* Floating action bar — Add Block + Done stay in reach without
          scrolling to the bottom of a long SOP (#3). */}
      <div style={{
        position: "sticky", bottom: 14, display: "flex", gap: 10, alignItems: "center",
        background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12, padding: "10px 12px",
        boxShadow: C.shadowMd, width: "fit-content",
      }}>
        <AddBlockMenu onAdd={addBlockType} openUp isForm={isForm} />
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
  const isForm = sop.kind === "form";
  const docWord = isForm ? "Form" : "SOP";

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
    const ok = await confirmDelete(`Delete "${title || (isForm ? "this form" : "this SOP")}"? This can't be undone.`);
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
    <div className="gk-fade-in" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back" onClick={handleClose} />
        <div style={{ fontSize: 14, color: C.mut, fontWeight: 600 }}>{isNew ? `New ${docWord}` : `Editing ${docWord}`}</div>
        <div style={{ flex: 1 }} />
        {!isNew && <IconBtn icon="history" title="Version history" onClick={() => setShowHistory(true)} />}
        {!isNew && <IconBtn icon="content_copy" title={`Duplicate ${docWord}`} onClick={handleDuplicate} />}
        {!isNew && <IconBtn icon="delete" danger title={`Delete ${docWord}`} onClick={handleDelete} />}
      </div>

      {/* Title on the left; version/code area to its right (#1). */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`${docWord} title…`}
          style={{ ...inp({ fontSize: 28, fontWeight: 800, padding: "8px 4px", border: "1.5px solid transparent", background: "transparent", width: "auto", flex: "1 1 320px" }) }}
          onFocus={e => e.target.style.border = `1.5px solid ${C.bdr2}`}
          onBlur={e => e.target.style.border = "1.5px solid transparent"} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, paddingTop: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em" }}>Version / Code</div>
          <input value={typePrefix} onChange={e => setTypePrefix(e.target.value)} placeholder="Type (SOP, WI…)" list="gk-type-prefixes"
            style={{ ...inp({ fontSize: 12, padding: "5px 9px", width: 190, fontFamily: "'IBM Plex Mono',monospace" }) }} />
          <datalist id="gk-type-prefixes">{getAllTypePrefixes().map(p => <option key={p} value={p} />)}</datalist>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (e.g. SOP-OPS-001)"
            style={{ ...inp({ fontSize: 12, padding: "5px 9px", width: 190, fontFamily: "'IBM Plex Mono',monospace" }) }} />
        </div>
      </div>

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

      <BlocksEditor blocks={blocks} onChange={setBlocks} docMagnet={{ kind: "sop", id: sop.id }} isForm={isForm} trailing={<Btn onClick={handleClose}>Done</Btn>} />

      {showHistory && <HistoryPanel sopId={sop.id} onClose={() => setShowHistory(false)} onRestored={handleRestored} />}
    </div>
  );
}

export default SOPEditor;
export { BlocksEditor };
