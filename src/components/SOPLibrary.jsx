import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, getCategories, getSOPs, getSOP, defSOP, sopMatchesSearch, sopExcerpt, fmtDateShort, canEdit,
  seedStandardSections, triggerSaved,
} from '../globals.js';
import { Btn, OBtn, Pill, Icon, SectionHeader, EmptyState } from './shared.jsx';
import SOPViewer from './SOPViewer.jsx';
import SOPEditor from './SOPEditor.jsx';
import ImportSopButton from './SOPImporter.jsx';

const SORTS = [
  { key: "updated", label: "Recently updated" },
  { key: "title", label: "Title A-Z" },
  { key: "category", label: "Category" },
];

/* Signature element: SOP cards read like filed index / plant-tag cards —
   a colored left-edge tab in the category's color (like a library card
   drawer divider), rather than a generic icon-top-title-bottom tile. */
function SOPCard({ sop, category, onOpen }) {
  const [hov, setHov] = useState(false);
  const color = category?.color || C.faint;
  return (
    <div onClick={onOpen} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", cursor: "pointer", background: C.sur, borderRadius: 12,
        border: `1.5px solid ${hov ? color + "70" : C.bdr}`, overflow: "hidden",
        boxShadow: hov ? C.shadowSm : "none", transition: "border-color .15s, box-shadow .15s",
        opacity: sop.status === "archived" ? 0.62 : 1,
      }}>
      <div style={{ width: 6, flexShrink: 0, background: color }} />
      <div style={{ padding: "16px 18px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {category && <Pill color={color}>{category.name}</Pill>}
          <Pill color={sop.status === "published" ? C.moss : C.faint}>
            {sop.status === "published" ? "Published" : sop.status === "archived" ? "Archived" : "Draft"}
          </Pill>
          {sop.code && <Pill color={C.faint}>{sop.code}</Pill>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sop.title || "Untitled SOP"}
        </div>
        <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.5, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {sopExcerpt(sop) || "No content yet."}
        </div>
        <div style={{ fontSize: 12, color: C.faint }}>Updated {fmtDateShort(sop.updatedAt)}</div>
      </div>
    </div>
  );
}

/** `kind` distinguishes the SOP Library ("sop", also covers WI/CL/LOG/APP —
 * they're all just SOPs with a different `typePrefix`) from the standalone
 * Forms nav section ("form") — same storage, editor, viewer, and Instances
 * mechanic, just filtered and labeled differently (Phase 6). `onNavigateOut`
 * is called when a mention/backlink points somewhere this library can't show
 * in place (a document of the other kind, or a Playbook section) so the
 * host (App.jsx) can switch nav sections. */
function SOPLibrary({ user, focusId, focusMode, onClearFocus, kind = "sop", onNavigateOut, onOpenTasks }) {
  const [refresh, setRefresh] = useState(0);
  const [activeCat, setActiveCat] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "edit"
  const [creating, setCreating] = useState(null);
  const [sort, setSort] = useState("updated");
  const [showArchived, setShowArchived] = useState(false);

  const categories = getCategories();
  const allSops = getSOPs().filter(s => (s.kind || "sop") === kind);
  const bump = () => setRefresh(r => r + 1);
  const isForm = kind === "form";

  // Deep-link: a Task Manager "Related SOP" link can request a specific SOP open.
  useEffect(() => {
    if (focusId) { setOpenId(focusId); setMode(focusMode || "view"); onClearFocus && onClearFocus(); }
  }, [focusId, focusMode, onClearFocus]);

  // A mention/backlink click: same-kind documents open in place; anything
  // else (the other kind, or a Playbook section) bubbles up to App.jsx.
  const handleNavigate = (navKind, id) => {
    if (navKind === (isForm ? "form" : "sop")) { setOpenId(id); setMode("view"); return; }
    onNavigateOut && onNavigateOut(navKind, id);
  };

  const sops = showArchived ? allSops : allSops.filter(s => s.status !== "archived");
  const archivedCount = allSops.length - allSops.filter(s => s.status !== "archived").length;

  const counts = {};
  sops.forEach(s => { counts[s.categoryId || "none"] = (counts[s.categoryId || "none"] || 0) + 1; });

  const catName = (id) => categories.find(c => c.id === id)?.name || "￿"; // uncategorized sorts last

  const filtered = sops
    .filter(s => activeCat === "all" || (activeCat === "none" ? !s.categoryId : s.categoryId === activeCat))
    .filter(s => sopMatchesSearch(s, query))
    .sort((a, b) => {
      if (sort === "title") return (a.title || "").localeCompare(b.title || "");
      if (sort === "category") return catName(a.categoryId).localeCompare(catName(b.categoryId)) || (a.title || "").localeCompare(b.title || "");
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  const openSop = openId ? getSOP(openId) : null;

  if (creating) {
    return <SOPEditor sop={creating} isNew
      onClose={() => setCreating(null)}
      onSaved={bump}
      onDeleted={() => { setCreating(null); bump(); }} />;
  }

  if (openSop && mode === "edit") {
    return <SOPEditor sop={openSop} isNew={false}
      onClose={() => { setMode("view"); bump(); }}
      onSaved={bump}
      onDeleted={() => { setOpenId(null); bump(); }} />;
  }

  if (openSop && mode === "view") {
    return <SOPViewer sop={openSop} user={user} canEditSop={canEdit(user)} onClose={() => setOpenId(null)} onEdit={() => setMode("edit")} onNavigate={handleNavigate} onOpenTasks={onOpenTasks} />;
  }

  const newDoc = () => defSOP(activeCat !== "all" && activeCat !== "none" ? activeCat : "", kind);

  return (
    <div className="gk-fade-in">
      <SectionHeader
        title={isForm ? "Forms" : "SOP Library"}
        sub={`${sops.length} ${isForm ? "form" : "procedure"}${sops.length === 1 ? "" : "s"}`}
        right={canEdit(user) && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <OBtn onClick={() => { const n = seedStandardSections(); if (n) triggerSaved(); bump(); }} title="Add the 12 standard Green Kiss sections as categories, if missing">
              <Icon name="playlist_add" size={16} />Load standard sections
            </OBtn>
            <ImportSopButton onImported={({ title, blocks }) => setCreating({ ...newDoc(), title, blocks })} />
            <Btn onClick={() => setCreating(newDoc())}>
              <Icon name="add" size={17} />New {isForm ? "Form" : "SOP"}
            </Btn>
          </div>
        )}
      />

      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
          <Icon name="search" size={18} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.faint }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={isForm ? "Search forms…" : "Search SOPs…"}
            style={{
              width: "100%", background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9,
              padding: "10px 14px 10px 38px", fontSize: 15, color: C.txt, outline: "none", fontFamily: "inherit",
            }} />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} title="Sort"
          style={{
            background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: "10px 14px",
            fontSize: 14, color: C.txt, outline: "none", fontFamily: "inherit", cursor: "pointer",
          }}>
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {archivedCount > 0 && (
          <button onClick={() => setShowArchived(v => !v)} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 9,
            border: `1.5px solid ${showArchived ? C.moss : C.bdr}`, background: showArchived ? C.mossSoft : C.sur,
            color: showArchived ? C.moss : C.txt2, fontSize: 12, fontWeight: showArchived ? 600 : 500,
            textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em",
            cursor: "pointer",
          }}>
            <Icon name={showArchived ? "visibility" : "visibility_off"} size={16} />
            {showArchived ? "Showing archived" : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <button onClick={() => setActiveCat("all")} style={pillBtnStyle(activeCat === "all", C.moss)}>
          All <span style={countStyle(activeCat === "all", C.moss)}>{sops.length}</span>
        </button>
        {categories.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)} style={pillBtnStyle(activeCat === c.id, c.color)}>
            {c.name} <span style={countStyle(activeCat === c.id, c.color)}>{counts[c.id] || 0}</span>
          </button>
        ))}
        {counts.none > 0 && (
          <button onClick={() => setActiveCat("none")} style={pillBtnStyle(activeCat === "none", C.faint)}>
            Uncategorized <span style={countStyle(activeCat === "none", C.faint)}>{counts.none}</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={isForm ? "description" : "menu_book"} title={query ? "No matches" : `No ${isForm ? "forms" : "SOPs"} here yet`}
          sub={query ? "Try a different search term or category." : `Create the first ${isForm ? "form" : "procedure"} for this category.`}
          action={canEdit(user) && !query && (
            <Btn onClick={() => setCreating(newDoc())}>
              <Icon name="add" size={17} />New {isForm ? "Form" : "SOP"}
            </Btn>
          )}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {filtered.map(s => (
            <SOPCard key={s.id} sop={s} category={categories.find(c => c.id === s.categoryId)}
              onOpen={() => { setOpenId(s.id); setMode("view"); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function pillBtnStyle(active, color) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 99,
    border: `1.5px solid ${active ? color : C.bdr}`, background: active ? color + "16" : C.sur,
    color: active ? color : C.txt2, fontSize: 12, fontWeight: active ? 600 : 500,
    textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em",
    cursor: "pointer", transition: "all .15s",
  };
}
function countStyle(active, color) {
  return {
    fontSize: 12, fontWeight: 700, background: active ? C.sur : C.s2,
    color: active ? color : C.mut, borderRadius: 99, padding: "1px 7px",
  };
}

export default SOPLibrary;
