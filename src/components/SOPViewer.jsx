import React from 'react';
import { C, getCategories, fmtDate } from '../globals.js';
import { IconBtn, Btn, OBtn, Pill, Icon } from './shared.jsx';

function ViewerBlock({ block }) {
  if (block.type === "heading") {
    return <h2 style={{ fontSize: 21, fontWeight: 800, color: C.txt, margin: "26px 0 10px" }}>{block.text}</h2>;
  }
  if (block.type === "text") {
    if (!block.text) return null;
    return <p style={{ fontSize: 16, lineHeight: 1.75, color: C.txt2, whiteSpace: "pre-wrap", margin: "0 0 16px" }}>{block.text}</p>;
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

function SOPViewer({ sop, canEditSop, onClose, onEdit }) {
  const categories = getCategories();
  const cat = categories.find(c => c.id === sop.categoryId);

  return (
    <div className="gk-fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="gk-no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back to library" onClick={onClose} />
        <div style={{ flex: 1 }} />
        {canEditSop && <OBtn onClick={onEdit}><Icon name="edit" size={16} />Edit</OBtn>}
        <Btn onClick={() => window.print()}><Icon name="print" size={16} />Print / PDF</Btn>
      </div>

      <div className="gk-print-area" style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "36px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {cat && <Pill color={cat.color}>{cat.name}</Pill>}
          <Pill color={sop.status === "published" ? C.moss : C.faint}>{sop.status === "published" ? "Published" : "Draft"}</Pill>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: C.txt, margin: "0 0 8px", letterSpacing: -0.4 }}>{sop.title || "Untitled SOP"}</h1>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 26 }}>
          Updated {fmtDate(sop.updatedAt)}{sop.updatedBy ? ` by ${sop.updatedBy}` : ""}
        </div>
        {(sop.blocks || []).length === 0 && <div style={{ color: C.mut, fontSize: 15 }}>This SOP has no content yet.</div>}
        {(sop.blocks || []).map(b => <ViewerBlock key={b.id} block={b} />)}
      </div>
    </div>
  );
}

export default SOPViewer;
