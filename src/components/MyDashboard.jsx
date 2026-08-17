import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, getTasks, updateTask, deleteTask, getUsers, getSOPs, getProjects,
  getContentItems, updateContentItem, getCampaigns, campaignStatusMeta, contentChannelMeta, getTags,
  getAlerts, deleteAlert, fmtDate, getAllInstances, formColor, canEdit,
  fetchShopifySales, currentSalesTargets,
  confirmDelete, triggerSaved, fmtDateShort, isOverdue, isDueToday, isDueThisWeek,
  announcementsForUser, newsSectionMeta, isAssignedTo,
  openCallbacksForUser, hasAckedCallback, getProducts, waitlistForProduct,
  linkifyMagnets, REMOTE_MODE, backupList, backupHealth,
} from '../globals.js';
import { Icon, IconBtn, Pill, MentionText } from './shared.jsx';
import { Speedometer } from './StoreUpdate.jsx';
import { TaskModal } from './TaskManager.jsx';
import { ProjectCard } from './Projects.jsx';

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

const SecTitle = ({ children }) => (
  <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>{children}</div>
);

/** Compact month-to-date sales gauge for the top of the dashboard (editors/
 * admins only — the same roles the Shopify proxy allows). Self-fetches; falls
 * back to a labelled sample when Shopify isn't connected, mirroring StoreUpdate. */
function DashStoreStrip({ user, onOpen }) {
  const [sales, setSales] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchShopifySales().then(s => { if (alive) setSales(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!canEdit(user)) return null;
  const { monthly, daily, weekly } = currentSalesTargets();
  const connected = !!sales;
  const cur = sales?.currency === "USD" || sales?.currency === "CAD" ? "$" : (sales?.currency ? sales.currency + " " : "$");
  const todayVal = connected ? sales.today : daily * 0.62;
  const weekVal = connected ? sales.weekToDate : weekly * 0.62;
  const monthVal = connected ? sales.monthToDate : monthly * 0.62;
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen && onOpen(); } }}
      style={{ display: "flex", flexDirection: "column", gap: 8, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, padding: "14px 20px", marginBottom: 22, cursor: "pointer", transition: "border-color .15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt2, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>
          Store Goals{!connected && <span style={{ color: C.faint, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: 8, fontFamily: "inherit" }}>· sample, connect Shopify for live sales</span>}
        </span>
        <span style={{ fontSize: 12.5, color: C.moss, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          Open Store Goals <Icon name="arrow_forward" size={14} />
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-around" }}>
        <Speedometer label="Today" value={todayVal} target={daily} currency={cur} size={132} sample={!connected} timePeriod="day" />
        <Speedometer label="This week" value={weekVal} target={weekly} currency={cur} size={132} sample={!connected} timePeriod="week" />
        <Speedometer label="This month" value={monthVal} target={monthly} currency={cur} size={132} sample={!connected} timePeriod="month" />
      </div>
    </div>
  );
}

/** Small per-column empty state — the dashboard is now split into columns,
 * so each one carries its own quiet "nothing here yet" instead of one big card. */
const DashEmpty = ({ icon, title, sub }) => (
  <div style={{ padding: "28px 20px", textAlign: "center", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12 }}>
    <Icon name={icon} size={22} style={{ color: C.faint, marginBottom: 8 }} />
    <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 13, color: C.mut }}>{sub}</div>
  </div>
);

/** Compact campaign card for the dashboard's Upcoming Campaigns column.
 * Clickable (#23) — opens the Content Calendar filtered to this campaign. */
function DashCampaignCard({ campaign, onOpen }) {
  const sm = campaignStatusMeta[campaign.status] || { label: campaign.status, col: C.mut };
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen && onOpen(); } }}
      style={{ display: "flex", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color .15s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}>
      <div style={{ width: 5, background: campaign.color || C.moss, flexShrink: 0 }} />
      <div style={{ padding: "12px 14px", flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campaign.name || "Untitled campaign"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: sm.col, background: sm.col + "1F", padding: "2px 8px", borderRadius: 99 }}>{sm.label}</span>
          {(campaign.startDate || campaign.endDate) && (
            <span style={{ fontSize: 11, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>
              {campaign.startDate ? fmtDateShort(campaign.startDate) : "…"} – {campaign.endDate ? fmtDateShort(campaign.endDate) : "…"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* Current News (Batch 2) — passive, auto-expiring news cards aimed at this
   user, grouped visually by section colour. Clicking one opens the full
   Announcements board. Hidden entirely when there's nothing live. */
function NewsStrip({ user, onOpen }) {
  const items = announcementsForUser(user, "news");
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <SecTitle>Current News</SecTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {items.map(a => {
          const meta = newsSectionMeta(a.section);
          return (
            <div key={a.id} onClick={onOpen} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen && onOpen(); } }}
              style={{ cursor: "pointer", background: C.sur, border: `1.5px solid ${C.bdr}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 12, padding: "13px 15px", transition: "border-color .15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.bdr2}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.bdr}>
              <Pill color={meta.color}>{meta.label}</Pill>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.txt, marginTop: 7 }}><MentionText text={linkifyMagnets(a.title || "")} /></div>
              {a.body && <div style={{ fontSize: 13, color: C.txt2, marginTop: 3, lineHeight: 1.45, maxHeight: 58, overflow: "hidden" }}><MentionText text={linkifyMagnets(a.body)} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Callbacks strip (Batch 4) — open callbacks aimed at this user (named or via
   a group). Rose-flagged until acknowledged. Clicking opens the callback to
   work its waitlist. */
function CallbacksStrip({ user, onOpen }) {
  const callbacks = openCallbacksForUser(user);
  if (callbacks.length === 0) return null;
  const products = getProducts();
  const productName = (id) => products.find(p => p.id === id)?.name || "A product";
  return (
    <div style={{ marginBottom: 22, display: "flex", flexDirection: "column", gap: 8 }}>
      {callbacks.map(c => {
        const acked = hasAckedCallback(c.id, user.id);
        const remaining = waitlistForProduct(c.productId).filter(e => !e.fulfilled).length;
        return (
          <div key={c.id} onClick={() => onOpen && onOpen(c.id)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter") onOpen && onOpen(c.id); }}
            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 11, padding: "12px 15px", borderRadius: 12, background: C.sur, border: `1.5px solid ${acked ? C.bdr : C.clay}` }}>
            <Icon name="inventory_2" size={20} style={{ color: C.clay, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.txt }}>Stock in — call your waitlist</div>
              <div style={{ fontSize: 12.5, color: C.mut }}>{productName(c.productId)} · {remaining} to call</div>
            </div>
            {!acked && <span style={{ fontSize: 11, fontWeight: 700, color: C.clay, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>New</span>}
            <Icon name="chevron_right" size={20} style={{ color: C.faint }} />
          </div>
        );
      })}
    </div>
  );
}

/* Chat unread strip (Batch chat P3) — appears when you have unread messages. */
function ChatStrip({ count, onOpen }) {
  if (!count) return null;
  return (
    <div onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onOpen && onOpen(); }}
      style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 11, padding: "12px 15px", borderRadius: 12, background: C.sur, border: `1.5px solid ${C.moss}`, marginBottom: 22 }}>
      <Icon name="forum" size={20} style={{ color: C.moss, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.txt }}>{count} unread message{count === 1 ? "" : "s"}</div>
        <div style={{ fontSize: 12.5, color: C.mut }}>Jump into chat to catch up</div>
      </div>
      <Icon name="chevron_right" size={20} style={{ color: C.faint }} />
    </div>
  );
}

/* ── Backup health warning (admins only) ────────────────────────────
   A dead backup looks identical to a working one until the day it's needed,
   and Admin Panel → Backups is a page nobody opens unprompted. So the same
   signal lands where the admins actually look. Silent when healthy — this
   must never become another banner people learn to scroll past.

   Remote-only: dev mode has no server to back up, matching the Backups panel
   precedent. Verdict logic lives in globals (`backupHealth`, pure + tested in
   scripts/test_backup_health.mjs); this component only renders it. */
function BackupHealthStrip({ user, onOpenAdmin }) {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    if (!REMOTE_MODE || (user?.role !== "admin")) return;
    let alive = true;
    backupList()
      .then(res => { if (alive) setHealth(backupHealth(res)); })
      // A failed status fetch is NOT reported as a backup failure — that would
      // cry wolf on any transient network blip. Admin Panel stays the source
      // of truth.
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  if (!health || health.level === "ok") return null;
  const isBad = health.level === "bad";
  const accent = isBad ? C.red : C.clay;
  return (
    <div style={{
      marginBottom: 22, background: accent + "0d", border: `1.5px solid ${accent}59`,
      borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: "12px 15px",
      display: "flex", alignItems: "flex-start", gap: 11,
    }}>
      <Icon name={isBad ? "cloud_off" : "warning"} size={20} style={{ color: accent, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>
          {isBad ? "Backups need attention" : "Backup warning"}
        </div>
        <div style={{ fontSize: 13, color: C.txt2, marginTop: 2, lineHeight: 1.45 }}>
          {health.problems.map((p, i) => <div key={i}>{p}</div>)}
        </div>
      </div>
      {onOpenAdmin && (
        <button type="button" onClick={onOpenAdmin}
          style={{
            flexShrink: 0, background: "none", border: `1.5px solid ${accent}59`, borderRadius: 8,
            color: accent, fontWeight: 700, fontSize: 12, fontFamily: FONT_CAPS, textTransform: "uppercase",
            letterSpacing: "0.06em", padding: "6px 11px", cursor: "pointer",
          }}>
          Open Backups
        </button>
      )}
    </div>
  );
}

/* ── Merged "Needs your attention" bar ──────────────────────────────
   Collapses the four notification channels (callbacks, unread chat, news,
   alerts) into ONE bar with a per-channel count, instead of up to five
   separately-styled strips stacked at the top. Clay accent when something
   is must-act (an open callback or a flagged alert), moss when it's just
   informational (chat/news). Expands to reveal the real items — the
   existing strip components, passed in as children. Hidden when empty. */
function AttentionBar({ callbackCount, chatUnread, newsCount, alertCount, children }) {
  const [open, setOpen] = useState(false);
  const total = callbackCount + (chatUnread ? 1 : 0) + newsCount + alertCount;
  if (total === 0) return null;
  const mustAct = callbackCount > 0 || alertCount > 0;
  const accent = mustAct ? C.clay : C.moss;
  const chips = [];
  if (callbackCount) chips.push(`${callbackCount} callback${callbackCount === 1 ? "" : "s"}`);
  if (alertCount) chips.push(`${alertCount} alert${alertCount === 1 ? "" : "s"}`);
  if (chatUnread) chips.push(`${chatUnread} unread`);
  if (newsCount) chips.push(`${newsCount} update${newsCount === 1 ? "" : "s"}`);
  return (
    <div style={{ marginBottom: 22, background: C.sur, border: `1.5px solid ${mustAct ? accent + "66" : C.bdr}`, borderLeft: `4px solid ${accent}`, borderRadius: 12, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 15px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <Icon name={mustAct ? "notifications_active" : "notifications"} size={19} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: C.txt, flexShrink: 0 }}>Needs your attention</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <span key={i} style={{ fontSize: 11.5, fontWeight: 600, color: C.txt2, background: C.bg, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 9px" }}>{c}</span>
          ))}
        </span>
        <span style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          {open ? "Hide" : "Show"} <Icon name={open ? "expand_less" : "expand_more"} size={17} />
        </span>
      </button>
      {open && <div style={{ padding: "4px 15px 14px" }}>{children}</div>}
    </div>
  );
}

/* ── Focus hero — the answer to "what do I do next?" ────────────────
   The single most prominent element: overdue + due-today work, full width,
   red top-accent the moment anything is overdue. When the day is clear it
   stays calm and points at what's coming, so the dashboard never opens on a
   wall of equal-weight cards. */
function FocusHero({ items, weekCount, onToggle, onOpen }) {
  const overdue = items.filter(i => i.group === "overdue");
  const today = items.filter(i => i.group === "today");
  const hasOverdue = overdue.length > 0;
  const accent = hasOverdue ? C.red : C.moss;
  const summary = items.length === 0
    ? (weekCount > 0 ? `Nothing due today · ${weekCount} coming up this week` : "Nothing due today")
    : [hasOverdue ? `${overdue.length} overdue` : null, today.length ? `${today.length} due today` : null].filter(Boolean).join(" · ");
  return (
    <section style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderTop: `3px solid ${accent}`, borderRadius: 14, padding: "18px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: items.length ? 14 : 0 }}>
        <Icon name={hasOverdue ? "priority_high" : "wb_sunny"} size={20} style={{ color: accent }} />
        <span style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>Do next today</span>
        <span style={{ fontSize: 13, color: hasOverdue ? C.red : C.mut, fontWeight: hasOverdue ? 700 : 500 }}>{summary}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.mut, fontSize: 13.5, marginTop: 10 }}>
          <Icon name="check_circle" size={17} style={{ color: C.moss }} />
          You&apos;re clear for today — nice. Anything assigned shows below.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
          {[...overdue, ...today].map(item => (
            <ItemRow key={item.key} item={item} onToggle={() => onToggle(item)} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </section>
  );
}

/* Quiet secondary section — uniform header so the grid cells line up. */
const DashSection = ({ title, extra, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.08em", color: C.txt2 }}>{title}</span>
      {extra}
    </div>
    {children}
  </div>
);

function MyDashboard({ user, onOpenProject, onOpenContent, onOpenCampaign, onOpenSubmission, onNavigateOut, onOpenStore, onOpenAnnouncements, onOpenCallback, chatUnread = 0, onOpenChat, onOpenAdmin }) {
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
    .filter(t => isAssignedTo(t, user.id) && !t.archived)
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
    .filter(c => isAssignedTo(c, user.id))
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

  // Counts for the merged attention bar (the strips themselves still own
  // their rendering — this is just the summary line).
  const myCallbacks = openCallbacksForUser(user);
  const myNews = announcementsForUser(user, "news");

  // Hero = overdue + due-today; the secondary "This week & later" card gets
  // everything else still open.
  const todayItems = bySection(DASH_SECTIONS[0]);      // overdue + today
  const laterItems = bySection(DASH_SECTIONS[1]);      // week + later

  // Upcoming campaigns (team-wide) — not done, and not already ended.
  const t0 = new Date();
  const todayLocal = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, "0")}-${String(t0.getDate()).padStart(2, "0")}`;
  const upcomingCampaigns = campaigns
    .filter(c => c.status !== "done")
    .filter(c => { const e = c.endDate || c.startDate; return !e || e >= todayLocal; })
    .sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999"))
    .slice(0, 6);

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

      {/* Above the attention bar on purpose: a broken backup outranks any
          per-user notification, and must not sit collapsed behind a "Show". */}
      <BackupHealthStrip user={user} onOpenAdmin={onOpenAdmin} />

      {/* One merged bar instead of up to five stacked notification strips.
          Expands to the original strips, which keep their own behavior. */}
      <AttentionBar callbackCount={myCallbacks.length} chatUnread={chatUnread} newsCount={myNews.length} alertCount={myAlerts.length}>
        <CallbacksStrip user={user} onOpen={onOpenCallback} />
        <ChatStrip count={chatUnread} onOpen={onOpenChat} />
        <AlertsStrip alerts={myAlerts} tasks={tasks} users={users} onDismiss={dismissAlert} onOpenTask={openAlertedTask} />
        <NewsStrip user={user} onOpen={onOpenAnnouncements} />
      </AttentionBar>

      {/* Hero — the most prominent block, "what do I do next?" */}
      <FocusHero items={todayItems} weekCount={laterItems.length} onToggle={toggleItem} onOpen={openItem} />

      {/* Store gauges stay their own wide element, demoted below the hero. */}
      <DashStoreStrip user={user} onOpen={onOpenStore} />

      {/* Quiet, aligned secondary grid — equal gaps, uniform headers. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "start" }}>
        <DashSection title="This week & later" extra={laterItems.length > 0 && <span style={{ fontSize: 11, color: C.mut, background: C.bg, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{laterItems.length}</span>}>
          {laterItems.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {laterItems.map(item => <ItemRow key={item.key} item={item} onToggle={() => toggleItem(item)} onOpen={() => openItem(item)} />)}
            </div>
          ) : (
            <DashEmpty icon="task_alt" title="Nothing upcoming" sub="Tasks assigned to you, due later this week or beyond, land here." />
          )}
        </DashSection>

        <DashSection title="My Projects">
          {myProjects.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {myProjects.map(p => (
                <ProjectCard key={p.id} project={p} users={users} tasks={tasks} onOpen={() => onOpenProject && onOpenProject(p.id)} />
              ))}
            </div>
          ) : (
            <DashEmpty icon="folder_open" title="No projects" sub="Projects you lead or belong to appear here." />
          )}
        </DashSection>

        <DashSection title="Upcoming Campaigns">
          {upcomingCampaigns.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {upcomingCampaigns.map(c => <DashCampaignCard key={c.id} campaign={c} onOpen={() => onOpenCampaign && onOpenCampaign(c.id)} />)}
            </div>
          ) : (
            <DashEmpty icon="campaign" title="No upcoming campaigns" sub="Campaigns with a current or future date range show here." />
          )}
        </DashSection>

        {myForms.length > 0 && (
          <DashSection title="My Forms" extra={<span style={{ fontSize: 11, color: C.faint }}>in progress</span>}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {myForms.map(f => {
                const doc = sops.find(s => s.id === f.docId);
                return (
                  <div key={f.id} onClick={() => onOpenSubmission && onOpenSubmission(f.docId, f.id)} role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSubmission && onOpenSubmission(f.docId, f.id); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 12,
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
          </DashSection>
        )}
      </div>

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
