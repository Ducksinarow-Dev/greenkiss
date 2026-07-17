import React, { useState, useEffect } from 'react';
import { C, getTasks, todayLocalISO, isOverdue } from '../globals.js';
import { Icon } from './shared.jsx';

/* Login reminders (R3 #9) — once per session, two stacked bottom-right toast
   bubbles for the logged-in user: (1) overdue + due-today tasks, (2) SOP-run
   tasks due today. Dismissable; clicking jumps to Task Manager. Session gate
   lives in sessionStorage so a reload doesn't re-nag but a fresh login does. */
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

function LoginReminders({ user, onOpenTasks }) {
  const [dismissed, setDismissed] = useState({ tasks: false, runs: false });
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
  const mine = getTasks().filter(t => !t.archived && t.assignedTo === user.id && t.status !== "done");
  const runTasks = mine.filter(t => t.fromSopRun && t.dueDate === today);
  const dueTasks = mine.filter(t => !t.fromSopRun && t.dueDate && (t.dueDate === today || isOverdue(t.dueDate)));

  const open = () => { onOpenTasks && onOpenTasks(); setDismissed({ tasks: true, runs: true }); };
  const showTasks = dueTasks.length > 0 && !dismissed.tasks;
  const showRuns = runTasks.length > 0 && !dismissed.runs;
  if (!showTasks && !showRuns) return null;

  const overdueCount = dueTasks.filter(t => isOverdue(t.dueDate)).length;
  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 700, display: "flex", flexDirection: "column", gap: 10 }}>
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
