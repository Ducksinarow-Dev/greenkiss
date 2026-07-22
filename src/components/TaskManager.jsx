import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, uid, getTasks, addTask, updateTask, deleteTask, confirmDelete, triggerSaved,
  getUsers, getSOPs, getProjects, getTags, addTag, getTaskTemplates, deleteTaskTemplate,
  fmtDateShort, fmtDate, nowISO, getCurrentUser, canEdit, isOverdue, CATEGORY_COLORS,
  TASK_STATUSES, TASK_BOARD_STATUSES, TASK_PRIORITIES, taskPriorityMeta,
  TASK_TYPES, taskType, inp,
  RECURRENCE_OPTIONS, completeTaskWithRecurrence, sortTasksForUser, dispatchTaskAction, copyMagnet, addAlert,
  emptyTaskShape as emptyForm,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Chk, Avatar, SectionHeader, EmptyState, lbl, SlideOver, MetaIconBtn, Popover, LinkPopover, ItemLink } from './shared.jsx';

/* ─────────────────────────────────────────────────────────────────────
   #8 — Compact month-grid date picker (no external library). Shared by
   the due-date popover on task tiles, subtask tiles, and the task modal
   isn't required to use it (native input there is fine) but the popover
   flow needs a real calendar per the reference design notes. */
/** `dots`: {["YYYY-MM-DD"]: [color,…]} — small colored markers under a date
 * (used by the Forms submission browser; absent everywhere else). */
function MiniCalendar({ value, onSelect, dots }) {
  const initial = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const todayStr = new Date().toISOString().slice(0, 10);
  const first = new Date(viewYear, viewMonth, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const changeMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };
  const fmt = (d) => `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <IconBtn icon="chevron_left" title="Previous month" onClick={() => changeMonth(-1)} />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em" }}>{monthLabel}</div>
        <IconBtn icon="chevron_right" title="Next month" onClick={() => changeMonth(1)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.faint }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateStr = fmt(d);
          const isToday = dateStr === todayStr;
          const isSel = dateStr === value;
          return (
            <button key={i} type="button" onClick={() => onSelect(dateStr)}
              style={{
                aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                borderRadius: 7, border: isToday && !isSel ? `1.5px solid ${C.moss}` : "1.5px solid transparent",
                background: isSel ? C.moss : "transparent", color: isSel ? "#fff" : C.txt,
                fontSize: 12, fontWeight: isSel ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
              }}>
              {d}
              {dots && dots[dateStr] && (
                <span style={{ display: "flex", gap: 2 }}>
                  {dots[dateStr].slice(0, 4).map((col, j) => (
                    <span key={j} style={{ width: 4, height: 4, borderRadius: 99, background: isSel ? "#fff" : col }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── #8 popover contents ─────────────────────────────────────────── */
const pickerRowStyle = (active) => ({
  display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 9px",
  borderRadius: 8, border: "none", background: active ? C.mossSoft : "transparent", color: active ? C.moss : C.txt,
  cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: active ? 700 : 500,
});

function AssigneePopoverContent({ users, value, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <button type="button" onClick={() => onSelect("")} style={pickerRowStyle(!value)}>
        <div style={{ width: 22, height: 22, borderRadius: 99, background: C.s2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="person_off" size={13} style={{ color: C.faint }} />
        </div>
        Unassigned
      </button>
      {users.map(u => (
        <button key={u.id} type="button" onClick={() => onSelect(u.id)} style={pickerRowStyle(value === u.id)}>
          <Avatar name={u.name} size={22} />{u.name}
        </button>
      ))}
    </div>
  );
}

function PriorityPopoverContent({ value, onSelect }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {TASK_PRIORITIES.map(p => (
        <button key={p.key} type="button" onClick={() => onSelect(p.key)} style={pickerRowStyle(value === p.key)}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: p.col, flexShrink: 0 }} />{p.label}
        </button>
      ))}
    </div>
  );
}

function DueDatePopoverContent({ entity, onPatch, showRecurrence }) {
  return (
    <div>
      <MiniCalendar value={entity.dueDate} onSelect={d => onPatch({ dueDate: d })} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <OBtn onClick={() => onPatch({ dueDate: "" })} style={{ padding: "5px 12px", fontSize: 12 }}>
          <Icon name="close" size={13} />Clear
        </OBtn>
      </div>
      {showRecurrence && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.bdr}` }}>
          <label style={lbl({ marginBottom: 6 })}>Recurring</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {RECURRENCE_OPTIONS.map(r => {
              const active = (entity.recurrence || "none") === r.key;
              return (
                <button key={r.key} type="button" onClick={() => onPatch({ recurrence: r.key })}
                  style={{
                    padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                    border: `1.5px solid ${active ? C.moss : C.bdr}`, background: active ? C.mossSoft : C.sur,
                    color: active ? C.moss : C.txt2, fontWeight: active ? 700 : 500,
                  }}>{r.label}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TagsPopoverContent({ tags, valueIds, onToggle, onCreate, onClose }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const submit = () => { if (!name.trim()) return; onCreate(name.trim(), color); setName(""); setCreating(false); };
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 170, overflowY: "auto" }}>
        {tags.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "6px 4px" }}>No tags yet — create one below.</div>}
        {tags.map(t => {
          const checked = (valueIds || []).includes(t.id);
          return (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, cursor: "pointer", background: checked ? C.s2 : "transparent" }}>
              <Chk checked={checked} onChange={() => onToggle(t.id)} size={16} />
              <Pill color={t.color}>{t.name}</Pill>
            </label>
          );
        })}
      </div>
      <div style={{ borderTop: `1px solid ${C.bdr}`, marginTop: 8, paddingTop: 8 }}>
        {!creating ? (
          <OBtn onClick={() => setCreating(true)} style={{ width: "100%", justifyContent: "center", padding: "7px 10px", fontSize: 12 }}>
            <Icon name="add" size={14} />New Tag
          </OBtn>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tag name…"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              style={inp({ fontSize: 13, padding: "7px 10px" })} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CATEGORY_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  style={{ width: 20, height: 20, borderRadius: 99, background: c, cursor: "pointer", border: color === c ? `2px solid ${C.txt}` : "2px solid transparent" }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <OBtn onClick={() => setCreating(false)} style={{ padding: "6px 12px", fontSize: 12 }}>Cancel</OBtn>
              <Btn onClick={submit} disabled={!name.trim()} style={{ padding: "6px 12px", fontSize: 12 }}>Create</Btn>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <Btn onClick={onClose} style={{ padding: "6px 16px", fontSize: 12 }}>Done</Btn>
      </div>
    </div>
  );
}

/** The four-icon metadata row — assignee/date/priority/tags — shared by
 * task tiles and subtask mini-cards (subtasks pass allowTags={false} and
 * carry no recurrence). Manages its own popover open state. */
function MetaRow({ entity, users, tags, allowTags = true, onPatch }) {
  const [openField, setOpenField] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const openPopover = (field, e) => {
    e.stopPropagation();
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setOpenField(f => (f === field ? null : field));
  };
  const close = () => setOpenField(null);

  const assigneeKey = "assignedTo" in entity ? "assignedTo" : "assigneeId";
  const assignee = users.find(u => u.id === entity[assigneeKey]);
  const pm = taskPriorityMeta[entity.priority] || TASK_PRIORITIES[1];
  const entityTags = allowTags ? (entity.tagIds || []).map(id => tags.find(t => t.id === id)).filter(Boolean) : [];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
      <MetaIconBtn icon="person" label="Assignee" active={!!assignee} onClick={e => openPopover("assignee", e)}>
        {assignee ? assignee.name.split(" ")[0] : null}
      </MetaIconBtn>
      <MetaIconBtn icon="calendar_today" label="Due date" active={!!entity.dueDate} onClick={e => openPopover("date", e)}>
        {entity.dueDate ? fmtDateShort(entity.dueDate) : null}
      </MetaIconBtn>
      <MetaIconBtn icon="flag" label="Priority" active activeColor={pm.col} onClick={e => openPopover("priority", e)} />
      {allowTags && (
        <MetaIconBtn icon="label" label="Tags" active={entityTags.length > 0} onClick={e => openPopover("tags", e)}>
          {entityTags[0] ? entityTags[0].name + (entityTags.length > 1 ? ` +${entityTags.length - 1}` : "") : null}
        </MetaIconBtn>
      )}

      {openField === "assignee" && (
        <Popover anchorRect={anchorRect} onClose={close} width={210}>
          <AssigneePopoverContent users={users} value={entity[assigneeKey]} onSelect={id => { onPatch({ [assigneeKey]: id }); close(); }} />
        </Popover>
      )}
      {openField === "date" && (
        <Popover anchorRect={anchorRect} onClose={close} width={260}>
          <DueDatePopoverContent entity={entity} onPatch={onPatch} showRecurrence={allowTags} />
        </Popover>
      )}
      {openField === "priority" && (
        <Popover anchorRect={anchorRect} onClose={close} width={170}>
          <PriorityPopoverContent value={entity.priority} onSelect={p => { onPatch({ priority: p }); close(); }} />
        </Popover>
      )}
      {openField === "tags" && allowTags && (
        <Popover anchorRect={anchorRect} onClose={close} width={230}>
          <TagsPopoverContent tags={tags} valueIds={entity.tagIds} onClose={close}
            onToggle={id => {
              const has = (entity.tagIds || []).includes(id);
              onPatch({ tagIds: has ? entity.tagIds.filter(x => x !== id) : [...(entity.tagIds || []), id] });
            }}
            onCreate={(name, color) => { const t = addTag(name, color); onPatch({ tagIds: [...(entity.tagIds || []), t.id] }); }} />
        </Popover>
      )}
    </div>
  );
}

/** Nested mini-card for a subtask, rendered under a parent tile's disclosure.
 * Subtasks are first-class here — individually assignable/dateable/
 * prioritizable without opening the parent (reference design note 3). */
function SubtaskMiniCard({ sub, users, onPatch }) {
  return (
    <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chk checked={sub.done} onChange={() => onPatch({ done: !sub.done })} size={16} />
        <span style={{ flex: 1, fontSize: 13, color: sub.done ? C.mut : C.txt, textDecoration: sub.done ? "line-through" : "none" }}>{sub.text}</span>
      </div>
      <MetaRow entity={sub} users={users} tags={[]} allowTags={false} onPatch={onPatch} />
    </div>
  );
}

const labelStyle = lbl();

function SubTaskRow({ sub, users, onChange, onRemove }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0" }}>
      <Chk checked={sub.done} onChange={() => onChange({ done: !sub.done })} />
      <span style={{ flex: "1 1 140px", minWidth: 100, fontSize: 14, textDecoration: sub.done ? "line-through" : "none", color: sub.done ? C.mut : C.txt }}>{sub.text}</span>
      <select value={sub.assigneeId || ""} onChange={e => onChange({ assigneeId: e.target.value })}
        style={inp({ width: "auto", flex: "0 0 auto", fontSize: 12, padding: "5px 8px" })} title="Assignee">
        <option value="">Unassigned</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <input type="date" value={sub.dueDate || ""} onChange={e => onChange({ dueDate: e.target.value })}
        style={inp({ width: "auto", flex: "0 0 auto", fontSize: 12, padding: "5px 8px" })} />
      <select value={sub.priority || "medium"} onChange={e => onChange({ priority: e.target.value })}
        style={inp({ width: "auto", flex: "0 0 auto", fontSize: 12, padding: "5px 8px" })} title="Priority">
        {TASK_PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      <IconBtn icon="close" title="Remove" onClick={onRemove} />
    </div>
  );
}

/** One row of the modal's Links section (R4 D2): label input + the shared
 * web/internal LinkPopover behind a bordered "Link" button (same treatment
 * as SOP list-item links, so magnet linking looks identical everywhere). */
function TaskLinkRow({ link, nav, onChange, onRemove }) {
  const [rect, setRect] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input value={link.label} onChange={e => onChange({ label: e.target.value })} placeholder="Label…"
          style={inp({ fontSize: 13, padding: "7px 10px", flex: 1 })} />
        <button type="button" title={link.url ? "Edit link" : "Add a link (web or internal magnet)"}
          onClick={e => setRect(e.currentTarget.getBoundingClientRect())}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 7, cursor: "pointer",
            border: `1.5px solid ${link.url ? C.moss : C.bdr2}`, background: link.url ? C.mossSoft : C.sur,
            color: link.url ? C.moss : C.txt2, fontFamily: "inherit", fontSize: 11.5, fontWeight: 700, flexShrink: 0,
          }}>
          <Icon name="link" size={14} />{link.url ? "Linked" : "Link"}
        </button>
        <IconBtn icon="close" title="Remove link" onClick={onRemove} />
        {rect && <LinkPopover anchorRect={rect} initial={link.url || ""} onSet={u => onChange({ url: u })} onClose={() => setRect(null)} />}
      </div>
      {link.url && (
        <div style={{ fontSize: 12.5, paddingLeft: 2 }}>
          <ItemLink url={link.url} nav={nav}>{link.label || link.url}</ItemLink>
        </div>
      )}
    </div>
  );
}

function TaskModal({ initial, users, sops, projects, tags, onSave, onDelete, onClose, isNew, wide, nav }) {
  const [form, setForm] = useState(initial);
  const [subInput, setSubInput] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isSopRun = !!form.fromSopRun;
  const [completing, setCompleting] = useState(false);
  const [runNotes, setRunNotes] = useState("");

  // Day-end "Complete run" for SOP-run tasks: record who + when + notes, mark
  // done, and save (mirrors the old in-viewer Completion block).
  const confirmCompleteRun = () => {
    const me = getCurrentUser();
    onSave({ ...form, status: "done", runCompletion: { by: me?.id || "", at: nowISO(), notes: runNotes.trim() } });
  };

  const addSub = () => {
    if (!subInput.trim()) return;
    set("subTasks", [...(form.subTasks || []), { id: uid(), text: subInput.trim(), done: false, assigneeId: "", dueDate: "", priority: "medium" }]);
    setSubInput("");
  };
  const changeSub = (id, changes) => set("subTasks", (form.subTasks || []).map(s => s.id === id ? { ...s, ...changes } : s));
  const removeSub = (id) => set("subTasks", (form.subTasks || []).filter(s => s.id !== id));
  const toggleTag = (id) => {
    const has = (form.tagIds || []).includes(id);
    set("tagIds", has ? form.tagIds.filter(x => x !== id) : [...(form.tagIds || []), id]);
  };
  const addLink = () => set("links", [...(form.links || []), { id: uid(), label: "", url: "" }]);
  const changeLink = (id, changes) => set("links", (form.links || []).map(l => l.id === id ? { ...l, ...changes } : l));
  const removeLink = (id) => set("links", (form.links || []).filter(l => l.id !== id));

  // Send alert (R4 D5): flag this task for a staff member — same addAlert
  // record the tile overflow action writes; lands on their dashboard strip
  // and their next-login toast.
  const [alertAnchor, setAlertAnchor] = useState(null);
  const [alertSent, setAlertSent] = useState(null); // user name, for the confirmation blip
  const me = getCurrentUser();
  const alertTargets = users.filter(u => u.id !== me?.id);
  const sendAlert = (userId) => {
    addAlert(form.id, userId);
    triggerSaved();
    setAlertSent(users.find(u => u.id === userId)?.name || "them");
    setAlertAnchor(null);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: wide ? 720 : 680, maxHeight: "88vh", overflowY: "auto", padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? (isSopRun ? "Run SOP — new task" : "New Task") : "Edit Task"}</div>
          {!isNew && <IconBtn icon="my_location" title="Copy magnet link to this task" onClick={() => copyMagnet("task", form.id)} />}
          {!isNew && <IconBtn icon="delete" danger title="Delete task" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        {isSopRun && (
          <div style={{ fontSize: 12.5, color: C.mut, marginBottom: 16, background: C.mossSoft, borderRadius: 9, padding: "8px 12px" }}>
            <Icon name="play_circle" size={14} style={{ color: C.moss, verticalAlign: "-2px", marginRight: 5 }} />
            Prefilled from the SOP. Adjust assignee / date, then Create to add it to the board.
            {form.runCompletion?.at && <span style={{ display: "block", marginTop: 4, color: C.moss, fontWeight: 700 }}>Run completed {fmtDate(form.runCompletion.at)}.</span>}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <label style={labelStyle}>Type</label>
              <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}`, width: "fit-content" }}>
                {TASK_TYPES.map(t => (
                  <button key={t.key} type="button" onClick={() => set("type", t.key)} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                    fontFamily: FONT_CAPS, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
                    background: (form.type || "task") === t.key ? C.sur : "transparent",
                    color: (form.type || "task") === t.key ? C.moss : C.mut,
                    boxShadow: (form.type || "task") === t.key ? C.shadowSm : "none",
                  }}>
                    <Icon name={t.icon} size={15} />{t.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: "0 1 300px", minWidth: 160 }}>
              <label style={labelStyle}>Tags</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                {(tags || []).map(t => {
                  const checked = (form.tagIds || []).includes(t.id);
                  return (
                    <label key={t.id} style={{ cursor: "pointer" }} onClick={() => toggleTag(t.id)}>
                      <Pill color={t.color} style={{ opacity: checked ? 1 : 0.45, background: checked ? t.color + "18" : "transparent" }}>
                        {checked && <Icon name="check" size={11} />}{t.name}
                      </Pill>
                    </label>
                  );
                })}
                {(tags || []).length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No tags yet — create one from a task tile's tag icon.</div>}
              </div>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input autoFocus value={form.title} onChange={e => set("title", e.target.value)} placeholder="Task title…" style={inp()} />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Optional details…" style={inp({ lineHeight: 1.55 })} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)} style={inp()}>
                {TASK_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Priority</label>
              <select value={form.priority} onChange={e => set("priority", e.target.value)} style={inp()}>
                {TASK_PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Assigned to</label>
              <select value={form.assignedTo} onChange={e => set("assignedTo", e.target.value)} style={inp()}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Due date</label>
              <input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} style={inp()} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Recurring</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RECURRENCE_OPTIONS.map(r => {
                const active = (form.recurrence || "none") === r.key;
                return (
                  <button key={r.key} type="button" onClick={() => set("recurrence", r.key)} style={{
                    padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                    border: `1.5px solid ${active ? C.moss : C.bdr}`, background: active ? C.mossSoft : C.sur,
                    color: active ? C.moss : C.txt2, fontWeight: active ? 700 : 500,
                  }}>{r.label}</button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Project</label>
              <select value={form.projectId || ""} onChange={e => set("projectId", e.target.value)} style={inp()}>
                <option value="">No project</option>
                {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name || "Untitled project"}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Related SOP</label>
              <select value={form.relatedSopId} onChange={e => set("relatedSopId", e.target.value)} style={inp()}>
                <option value="">None</option>
                {sops.map(s => <option key={s.id} value={s.id}>{s.title || "Untitled SOP"}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Links</label>
            {(form.links || []).length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                {(form.links || []).map(l => (
                  <TaskLinkRow key={l.id} link={l} nav={nav} onChange={c => changeLink(l.id, c)} onRemove={() => removeLink(l.id)} />
                ))}
              </div>
            )}
            <OBtn onClick={addLink} style={{ padding: "6px 12px", fontSize: 12 }}><Icon name="add_link" size={15} />Add link</OBtn>
          </div>

          <div>
            <label style={labelStyle}>Sub-tasks</label>
            <div style={{ display: "flex", flexDirection: "column", marginBottom: 8 }}>
              {(form.subTasks || []).map(s => (
                <SubTaskRow key={s.id} sub={s} users={users} onChange={c => changeSub(s.id, c)} onRemove={() => removeSub(s.id)} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={subInput} onChange={e => setSubInput(e.target.value)} placeholder="Add a sub-task…"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSub(); } }}
                style={inp({ fontSize: 14, padding: "8px 12px" })} />
              <OBtn onClick={addSub} style={{ padding: "8px 14px" }}>Add</OBtn>
            </div>
          </div>
        </div>

        {completing && (
          <div style={{ marginTop: 20, padding: "14px 16px", background: C.mossSoft, border: `1.5px solid ${C.moss}55`, borderRadius: 12 }}>
            <label style={labelStyle}>Completion notes (optional)</label>
            <textarea autoFocus rows={2} value={runNotes} onChange={e => setRunNotes(e.target.value)} placeholder="Anything worth noting about this run…" style={inp({ lineHeight: 1.5 })} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <OBtn onClick={() => setCompleting(false)}>Cancel</OBtn>
              <Btn onClick={confirmCompleteRun}><Icon name="task_alt" size={15} />Complete run</Btn>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 24 }}>
          {isSopRun && !isNew && form.status !== "done" && !completing && (
            <OBtn onClick={() => setCompleting(true)}><Icon name="task_alt" size={15} />Complete run</OBtn>
          )}
          {!isNew && (alertSent ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.moss }}>
              <Icon name="check_circle" size={15} />Alerted {alertSent}
            </span>
          ) : (
            <OBtn onClick={e => setAlertAnchor(e.currentTarget.getBoundingClientRect())}>
              <Icon name="campaign" size={15} />Send alert
            </OBtn>
          ))}
          {alertAnchor && (
            <Popover anchorRect={alertAnchor} onClose={() => setAlertAnchor(null)} width={210}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", color: C.faint, padding: "2px 6px 6px" }}>Alert who?</div>
                {alertTargets.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "4px 6px" }}>No other staff to alert.</div>}
                {alertTargets.map(u => (
                  <button key={u.id} type="button" onClick={() => sendAlert(u.id)} style={pickerRowStyle(u.id === form.assignedTo)}>
                    <Avatar name={u.name} size={22} />{u.name}
                  </button>
                ))}
              </div>
            </Popover>
          )}
          <div style={{ flex: 1 }} />
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.title.trim()}>{isNew && isSopRun ? "Create" : "Save"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── #9 hover pill + overflow menu ──────────────────────────────── */
function PillIconBtn({ icon, title, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick} title={title} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: 26, height: 26, borderRadius: 99, border: "none", background: hov ? C.mossSoft : "transparent", color: hov ? C.moss : C.txt2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
      <Icon name={icon} size={15} />
    </button>
  );
}

function HoverPill({ onComplete, onAddSubtask, onRename, onOverflow }) {
  return (
    <div onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", top: -13, right: 8, display: "flex", alignItems: "center", gap: 1,
        background: C.sur, border: `1.5px solid ${C.bdr2}`, borderRadius: 99, padding: 3, boxShadow: C.shadowMd, zIndex: 6,
      }}>
      <PillIconBtn icon="check_circle" title="Mark complete" onClick={onComplete} />
      <PillIconBtn icon="playlist_add" title="Add subtask" onClick={onAddSubtask} />
      <PillIconBtn icon="edit" title="Rename" onClick={onRename} />
      <PillIconBtn icon="more_horiz" title="More" onClick={onOverflow} />
    </div>
  );
}

function MenuRow({ icon, label, onClick, chevron, danger, highlight }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "7px 9px", borderRadius: 8, border: "none",
        background: hov ? (danger ? C.red + "14" : C.s2) : (highlight ? C.mossSoft : "transparent"),
        color: danger ? C.red : (highlight ? C.moss : C.txt), cursor: "pointer", fontFamily: "inherit", fontSize: 13, textAlign: "left",
      }}>
      <Icon name={icon} size={16} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {chevron && <Icon name="chevron_right" size={15} style={{ color: C.faint }} />}
    </button>
  );
}
function SubMenuShell({ title, onBack, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.bdr}` }}>
        <IconBtn icon="arrow_back" title="Back" onClick={onBack} />
        <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em" }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 220, overflowY: "auto" }}>{children}</div>
    </div>
  );
}
function EmptyRow({ text }) { return <div style={{ fontSize: 12, color: C.faint, padding: "8px 6px" }}>{text}</div>; }

/** The full #9 overflow menu — a single anchored popover with an internal
 * multi-step flow (top-level list, then a "submenu" mode for anything that
 * needs a picker: alert target, merge target, project, template, convert
 * target) rather than true flyouts, so positioning/dismissal stays simple. */
function TaskOverflowMenu({ task, users, projects, templates, allTasks, currentUser, anchorRect, onClose, onAction }) {
  const [mode, setMode] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const isFav = (task.favouritedBy || []).includes(currentUser?.id);
  const otherTasks = (allTasks || []).filter(t => t.id !== task.id && !t.archived);
  const otherUsers = (users || []).filter(u => u.id !== currentUser?.id);
  const back = () => setMode(null);
  const act = (action, extra) => { onAction(action, extra); onClose(); };

  const doConvertProject = async () => {
    const ok = await confirmDelete(`Convert "${task.title}" into a project? Its subtasks become real tasks in the new project, and this task is deleted.`);
    if (ok) act("convertProject");
  };

  return (
    <Popover anchorRect={anchorRect} onClose={onClose} width={250}>
      {mode === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <MenuRow icon={isFav ? "star" : "star_outline"} label={isFav ? "Unfavourite" : "Favourite"} onClick={() => act("favourite")} highlight={isFav} />
          <MenuRow icon="campaign" label="Alert staff member" onClick={() => setMode("alert")} chevron />
          <MenuRow icon="content_copy" label="Duplicate" onClick={() => act("duplicate")} />
          <MenuRow icon="call_merge" label="Merge into…" onClick={() => setMode("merge")} chevron />
          <MenuRow icon="drive_file_move" label="Add to project…" onClick={() => setMode("addToProject")} chevron />
          <MenuRow icon="dashboard_customize" label="Templates" onClick={() => setMode("templates")} chevron />
          <div style={{ height: 1, background: C.bdr, margin: "5px 2px" }} />
          <MenuRow icon={task.archived ? "unarchive" : "archive"} label={task.archived ? "Unarchive" : "Archive"} onClick={() => act(task.archived ? "unarchive" : "archive")} />
          <MenuRow icon="swap_horiz" label="Convert to…" onClick={() => setMode("convert")} chevron />
          <div style={{ height: 1, background: C.bdr, margin: "5px 2px" }} />
          <MenuRow icon="delete" label="Delete" danger onClick={async () => {
            const ok = await confirmDelete(`Delete "${task.title}"? This can't be undone.`);
            if (ok) act("delete");
          }} />
        </div>
      )}
      {mode === "alert" && (
        <SubMenuShell title="Alert staff member" onBack={back}>
          {otherUsers.length === 0 && <EmptyRow text="No other staff to alert." />}
          {otherUsers.map(u => <MenuRow key={u.id} icon="person" label={u.name} onClick={() => act("alert", { userId: u.id })} />)}
        </SubMenuShell>
      )}
      {mode === "merge" && (
        <SubMenuShell title="Merge into…" onBack={back}>
          {otherTasks.length === 0 && <EmptyRow text="No other tasks to merge into." />}
          {otherTasks.map(t => (
            <MenuRow key={t.id} icon="task" label={t.title || "Untitled task"} onClick={async () => {
              const ok = await confirmDelete(`Merge "${task.title}" into "${t.title}"? Its description appends, subtasks move over, tags combine, and "${task.title}" is deleted. This can't be undone.`);
              if (ok) act("merge", { target: t });
            }} />
          ))}
        </SubMenuShell>
      )}
      {mode === "addToProject" && (
        <SubMenuShell title="Add to project…" onBack={back}>
          <MenuRow icon="block" label="No project" onClick={() => act("addToProject", { projectId: "" })} highlight={!task.projectId} />
          {(projects || []).map(p => (
            <MenuRow key={p.id} icon="folder" label={p.name || "Untitled project"} onClick={() => act("addToProject", { projectId: p.id })} highlight={task.projectId === p.id} />
          ))}
        </SubMenuShell>
      )}
      {mode === "templates" && (
        <SubMenuShell title="Templates" onBack={back}>
          <div style={{ padding: "2px 2px 8px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Save this as…"
                style={inp({ fontSize: 12, padding: "6px 9px" })} />
              <Btn onClick={() => { if (!templateName.trim()) return; act("saveTemplate", { name: templateName.trim() }); }}
                disabled={!templateName.trim()} style={{ padding: "6px 10px", fontSize: 11 }}>Save</Btn>
            </div>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", color: C.faint, padding: "4px 6px" }}>Apply existing</div>
          {(templates || []).length === 0 && <EmptyRow text="No templates saved yet." />}
          {(templates || []).map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}><MenuRow icon="dashboard_customize" label={t.name} onClick={() => act("applyTemplate", { template: t })} /></div>
              <IconBtn icon="delete" danger title="Delete template" onClick={async (e) => {
                e.stopPropagation();
                const ok = await confirmDelete(`Delete template "${t.name}"?`);
                if (ok) { deleteTaskTemplate(t.id); onClose(); }
              }} />
            </div>
          ))}
        </SubMenuShell>
      )}
      {mode === "convert" && (
        <SubMenuShell title="Convert to…" onBack={back}>
          <MenuRow icon="folder_special" label="Project" onClick={doConvertProject} />
          <MenuRow icon="checklist" label="Subtask of…" onClick={() => setMode("convertSubtask")} chevron />
        </SubMenuShell>
      )}
      {mode === "convertSubtask" && (
        <SubMenuShell title="Subtask of…" onBack={() => setMode("convert")}>
          {otherTasks.length === 0 && <EmptyRow text="No other tasks available." />}
          {otherTasks.map(t => (
            <MenuRow key={t.id} icon="task" label={t.title || "Untitled task"} onClick={async () => {
              const hasExtra = (task.subTasks || []).length > 0 || !!task.description || (task.tagIds || []).length > 0;
              const warn = hasExtra ? " Its own subtasks, description, and tags will be flattened/lost." : "";
              const ok = await confirmDelete(`Make "${task.title}" a subtask of "${t.title}"?${warn} This can't be undone.`);
              if (ok) act("convertSubtask", { target: t });
            }} />
          ))}
        </SubMenuShell>
      )}
    </Popover>
  );
}

function TaskCard({ task, users, sops, projects, tags, templates, allTasks, currentUser, onOpen, onDragStart, onDragOver, isDragOver, onQuickToggle, onOpenSop, onPatchTask, onAction, nav }) {
  const sop = sops.find(s => s.id === task.relatedSopId);
  const project = (projects || []).find(p => p.id === task.projectId);
  const subTasks = task.subTasks || [];
  const stDone = subTasks.filter(s => s.done).length;
  const tm = taskType(task);
  const isMilestone = tm.key === "milestone";
  const isNote = tm.key === "note";
  const overdue = !isNote && isOverdue(task.dueDate, task.status === "done");
  const isDone = task.status === "done";
  const isFav = (task.favouritedBy || []).includes(currentUser?.id);
  const isRecurring = task.recurrence && task.recurrence !== "none";

  const [pillVisible, setPillVisible] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(task.title);
  const [addingSub, setAddingSub] = useState(false);
  const [subInput, setSubInput] = useState("");
  const [overflowAnchor, setOverflowAnchor] = useState(null);

  const patchSubtask = (subId, patch) => onPatchTask({ subTasks: subTasks.map(s => s.id === subId ? { ...s, ...patch } : s) });
  const submitRename = () => { const v = renameVal.trim(); if (v) onAction("rename", { title: v }); setRenaming(false); };
  const submitAddSub = () => { const v = subInput.trim(); if (v) { onAction("addSubtask", { text: v }); setSubOpen(true); } setSubInput(""); setAddingSub(false); };

  return (
    <div draggable onDragStart={e => onDragStart(e, task.id)} onDragOver={e => onDragOver(e, task.id)} onClick={onOpen}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => setPillVisible(true)}
      onMouseLeave={() => { if (!overflowAnchor) setPillVisible(false); }}
      onFocus={() => setPillVisible(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPillVisible(false); }}
      style={{
        position: "relative", background: C.sur, border: `1.5px solid ${isDragOver ? C.moss : C.bdr}`, borderRadius: 11,
        padding: "12px 14px", cursor: "pointer", boxShadow: isDragOver ? `0 0 0 2px ${C.mossSoft}` : C.shadowSm,
        transition: "border-color .1s", opacity: task.archived ? 0.55 : 1,
      }}>
      {pillVisible && (
        <HoverPill
          onComplete={() => onQuickToggle()}
          onAddSubtask={() => { setSubOpen(true); setAddingSub(true); }}
          onRename={() => setRenaming(true)}
          onOverflow={e => setOverflowAnchor(e.currentTarget.getBoundingClientRect())}
        />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div onClick={e => { e.stopPropagation(); onQuickToggle(); }}
          role="checkbox" aria-checked={isDone} tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onQuickToggle(); } }}
          style={{
            width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginTop: 1, cursor: "pointer",
            border: `1.5px solid ${isDone ? C.moss : C.bdr2}`, background: isDone ? C.moss : C.sur,
            display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
          }}>
          {isDone && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name={tm.icon} size={15} style={{ color: isMilestone ? C.moss : C.faint, flexShrink: 0 }} title={tm.label} />
            {isFav && <Icon name="star" size={14} style={{ color: C.clay, flexShrink: 0 }} title="Favourited" />}
            {isRecurring && <Icon name="repeat" size={14} style={{ color: C.mut, flexShrink: 0 }} title={`Repeats ${task.recurrence}`} />}
            {renaming ? (
              <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitRename(); } if (e.key === "Escape") setRenaming(false); }}
                onBlur={submitRename}
                style={{ ...inp({ fontSize: 15, padding: "3px 7px", fontWeight: 700 }), flex: 1 }} />
            ) : (
              <div style={{
                fontSize: 15, fontWeight: isMilestone ? 800 : 700, color: isMilestone ? C.moss : C.txt,
                textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.6 : 1,
              }}>{task.title}</div>
            )}
            {!renaming && task.description && <Icon name="subject" size={13} style={{ color: C.faint, flexShrink: 0 }} title="Has a description" />}
          </div>
          {project && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: project.color || C.moss, marginTop: 3, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.04em", fontWeight: 600 }} title="Project">
              <Icon name="folder" size={13} />{project.name || "Untitled project"}
            </div>
          )}
          {sop && (
            <div onClick={e => { e.stopPropagation(); onOpenSop && onOpenSop(sop.id); }}
              role="link" tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpenSop && onOpenSop(sop.id); } }}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.moss, marginTop: 3, cursor: "pointer", width: "fit-content" }}
              title="Open related SOP">
              <Icon name="menu_book" size={13} />{sop.title || "Untitled SOP"}
            </div>
          )}
          {(task.links || []).some(l => l.url) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px", marginTop: 3, fontSize: 12 }} onClick={e => e.stopPropagation()}>
              {(task.links || []).filter(l => l.url).map(l => (
                <ItemLink key={l.id} url={l.url} nav={nav}>{l.label || l.url}</ItemLink>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <MetaRow entity={task} users={users} tags={tags} allowTags onPatch={onPatchTask} />
      </div>

      {overdue && task.dueDate && (
        <div style={{ marginTop: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: C.red, background: C.red + "18", border: `1px solid ${C.red}38`,
            borderRadius: 99, padding: "2px 9px", fontFamily: "'IBM Plex Mono',monospace", display: "inline-flex", alignItems: "center", gap: 4,
          }}><Icon name="event_busy" size={12} />Overdue — {fmtDateShort(task.dueDate)}</span>
        </div>
      )}

      {subTasks.length > 0 && (
        <button type="button" onClick={e => { e.stopPropagation(); setSubOpen(o => !o); }}
          style={{
            display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer",
            fontFamily: "inherit", padding: 0, marginTop: 10, fontSize: 11, fontWeight: 700,
            color: stDone === subTasks.length ? C.moss : C.mut,
          }}>
          <Icon name={subOpen ? "expand_less" : "expand_more"} size={15} />
          {stDone}/{subTasks.length} subtask{subTasks.length === 1 ? "" : "s"}
        </button>
      )}

      {(subOpen || addingSub) && (
        <div style={{ marginTop: 9, paddingLeft: 13, borderLeft: `2px solid ${C.bdr}`, display: "flex", flexDirection: "column", gap: 7 }} onClick={e => e.stopPropagation()}>
          {subTasks.map(s => <SubtaskMiniCard key={s.id} sub={s} users={users} onPatch={patch => patchSubtask(s.id, patch)} />)}
          {addingSub && (
            <div style={{ display: "flex", gap: 6 }}>
              <input autoFocus value={subInput} onChange={e => setSubInput(e.target.value)} placeholder="New subtask…"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitAddSub(); } if (e.key === "Escape") setAddingSub(false); }}
                onBlur={submitAddSub}
                style={inp({ fontSize: 13, padding: "6px 9px" })} />
              <Btn onClick={submitAddSub} style={{ padding: "6px 12px", fontSize: 12 }}>Add</Btn>
            </div>
          )}
        </div>
      )}

      {overflowAnchor && (
        <TaskOverflowMenu task={task} users={users} projects={projects} templates={templates} allTasks={allTasks} currentUser={currentUser}
          anchorRect={overflowAnchor} onClose={() => setOverflowAnchor(null)} onAction={onAction} />
      )}
    </div>
  );
}

/** The Done bucket lives here instead of a permanent 4th board column
 * (#6) — same task cards, reachable via the "Done (n)" button in the
 * header. A Done / Archived segmented toggle (#9) surfaces archived
 * tasks too, with an Unarchive action available from their overflow menu.
 * Un-checking a card's checkbox sends it back to To Do. */
function TaskDoneSlideOver({ doneTasks, archivedTasks, cardProps, onClose }) {
  const [tab, setTab] = useState("done");
  const list = tab === "done" ? doneTasks : archivedTasks;
  return (
    <SlideOver title={tab === "done" ? `Done (${doneTasks.length})` : `Archived (${archivedTasks.length})`} icon="task_alt" onClose={onClose}>
      <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}`, width: "fit-content", marginBottom: 14 }}>
        {[{ key: "done", label: "Done" }, { key: "archived", label: "Archived" }].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
            padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
            fontFamily: FONT_CAPS, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
            background: tab === t.key ? C.sur : "transparent", color: tab === t.key ? C.moss : C.mut,
            boxShadow: tab === t.key ? C.shadowSm : "none",
          }}>{t.label}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "30px 10px", fontSize: 13, color: C.faint }}>
          {tab === "done" ? "No completed tasks yet." : "Nothing archived."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {list.map(t => (
            <TaskCard key={t.id} task={t} {...cardProps}
              onOpen={() => cardProps.onOpen(t)} onDragStart={() => {}} onDragOver={() => {}} isDragOver={false}
              onQuickToggle={() => cardProps.onQuickToggle(t)} onPatchTask={patch => cardProps.onPatchTask(t, patch)}
              onAction={(action, extra) => cardProps.onAction(t, action, extra)} />
          ))}
        </div>
      )}
    </SlideOver>
  );
}

const TASKS_VIEW_KEY = "gkTasksView";
const getTasksView = () => { try { return localStorage.getItem(TASKS_VIEW_KEY) || "board"; } catch { return "board"; } };
const setTasksView = (v) => { try { localStorage.setItem(TASKS_VIEW_KEY, v); } catch { /* private mode */ } };

function TaskManager({ user, onOpenSop, focusTaskId, onClearFocus, onNavigateOut }) {
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null); // {task, isNew}
  const [view, setView] = useState(getTasksView); // Board / List (R4 D1), persisted per-browser
  const changeView = (v) => { setView(v); setTasksView(v); };
  const [hideProjectTasks, setHideProjectTasks] = useState(false); // R4 D6

  // Magnet deep-link (gk:task:<id>): open that task's modal on arrival.
  useEffect(() => {
    if (!focusTaskId) return;
    const t = getTasks().find(x => x.id === focusTaskId);
    if (t) setModal({ task: { ...t }, isNew: false });
    onClearFocus && onClearFocus();
  }, [focusTaskId, onClearFocus]);
  const [showDone, setShowDone] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [query, setQuery] = useState("");
  const [dragItem, setDragItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const bump = () => setRefresh(r => r + 1);

  const users = getUsers();
  const sops = getSOPs();
  const projects = getProjects();
  const tags = getTags();
  const templates = getTaskTemplates();
  const allTasks = getTasks();
  const editable = canEdit(user);

  const visibleTasks = allTasks.filter(t => !t.archived);
  const filtered = visibleTasks.filter(t => {
    if (hideProjectTasks && t.projectId) return false;
    if (filterAssignee && t.assignedTo !== filterAssignee) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (filterProject && t.projectId !== filterProject) return false;
    if (filterTag && !(t.tagIds || []).includes(filterTag)) return false;
    if (query && !t.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const sorted = sortTasksForUser(filtered, user?.id || "");
  // R4 D7: cluster tasks by project within each column/section — a stable
  // sort by project name after the favourite/priority ordering, so clusters
  // are alphabetical and the usual order survives inside each cluster.
  // No-project tasks ("" sorts first) stay at the top.
  const projName = (id) => (id && projects.find(p => p.id === id)?.name) || "";
  const clustered = [...sorted].sort((a, b) => projName(a.projectId).localeCompare(projName(b.projectId)));
  const byStatus = (s) => clustered.filter(t => t.status === s);

  const openNew = () => setModal({ task: { ...emptyForm(), assignedTo: user?.id || "" }, isNew: true });
  const openEdit = (task) => setModal({ task: { ...task }, isNew: false });

  const saveModal = (form) => {
    if (modal.isNew) addTask(form);
    else updateTask(form.id, form);
    triggerSaved();
    setModal(null); bump();
  };
  const deleteModal = async () => {
    const ok = await confirmDelete(`Delete "${modal.task.title}"? This can't be undone.`);
    if (!ok) return;
    deleteTask(modal.task.id);
    triggerSaved();
    setModal(null); bump();
  };
  const quickToggle = (task) => { completeTaskWithRecurrence(task); triggerSaved(); bump(); };
  const patchTask = (task, patch) => { updateTask(task.id, patch); triggerSaved(); bump(); };
  const taskAction = (task, action, extra) => { dispatchTaskAction(task, action, extra, user); triggerSaved(); bump(); };

  const onDragStart = (e, id) => { setDragItem(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOverCard = (e, id) => { e.preventDefault(); e.stopPropagation(); setDragOverItem(id); };
  const onDropColumn = (e, status) => {
    e.preventDefault();
    if (!dragItem) return;
    const col = byStatus(status);
    if (dragOverItem && dragOverItem !== dragItem) {
      const without = col.filter(t => t.id !== dragItem);
      const idx = without.findIndex(t => t.id === dragOverItem);
      const dragTask = allTasks.find(t => t.id === dragItem);
      const reordered = idx === -1 ? [...without, dragTask] : [...without.slice(0, idx), dragTask, ...without.slice(idx)];
      reordered.forEach((t, i) => updateTask(t.id, { status, order: i }));
    } else {
      updateTask(dragItem, { status });
    }
    setDragItem(null); setDragOverItem(null); bump();
  };

  const openCount = visibleTasks.filter(t => t.status !== "done").length;
  const doneTasks = byStatus("done");
  const archivedTasks = allTasks.filter(t => t.archived);

  // Magnet-link navigation for task links (R4 D2): SOP/playbook targets
  // bubble up to App; a task magnet just opens that task's modal here.
  const nav = {
    goToSop: (id, blockId) => onOpenSop && onOpenSop(id, blockId),
    goToTask: (id) => { const t = allTasks.find(x => x.id === id); if (t) openEdit(t); },
    goToPlaybookSection: (id) => onNavigateOut && onNavigateOut("playbook", id),
  };

  const cardProps = { users, sops, projects, tags, templates, allTasks, currentUser: user, onOpen: openEdit, onOpenSop, onPatchTask: patchTask, onAction: taskAction, onQuickToggle: quickToggle, nav };

  // Shared by board columns and list sections: same cards, plus a slim
  // project-name label above each project cluster (R4 D7). The label spans
  // the full row in the list view's grid (gridColumn is inert in flex).
  const renderCards = (items) => items.map((t, i) => {
    const prev = items[i - 1];
    const project = t.projectId ? projects.find(p => p.id === t.projectId) : null;
    const showLabel = project && (!prev || prev.projectId !== t.projectId);
    return (
      <React.Fragment key={t.id}>
        {showLabel && (
          <div style={{
            display: "flex", alignItems: "center", gap: 5, gridColumn: "1 / -1", marginTop: i === 0 ? 0 : 3,
            fontSize: 10.5, fontWeight: 700, color: project.color || C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em",
          }}>
            <Icon name="folder" size={12} />{project.name || "Untitled project"}
          </div>
        )}
        <TaskCard task={t} {...cardProps}
          onOpen={() => openEdit(t)}
          onDragStart={onDragStart} onDragOver={onDragOverCard} isDragOver={dragOverItem === t.id}
          onQuickToggle={() => quickToggle(t)} onPatchTask={patch => patchTask(t, patch)}
          onAction={(action, extra) => taskAction(t, action, extra)} />
      </React.Fragment>
    );
  });

  const columnHeader = (s, count) => (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
      <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
      <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>{s.label}</div>
      <span style={{ fontSize: 12, color: C.mut, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{count}</span>
    </div>
  );

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Task Manager" sub={`${openCount} open task${openCount === 1 ? "" : "s"}`}
        right={<>
          <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}` }}>
            {[{ key: "board", icon: "view_kanban", label: "Board" }, { key: "list", icon: "view_list", label: "List" }].map(v => (
              <button key={v.key} type="button" onClick={() => changeView(v.key)} title={`${v.label} view`}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 7, border: "none", cursor: "pointer",
                  fontFamily: FONT_CAPS, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
                  background: view === v.key ? C.sur : "transparent", color: view === v.key ? C.moss : C.mut,
                  boxShadow: view === v.key ? C.shadowSm : "none",
                }}>
                <Icon name={v.icon} size={16} />{v.label}
              </button>
            ))}
          </div>
          <OBtn onClick={() => setShowDone(true)}><Icon name="task_alt" size={16} />Done ({doneTasks.length})</OBtn>
          {editable && <Btn onClick={openNew}><Icon name="add" size={17} />New Task</Btn>}
        </>} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Icon name="search" size={17} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.faint }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks…"
            style={{ width: "100%", background: C.inset, border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: "9px 12px 9px 36px", fontSize: 14, color: C.txt, outline: "none", fontFamily: "inherit" }} />
        </div>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={inp({ width: "auto", fontSize: 14, padding: "8px 12px" })}>
          <option value="">All assignees</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {projects.length > 0 && (
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={inp({ width: "auto", fontSize: 14, padding: "8px 12px" })}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name || "Untitled project"}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)} style={inp({ width: "auto", fontSize: 14, padding: "8px 12px" })}>
            <option value="">All tags</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => setFilterPriority("")} style={priorityFilterStyle(filterPriority === "", C.moss)}>All</button>
          {TASK_PRIORITIES.map(p => (
            <button key={p.key} onClick={() => setFilterPriority(filterPriority === p.key ? "" : p.key)} style={priorityFilterStyle(filterPriority === p.key, p.col)}>{p.label}</button>
          ))}
        </div>
        <button onClick={() => setHideProjectTasks(h => !h)} title="Hide tasks that belong to a project"
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            border: `1.5px solid ${hideProjectTasks ? C.moss : C.bdr}`, background: hideProjectTasks ? C.mossSoft : C.sur,
            color: hideProjectTasks ? C.moss : C.txt2, fontSize: 12, fontWeight: hideProjectTasks ? 600 : 500,
          }}>
          <Icon name={hideProjectTasks ? "folder_off" : "folder"} size={16} />
          {hideProjectTasks ? "Hiding project tasks" : "Hide project tasks"}
        </button>
      </div>

      {visibleTasks.length === 0 ? (
        <EmptyState icon="checklist" title="No tasks yet" sub="Create the first task to get the shift moving."
          action={editable && <Btn onClick={openNew}><Icon name="add" size={17} />New Task</Btn>} />
      ) : view === "list" ? (
        // R4 D1 — list view: vertical sections per status, same cards laid
        // out in a fluid grid. Sections stay live drop targets like columns.
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8 }}>
          {TASK_BOARD_STATUSES.map(s => {
            const items = byStatus(s.key);
            return (
              <div key={s.key} onDragOver={e => e.preventDefault()} onDrop={e => onDropColumn(e, s.key)}
                style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 14 }}>
                {columnHeader(s, items.length)}
                {items.length === 0 ? (
                  <div style={{ padding: "6px 0 2px", fontSize: 13, color: C.faint }}>No tasks</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 9, alignItems: "start" }}>
                    {renderCards(items)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {TASK_BOARD_STATUSES.map(s => {
            const items = byStatus(s.key);
            // Empty "Review Before Closing" collapses to a thin tab (R3 #7) —
            // still a live drop target, so dragging a card onto it works and
            // the column expands as soon as it holds anything.
            if (s.key === "review" && items.length === 0) {
              return (
                <div key={s.key} onDragOver={e => e.preventDefault()} onDrop={e => onDropColumn(e, s.key)}
                  title="Review Before Closing — drop a task here"
                  style={{
                    flex: "0 0 44px", minWidth: 44, background: C.bg, border: `1.5px dashed ${C.bdr}`, borderRadius: 13,
                    display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 10, minHeight: 160,
                  }}>
                  <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col, flexShrink: 0 }} />
                  <div style={{ writingMode: "vertical-rl", fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.1em" }}>
                    {s.label}
                  </div>
                </div>
              );
            }
            return (
              <div key={s.key} onDragOver={e => e.preventDefault()} onDrop={e => onDropColumn(e, s.key)}
                style={{ flex: "1 1 280px", minWidth: 260, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 12, minHeight: 160 }}>
                {columnHeader(s, items.length)}
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {renderCards(items)}
                  {items.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", fontSize: 13, color: C.faint }}>No tasks</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <TaskModal initial={modal.task} isNew={modal.isNew} users={users} sops={sops} projects={projects} tags={tags}
          nav={nav} onSave={saveModal} onDelete={deleteModal} onClose={() => setModal(null)} />
      )}

      {showDone && (
        <TaskDoneSlideOver doneTasks={doneTasks} archivedTasks={archivedTasks} cardProps={cardProps} onClose={() => setShowDone(false)} />
      )}
    </div>
  );
}

function priorityFilterStyle(active, color) {
  return {
    padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: active ? 600 : 500, cursor: "pointer",
    border: `1.5px solid ${active ? color : C.bdr}`,
    textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em",
    background: active ? color + "16" : C.sur, color: active ? color : C.mut,
  };
}

export default TaskManager;
export { TaskCard, TaskModal, MiniCalendar, emptyForm, labelStyle, priorityFilterStyle };
