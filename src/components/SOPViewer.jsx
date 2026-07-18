import React, { useState, useMemo, useEffect } from 'react';
import {
  C, FONT_CAPS, getCategories, getUsers, getSOPs, getProjects, getTags, getCurrentUser,
  fmtDate, nowISO, inp, addTask, taskFromSop, sopHasTaskRoles, asListBlock, blockBg,
  getAcks, ackSop, isAckStale, triggerSaved, findBacklinks,
  isMagnet, openMagnet, copyMagnet, sanitizeHtml, mentionTokensToHtml,
  getInstances, updateInstance, newSubmission, stampEditLog, todayLocalISO,
} from '../globals.js';
import { IconBtn, Btn, OBtn, Pill, Icon, MentionText, SlideOver, ItemLink } from './shared.jsx';
import { TaskModal } from './TaskManager.jsx';

/* Viewer blocks manage their own session-only fill state (checkboxes, entry
   values, completion fields) — reset on reload. Real tracked execution now
   lives in "Run SOP → Task" (Phase D); in-doc ticking is a casual working aid,
   the original pre-instance behavior. */

/** List / checklist. `checkboxes` shows a leading interactive box per item
 * (folds in the old Checklist block); `withEntry` shows a fill-in blank; each
 * item may carry a link. Checkbox + entry state is component-local. */
function ListViewerBlock({ block, onNavigate, nav }) {
  const items = block.items || [];
  const [checks, setChecks] = useState({});
  const [entries, setEntries] = useState({});
  if (!items.length) return null;
  const toggle = (id) => setChecks(p => ({ ...p, [id]: !p[id] }));
  const label = (it) => it.url
    ? <ItemLink url={it.url} nav={nav}>{it.text || it.url}</ItemLink>
    : <MentionText text={it.text} onNavigate={onNavigate} />;
  return (
    <div style={{ margin: "0 0 14px" }}>
      <div className="gk-no-print" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it, idx) => {
          const on = !!checks[it.id];
          return (
            <div key={it.id} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              {block.checkboxes ? (
                <div role="checkbox" aria-checked={on} tabIndex={0}
                  onClick={() => toggle(it.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(it.id); } }}
                  style={{ width: 19, height: 19, borderRadius: 6, flexShrink: 0, cursor: "pointer", alignSelf: "center",
                    border: `1.5px solid ${on ? C.moss : C.bdr2}`, background: on ? C.moss : C.sur,
                    display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>
                  {on && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
              ) : block.style === "plain" ? null : (
                <span style={{ fontSize: 15, color: C.faint, flexShrink: 0, minWidth: 16 }}>{block.style === "numbered" ? `${idx + 1}.` : "•"}</span>
              )}
              {/* Plain + entry = the FRM-001 "Date Received: ______" slot shape: bold label, underlined blank */}
              <span style={{ fontSize: 15, color: on ? C.mut : C.txt2, textDecoration: on ? "line-through" : "none", opacity: on ? 0.55 : 1, flex: block.withEntry ? "0 0 auto" : 1, fontWeight: block.style === "plain" && block.withEntry ? 700 : 400 }}>{label(it)}{block.style === "plain" && block.withEntry ? ":" : ""}</span>
              {block.withEntry && (
                <input value={entries[it.id] ?? (it.value || "")} onChange={e => setEntries(p => ({ ...p, [it.id]: e.target.value }))}
                  style={{ flex: 1, minWidth: 60, background: "transparent", border: "none", borderBottom: `1.5px solid ${C.bdr2}`, fontSize: 15, color: C.txt, outline: "none", fontFamily: "inherit", padding: "0 0 2px" }} />
              )}
            </div>
          );
        })}
      </div>
      {/* print: static, reflects current tick state */}
      <div className="gk-print-only">
        {items.map((it, idx) => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, fontSize: 14 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>{block.checkboxes ? (checks[it.id] ? "☑" : "☐") : (block.style === "numbered" ? `${idx + 1}.` : "•")}</span>
            <span>{it.text}{block.withEntry ? `:  ${entries[it.id] ?? (it.value || "______")}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Completion footer — session-fillable, printable. Completed By defaults to
 * the current user, Date to today; nothing locks (tracked completion lives on
 * the Run→Task now). */
function CompletionViewerBlock() {
  const me = getCurrentUser();
  const [by, setBy] = useState(me?.name || "");
  const [date, setDate] = useState(nowISO().slice(0, 10));
  const [notes, setNotes] = useState("");
  const row = { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 };
  const lbl = { fontSize: 14, fontWeight: 700, color: C.txt2, minWidth: 110 };
  return (
    <div style={{ margin: "8px 0 20px", padding: "16px 18px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12 }}>
      <div style={{ fontWeight: 700, color: C.txt, marginBottom: 12, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em", fontSize: 13 }}>Completion</div>
      <div style={row}><span style={lbl}>Completed By</span><input value={by} onChange={e => setBy(e.target.value)} style={{ ...inp({ fontSize: 14, padding: "6px 10px", maxWidth: 260 }) }} /></div>
      <div style={row}><span style={lbl}>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp({ fontSize: 14, padding: "6px 10px", width: "auto" }) }} /></div>
      <div style={{ marginTop: 4 }}><span style={lbl}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inp({ fontSize: 14, lineHeight: 1.6, minHeight: 60, marginTop: 6 }) }} />
      </div>
    </div>
  );
}

/** Index — a table of contents from headings + any numbered block, each a
 * jump link into the document (scrolls to that block's anchor). */
function IndexViewerBlock({ allBlocks, onJump }) {
  const entries = (allBlocks || [])
    .map(raw => asListBlock(raw))
    .filter(b => b.type === "heading" || b.num != null)
    .map(b => {
      let text = b.type === "heading" ? (b.text || "Untitled")
        : (b.type === "list" ? (b.items?.[0]?.text || "List") : (b.text || "Section"));
      return { id: b.id, num: b.num, text };
    })
    .filter(e => e.text);
  if (!entries.length) return null;
  return (
    <nav style={{ margin: "0 0 22px", padding: "14px 18px", background: C.s2, borderRadius: 12, border: `1.5px solid ${C.bdr}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", marginBottom: 8 }}>Index</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map(e => (
          <button key={e.id} onClick={() => onJump && onJump(e.id)} className="gk-no-print"
            style={{ display: "flex", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: C.txt2, fontSize: 14 }}>
            {e.num != null && <span style={{ color: C.moss, fontWeight: 700, minWidth: 20 }}>{e.num}.</span>}
            <span style={{ textDecoration: "underline", textDecorationColor: C.bdr2 }}>{e.text}</span>
          </button>
        ))}
        {/* print: plain list, no buttons */}
        <div className="gk-print-only">
          {entries.map(e => <div key={e.id} style={{ fontSize: 14 }}>{e.num != null ? `${e.num}. ` : ""}{e.text}</div>)}
        </div>
      </div>
    </nav>
  );
}

/** WYSIWYG text render — sanitized stored HTML with mention tokens swapped
 * to clickable pills and gk: anchors intercepted for internal navigation.
 * One click delegate on the paragraph handles both. */
function RichTextView({ block, onNavigate, nav }) {
  const html = useMemo(() => mentionTokensToHtml(sanitizeHtml(block.html)), [block.html]);
  const onClick = (e) => {
    const mention = e.target.closest("[data-mention]");
    if (mention) {
      const [kind, id] = mention.getAttribute("data-mention").split(":");
      if (onNavigate) onNavigate(kind, id);
      return;
    }
    const a = e.target.closest("a");
    if (a) {
      const href = a.getAttribute("href") || "";
      if (isMagnet(href)) { e.preventDefault(); openMagnet(href, nav); }
      else { a.target = "_blank"; a.rel = "noreferrer"; }
    }
  };
  return (
    <div onClick={onClick} className="gk-richtext" dangerouslySetInnerHTML={{ __html: html }}
      style={{ fontSize: 16, lineHeight: 1.6, color: C.txt2, whiteSpace: "pre-wrap", overflowWrap: "break-word", margin: "0 0 12px" }} />
  );
}

function ViewerBlock({ block: raw, onNavigate, allBlocks, onJump, nav }) {
  const block = asListBlock(raw);
  if (block.type === "index") return <IndexViewerBlock allBlocks={allBlocks} onJump={onJump} />;
  if (block.type === "heading") {
    return (
      <div style={{ margin: "20px 0 8px" }}>
        <h2 style={{ fontSize: 21, fontWeight: 800, color: C.txt, margin: 0 }}>{block.num != null ? `${block.num}. ` : ""}{block.text}</h2>
        {block.description && <p style={{ fontSize: 14, color: C.mut, margin: "4px 0 0", lineHeight: 1.5 }}><MentionText text={block.description} onNavigate={onNavigate} /></p>}
      </div>
    );
  }
  if (block.type === "list") return <ListViewerBlock block={block} onNavigate={onNavigate} nav={nav} />;
  if (block.type === "text") {
    if (block.html) return <RichTextView block={block} onNavigate={onNavigate} nav={nav} />;
    if (!block.text) return null;
    return <p style={{ fontSize: 16, lineHeight: 1.6, color: C.txt2, whiteSpace: "pre-wrap", margin: "0 0 12px" }}><MentionText text={block.text} onNavigate={onNavigate} /></p>;
  }
  if (block.type === "divider") return <hr className="gk-no-print-break" style={{ border: "none", height: 2, background: C.bdr, borderRadius: 2, margin: "18px 0" }} />;
  if (block.type === "completion") return <CompletionViewerBlock />;
  if (block.type === "links") {
    const links = block.links || [];
    if (!links.length) return null;
    return (
      <div style={{ margin: "0 0 16px" }}>
        {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 6 }}>{block.title}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {links.map(l => (
            <span key={l.id} style={{ fontSize: 15 }}>
              <ItemLink url={l.url} nav={nav}>{l.label || l.url}</ItemLink>
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "image") {
    if (!block.src) return null;
    return (
      <figure style={{ margin: "0 0 22px" }}>
        <img src={block.src} alt={block.caption || ""} style={{ maxWidth: "100%", borderRadius: 12, border: `1.5px solid ${C.bdr}`, display: "block" }} />
        {block.caption && <figcaption style={{ fontSize: 13, color: C.mut, marginTop: 8, textAlign: "center" }}>{block.caption}</figcaption>}
      </figure>
    );
  }
  return null;
}

/* Phase 6 #2: read acknowledgments. Any role can mark an SOP read; if the
   SOP has been updated since their last ack, the button flips to an amber
   re-confirm state instead of showing "Read on <date>". */
function ReadReceipts({ sop, user, onAcked }) {
  if (!user) return null;
  const acks = getAcks();
  const mine = (acks[sop.id] && acks[sop.id][user.id]) || null;
  const stale = isAckStale(mine, sop);
  const markRead = () => { ackSop(sop.id, user.id, sop.updatedAt); triggerSaved(); onAcked && onAcked(); };
  return (
    <div className="gk-no-print" style={{ marginTop: 28, paddingTop: 20, borderTop: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {mine && !stale && (
        <div style={{ fontSize: 13, color: C.moss, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="check_circle" size={16} />Read on {fmtDate(mine.at)}
        </div>
      )}
      {mine && stale && (
        <div style={{ fontSize: 13, color: C.orange, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, background: C.orange + "18", padding: "6px 12px", borderRadius: 8 }}>
          <Icon name="warning" size={16} />Updated since you last read — re-confirm
        </div>
      )}
      {(!mine || stale) && (
        <Btn onClick={markRead}><Icon name="task_alt" size={16} />Mark as read</Btn>
      )}
    </div>
  );
}

/** Editors/admins only — a compact roster of who's acked this SOP. */
function ReadByList({ sop }) {
  const acksForSop = getAcks()[sop.id] || {};
  const users = getUsers();
  const entries = Object.keys(acksForSop).map(userId => {
    const u = users.find(x => x.id === userId);
    const ack = acksForSop[userId];
    return { name: u?.name || "Unknown", at: ack.at, stale: isAckStale(ack, sop) };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  if (entries.length === 0) return null;
  return (
    <div className="gk-no-print" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>Read by ({entries.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.txt2 }}>
            <Icon name={e.stale ? "warning" : "check_circle"} size={14} style={{ color: e.stale ? C.orange : C.moss }} />
            {e.name} · {fmtDate(e.at)}{e.stale ? " — stale" : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Referenced by" — every other document/playbook-section that mentions
 * this one, computed lazily at render time (no reverse index to maintain). */
function BacklinksList({ sop, onNavigate }) {
  const refs = findBacklinks(sop.kind === "form" ? "form" : "sop", sop.id);
  if (!refs.length) return null;
  return (
    <div className="gk-no-print" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>Referenced by ({refs.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {refs.map(r => (
          <button key={r.kind + r.id} onClick={() => onNavigate && onNavigate(r.kind, r.id)}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.moss, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "fit-content" }}>
            <Icon name={r.kind === "playbook" ? "menu_book" : "description"} size={14} />{r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Form fill mode (R4 C) ─────────────────────────────────────────
   Renders a submission from its blocksSnapshot (template edits never
   rewrite records). Fill state writes into instance.values, per-block
   notes into instance.notes (available before AND after submitting).
   Submitting auto-fills the Completion block and marks the record
   submitted — it STAYS editable, but every post-submission save appends
   a non-editable editLog entry showing who edited and when. */
function FillNote({ note, onChange }) {
  const [open, setOpen] = useState(!!note);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", color: C.faint, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, display: "flex", alignItems: "center", gap: 3, marginBottom: 10 }}>
        <Icon name="sticky_note_2" size={13} />Add note
      </button>
    );
  }
  return (
    <div style={{ margin: "2px 0 12px", display: "flex", gap: 6, alignItems: "flex-start" }}>
      <Icon name="sticky_note_2" size={14} style={{ color: C.clay, marginTop: 8 }} />
      <textarea value={note || ""} onChange={e => onChange(e.target.value)} rows={2} placeholder="Note…"
        style={{ ...inp({ fontSize: 13, lineHeight: 1.5, minHeight: 34, background: C.clay + "11" }) }} />
    </div>
  );
}

function FillListBlock({ block, value, onChange }) {
  const v = value || { checks: {}, entries: {} };
  const items = block.items || [];
  const isSlot = block.style === "plain" && block.withEntry;
  return (
    <div style={{ margin: "0 0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((it, idx) => {
        const on = !!v.checks[it.id];
        return (
          <div key={it.id} style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            {block.checkboxes ? (
              <div role="checkbox" aria-checked={on} tabIndex={0}
                onClick={() => onChange({ ...v, checks: { ...v.checks, [it.id]: !on } })}
                style={{ width: 19, height: 19, borderRadius: 6, flexShrink: 0, cursor: "pointer", alignSelf: "center",
                  border: `1.5px solid ${on ? C.moss : C.bdr2}`, background: on ? C.moss : C.sur,
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>
                {on && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            ) : block.style === "plain" ? null : (
              <span style={{ fontSize: 15, color: C.faint, flexShrink: 0, minWidth: 16 }}>{block.style === "numbered" ? `${idx + 1}.` : "•"}</span>
            )}
            <span style={{ fontSize: 15, color: on ? C.mut : C.txt2, textDecoration: on ? "line-through" : "none", opacity: on ? 0.55 : 1, flexShrink: 0, fontWeight: isSlot ? 700 : 400 }}>
              {it.text}{isSlot ? ":" : ""}
            </span>
            {block.withEntry && (
              <input value={v.entries[it.id] ?? ""} onChange={e => onChange({ ...v, entries: { ...v.entries, [it.id]: e.target.value } })}
                style={{ flex: 1, minWidth: 60, background: "transparent", border: "none", borderBottom: `1.5px solid ${C.bdr2}`, fontSize: 15, color: C.txt, outline: "none", fontFamily: "inherit", padding: "0 0 2px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FillCompletionBlock({ value, onChange }) {
  const v = value || {};
  const row = { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 };
  const lbl2 = { fontSize: 14, fontWeight: 700, color: C.txt2, minWidth: 110 };
  return (
    <div style={{ margin: "8px 0 14px", padding: "16px 18px", background: C.s2, border: `1.5px solid ${C.bdr}`, borderRadius: 12 }}>
      <div style={{ fontWeight: 700, color: C.txt, marginBottom: 12, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em", fontSize: 13 }}>Completion</div>
      <div style={row}><span style={lbl2}>Completed By</span><input value={v.by || ""} onChange={e => onChange({ ...v, by: e.target.value })} placeholder="Auto-fills on submit" style={{ ...inp({ fontSize: 14, padding: "6px 10px", maxWidth: 260 }) }} /></div>
      <div style={row}><span style={lbl2}>Date</span><input type="date" value={v.date || ""} onChange={e => onChange({ ...v, date: e.target.value })} style={{ ...inp({ fontSize: 14, padding: "6px 10px", width: "auto" }) }} /></div>
      <div style={{ marginTop: 4 }}><span style={lbl2}>Notes</span>
        <textarea value={v.notes || ""} onChange={e => onChange({ ...v, notes: e.target.value })} rows={3} style={{ ...inp({ fontSize: 14, lineHeight: 1.6, minHeight: 60, marginTop: 6 }) }} />
      </div>
    </div>
  );
}

function FormFill({ sop, instance: initial, user, onClose, onNavigate }) {
  const [inst, setInst] = useState(initial);
  const nav = useMemo(() => ({
    goToSop: (id, blockId) => onNavigate && onNavigate("sop", id, blockId),
    goToTask: (id) => onNavigate && onNavigate("task", id),
    goToPlaybookSection: (id) => onNavigate && onNavigate("playbook", id),
  }), [onNavigate]);

  // Every change persists immediately; post-submission changes stamp the
  // non-editable edit log first (dedup: one entry per user per minute).
  const patch = (changes) => {
    const next = { ...inst, ...changes, editLog: stampEditLog(inst, user) };
    setInst(next);
    updateInstance(inst.id, { ...changes, editLog: next.editLog });
  };
  const setValue = (blockId, v) => patch({ values: { ...(inst.values || {}), [blockId]: v } });
  const setNote = (blockId, text) => patch({ notes: { ...(inst.notes || {}), [blockId]: text } });

  const submit = () => {
    const me = user?.name || "";
    // Auto-fill any completion blocks that weren't filled by hand.
    const values = { ...(inst.values || {}) };
    (inst.blocksSnapshot || []).forEach(b => {
      if (b.type !== "completion") return;
      const v = values[b.id] || {};
      values[b.id] = { ...v, by: v.by || me, date: v.date || todayLocalISO() };
    });
    patch({ values, status: "submitted", completedBy: me, completedAt: nowISO() });
    triggerSaved();
  };

  const submitted = inst.status === "submitted";
  const blocks = (inst.blocksSnapshot || []).map(asListBlock);

  return (
    <div className="gk-fade-in" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="gk-no-print" style={{ position: "sticky", top: 0, zIndex: 40, background: C.bg, display: "flex", alignItems: "center", gap: 10, padding: "10px 0 12px", marginBottom: 8, borderBottom: `1.5px solid ${C.bdr}` }}>
        <IconBtn icon="arrow_back" title="Back" onClick={onClose} />
        <div style={{ fontSize: 14, color: C.mut, fontWeight: 600 }}>
          {sop.title || "Form"} — {fmtDate(inst.startedAt)}{inst.startedBy ? ` · started by ${inst.startedBy}` : ""}
        </div>
        <div style={{ flex: 1 }} />
        <Pill color={submitted ? C.moss : C.clay}>{submitted ? "Submitted" : "In progress"}</Pill>
        {!submitted && <Btn onClick={submit}><Icon name="task_alt" size={16} />Submit</Btn>}
        <OBtn onClick={() => window.print()}><Icon name="print" size={16} />Print</OBtn>
      </div>

      <div className="gk-print-area" style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "36px 40px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 4px", letterSpacing: -0.4 }}>{sop.title || "Untitled form"}</h1>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 22 }}>
          {submitted
            ? `Submitted by ${inst.completedBy || "unknown"} · ${fmtDate(inst.completedAt)} — still editable; edits are logged below.`
            : `Fill in below, then Submit. You can add a note to any block.`}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 24px" }}>
          {blocks.map(b => {
            const bg = blockBg(b.bg);
            return (
              <div key={b.id} style={{
                flex: `0 0 calc(${b.width || 100}% - 24px)`, minWidth: 0,
                ...(bg !== "transparent" ? { background: bg, borderRadius: 10, padding: "10px 14px", margin: "0 0 4px" } : {}),
              }}>
                {b.type === "list"
                  ? <FillListBlock block={b} value={(inst.values || {})[b.id]} onChange={v => setValue(b.id, v)} />
                  : b.type === "completion"
                    ? <FillCompletionBlock value={(inst.values || {})[b.id]} onChange={v => setValue(b.id, v)} />
                    : <ViewerBlock block={b} nav={nav} onNavigate={onNavigate} allBlocks={blocks} />}
                {b.type !== "divider" && b.type !== "index" && (
                  <div className="gk-no-print">
                    <FillNote note={(inst.notes || {})[b.id]} onChange={t => setNote(b.id, t)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {(inst.editLog || []).length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1.5px solid ${C.bdr}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 6 }}>Edit history</div>
            {(inst.editLog || []).map((e, i) => (
              <div key={i} style={{ fontSize: 12.5, color: C.faint }}>Edited by {e.by || "unknown"} · {fmtDate(e.at)} {new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Submissions list for one form — date/by/status rows, newest first. */
function SubmissionsSlideOver({ sop, onOpen, onClose }) {
  const subs = getInstances(sop.id);
  return (
    <SlideOver title={`Submissions (${subs.length})`} onClose={onClose}>
      {subs.length === 0 && <div style={{ fontSize: 13.5, color: C.mut, padding: "8px 2px" }}>No submissions yet — "Fill out" creates the first one.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {subs.map(s => (
          <button key={s.id} onClick={() => onOpen(s)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{fmtDate(s.startedAt)}</div>
              <div style={{ fontSize: 12, color: C.mut }}>{s.status === "submitted" ? `Submitted by ${s.completedBy || s.startedBy || "unknown"}` : `Started by ${s.startedBy || "unknown"}`}</div>
            </div>
            <Pill color={s.status === "submitted" ? C.moss : C.clay}>{s.status === "submitted" ? "Submitted" : "In progress"}</Pill>
          </button>
        ))}
      </div>
    </SlideOver>
  );
}

function SOPViewer({ sop, user, canEditSop, onClose, onEdit, onNavigate, onOpenTasks, scrollToBlock, onScrolled, openSubmissionId }) {
  const categories = getCategories();
  const cat = categories.find(c => c.id === sop.categoryId);
  const printedOn = fmtDate(nowISO());
  const [ackVersion, setAckVersion] = useState(0);
  const [runDraft, setRunDraft] = useState(null); // pre-filled task awaiting confirm
  const [runGate, setRunGate] = useState(false);  // "not set up for tasks yet" notice
  const [hoverBlk, setHoverBlk] = useState(null);
  const isForm = sop.kind === "form";

  const jump = (id) => { const el = document.getElementById("blk-" + id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };

  // Magnet deep-anchor: scroll to the requested block once rendered.
  useEffect(() => {
    if (!scrollToBlock) return;
    const t = setTimeout(() => { jump(scrollToBlock); onScrolled && onScrolled(); }, 60);
    return () => clearTimeout(t);
  }, [scrollToBlock, sop.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Magnet navigation rides the same onNavigate App already wires for
  // mentions — extended with a "task" kind and an optional block anchor.
  const nav = useMemo(() => ({
    goToSop: (id, blockId) => onNavigate && onNavigate("sop", id, blockId),
    goToTask: (id) => onNavigate && onNavigate("task", id),
    goToPlaybookSection: (id) => onNavigate && onNavigate("playbook", id),
  }), [onNavigate]);

  const startRun = () => {
    if (sopHasTaskRoles(sop)) setRunDraft(taskFromSop(sop, user));
    else setRunGate(true);
  };

  // Forms: "Fill out" starts a submission and switches to fill mode; a
  // deep link (openSubmissionId, from the Forms browse page) opens one.
  const [fillInst, setFillInst] = useState(null);
  const [showSubs, setShowSubs] = useState(false);
  useEffect(() => {
    if (!openSubmissionId) return;
    const s = getInstances(sop.id).find(x => x.id === openSubmissionId);
    if (s) setFillInst(s);
  }, [openSubmissionId, sop.id]);
  const startFill = () => { setFillInst(newSubmission(sop, user)); triggerSaved(); };
  const subCount = isForm ? getInstances(sop.id).length : 0;

  const blocks = sop.blocks || [];

  if (fillInst) {
    return <FormFill sop={sop} instance={fillInst} user={user} onClose={() => setFillInst(null)} onNavigate={onNavigate} />;
  }

  return (
    <div className="gk-fade-in" style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* Floating header — Edit / Run / Print stay reachable without scrolling up (#8). */}
      <div className="gk-no-print" style={{ position: "sticky", top: 0, zIndex: 40, background: C.bg, display: "flex", alignItems: "center", gap: 10, padding: "10px 0 12px", marginBottom: 8, borderBottom: `1.5px solid ${C.bdr}` }}>
        <IconBtn icon="arrow_back" title="Back to library" onClick={onClose} />
        <div style={{ flex: 1 }} />
        {isForm ? (
          <>
            <Btn onClick={startFill}><Icon name="edit_note" size={16} />Fill out</Btn>
            <OBtn onClick={() => setShowSubs(true)}><Icon name="inventory" size={15} />Submissions ({subCount})</OBtn>
          </>
        ) : (
          <Btn onClick={startRun}><Icon name="play_circle" size={16} />Run SOP</Btn>
        )}
        {canEditSop && <OBtn onClick={onEdit}><Icon name="edit" size={16} />Edit</OBtn>}
        <OBtn onClick={() => window.print()}><Icon name="print" size={16} />Print</OBtn>
      </div>

      <div className="gk-print-area" style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "36px 40px" }}>
        <div className="gk-print-only" style={{ marginBottom: 22, paddingBottom: 14, borderBottom: "1.5px solid #ccc" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: FONT_CAPS }}>The Green Kiss</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{sop.title || "Untitled"}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Printed on {printedOn}</div>
        </div>

        {/* Title row with the version/code to its right (#1). */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {cat && <Pill color={cat.color}>{cat.name}</Pill>}
              <Pill color={sop.status === "published" ? C.moss : C.faint}>
                {sop.status === "published" ? "Published" : sop.status === "archived" ? "Archived" : "Draft"}
              </Pill>
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: C.txt, margin: 0, letterSpacing: -0.4 }}>{sop.title || "Untitled"}</h1>
          </div>
          {sop.code && (
            <div style={{ flexShrink: 0, textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, color: C.mut, border: `1.5px solid ${C.bdr}`, borderRadius: 8, padding: "6px 10px" }}>
              {sop.code}
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, color: C.mut, margin: "8px 0 26px" }}>
          Updated {fmtDate(sop.updatedAt)}{sop.updatedBy ? ` by ${sop.updatedBy}` : ""}
        </div>

        {blocks.length === 0 && <div style={{ color: C.mut, fontSize: 15 }}>This document has no content yet.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 24px" }}>
          {blocks.map(b => {
            const bg = blockBg(b.bg);
            return (
              <div key={b.id} id={"blk-" + b.id}
                onMouseEnter={() => setHoverBlk(b.id)} onMouseLeave={() => setHoverBlk(h => h === b.id ? null : h)}
                style={{
                  flex: `0 0 calc(${b.width || 100}% - 24px)`, minWidth: 0, position: "relative",
                  ...(bg !== "transparent" ? { background: bg, borderRadius: 10, padding: "10px 14px", margin: "0 0 4px" } : {}),
                }}>
                {/* hover: copy a magnet link straight from the reading view */}
                {hoverBlk === b.id && (
                  <button type="button" className="gk-no-print" title="Copy magnet link to this block"
                    onClick={() => copyMagnet("sop", sop.id, b.id)}
                    style={{ position: "absolute", top: 2, right: 0, display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.sur, color: C.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, zIndex: 5 }}>
                    <Icon name="my_location" size={12} />Copy link
                  </button>
                )}
                <ViewerBlock block={b} onNavigate={onNavigate} allBlocks={blocks} onJump={jump} nav={nav} />
              </div>
            );
          })}
        </div>
      </div>

      <ReadReceipts sop={sop} user={user} onAcked={() => setAckVersion(v => v + 1)} />
      {canEditSop && <ReadByList key={ackVersion} sop={sop} />}
      <BacklinksList sop={sop} onNavigate={onNavigate} />

      {runDraft && (
        <TaskModal initial={runDraft} isNew wide
          users={getUsers()} sops={getSOPs()} projects={getProjects()} tags={getTags()}
          onClose={() => setRunDraft(null)}
          onSave={(form) => { addTask(form); triggerSaved(); setRunDraft(null); onOpenTasks && onOpenTasks(); }}
        />
      )}

      {showSubs && (
        <SubmissionsSlideOver sop={sop} onClose={() => setShowSubs(false)}
          onOpen={s => { setShowSubs(false); setFillInst(s); }} />
      )}

      {/* Default-none gate (R3 C): no blocks routed yet → force the one-time setup */}
      {runGate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }} onClick={() => setRunGate(false)}>
          <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{ background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd, maxWidth: 420, width: "100%", padding: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <Icon name="tune" size={20} style={{ color: C.clay }} />
              <div style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>Not set up for tasks yet</div>
            </div>
            <div style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, marginBottom: 18 }}>
              Before this {isForm ? "form" : "SOP"} can be run as a task, each block needs a <strong>Task</strong> setting (the small dropdown in its toolbar): <strong>Desc</strong> sends it to the task description, <strong>List</strong> turns its items into subtasks.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <OBtn onClick={() => setRunGate(false)}>Close</OBtn>
              {canEditSop && <Btn onClick={() => { setRunGate(false); onEdit(); }}><Icon name="edit" size={15} />Open editor</Btn>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SOPViewer;
export { ViewerBlock, FormFill };
