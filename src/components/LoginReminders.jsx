import React, { useState, useEffect } from 'react';
import { C, getTasks, getUsers, getAlerts, deleteAlert, todayLocalISO, isOverdue, fmtDateShort, taskPriorityMeta } from '../globals.js';
import { Icon } from './shared.jsx';

/* Login reminders (R3 #9, R4 D5) — once per session, stacked bottom-right
   toast bubbles for the logged-in user: (1) overdue + due-today tasks,
   (2) SOP-run tasks due today, (3) one bubble per alert flagged at me —
   clicking an alert opens that task and deletes the alert record (which
   also clears it from the dashboard strip), as does dismissing it. Session
   gate lives in sessionStorage so a reload doesn't re-nag but a fresh
   login does. */
function Bubble({ icon, color, title, items, onClose, onOpen }) {
  return (
    <div className="gk-fade-in" style={{
      background: C.sur, border: `1.5px solid ${color}`, borderRadius: 13, boxShadow: C.shadowMd,
      padding: "13px 15px", width: 320, cursor: "pointer",
    }} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <Icon name={icon} size={17} style={{ color }} />
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt, flex: 1 }}>{title}</div>
        <button onClick={e => { e.stopPropagation(); onClose(); }} title="Dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 2, display: "flex" }}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {items.slice(0, 4).map(t => (
          <div key={t.id} style={{ fontSize: 13, color: C.txt2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {t.title || "Untitled"}</div>
        ))}
        {items.length > 4 && <div style={{ fontSize: 12, color: C.mut }}>+ {items.length - 4} more</div>}
      </div>
    </div>
  );
}

/** One toast per alert flagged at me (R4 D5): task title, a colored
 * priority flag when it's high/urgent, due date, who flagged it. The whole
 * toast opens the task; open or dismiss deletes the alert record. */
function AlertBubble({ alert, task, fromName, onClose, onOpen }) {
  const pm = taskPriorityMeta[task.priority];
  const hot = task.priority === "high" || task.priority === "urgent";
  return (
    <div className="gk-fade-in" style={{
      background: C.sur, border: `1.5px solid ${C.red}`, borderRadius: 13, boxShadow: C.shadowMd,
      padding: "13px 15px", width: 320, cursor: "pointer",
    }} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="campaign" size={17} style={{ color: C.red }} />
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title || "Untitled"}</div>
        {hot && pm && <Icon name="flag" size={15} style={{ color: pm.col, flexShrink: 0 }} title={`${pm.label} priority`} />}
        <button onClick={e => { e.stopPropagation(); onClose(); }} title="Dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 2, display: "flex" }}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: C.mut, marginTop: 5, display: "flex", alignItems: "center", gap: 10 }}>
        <span>Flagged by {fromName}</span>
        {task.dueDate && (
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: isOverdue(task.dueDate, task.status === "done") ? C.red : C.mut }}>
            {fmtDateShort(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function LoginReminders({ user, onOpenTasks, onOpenTask }) {
  const [dismissed, setDismissed] = useState({ tasks: false, runs: false });
  const [goneAlerts, setGoneAlerts] = useState([]); // alert ids handled this session
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const key = "gkRemindersShown:" + user.id;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      setShow(true);
    } catch { setShow(true); }
  }, [user]);

  if (!show || !user) return null;

  const today = todayLocalISO();
  const allTasks = getTasks();
  const mine = allTasks.filter(t => !t.archived && t.assignedTo === user.id && t.status !== "done");
  const runTasks = mine.filter(t => t.fromSopRun && t.dueDate === today);
  const dueTasks = mine.filter(t => !t.fromSopRun && t.dueDate && (t.dueDate === today || isOverdue(t.dueDate)));
  const users = getUsers();
  const myAlerts = getAlerts()
    .filter(a => a.toUserId === user.id && !goneAlerts.includes(a.id))
    .map(a => ({ alert: a, task: allTasks.find(t => t.id === a.taskId) }))
    .filter(x => x.task);

  const open = () => { onOpenTasks && onOpenTasks(); setDismissed({ tasks: true, runs: true }); };
  const clearAlert = (id) => { deleteAlert(id); setGoneAlerts(g => [...g, id]); };
  const openAlert = ({ alert, task }) => { clearAlert(alert.id); (onOpenTask ? onOpenTask(task.id) : (onOpenTasks && onOpenTasks())); };

  const showTasks = dueTasks.length > 0 && !dismissed.tasks;
  const showRuns = runTasks.length > 0 && !dismissed.runs;
  if (!showTasks && !showRuns && myAlerts.length === 0) return null;

  const overdueCount = dueTasks.filter(t => isOverdue(t.dueDate)).length;
  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 700, display: "flex", flexDirection: "column", gap: 10 }}>
      {myAlerts.slice(0, 3).map(x => (
        <AlertBubble key={x.alert.id} alert={x.alert} task={x.task}
          fromName={users.find(u => u.id === x.alert.fromUserId)?.name || "someone"}
          onClose={() => clearAlert(x.alert.id)} onOpen={() => openAlert(x)} />
      ))}
      {showRuns && (
        <Bubble icon="play_circle" color={C.moss} title={`${runTasks.length} SOP run${runTasks.length === 1 ? "" : "s"} for today`}
          items={runTasks} onClose={() => setDismissed(d => ({ ...d, runs: true }))} onOpen={open} />
      )}
      {showTasks && (
        <Bubble icon="notifications" color={overdueCount ? C.red : C.clay}
          title={overdueCount ? `${overdueCount} overdue · ${dueTasks.length - overdueCount} due today` : `${dueTasks.length} task${dueTasks.length === 1 ? "" : "s"} due today`}
          items={dueTasks} onClose={() => setDismissed(d => ({ ...d, tasks: true }))} onOpen={open} />
      )}
    </div>
  );
}

export default LoginReminders;
