import React, { useState } from 'react';
import {
  C, getCategories, getUsers, fmtDate, nowISO,
  getAcks, ackSop, isAckStale, triggerSaved,
} from '../globals.js';
import { IconBtn, Btn, OBtn, Pill, Icon } from './shared.jsx';

/* Session-only interactive checklist — nothing here is persisted; it's a
   "check things off while you work" aid, reset on reload or via the Reset
   link. Prints as plain empty checkboxes regardless of on-screen state
   (see the .gk-print-only sibling below), which is the point for paper use. */
function ChecklistViewerBlock({ block }) {
  const items = block.items || [];
  const [checked, setChecked] = useState(() => new Set());
  if (!items.length) return null;
  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div style={{ margin: "0 0 20px" }}>
      {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{block.title}</div>}

      {/* Interactive, screen-only */}
      <div className="gk-no-print" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => {
          const isChecked = checked.has(it.id);
          return (
            <div key={it.id} role="checkbox" aria-checked={isChecked} tabIndex={0}
              onClick={() => toggle(it.id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(it.id); } }}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
              <div style={{
                width: 19, height: 19, borderRadius: 6, flexShrink: 0,
                border: `1.5px solid ${isChecked ? C.moss : C.bdr2}`, background: isChecked ? C.moss : C.sur,
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
              }}>
                {isChecked && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <span style={{ fontSize: 15, color: isChecked ? C.mut : C.txt2, textDecoration: isChecked ? "line-through" : "none" }}>{it.text}</span>
            </div>
          );
        })}
        {checked.size > 0 && (
          <button type="button" onClick={() => setChecked(new Set())}
            style={{ alignSelf: "flex-start", marginTop: 4, background: "none", border: "none", color: C.moss, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Reset
          </button>
        )}
      </div>

      {/* Static, print-only — always unchecked, for paper use */}
      <div className="gk-print-only">
        {items.map(it => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, fontSize: 14 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>☐</span>
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewerBlock({ block }) {
  if (block.type === "heading") {
    return <h2 style={{ fontSize: 21, fontWeight: 800, color: C.txt, margin: "26px 0 10px" }}>{block.text}</h2>;
  }
  if (block.type === "text") {
    if (!block.text) return null;
    return <p style={{ fontSize: 16, lineHeight: 1.75, color: C.txt2, whiteSpace: "pre-wrap", margin: "0 0 16px" }}>{block.text}</p>;
  }
  if (block.type === "checklist") {
    return <ChecklistViewerBlock block={block} />;
  }
  if (block.type === "links") {
    const links = block.links || [];
    if (!links.length) return null;
    return (
      <div style={{ margin: "0 0 20px" }}>
        {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{block.title}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {links.map(l => (
            <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: C.moss, textDecoration: "none", fontWeight: 600 }}>
              <Icon name="open_in_new" size={15} />{l.label || l.url}
            </a>
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

  const markRead = () => {
    ackSop(sop.id, user.id, sop.updatedAt);
    triggerSaved();
    onAcked && onAcked();
  };

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
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Read by ({entries.length})</div>
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

function SOPViewer({ sop, user, canEditSop, onClose, onEdit }) {
  const categories = getCategories();
  const cat = categories.find(c => c.id === sop.categoryId);
  const printedOn = fmtDate(nowISO());
  // ReadReceipts and ReadByList both read getAcks() fresh on render, but
  // they're siblings — marking read only re-renders ReadReceipts itself,
  // so the editor-facing "Read by" list needs this to force its own
  // re-render too (bumped by ReadReceipts.onAcked).
  const [ackVersion, setAckVersion] = useState(0);

  return (
    <div className="gk-fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="gk-no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back to library" onClick={onClose} />
        <div style={{ flex: 1 }} />
        {canEditSop && <OBtn onClick={onEdit}><Icon name="edit" size={16} />Edit</OBtn>}
        <Btn onClick={() => window.print()}><Icon name="print" size={16} />Print / PDF</Btn>
      </div>

      <div className="gk-print-area" style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "36px 40px" }}>
        {/* Phase 6 QoL (d): print-only header — wordmark + title + printed-on date */}
        <div className="gk-print-only" style={{ marginBottom: 22, paddingBottom: 14, borderBottom: "1.5px solid #ccc" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase" }}>The Green Kiss</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{sop.title || "Untitled SOP"}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Printed on {printedOn}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {cat && <Pill color={cat.color}>{cat.name}</Pill>}
          <Pill color={sop.status === "published" ? C.moss : sop.status === "archived" ? C.faint : C.faint}>
            {sop.status === "published" ? "Published" : sop.status === "archived" ? "Archived" : "Draft"}
          </Pill>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: C.txt, margin: "0 0 8px", letterSpacing: -0.4 }}>{sop.title || "Untitled SOP"}</h1>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 26 }}>
          Updated {fmtDate(sop.updatedAt)}{sop.updatedBy ? ` by ${sop.updatedBy}` : ""}
        </div>
        {(sop.blocks || []).length === 0 && <div style={{ color: C.mut, fontSize: 15 }}>This SOP has no content yet.</div>}
        {(sop.blocks || []).map(b => <ViewerBlock key={b.id} block={b} />)}
      </div>

      <ReadReceipts sop={sop} user={user} onAcked={() => setAckVersion(v => v + 1)} />
      {canEditSop && <ReadByList key={ackVersion} sop={sop} />}
    </div>
  );
}

export default SOPViewer;
