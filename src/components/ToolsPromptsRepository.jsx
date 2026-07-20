import React, { useState } from 'react';
import {
  C, FONT_CAPS, uid, inp, canEdit, confirmDelete, triggerSaved, triggerToast,
  getToolsPrompts, saveToolsPrompts,
} from '../globals.js';
import { Icon, IconBtn, Btn, OBtn, Pill, SectionHeader, EmptyState, LinkPopover, ItemLink } from './shared.jsx';

/* Flat repository of team tools and reusable prompts. One kv doc
   {items:[{id,type,title,body,url,tags,createdAt}]}. Tabs split tools from
   prompts; a search box filters title+body+tags. Same edit-mode gating and
   page shape as ImageRepository. */

const TABS = [
  { key: "tool", label: "Tools", icon: "build", empty: "No tools yet", sub: "Links to apps, generators, and utilities the team uses." },
  { key: "prompt", label: "Prompts", icon: "chat", empty: "No prompts yet", sub: "Reusable AI prompts, saved for the whole team." },
];

const tabStyle = (active) => ({
  padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer",
  border: `1.5px solid ${active ? C.moss : C.bdr}`, background: active ? C.mossSoft : C.sur, color: active ? C.moss : C.mut,
  textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em",
});

const parseTags = (s) => (s || "").split(",").map(t => t.trim()).filter(Boolean);

function EditRow({ item, onPatch, onRemove }) {
  const [rect, setRect] = useState(null);
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={item.title} onChange={e => onPatch({ title: e.target.value })} placeholder="Title…" style={inp({ flex: 1 })} />
        <button type="button" title={item.url ? "Edit link" : "Add a link (web or internal magnet)"}
          onClick={e => setRect(e.currentTarget.getBoundingClientRect())}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "8px 11px", borderRadius: 7, cursor: "pointer",
            border: `1.5px solid ${item.url ? C.moss : C.bdr}`, background: item.url ? C.mossSoft : C.sur,
            color: item.url ? C.moss : C.txt2, fontFamily: "inherit", fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
          <Icon name="link" size={15} />{item.url ? "Linked" : "Link"}
        </button>
        <IconBtn icon="delete" danger title="Remove" onClick={onRemove} />
        {rect && <LinkPopover anchorRect={rect} initial={item.url || ""} onSet={u => onPatch({ url: u })} onClose={() => setRect(null)} />}
      </div>
      <textarea rows={item.type === "prompt" ? 4 : 2} value={item.body || ""} onChange={e => onPatch({ body: e.target.value })}
        placeholder={item.type === "prompt" ? "Prompt text…" : "What it's for, how to use it…"} style={inp({ lineHeight: 1.55 })} />
      <input value={item.tags || ""} onChange={e => onPatch({ tags: e.target.value })} placeholder="Tags (comma-separated)" style={inp({ fontSize: 13, padding: "7px 10px" })} />
    </div>
  );
}

function ViewRow({ item, nav }) {
  const [expanded, setExpanded] = useState(false);
  const tags = parseTags(item.tags);
  const copyBody = () => { try { navigator.clipboard.writeText(item.body || ""); triggerToast("Copied to clipboard"); } catch {} };
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.txt, flex: 1, minWidth: 120 }}>{item.title || "Untitled"}</span>
        {item.url && <ItemLink url={item.url} nav={nav}>Open</ItemLink>}
        {item.type === "prompt" && item.body && (
          <button type="button" onClick={copyBody} title="Copy prompt"
            style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: `1.5px solid ${C.bdr}`, borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: C.mut, cursor: "pointer", fontFamily: "inherit" }}>
            <Icon name="content_copy" size={14} />Copy
          </button>
        )}
      </div>
      {item.body && (
        item.type === "prompt" ? (
          <>
            <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: expanded ? "none" : 66, overflow: "hidden" }}>{item.body}</div>
            {item.body.length > 160 && (
              <button type="button" onClick={() => setExpanded(x => !x)}
                style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.moss, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.55 }}>{item.body}</div>
        )
      )}
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tags.map(t => <Pill key={t} color={C.faint}>{t}</Pill>)}
        </div>
      )}
    </div>
  );
}

function ToolsPromptsRepository({ user, onOpenSop, onNavigateOut }) {
  const [, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  const [tab, setTab] = useState("tool");
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);

  const doc = getToolsPrompts();
  const items = doc.items || [];
  const canManage = canEdit(user);
  const meta = TABS.find(t => t.key === tab);

  const nav = {
    goToSop: (id, blockId) => onOpenSop ? onOpenSop(id, blockId) : onNavigateOut && onNavigateOut("sop", id, blockId),
    goToTask: (id) => onNavigateOut && onNavigateOut("task", id),
    goToPlaybookSection: (id) => onNavigateOut && onNavigateOut("playbook", id),
  };

  const save = (next) => { saveToolsPrompts({ ...doc, items: next }); triggerSaved(); bump(); };
  const addItem = () => save([...items, { id: uid(), type: tab, title: "", body: "", url: "", tags: "", createdAt: new Date().toISOString() }]);
  const patch = (id, changes) => save(items.map(i => i.id === id ? { ...i, ...changes } : i));
  const remove = async (id) => { if (await confirmDelete("Remove this entry?")) save(items.filter(i => i.id !== id)); };

  const q = search.toLowerCase().trim();
  const shown = items.filter(i => i.type === tab && (!q || [i.title, i.body, i.tags].join(" ").toLowerCase().includes(q)));

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Tools & Prompts" sub="Team tools and reusable prompts, all in one place."
        right={canManage && (
          <OBtn active={editMode} onClick={() => setEditMode(e => !e)}>
            <Icon name={editMode ? "done" : "edit"} size={16} />{editMode ? "Done" : "Edit"}
          </OBtn>
        )} />

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
            <Icon name={t.icon} size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />{t.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${meta.label.toLowerCase()}…`}
          style={inp({ maxWidth: 360 })} />
      </div>

      {editMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.filter(i => i.type === tab).map(i => (
            <EditRow key={i.id} item={i} onPatch={c => patch(i.id, c)} onRemove={() => remove(i.id)} />
          ))}
          <Btn onClick={addItem} style={{ alignSelf: "flex-start" }}><Icon name="add" size={16} />Add {tab}</Btn>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={meta.icon} title={meta.empty} sub={meta.sub}
          action={canManage && <Btn onClick={() => setEditMode(true)}><Icon name="add" size={16} />Add entries</Btn>} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shown.map(i => <ViewRow key={i.id} item={i} nav={nav} />)}
        </div>
      )}
    </div>
  );
}

export default ToolsPromptsRepository;
