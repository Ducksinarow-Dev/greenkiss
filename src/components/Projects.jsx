import React, { useState } from 'react';
import {
  C, FONT_CAPS, getProjects, addProject, updateProject, deleteProject, defProject,
  getTasks, addTask, updateTask, deleteTask, getUsers, getSOPs, getTags, getTaskTemplates, confirmDelete, triggerSaved,
  canEdit, fmtDate, fmtDateShort, isOverdue, PROJECT_STATUSES, PROJECT_BOARD_STATUSES, projectStatusMeta, projectProgress,
  TASK_BOARD_STATUSES, inp, sortTasksForUser, completeTaskWithRecurrence, dispatchTaskAction,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Avatar, SectionHeader, EmptyState, lbl, SlideOver } from './shared.jsx';
import { TaskCard, TaskModal, emptyForm as emptyTaskForm } from './TaskManager.jsx';

/* Design intent: a project is a shelf, not a spreadsheet row — cards read
   like a stack of labeled folders (name, lead/team avatars, a quiet
   progress bar) rather than a dense table. The timeline strip borrows the
   ingredient-label vocabulary: a thin rail with a today pin and small dots
   for each task's due date, colored rose when overdue — the same "small
   badge of color, otherwise quiet" rule as everywhere else in the app. */

function ProgressBar({ pct, color }) {
  return (
    <div style={{ height: 6, borderRadius: 99, background: C.s2, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: "100%", background: color || C.moss, borderRadius: 99,
        transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`, transformOrigin: "left",
        transition: "transform .2s",
      }} />
    </div>
  );
}

function MemberStack({ users, ids, max = 4 }) {
  const uniqueIds = [...new Set(ids || [])];
  const list = uniqueIds.map(id => users.find(u => u.id === id)).filter(Boolean);
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  if (list.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((u, i) => (
        <div key={u.id} title={u.name} style={{ marginLeft: i === 0 ? 0 : -7, border: `2px solid ${C.sur}`, borderRadius: 99 }}>
          <Avatar name={u.name} size={24} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ marginLeft: -7, width: 24, height: 24, borderRadius: 99, background: C.s2, border: `2px solid ${C.sur}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: C.mut }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

function ProjectModal({ initial, users, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleMember = (id) => {
    const has = (form.memberIds || []).includes(id);
    set("memberIds", has ? form.memberIds.filter(x => x !== id) : [...(form.memberIds || []), id]);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? "New Project" : "Edit Project"}</div>
          {!isNew && <IconBtn icon="delete" danger title="Delete project" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl()}>Name</label>
            <input autoFocus value={form.name} onChange={e => set("name", e.target.value)} placeholder="Project name…" style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Description</label>
            <textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What's this project about?" style={inp({ lineHeight: 1.55 })} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)} style={inp()}>
                {PROJECT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Lead</label>
              <select value={form.leadId || ""} onChange={e => set("leadId", e.target.value)} style={inp()}>
                <option value="">No lead</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Start date</label>
              <input type="date" value={form.startDate || ""} onChange={e => set("startDate", e.target.value)} style={inp()} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Due date</label>
              <input type="date" value={form.dueDate || ""} onChange={e => set("dueDate", e.target.value)} style={inp()} />
            </div>
          </div>

          <div>
            <label style={lbl()}>Color</label>
            <div style={{ display: "flex", gap: 7 }}>
              {[C.moss, "#4f6358", "#a8bdb2", "#B63E59", "#EB97A6", "#2a2a28", "#8f948f"].map(c => (
                <button key={c} type="button" onClick={() => set("color", c)}
                  style={{ width: 26, height: 26, borderRadius: 99, background: c, cursor: "pointer", border: form.color === c ? `2px solid ${C.txt}` : "2px solid transparent" }} />
              ))}
            </div>
          </div>

          <div>
            <label style={lbl()}>Members</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto", border: `1.5px solid ${C.bdr}`, borderRadius: 9, padding: 8 }}>
              {users.map(u => {
                const checked = (form.memberIds || []).includes(u.id);
                return (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 7, cursor: "pointer", background: checked ? C.mossSoft : "transparent" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleMember(u.id)} />
                    <Avatar name={u.name} size={22} />
                    <span style={{ fontSize: 14, color: C.txt }}>{u.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.name.trim()}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, users, tasks, onOpen, draggable, onDragStart, onDragOver, isDragOver }) {
  const sm = projectStatusMeta[project.status] || PROJECT_STATUSES[0];
  const { done, total, pct } = projectProgress(project.id, tasks);
  const overdue = isOverdue(project.dueDate, project.status === "done" || project.status === "archived");
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      draggable={!!draggable}
      onDragStart={draggable ? (e => onDragStart(e, project.id)) : undefined}
      onDragOver={draggable ? (e => onDragOver(e, project.id)) : undefined}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", cursor: "pointer", background: C.sur, borderRadius: 12,
        border: `1.5px solid ${isDragOver ? C.moss : C.bdr}`, overflow: "hidden", transition: "box-shadow .15s, border-color .1s",
        boxShadow: isDragOver ? `0 0 0 2px ${C.mossSoft}` : "none",
        opacity: project.status === "archived" ? 0.6 : 1,
      }}
      onMouseEnter={e => { if (!isDragOver) e.currentTarget.style.boxShadow = C.shadowSm; }}
      onMouseLeave={e => { if (!isDragOver) e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ width: 6, flexShrink: 0, background: project.color || C.moss }} />
      <div style={{ padding: "16px 18px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Pill color={sm.col}>{sm.label}</Pill>
          {project.dueDate && (
            overdue
              ? <span style={{ fontSize: 11, fontWeight: 700, color: C.red, fontFamily: "'IBM Plex Mono',monospace" }}>Due {fmtDateShort(project.dueDate)}</span>
              : <span style={{ fontSize: 11, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>Due {fmtDateShort(project.dueDate)}</span>
          )}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>{project.name || "Untitled project"}</div>
        {project.description && <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{project.description}</div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <MemberStack users={users} ids={[project.leadId, ...(project.memberIds || [])].filter(Boolean)} />
          <span style={{ fontSize: 12, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>{done}/{total} tasks</span>
        </div>
        <ProgressBar pct={pct} color={project.color || C.moss} />
      </div>
    </div>
  );
}

/** Plain-div timeline: a rail from startDate to dueDate, a "today" pin,
 * and one dot per linked task's due date (rose if overdue). No library —
 * just percentage-based absolute positioning along a fixed-width rail. */
function TimelineStrip({ project, tasks }) {
  if (!project.startDate || !project.dueDate) {
    return <div style={{ fontSize: 13, color: C.faint, padding: "10px 0" }}>Set a start and due date to see the timeline.</div>;
  }
  const start = new Date(project.startDate).getTime();
  const end = new Date(project.dueDate).getTime();
  const span = Math.max(end - start, 1);
  const pctOf = (dateStr) => {
    const t = new Date(dateStr).getTime();
    return Math.max(0, Math.min(100, ((t - start) / span) * 100));
  };
  const todayPct = pctOf(new Date().toISOString().slice(0, 10));
  const dated = tasks.filter(t => t.dueDate);

  return (
    <div style={{ padding: "18px 4px 28px" }}>
      <div style={{ position: "relative", height: 4, borderRadius: 99, background: C.s2 }}>
        <div style={{ position: "absolute", left: `${todayPct}%`, top: -10, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: C.txt2, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>Today</span>
          <div style={{ width: 2, height: 20, background: C.txt2 }} />
        </div>
        {dated.map(t => {
          const overdue = isOverdue(t.dueDate, t.status === "done");
          return (
            <div key={t.id} title={`${t.title} — ${fmtDateShort(t.dueDate)}`}
              style={{
                position: "absolute", left: `${pctOf(t.dueDate)}%`, top: 10, transform: "translateX(-50%)",
                width: 10, height: 10, borderRadius: 99, background: overdue ? C.red : (t.status === "done" ? C.moss : C.faint),
                border: `2px solid ${C.sur}`,
              }} />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontSize: 11, color: C.faint, fontFamily: "'IBM Plex Mono',monospace" }}>
        <span>{fmtDate(project.startDate)}</span>
        <span>{fmtDate(project.dueDate)}</span>
      </div>
    </div>
  );
}

function ProjectDetail({ project, users, sops, allProjects, editable, currentUser, onBack, onBump, onOpenSop }) {
  const [editing, setEditing] = useState(false);
  const [taskModal, setTaskModal] = useState(null); // {task, isNew}
  const [showDone, setShowDone] = useState(false);
  const allTasks = getTasks();
  const tags = getTags();
  const templates = getTaskTemplates();
  const tasks = allTasks.filter(t => t.projectId === project.id && !t.archived);
  const sm = projectStatusMeta[project.status] || PROJECT_STATUSES[0];
  const lead = users.find(u => u.id === project.leadId);

  const saveProject = (form) => {
    updateProject(project.id, form);
    triggerSaved();
    setEditing(false);
    onBump();
  };
  const removeProject = async () => {
    const ok = await confirmDelete(`Delete "${project.name}"? Its tasks stay, just unlinked from the project. This can't be undone.`);
    if (!ok) return;
    deleteProject(project.id);
    triggerSaved();
    onBack();
  };

  const openNewTask = () => setTaskModal({ task: { ...emptyTaskForm(), projectId: project.id }, isNew: true });
  const openEditTask = (task) => setTaskModal({ task: { ...task }, isNew: false });
  const saveTask = (form) => {
    if (taskModal.isNew) addTask(form);
    else updateTask(form.id, form);
    triggerSaved();
    setTaskModal(null); onBump();
  };
  const deleteTaskModal = async () => {
    const ok = await confirmDelete(`Delete "${taskModal.task.title}"? This can't be undone.`);
    if (!ok) return;
    deleteTask(taskModal.task.id);
    triggerSaved();
    setTaskModal(null); onBump();
  };
  const quickToggle = (task) => { completeTaskWithRecurrence(task); triggerSaved(); onBump(); };
  const patchTask = (task, patch) => { updateTask(task.id, patch); triggerSaved(); onBump(); };
  const taskAction = (task, action, extra) => { dispatchTaskAction(task, action, extra, currentUser); triggerSaved(); onBump(); };
  const cardProps = { users, sops, projects: allProjects, tags, templates, allTasks, currentUser, onOpenSop };

  return (
    <div className="gk-fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back to projects" onClick={onBack} />
        <div style={{ flex: 1 }} />
        {editable && <OBtn onClick={() => setEditing(true)}><Icon name="edit" size={16} />Edit</OBtn>}
      </div>

      <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "24px 28px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 8, height: 40, borderRadius: 99, background: project.color || C.moss, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <Pill color={sm.col}>{sm.label}</Pill>
              {lead && <span style={{ fontSize: 12, color: C.mut }}>Led by <strong style={{ color: C.txt2 }}>{lead.name}</strong></span>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.txt, marginBottom: 6 }}>{project.name || "Untitled project"}</div>
            {project.description && <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.55, maxWidth: 640 }}>{project.description}</div>}
          </div>
          <MemberStack users={users} ids={[project.leadId, ...(project.memberIds || [])].filter(Boolean)} max={6} />
        </div>
        <TimelineStrip project={project} tasks={tasks} />
      </div>

      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, flex: 1 }}>Tasks</div>
        <OBtn onClick={() => setShowDone(true)} style={{ marginRight: 10 }}>
          <Icon name="task_alt" size={16} />Done ({tasks.filter(t => t.status === "done").length})
        </OBtn>
        {editable && <Btn onClick={openNewTask}><Icon name="add" size={17} />New Task</Btn>}
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon="checklist" title="No tasks in this project yet" sub="Create the first task to get moving."
          action={editable && <Btn onClick={openNewTask}><Icon name="add" size={17} />New Task</Btn>} />
      ) : (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {TASK_BOARD_STATUSES.map(s => {
            const items = sortTasksForUser(tasks.filter(t => t.status === s.key), currentUser?.id || "");
            return (
              <div key={s.key} style={{ flex: "1 1 260px", minWidth: 240, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>{s.label}</div>
                  <span style={{ fontSize: 12, color: C.mut, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {items.map(t => (
                    <TaskCard key={t.id} task={t} {...cardProps}
                      onOpen={() => openEditTask(t)} onDragStart={() => {}} onDragOver={() => {}} isDragOver={false}
                      onQuickToggle={() => quickToggle(t)} onPatchTask={patch => patchTask(t, patch)}
                      onAction={(action, extra) => taskAction(t, action, extra)} />
                  ))}
                  {items.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", fontSize: 13, color: C.faint }}>No tasks</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ProjectModal initial={{ ...project }} users={users} isNew={false}
          onSave={saveProject} onDelete={removeProject} onClose={() => setEditing(false)} />
      )}
      {taskModal && (
        <TaskModal initial={taskModal.task} isNew={taskModal.isNew} users={users} sops={sops} projects={allProjects} tags={tags}
          onSave={saveTask} onDelete={deleteTaskModal} onClose={() => setTaskModal(null)} />
      )}

      {showDone && (
        <SlideOver title={`Done (${tasks.filter(t => t.status === "done").length})`} icon="task_alt" onClose={() => setShowDone(false)}>
          {tasks.filter(t => t.status === "done").length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", fontSize: 13, color: C.faint }}>No completed tasks yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {tasks.filter(t => t.status === "done").map(t => (
                <TaskCard key={t.id} task={t} {...cardProps}
                  onOpen={() => openEditTask(t)} onDragStart={() => {}} onDragOver={() => {}} isDragOver={false}
                  onQuickToggle={() => quickToggle(t)} onPatchTask={patch => patchTask(t, patch)}
                  onAction={(action, extra) => taskAction(t, action, extra)} />
              ))}
            </div>
          )}
        </SlideOver>
      )}
    </div>
  );
}

/** List-view row: same data as ProjectCard, laid out horizontally so a
 * whole status group scans like a spreadsheet-lite roster rather than a
 * shelf of cards — the two views intentionally read differently. */
function ProjectRow({ project, users, tasks, onOpen }) {
  const sm = projectStatusMeta[project.status] || PROJECT_STATUSES[0];
  const lead = users.find(u => u.id === project.leadId);
  const { done, total, pct } = projectProgress(project.id, tasks);
  const overdue = isOverdue(project.dueDate, project.status === "done" || project.status === "archived");
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", cursor: "pointer",
        background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 11, transition: "border-color .15s",
        opacity: project.status === "archived" ? 0.6 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}
    >
      <div style={{ width: 5, alignSelf: "stretch", borderRadius: 99, background: project.color || C.moss, flexShrink: 0 }} />
      <div style={{ flex: "2 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name || "Untitled project"}</div>
        {lead && <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>Led by {lead.name}</div>}
      </div>
      <Pill color={sm.col}>{sm.label}</Pill>
      <div style={{ flex: "0 0 auto" }}><MemberStack users={users} ids={[project.leadId, ...(project.memberIds || [])].filter(Boolean)} /></div>
      <div style={{ flex: "0 0 92px", textAlign: "right" }}>
        {project.dueDate && (
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace", color: overdue ? C.red : C.mut }}>{fmtDateShort(project.dueDate)}</span>
        )}
      </div>
      <div style={{ flex: "0 0 130px" }}>
        <ProgressBar pct={pct} color={project.color || C.moss} />
        <div style={{ fontSize: 11, color: C.mut, marginTop: 3, textAlign: "right", fontFamily: "'IBM Plex Mono',monospace" }}>{done}/{total}</div>
      </div>
    </div>
  );
}

/** List view (#14): the same projects as vertical sections grouped by
 * status instead of columns. Done + Archived collapse into one section
 * at the bottom (archived projects keep their own "Archived" pill rather
 * than reading as done). */
function ProjectListView({ projects, users, tasks, onOpen }) {
  const [doneOpen, setDoneOpen] = useState(false);
  const doneItems = projects.filter(p => p.status === "done" || p.status === "archived");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {PROJECT_BOARD_STATUSES.map(s => {
        const items = projects.filter(p => p.status === s.key);
        if (items.length === 0) return null;
        return (
          <div key={s.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
              <div style={{ fontSize: 13, fontWeight: 800, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em" }}>{s.label}</div>
              <span style={{ fontSize: 12, color: C.mut }}>({items.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map(p => <ProjectRow key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpen(p.id)} />)}
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" onClick={() => setDoneOpen(o => !o)} style={{
          display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer",
          fontFamily: "inherit", padding: 0, marginBottom: doneOpen ? 10 : 0,
        }}>
          <Icon name={doneOpen ? "expand_less" : "expand_more"} size={18} style={{ color: C.mut }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.05em" }}>Done</div>
          <span style={{ fontSize: 12, color: C.mut }}>({doneItems.length})</span>
        </button>
        {doneOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {doneItems.length === 0 && <div style={{ fontSize: 13, color: C.faint, padding: "6px 2px" }}>Nothing done yet.</div>}
            {doneItems.map(p => <ProjectRow key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpen(p.id)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Board view (default): Upcoming / In Progress / Approval columns, drag
 * a card to change status. Done + Archived hide behind the same
 * slide-over treatment as Task Manager's Done column (#6). */
function ProjectBoardView({ projects, users, tasks, onOpen, onBump }) {
  const [dragItem, setDragItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const doneItems = projects.filter(p => p.status === "done" || p.status === "archived");

  const onDragStart = (e, id) => { setDragItem(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOverCard = (e, id) => { e.preventDefault(); e.stopPropagation(); setDragOverItem(id); };
  const onDropColumn = (e, status) => {
    e.preventDefault();
    if (dragItem) { updateProject(dragItem, { status }); triggerSaved(); }
    setDragItem(null); setDragOverItem(null); onBump();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <OBtn onClick={() => setShowDone(true)}><Icon name="task_alt" size={16} />Done ({doneItems.length})</OBtn>
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
        {PROJECT_BOARD_STATUSES.map(s => {
          const items = projects.filter(p => p.status === s.key);
          return (
            <div key={s.key} onDragOver={e => e.preventDefault()} onDrop={e => onDropColumn(e, s.key)}
              style={{ flex: "1 1 300px", minWidth: 280, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 12, minHeight: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
                <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>{s.label}</div>
                <span style={{ fontSize: 12, color: C.mut, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{items.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map(p => (
                  <ProjectCard key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpen(p.id)}
                    draggable onDragStart={onDragStart} onDragOver={onDragOverCard} isDragOver={dragOverItem === p.id} />
                ))}
                {items.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", fontSize: 13, color: C.faint }}>No projects</div>}
              </div>
            </div>
          );
        })}
      </div>

      {showDone && (
        <SlideOver title={`Done (${doneItems.length})`} icon="task_alt" onClose={() => setShowDone(false)}>
          {doneItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", fontSize: 13, color: C.faint }}>No completed or archived projects yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {doneItems.map(p => <ProjectCard key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpen(p.id)} />)}
            </div>
          )}
        </SlideOver>
      )}
    </>
  );
}

const PROJECTS_VIEW_KEY = "gkProjectsView";
const getProjectsView = () => { try { return localStorage.getItem(PROJECTS_VIEW_KEY) || "board"; } catch { return "board"; } };
const setProjectsView = (v) => { try { localStorage.setItem(PROJECTS_VIEW_KEY, v); } catch {} };

function Projects({ user, onOpenSop, focusProjectId, onClearFocus }) {
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState(focusProjectId || null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(getProjectsView);
  const bump = () => setRefresh(r => r + 1);
  const changeView = (v) => { setView(v); setProjectsView(v); };

  const users = getUsers();
  const sops = getSOPs();
  const projects = getProjects();
  const tasks = getTasks();
  const editable = canEdit(user);

  React.useEffect(() => {
    if (focusProjectId) { setSelectedId(focusProjectId); onClearFocus && onClearFocus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProjectId]);

  const selected = selectedId ? projects.find(p => p.id === selectedId) : null;

  const createProject = (form) => {
    addProject(form);
    triggerSaved();
    setCreating(false);
    bump();
  };

  if (selected) {
    return <ProjectDetail project={selected} users={users} sops={sops} allProjects={projects} editable={editable} currentUser={user}
      onBack={() => { setSelectedId(null); bump(); }} onBump={bump} onOpenSop={onOpenSop} />;
  }

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Projects" sub={`${projects.length} project${projects.length === 1 ? "" : "s"}`}
        right={<>
          <div style={{ display: "flex", background: C.s2, borderRadius: 9, padding: 3, border: `1.5px solid ${C.bdr}` }}>
            {[{ key: "board", icon: "view_kanban" }, { key: "list", icon: "view_list" }].map(v => (
              <button key={v.key} type="button" onClick={() => changeView(v.key)} title={v.key === "board" ? "Board view" : "List view"}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 7, border: "none", cursor: "pointer",
                  fontFamily: FONT_CAPS, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
                  background: view === v.key ? C.sur : "transparent", color: view === v.key ? C.moss : C.mut,
                  boxShadow: view === v.key ? C.shadowSm : "none",
                }}>
                <Icon name={v.icon} size={16} />{v.key === "board" ? "Board" : "List"}
              </button>
            ))}
          </div>
          {editable && <Btn onClick={() => setCreating(true)}><Icon name="add" size={17} />New Project</Btn>}
        </>} />

      {projects.length === 0 ? (
        <EmptyState icon="folder_special" title="No projects yet" sub="Group related tasks together and track them as a team."
          action={editable && <Btn onClick={() => setCreating(true)}><Icon name="add" size={17} />New Project</Btn>} />
      ) : view === "list" ? (
        <ProjectListView projects={projects} users={users} tasks={tasks} onOpen={setSelectedId} />
      ) : (
        <ProjectBoardView projects={projects} users={users} tasks={tasks} onOpen={setSelectedId} onBump={bump} />
      )}

      {creating && (
        <ProjectModal initial={defProject()} users={users} isNew
          onSave={createProject} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

export default Projects;
export { ProjectCard, ProgressBar, MemberStack };
