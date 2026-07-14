import React, { useState } from 'react';
import {
  C, uid, getTasks, addTask, updateTask, deleteTask, confirmDelete, triggerSaved,
  getUsers, getSOPs, fmtDateShort, canEdit,
  TASK_STATUSES, TASK_PRIORITIES, taskPriorityMeta, inp,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Chk, Avatar, SectionHeader, EmptyState } from './shared.jsx';

const emptyForm = () => ({
  title: "", description: "", status: "todo", priority: "medium",
  assignedTo: "", dueDate: "", relatedSopId: "", subTasks: [],
});

function TaskModal({ initial, users, sops, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const [subInput, setSubInput] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addSub = () => {
    if (!subInput.trim()) return;
    set("subTasks", [...(form.subTasks || []), { id: uid(), label: subInput.trim(), done: false }]);
    setSubInput("");
  };
  const toggleSub = (id) => set("subTasks", (form.subTasks || []).map(s => s.id === id ? { ...s, done: !s.done } : s));
  const removeSub = (id) => set("subTasks", (form.subTasks || []).filter(s => s.id !== id));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,23,17,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? "New Task" : "Edit Task"}</div>
          {!isNew && <IconBtn icon="delete" danger title="Delete task" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            <label style={labelStyle}>Related SOP</label>
            <select value={form.relatedSopId} onChange={e => set("relatedSopId", e.target.value)} style={inp()}>
              <option value="">None</option>
              {sops.map(s => <option key={s.id} value={s.id}>{s.title || "Untitled SOP"}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Sub-tasks</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {(form.subTasks || []).map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Chk checked={s.done} onChange={() => toggleSub(s.id)} label={<span style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? C.mut : C.txt }}>{s.label}</span>} />
                  <div style={{ flex: 1 }} />
                  <IconBtn icon="close" title="Remove" onClick={() => removeSub(s.id)} />
                </div>
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.title.trim()}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 700, color: C.txt2, display: "block", marginBottom: 6 };

function TaskCard({ task, users, sops, onOpen, onDragStart, onDragOver, isDragOver, onQuickToggle, onOpenSop }) {
  const pm = taskPriorityMeta[task.priority] || TASK_PRIORITIES[1];
  const assignee = users.find(u => u.id === task.assignedTo);
  const sop = sops.find(s => s.id === task.relatedSopId);
  const subTasks = task.subTasks || [];
  const stDone = subTasks.filter(s => s.done).length;
  const overdue = task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date(new Date().toDateString());
  const isDone = task.status === "done";
  return (
    <div draggable onDragStart={e => onDragStart(e, task.id)} onDragOver={e => onDragOver(e, task.id)} onClick={onOpen}
      style={{
        background: C.sur, border: `1.5px solid ${isDragOver ? C.moss : C.bdr}`, borderRadius: 11,
        padding: "12px 14px", cursor: "pointer", boxShadow: isDragOver ? `0 0 0 2px ${C.mossSoft}` : C.shadowSm,
        transition: "border-color .1s",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div onClick={e => { e.stopPropagation(); onQuickToggle(); }} style={{
          width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginTop: 1, cursor: "pointer",
          border: `1.5px solid ${isDone ? C.moss : C.bdr2}`, background: isDone ? C.moss : C.sur,
          display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
        }}>
          {isDone && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, textDecoration: isDone ? "line-through" : "none", opacity: isDone ? 0.6 : 1 }}>{task.title}</div>
          {sop && (
            <div onClick={e => { e.stopPropagation(); onOpenSop && onOpenSop(sop.id); }}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: C.moss, marginTop: 3, cursor: "pointer", width: "fit-content" }}
              title="Open related SOP">
              <Icon name="menu_book" size={13} />{sop.title || "Untitled SOP"}
            </div>
          )}
        </div>
        <Pill color={pm.col}>{pm.label}</Pill>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {assignee && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Avatar name={assignee.name} size={18} /><span style={{ fontSize: 12, color: C.mut }}>{assignee.name}</span></div>}
        {task.dueDate && <span style={{ fontSize: 12, fontWeight: 600, color: overdue ? C.red : C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDateShort(task.dueDate)}</span>}
        {subTasks.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: stDone === subTasks.length ? C.moss : C.mut, background: C.s2, borderRadius: 99, padding: "1px 7px", display: "flex", alignItems: "center", gap: 3 }}>
            <Icon name="check_box" size={12} />{stDone}/{subTasks.length}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskManager({ user, onOpenSop }) {
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null); // {task, isNew}
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [query, setQuery] = useState("");
  const [dragItem, setDragItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const bump = () => setRefresh(r => r + 1);

  const users = getUsers();
  const sops = getSOPs();
  const tasks = getTasks();
  const editable = canEdit(user);

  const filtered = tasks.filter(t => {
    if (filterAssignee && t.assignedTo !== filterAssignee) return false;
    if (filterPriority && t.priority !== filterPriority) return false;
    if (query && !t.title.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const prioOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...filtered].sort((a, b) => (prioOrder[a.priority] ?? 3) - (prioOrder[b.priority] ?? 3) || new Date(b.createdAt) - new Date(a.createdAt));
  const byStatus = (s) => sorted.filter(t => t.status === s);

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
  const quickToggle = (task) => { updateTask(task.id, { status: task.status === "done" ? "todo" : "done" }); triggerSaved(); bump(); };

  const onDragStart = (e, id) => { setDragItem(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOverCard = (e, id) => { e.preventDefault(); e.stopPropagation(); setDragOverItem(id); };
  const onDropColumn = (e, status) => {
    e.preventDefault();
    if (!dragItem) return;
    const col = byStatus(status);
    if (dragOverItem && dragOverItem !== dragItem) {
      const without = col.filter(t => t.id !== dragItem);
      const idx = without.findIndex(t => t.id === dragOverItem);
      const dragTask = tasks.find(t => t.id === dragItem);
      const reordered = idx === -1 ? [...without, dragTask] : [...without.slice(0, idx), dragTask, ...without.slice(idx)];
      reordered.forEach((t, i) => updateTask(t.id, { status, order: i }));
    } else {
      updateTask(dragItem, { status });
    }
    setDragItem(null); setDragOverItem(null); bump();
  };

  const openCount = tasks.filter(t => t.status !== "done").length;

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Task Manager" sub={`${openCount} open task${openCount === 1 ? "" : "s"}`}
        right={editable && <Btn onClick={openNew}><Icon name="add" size={17} />New Task</Btn>} />

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
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => setFilterPriority("")} style={priorityFilterStyle(filterPriority === "", C.moss)}>All</button>
          {TASK_PRIORITIES.map(p => (
            <button key={p.key} onClick={() => setFilterPriority(filterPriority === p.key ? "" : p.key)} style={priorityFilterStyle(filterPriority === p.key, p.col)}>{p.label}</button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon="checklist" title="No tasks yet" sub="Create the first task to get the shift moving."
          action={editable && <Btn onClick={openNew}><Icon name="add" size={17} />New Task</Btn>} />
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {TASK_STATUSES.map(s => {
            const items = byStatus(s.key);
            return (
              <div key={s.key} onDragOver={e => e.preventDefault()} onDrop={e => onDropColumn(e, s.key)}
                style={{ flex: "1 1 280px", minWidth: 260, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 12, minHeight: 160 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>{s.label}</div>
                  <span style={{ fontSize: 12, color: C.mut, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {items.map(t => (
                    <TaskCard key={t.id} task={t} users={users} sops={sops}
                      onOpen={() => openEdit(t)}
                      onDragStart={onDragStart} onDragOver={onDragOverCard} isDragOver={dragOverItem === t.id}
                      onQuickToggle={() => quickToggle(t)} onOpenSop={onOpenSop} />
                  ))}
                  {items.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", fontSize: 13, color: C.faint }}>No tasks</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <TaskModal initial={modal.task} isNew={modal.isNew} users={users} sops={sops}
          onSave={saveModal} onDelete={deleteModal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function priorityFilterStyle(active, color) {
  return {
    padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
    fontFamily: "inherit", border: `1.5px solid ${active ? color : C.bdr}`,
    background: active ? color + "16" : C.sur, color: active ? color : C.mut,
  };
}

export default TaskManager;
