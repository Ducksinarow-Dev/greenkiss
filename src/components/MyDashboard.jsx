import React, { useState } from 'react';
import {
  C, getTasks, updateTask, deleteTask, getUsers, getSOPs, getProjects,
  confirmDelete, triggerSaved, fmtDateShort, isOverdue, isDueToday, isDueThisWeek,
} from '../globals.js';
import { Icon } from './shared.jsx';
import { TaskModal } from './TaskManager.jsx';
import { ProjectCard } from './Projects.jsx';
import gkLogo from '../assets/gk-logo.svg';

/* Design intent: this is the first thing staff see after logging in —
   mid-shift, glancing between customers. It reads like a hand-written
   morning list, not a BI dashboard: four quiet groups (Overdue, Today,
   This Week, Later), a rose header only where something is actually
   overdue, and a light "my projects" shelf underneath. Nothing here
   aggregates the team — it's always scoped to the one person looking. */

const GROUPS = [
  { key: "overdue", label: "Overdue", accent: true },
  { key: "today", label: "Due Today" },
  { key: "week", label: "This Week" },
  { key: "later", label: "Later / No Date" },
];

function classify(dueDate, done) {
  if (done) return null;
  if (isOverdue(dueDate, done)) return "overdue";
  if (isDueToday(dueDate)) return "today";
  if (isDueThisWeek(dueDate)) return "week";
  return "later";
}

function ItemRow({ item, onToggle, onOpen }) {
  const overdue = item.group === "overdue";
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
        background: C.sur, border: `1.5px solid ${C.bdr}`, cursor: "pointer", transition: "border-color .15s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}
    >
      <div onClick={e => { e.stopPropagation(); onToggle(); }}
        role="checkbox" aria-checked={false} tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onToggle(); } }}
        style={{
          width: 19, height: 19, borderRadius: 6, flexShrink: 0, cursor: "pointer",
          border: `1.5px solid ${C.bdr2}`, background: C.sur,
        }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
        {item.sub && <div style={{ fontSize: 12, color: C.mut, marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name={item.subIcon || "subdirectory_arrow_right"} size={12} />{item.sub}
        </div>}
      </div>
      {item.dueDate && (
        <span style={{
          fontSize: 11, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", whiteSpace: "nowrap",
          color: overdue ? C.red : C.mut,
        }}>{fmtDateShort(item.dueDate)}</span>
      )}
    </div>
  );
}

function ItemGroup({ group, items, onToggle, onOpen }) {
  if (items.length === 0) return null;
  const accent = group.accent;
  return (
    <div>
      <div style={{
        fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
        color: accent ? C.red : C.txt2, marginBottom: 9, display: "flex", alignItems: "center", gap: 6,
      }}>
        {accent && <Icon name="error" size={14} />}
        {group.label} <span style={{ color: C.faint, fontWeight: 500 }}>({items.length})</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map(item => <ItemRow key={item.key} item={item} onToggle={() => onToggle(item)} onOpen={() => onOpen(item)} />)}
      </div>
    </div>
  );
}

function MyDashboard({ user, onOpenProject }) {
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null); // {task, isNew}
  const bump = () => setRefresh(r => r + 1);

  const users = getUsers();
  const sops = getSOPs();
  const projects = getProjects();
  const tasks = getTasks();

  // My tasks: assigned to me directly.
  const myTaskItems = tasks
    .filter(t => t.assignedTo === user.id)
    .map(t => ({
      key: "task:" + t.id, kind: "task", task: t, title: t.title, dueDate: t.dueDate,
      group: classify(t.dueDate, t.status === "done"),
    }))
    .filter(i => i.group);

  // My subtasks: assigned to me, wherever the parent task lives — shown
  // with the parent task's title so it's clear what it belongs to.
  const mySubtaskItems = [];
  tasks.forEach(t => {
    (t.subTasks || []).forEach(s => {
      if (s.assigneeId !== user.id) return;
      const g = classify(s.dueDate, s.done);
      if (!g) return;
      mySubtaskItems.push({
        key: "sub:" + s.id, kind: "subtask", task: t, subItem: s,
        title: s.text, sub: t.title, subIcon: "checklist", dueDate: s.dueDate, group: g,
      });
    });
  });

  // Content items assigned to me feed in here once the content calendar
  // (Phase 4) exists — same {key, title, dueDate, group} shape via
  // getContentItems().filter(c => c.assigneeId === user.id).
  const allItems = [...myTaskItems, ...mySubtaskItems];

  const byGroup = (key) => allItems.filter(i => i.group === key)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const toggleItem = (item) => {
    if (item.kind === "task") {
      updateTask(item.task.id, { status: item.task.status === "done" ? "todo" : "done" });
    } else {
      const nextSubs = (item.task.subTasks || []).map(s => s.id === item.subItem.id ? { ...s, done: !s.done } : s);
      updateTask(item.task.id, { subTasks: nextSubs });
    }
    triggerSaved();
    bump();
  };
  const openItem = (item) => setModal({ task: { ...item.task }, isNew: false });

  const saveModal = (form) => {
    updateTask(form.id, form);
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

  const myProjects = projects.filter(p => p.leadId === user.id || (p.memberIds || []).includes(user.id));
  const totalOpen = allItems.length;

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const greetHour = today.getHours();
  const greeting = greetHour < 12 ? "Good morning" : greetHour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="gk-fade-in">
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 600, color: C.txt, textTransform: "uppercase", letterSpacing: "0.05em" }}>{greeting}, {user.name}</div>
        <div style={{ fontSize: 14, color: C.mut, marginTop: 6 }}>{dateStr}</div>
      </div>

      {totalOpen === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "72px 24px", textAlign: "center", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14,
        }}>
          <img src={gkLogo} alt="" aria-hidden="true" style={{ width: 44, height: 44, marginBottom: 18, mixBlendMode: "multiply", opacity: 0.5 }} />
          <div style={{ fontSize: 17, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Nothing on your plate</div>
          <div style={{ fontSize: 14, color: C.mut, maxWidth: 360 }}>Tasks and sub-tasks assigned to you will show up here, grouped by when they're due.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginBottom: 34 }}>
          {GROUPS.map(g => (
            <ItemGroup key={g.key} group={g} items={byGroup(g.key)} onToggle={toggleItem} onOpen={openItem} />
          ))}
        </div>
      )}

      {myProjects.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>My Projects</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {myProjects.map(p => (
              <ProjectCard key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpenProject && onOpenProject(p.id)} />
            ))}
          </div>
        </div>
      )}

      {modal && (
        <TaskModal initial={modal.task} isNew={false} users={users} sops={sops} projects={projects}
          onSave={saveModal} onDelete={deleteModal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

export default MyDashboard;
