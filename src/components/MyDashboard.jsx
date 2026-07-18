import React, { useState } from 'react';
import {
  C, FONT_CAPS, getTheme, getTasks, updateTask, deleteTask, getUsers, getSOPs, getProjects,
  getContentItems, updateContentItem, getCampaigns, contentChannelMeta, getTags,
  getAlerts, deleteAlert, fmtDate, getAllInstances, formColor,
  confirmDelete, triggerSaved, fmtDateShort, isOverdue, isDueToday, isDueThisWeek,
} from '../globals.js';
import { Icon, IconBtn } from './shared.jsx';
import { TaskModal } from './TaskManager.jsx';
import { ProjectCard } from './Projects.jsx';
import gkLogo from '../assets/gk-logo.svg';

/* Design intent: this is the first thing staff see after logging in —
   mid-shift, glancing between customers. It reads like a hand-written
   morning list, not a BI dashboard: two quiet groups (Today's Tasks =
   overdue + due today, Assigned Tasks = everything else open), a rose
   header only where something is actually overdue, then "my projects"
   and "my forms" shelves underneath. Nothing here aggregates the team —
   it's always scoped to the one person looking. */

// R4 E — display sections built from the classify() buckets.
const DASH_SECTIONS = [
  { key: "today", label: "Today's Tasks", buckets: ["overdue", "today"], icon: "today" },
  { key: "assigned", label: "Assigned Tasks", buckets: ["week", "later"] },
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
  const color = accent ? C.red : (group.key === "today" ? C.moss : C.txt2);
  const icon = accent ? "error" : group.icon;
  return (
    <div>
      <div style={{
        fontSize: 12, fontWeight: 700, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em",
        color, marginBottom: 9, display: "flex", alignItems: "center", gap: 6,
      }}>
        {icon && <Icon name={icon} size={14} />}
        {group.label} <span style={{ color: C.faint, fontWeight: 500 }}>({items.length})</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {items.map(item => <ItemRow key={item.key} item={item} onToggle={() => onToggle(item)} onOpen={() => onOpen(item)} />)}
      </div>
    </div>
  );
}

/** #9 — the target user's alert strip: any staff member who flagged a task
 * for someone shows up here, rose/pink accent, dismissible (dismiss =
 * delete the alert record). Sits above everything else on the dashboard. */
function AlertsStrip({ alerts, tasks, users, onDismiss, onOpenTask }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        fontSize: 12, fontWeight: 700, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em",
        color: C.red, display: "flex", alignItems: "center", gap: 6,
      }}>
        <Icon name="campaign" size={14} />Alerts <span style={{ color: C.faint, fontWeight: 500 }}>({alerts.length})</span>
      </div>
      {alerts.map(a => {
        const task = tasks.find(t => t.id === a.taskId);
        const from = users.find(u => u.id === a.fromUserId);
        return (
          <div key={a.id} style={{
            display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", borderRadius: 10,
            background: C.red + "0d", border: `1.5px solid ${C.red}38`,
          }}>
            <Icon name="campaign" size={17} style={{ color: C.red, flexShrink: 0 }} />
            <div onClick={() => task && onOpenTask(task)} role={task ? "button" : undefined} tabIndex={task ? 0 : undefined}
              style={{ flex: 1, minWidth: 0, cursor: task ? "pointer" : "default" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task ? task.title : "Task no longer exists"}
              </div>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>
                Flagged by {from ? from.name : "someone"} · {fmtDate(a.at)}
              </div>
            </div>
            <IconBtn icon="close" title="Dismiss" onClick={() => onDismiss(a.id)} />
          </div>
        );
      })}
    </div>
  );
}

function MyDashboard({ user, onOpenProject, onOpenContent, onOpenSubmission, onNavigateOut }) {
  const [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null); // {task, isNew}
  const bump = () => setRefresh(r => r + 1);

  const users = getUsers();
  const sops = getSOPs();
  const projects = getProjects();
  const tasks = getTasks();
  const campaigns = getCampaigns();
  const contentItems = getContentItems();
  const myAlerts = getAlerts().filter(a => a.toUserId === user.id).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const dismissAlert = (id) => { deleteAlert(id); bump(); };
  const openAlertedTask = (task) => setModal({ task: { ...task }, isNew: false });

  // My tasks: assigned to me directly. Archived tasks are hidden everywhere,
  // including here (#9).
  const myTaskItems = tasks
    .filter(t => t.assignedTo === user.id && !t.archived)
    .map(t => ({
      key: "task:" + t.id, kind: "task", task: t, title: t.title, dueDate: t.dueDate,
      group: classify(t.dueDate, t.status === "done"),
    }))
    .filter(i => i.group);

  // My subtasks: assigned to me, wherever the parent task lives — shown
  // with the parent task's title so it's clear what it belongs to.
  const mySubtaskItems = [];
  tasks.forEach(t => {
    if (t.archived) return;
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

  // Content items assigned to me — shown with their campaign name (if any)
  // and a channel glyph, same shape as tasks/subtasks so they slot into
  // the same grouped list. "Done" means published.
  const myContentItems = contentItems
    .filter(c => c.assigneeId === user.id)
    .map(c => {
      const campaign = campaigns.find(cm => cm.id === c.campaignId);
      const ch = contentChannelMeta[c.channel];
      return {
        key: "content:" + c.id, kind: "content", item: c, title: c.title || "Untitled content",
        sub: campaign?.name || (ch ? ch.label : ""), subIcon: ch?.icon || "calendar_month",
        dueDate: c.publishDate, group: classify(c.publishDate, c.status === "published"),
      };
    })
    .filter(i => i.group);

  const allItems = [...myTaskItems, ...mySubtaskItems, ...myContentItems];

  const bySection = (sec) => allItems.filter(i => sec.buckets.includes(i.group))
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  // R4 E — in-progress form submissions I started, linking into fill mode.
  const myForms = getAllInstances()
    .filter(i => i.docKind === "form" && i.status === "in_progress" && i.startedBy === user.name)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const toggleItem = (item) => {
    if (item.kind === "task") {
      updateTask(item.task.id, { status: item.task.status === "done" ? "todo" : "done" });
    } else if (item.kind === "subtask") {
      const nextSubs = (item.task.subTasks || []).map(s => s.id === item.subItem.id ? { ...s, done: !s.done } : s);
      updateTask(item.task.id, { subTasks: nextSubs });
    } else if (item.kind === "content") {
      updateContentItem(item.item.id, { status: item.item.status === "published" ? "scheduled" : "published" });
    }
    triggerSaved();
    bump();
  };
  const openItem = (item) => {
    if (item.kind === "content") { onOpenContent && onOpenContent(item.item.id); return; }
    setModal({ task: { ...item.task }, isNew: false });
  };

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
        <div style={{ fontSize: 26, fontWeight: 600, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em" }}>{greeting}, {user.name}</div>
        <div style={{ fontSize: 14, color: C.mut, marginTop: 6 }}>{dateStr}</div>
      </div>

      <AlertsStrip alerts={myAlerts} tasks={tasks} users={users} onDismiss={dismissAlert} onOpenTask={openAlertedTask} />

      {totalOpen === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "72px 24px", textAlign: "center", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14,
        }}>
          <img src={gkLogo} alt="" aria-hidden="true" style={
            getTheme() === "dark"
              ? { width: 44, height: 44, marginBottom: 18, filter: "invert(1)", mixBlendMode: "screen", opacity: 0.5 }
              : { width: 44, height: 44, marginBottom: 18, mixBlendMode: "multiply", opacity: 0.5 }
          } />
          <div style={{ fontSize: 17, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Nothing on your plate</div>
          <div style={{ fontSize: 14, color: C.mut, maxWidth: 360 }}>Tasks and sub-tasks assigned to you will show up here, grouped by when they're due.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 26, marginBottom: 34 }}>
          {DASH_SECTIONS.map(sec => {
            const items = bySection(sec);
            const accent = sec.key === "today" && items.some(i => i.group === "overdue");
            return <ItemGroup key={sec.key} group={{ ...sec, accent }} items={items} onToggle={toggleItem} onOpen={openItem} />;
          })}
        </div>
      )}

      {myProjects.length > 0 && (
        <div style={{ marginBottom: 34 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>My Projects</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {myProjects.map(p => (
              <ProjectCard key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpenProject && onOpenProject(p.id)} />
            ))}
          </div>
        </div>
      )}

      {myForms.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>My Forms <span style={{ color: C.faint, fontWeight: 500 }}>— in progress</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxWidth: 640 }}>
            {myForms.map(f => {
              const doc = sops.find(s => s.id === f.docId);
              return (
                <div key={f.id} onClick={() => onOpenSubmission && onOpenSubmission(f.docId, f.id)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSubmission && onOpenSubmission(f.docId, f.id); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10,
                    background: C.sur, border: `1.5px solid ${C.bdr}`, cursor: "pointer", transition: "border-color .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: formColor(f.docId), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc?.title || "Deleted form"}</div>
                    <div style={{ fontSize: 12, color: C.mut, marginTop: 1 }}>Started {fmtDate(f.startedAt)}</div>
                  </div>
                  <Icon name="edit_note" size={17} style={{ color: C.mut, flexShrink: 0 }} title="Continue filling out" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal && (
        <TaskModal initial={modal.task} isNew={false} users={users} sops={sops} projects={projects} tags={getTags()}
          nav={{
            goToSop: (id, blockId) => onNavigateOut && onNavigateOut("sop", id, blockId),
            goToTask: (id) => { const t = tasks.find(x => x.id === id); if (t) setModal({ task: { ...t }, isNew: false }); },
            goToPlaybookSection: (id) => onNavigateOut && onNavigateOut("playbook", id),
          }}
          onSave={saveModal} onDelete={deleteModal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

export default MyDashboard;
