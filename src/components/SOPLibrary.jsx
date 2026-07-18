import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, getCategories, getSOPs, getSOP, defSOP, sopMatchesSearch, sopExcerpt, fmtDateShort, canEdit,
  seedStandardSections, triggerSaved, inp, getAllInstances, formColor, fmtDate,
} from '../globals.js';
import { Btn, OBtn, Pill, Icon, SectionHeader, EmptyState } from './shared.jsx';
import { MiniCalendar } from './TaskManager.jsx';
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
/* ─── View Filled Forms (R4 C+) ─────────────────────────────────────
   Browse every submission: month calendar on the left with per-form
   colored dots on dates that have submissions; clicking a date lists that
   day's submissions on the right. "Show all forms" swaps to a flat
   newest-first list. Clicking any row opens that submission. */
function SubmissionRow({ sub, form, onOpen }) {
  return (
    <button onClick={onOpen}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: formColor(sub.docId), flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form?.title || "Deleted form"}</div>
        <div style={{ fontSize: 12, color: C.mut }}>
          {fmtDate(sub.startedAt)} · {sub.status === "submitted" ? `submitted by ${sub.completedBy || sub.startedBy || "unknown"}` : `started by ${sub.startedBy || "unknown"}`}
        </div>
      </div>
      <Pill color={sub.status === "submitted" ? C.moss : C.clay}>{sub.status === "submitted" ? "Submitted" : "In progress"}</Pill>
    </button>
  );
}

function FormBrowse({ forms, onOpenSubmission }) {
  const subs = getAllInstances().filter(i => i.docKind === "form")
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const [showAll, setShowAll] = useState(false);
  const [selDate, setSelDate] = useState(null);
  const formOf = (sub) => forms.find(f => f.id === sub.docId);

  // per-form colored dots, one set per date (deduped by form)
  const dots = {};
  subs.forEach(s => {
    if (!s.date) return;
    const col = formColor(s.docId);
    dots[s.date] = dots[s.date] || [];
    if (!dots[s.date].includes(col)) dots[s.date].push(col);
  });

  const dayList = selDate ? subs.filter(s => s.date === selDate) : [];

  if (subs.length === 0) {
    return <EmptyState icon="inventory" title="No filled forms yet" sub={'Open a form and hit "Fill out" — submissions collect here.'} />;
  }
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <OBtn onClick={() => setShowAll(a => !a)}>
          <Icon name={showAll ? "calendar_month" : "list"} size={15} />{showAll ? "Back to calendar" : `Show all forms (${subs.length})`}
        </OBtn>
      </div>
      {showAll ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
          {subs.map(s => <SubmissionRow key={s.id} sub={s} form={formOf(s)} onOpen={() => onOpenSubmission(s)} />)}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 300px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, padding: 16 }}>
            <MiniCalendar value={selDate} onSelect={setSelDate} dots={dots} />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {forms.filter(f => subs.some(s => s.docId === f.id)).map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: C.mut }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: formColor(f.id), flexShrink: 0 }} />{f.title || "Untitled"}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            {!selDate && <div style={{ fontSize: 14, color: C.mut, paddingTop: 8 }}>Pick a date with dots to see that day's submissions.</div>}
            {selDate && dayList.length === 0 && <div style={{ fontSize: 14, color: C.mut, paddingTop: 8 }}>No submissions on {selDate}.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dayList.map(s => <SubmissionRow key={s.id} sub={s} form={formOf(s)} onOpen={() => onOpenSubmission(s)} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SOPLibrary({ user, focusId, focusMode, focusBlockId, focusSubId, onClearFocus, kind = "sop", onNavigateOut, onOpenTasks }) {
  const [refresh, setRefresh] = useState(0);
  const [activeCat, setActiveCat] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState("view"); // "view" | "edit"
  const [scrollBlk, setScrollBlk] = useState(null); // magnet deep-anchor (blk id)
  const [browse, setBrowse] = useState(false);   // Forms: "View filled forms" mode
  const [subId, setSubId] = useState(null);      // submission to open in the viewer
  const [creating, setCreating] = useState(null);
  const [sort, setSort] = useState("updated");
  const [showArchived, setShowArchived] = useState(false);

  const categories = getCategories();
  const allSops = getSOPs().filter(s => (s.kind || "sop") === kind);
  const bump = () => setRefresh(r => r + 1);
  const isForm = kind === "form";

  // Deep-link: a Task Manager "Related SOP" link or a magnet can request a
  // specific SOP open (optionally scrolled to one block).
  useEffect(() => {
    if (focusId) { setOpenId(focusId); setMode(focusMode || "view"); setScrollBlk(focusBlockId || null); setSubId(focusSubId || null); onClearFocus && onClearFocus(); }
  }, [focusId, focusMode, focusBlockId, focusSubId, onClearFocus]);

  // A mention/backlink/magnet click: same-kind documents open in place;
  // anything else (the other kind, Playbook, a task) bubbles up to App.jsx.
  const handleNavigate = (navKind, id, blockId) => {
    if (navKind === (isForm ? "form" : "sop")) { setOpenId(id); setMode("view"); setScrollBlk(blockId || null); return; }
    onNavigateOut && onNavigateOut(navKind, id, blockId);
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
    return <SOPViewer sop={openSop} user={user} canEditSop={canEdit(user)} onClose={() => { setOpenId(null); setSubId(null); }} onEdit={() => setMode("edit")} onNavigate={handleNavigate} onOpenTasks={onOpenTasks} scrollToBlock={scrollBlk} onScrolled={() => setScrollBlk(null)} openSubmissionId={subId} />;
  }

  const newDoc = () => defSOP(activeCat !== "all" && activeCat !== "none" ? activeCat : "", kind);

  return (
    <div className="gk-fade-in">
      <SectionHeader
        title={isForm ? "Forms" : "SOP Library"}
        sub={`${sops.length} ${isForm ? "form" : "procedure"}${sops.length === 1 ? "" : "s"}`}
        right={(
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {isForm && (
              <OBtn onClick={() => setBrowse(b => !b)} style={browse ? { borderColor: C.moss, color: C.moss, background: C.mossSoft } : undefined}>
                <Icon name={browse ? "grid_view" : "inventory"} size={15} />{browse ? "Back to forms" : "View filled forms"}
              </OBtn>
            )}
            {canEdit(user) && (
              <>
                <OBtn onClick={() => { const n = seedStandardSections(); if (n) triggerSaved(); bump(); }} title="Add the 12 standard Green Kiss sections as categories, if missing">
                  <Icon name="playlist_add" size={16} />Load standard sections
                </OBtn>
                <ImportSopButton onImported={({ title, blocks }) => setCreating({ ...newDoc(), title, blocks })} />
                <Btn onClick={() => setCreating(newDoc())}>
                  <Icon name="add" size={17} />New {isForm ? "Form" : "SOP"}
                </Btn>
              </>
            )}
          </div>
        )}
      />

      {isForm && browse ? (
        <FormBrowse forms={allSops} onOpenSubmission={s => { setSubId(s.id); setOpenId(s.docId); setMode("view"); }} />
      ) : (
      <>

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

      {/* One dropdown instead of a pill per category (R3 #8) — the pill row
          got unwieldy once the 12 standard sections were loaded. */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24 }}>
        <select value={activeCat} onChange={e => setActiveCat(e.target.value)}
          style={{ ...inp({ width: "auto", fontSize: 14, padding: "9px 12px", minWidth: 220 }) }}>
          <option value="all">All categories ({sops.length})</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({counts[c.id] || 0})</option>
          ))}
          {counts.none > 0 && <option value="none">Uncategorized ({counts.none})</option>}
        </select>
        {activeCat !== "all" && (
          <button onClick={() => setActiveCat("all")} style={{ background: "none", border: "none", color: C.mut, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            Clear filter
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
      </>
      )}
    </div>
  );
}

export default SOPLibrary;
