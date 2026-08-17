import React, { useState } from 'react';
import {
  C, FONT_CAPS, uid, nowISO, CATEGORY_COLORS, inp,
  getCampaigns, addCampaign, updateCampaign, deleteCampaign, defCampaign,
  getContentItems, addContentItem, updateContentItem, deleteContentItem, defContentItem,
  getContentReports, addContentReport, deleteContentReport, reportRange, REPORT_RANGES,
  getUsers, confirmDelete, triggerSaved, canEdit, fmtDate, fmtDateShort, isOverdue,
  CAMPAIGN_STATUSES, campaignStatusMeta, CONTENT_CHANNELS, contentChannelMeta,
  CONTENT_STATUSES, contentStatusMeta, CONTENT_TYPES, contentTypeLabel, assigneesOf, GBP_CTA_TYPES, GBP_CATEGORIES,
  campaignChannelCounts, processAndStoreImage, linkifyMagnets,
  copyMagnet, createTaskFromItem, taskPrefillFromItem,
  getTasks, getProjects, taskOnCalendar, navigateItem,
  fetchOmnisendCampaigns, fetchOmnisendCampaignStats, triggerToast,
  parseDate, todayLocalISO, daysBetween, addDaysISO, MONTHS_ABBR, TIMELINE_ZOOMS,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Avatar, SectionHeader, EmptyState, lbl, LinkPopover, ItemLink, Popover, MentionText, RichMentionField, Modal, Segmented } from './shared.jsx';

/* Design intent: a shop's paper wall-planner, not a marketing ops tool —
   each day is a small cell you'd pin a sticky note to. The signature is
   the content chip: a colored campaign rail (the same "rail = ownership"
   vocabulary as a Project card's left color bar) plus a channel glyph and
   a clipped title, so a month reads as a shelf of labeled tags rather
   than a dense grid of text. Campaign color is the only place color
   carries meaning here — channel icons stay neutral ink, status keeps
   the existing Pill-as-ingredient-tag treatment. Borders-only depth,
   Jost uppercase-tracked headers/tabs, IBM Plex Mono for dates — same
   system as Projects/Task Manager. */

const VIEW_TABS = [
  { key: "calendar", label: "Calendar" },
  { key: "list", label: "List" },
  { key: "campaigns", label: "Campaigns" },
  { key: "reports", label: "Reports" },
];

// Metrics the Reports tab rolls up (Batch 3). These mirror
// defContentItem().metrics; managers can re-point the charts at any of them.
const REPORT_METRICS = [
  { key: "likes", label: "Likes", color: "#799385" },
  { key: "shares", label: "Shares", color: "#C08A6B" },
  { key: "clicks", label: "Clicks", color: "#4f6358" },
  { key: "saves", label: "Saves", color: "#B98A3E" },
  { key: "sales", label: "Sales", color: "#B63E59" },
];

function monthMeta(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const days = [];
  for (let i = 0; i < firstDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  return { y, m, daysInMonth, days };
}
function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function fmtMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function dayStr(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function tabStyle(active) {
  return {
    padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer",
    border: `1.5px solid ${active ? C.moss : C.bdr}`,
    textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.07em",
    background: active ? C.mossSoft : C.sur, color: active ? C.moss : C.mut,
  };
}

/* ─── CONTENT CHIP (calendar cell + list row glyph) ─────────────────── */
function ContentChip({ item, campaign, onClick }) {
  const ch = contentChannelMeta[item.channel] || CONTENT_CHANNELS[0];
  const sm = contentStatusMeta[item.status] || CONTENT_STATUSES[0];
  const railColor = campaign?.color || C.faint;
  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      title={`${item.title || "Untitled"} · ${sm.label}`}
      style={{
        display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
        background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 5,
        padding: "2px 6px 2px 4px", overflow: "hidden",
      }}>
      <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: railColor, flexShrink: 0 }} />
      <span style={{ width: 6, height: 6, borderRadius: 99, background: sm.col, flexShrink: 0 }} title={sm.label} />
      <Icon name={ch.icon} size={11} style={{ color: C.txt2, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.title || "Untitled"}
      </span>
    </div>
  );
}

/* ─── CALENDAR VIEW ──────────────────────────────────────────────────── */
/* A campaign draws as a horizontal band spanning its date range, stacked in
   lanes below the day number — same "rail = campaign" color vocabulary as the
   chips, just stretched across days. Content-item chips flow underneath.
   ponytail: MAX_LANES visible bands per week; rare overflow shows a "+n" note. */
const CELL_PAD = 6, DNUM_H = 19, BAND_H = 16, BAND_GAP = 3, MAX_LANES = 3;

/** Lay a week's overlapping campaigns into non-overlapping lanes.
 * @param {(null|{d:number,ds:string})[]} cells 7 cells @param {Campaign[]} bandCampaigns */
function weekBands(cells, bandCampaigns) {
  const dated = cells.filter(Boolean).map(c => c.ds);
  if (dated.length === 0) return { lanes: [], overflow: 0 };
  const wStart = dated[0], wEnd = dated[dated.length - 1];
  const colOf = (ds) => cells.findIndex(c => c && c.ds === ds);
  const segs = [];
  bandCampaigns.forEach(c => {
    const s = c.startDate || c.endDate, e = c.endDate || c.startDate;
    if (!s || s > wEnd || e < wStart) return; // no date, or no overlap this week
    const startCol = colOf(s < wStart ? wStart : s);
    const endCol = colOf(e > wEnd ? wEnd : e);
    if (startCol < 0 || endCol < 0) return;
    segs.push({ campaign: c, startCol, endCol, openLeft: s < wStart, openRight: e > wEnd });
  });
  segs.sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
  const laneEnds = [];
  let overflow = 0;
  segs.forEach(seg => {
    let lane = laneEnds.findIndex(end => end < seg.startCol);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_LANES) { overflow++; return; }
    laneEnds[lane] = seg.endCol;
    seg.lane = lane;
  });
  return { lanes: segs.filter(s => s.lane !== undefined), overflow };
}

function CalendarView({ items, campaigns, bandCampaigns, tasksByDay = {}, onOpenTask, monthKey, setMonthKey, onOpenItem, onNewAt, onFilterCampaign }) {
  const { y, m, daysInMonth, days } = monthMeta(monthKey);
  const byDay = {};
  items.forEach(i => { if (i.publishDate) (byDay[i.publishDate] = byDay[i.publishDate] || []).push(i); });
  const today = todayStr();

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).map(d => d === null ? null : { d, ds: dayStr(y, m, d) }));
  }
  const lastW = weeks[weeks.length - 1];
  while (lastW && lastW.length < 7) lastW.push(null); // keep 7 columns

  const monthStart = dayStr(y, m, 1), monthEnd = dayStr(y, m, daysInMonth);
  const anyItemThisMonth = Object.keys(byDay).some(ds => ds >= monthStart && ds <= monthEnd);
  const anyBand = bandCampaigns.some(c => { const s = c.startDate || c.endDate, e = c.endDate || c.startDate; return s && s <= monthEnd && e >= monthStart; });
  const monthEmpty = !anyItemThisMonth && !anyBand;

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}` }}>
        <IconBtn icon="chevron_left" title="Previous month" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} />
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>{fmtMonthLabel(monthKey)}</div>
        <IconBtn icon="chevron_right" title="Next month" onClick={() => setMonthKey(shiftMonth(monthKey, 1))} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1.5px solid ${C.bdr}` }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>{d}</div>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        {weeks.map((cells, wi) => {
          const { lanes, overflow } = weekBands(cells, bandCampaigns);
          const laneCount = lanes.reduce((mx, s) => Math.max(mx, s.lane + 1), 0);
          const bandAreaH = laneCount * (BAND_H + BAND_GAP);
          return (
            <div key={wi} style={{ position: "relative" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                {cells.map((cell, ci) => {
                  if (!cell) return <div key={"e" + ci} style={{ minHeight: 92, borderRight: ci < 6 ? `1px solid ${C.bdr}` : "none", borderBottom: `1px solid ${C.bdr}`, background: C.bg }} />;
                  const dayItems = byDay[cell.ds] || [];
                  const dayTasks = tasksByDay[cell.ds] || [];
                  const isToday = cell.ds === today;
                  return (
                    <div key={cell.ds} onClick={() => onNewAt(cell.ds)}
                      style={{
                        minHeight: 92, padding: `${CELL_PAD}px 5px`, borderRight: ci < 6 ? `1px solid ${C.bdr}` : "none", borderBottom: `1px solid ${C.bdr}`,
                        cursor: "pointer", position: "relative", background: isToday ? C.dew : C.sur,
                      }}>
                      <div style={{
                        fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? C.moss : C.mut,
                        fontFamily: "'IBM Plex Mono',monospace", height: DNUM_H - 4, marginBottom: 4,
                      }}>{cell.d}</div>
                      {bandAreaH > 0 && <div style={{ height: bandAreaH }} aria-hidden="true" />}
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {dayItems.slice(0, 3).map(it => (
                          <ContentChip key={it.id} item={it} campaign={campaigns.find(c => c.id === it.campaignId)}
                            onClick={(e) => { e && e.stopPropagation && e.stopPropagation(); onOpenItem(it); }} />
                        ))}
                        {dayItems.length > 3 && <div style={{ fontSize: 10, color: C.faint, paddingLeft: 4 }}>+{dayItems.length - 3} more</div>}
                        {dayTasks.slice(0, 2).map(t => (
                          <div key={t.id} onClick={(e) => { e.stopPropagation(); onOpenTask && onOpenTask(t); }} title={t.title}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, padding: "2px 5px", borderRadius: 5, cursor: "pointer", background: C.bg, border: `1px solid ${C.bdr}`, color: C.txt2, overflow: "hidden", whiteSpace: "nowrap" }}>
                            <Icon name="task_alt" size={11} style={{ color: t.status === "done" ? C.moss : C.faint, flexShrink: 0 }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</span>
                          </div>
                        ))}
                        {dayTasks.length > 2 && <div style={{ fontSize: 10, color: C.faint, paddingLeft: 4 }}>+{dayTasks.length - 2} task{dayTasks.length - 2 > 1 ? "s" : ""}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {lanes.map((seg, si) => {
                  const leftPct = seg.startCol / 7 * 100;
                  const widthPct = (seg.endCol - seg.startCol + 1) / 7 * 100;
                  const insetL = seg.openLeft ? 0 : 3, insetR = seg.openRight ? 0 : 3;
                  const color = seg.campaign.color || C.moss;
                  return (
                    <div key={si} title={`${seg.campaign.name || "Untitled campaign"} — filter to this campaign`}
                      onClick={(e) => { e.stopPropagation(); onFilterCampaign && onFilterCampaign(seg.campaign.id); }}
                      style={{
                        position: "absolute", pointerEvents: "auto", cursor: "pointer",
                        top: CELL_PAD + DNUM_H + seg.lane * (BAND_H + BAND_GAP), height: BAND_H,
                        left: `calc(${leftPct}% + ${insetL}px)`, width: `calc(${widthPct}% - ${insetL + insetR}px)`,
                        background: color + "22", border: `1px solid ${color}`,
                        borderLeft: seg.openLeft ? "none" : `1px solid ${color}`, borderRight: seg.openRight ? "none" : `1px solid ${color}`,
                        borderRadius: `${insetL ? 5 : 0}px ${insetR ? 5 : 0}px ${insetR ? 5 : 0}px ${insetL ? 5 : 0}px`,
                        display: "flex", alignItems: "center", padding: "0 6px", overflow: "hidden",
                        fontSize: 10, fontWeight: 700, color: C.txt, whiteSpace: "nowrap",
                      }}>
                      <Icon name="campaign" size={11} style={{ color, marginRight: 4, flexShrink: 0 }} />
                      {seg.campaign.name || "Untitled campaign"}
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <div style={{ position: "absolute", right: 6, top: CELL_PAD + DNUM_H + (MAX_LANES - 1) * (BAND_H + BAND_GAP), fontSize: 9, fontWeight: 700, color: C.faint }}>+{overflow}</div>
                )}
              </div>
            </div>
          );
        })}
        {monthEmpty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", padding: 20 }}>
            <div style={{ textAlign: "center" }}>
              <Icon name="event_available" size={26} style={{ color: C.faint, marginBottom: 6 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: C.mut }}>Nothing scheduled this month</div>
              <div style={{ fontSize: 12, color: C.faint }}>Click any day to add content.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CONTENT ITEM RAIL (beside the calendar) ─────────────────────────────
   Every filtered item as a scannable row — INCLUDING undated ones, grouped
   under "Unscheduled", so a just-created item with no publish date never
   silently vanishes from view. */
function ItemRail({ items, campaigns, onOpenItem }) {
  const dated = items.filter(i => i.publishDate).sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  const undated = items.filter(i => !i.publishDate);
  const row = (it) => {
    const ch = contentChannelMeta[it.channel] || CONTENT_CHANNELS[0];
    const sm = contentStatusMeta[it.status] || CONTENT_STATUSES[0];
    const campaign = campaigns.find(c => c.id === it.campaignId);
    const overdue = isOverdue(it.publishDate, it.status === "published");
    return (
      <div key={it.id} onClick={() => onOpenItem(it)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenItem(it); } }}
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", cursor: "pointer", borderTop: `1px solid ${C.bdr}` }}
        onMouseEnter={e => e.currentTarget.style.background = C.s2}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: campaign?.color || C.faint, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name={ch.icon} size={13} style={{ color: C.txt2, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title || "Untitled"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 3 }}>
            <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: overdue ? C.red : C.faint, fontWeight: overdue ? 700 : 400 }}>
              {it.publishDate ? fmtDateShort(it.publishDate) : "Unscheduled"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: C.mut }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: sm.col }} />{sm.label}
            </span>
          </div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 640 }}>
      <div style={{ padding: "13px 14px", borderBottom: `1.5px solid ${C.bdr}`, fontSize: 12, fontWeight: 700, color: C.txt, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", flexShrink: 0 }}>
        Content items <span style={{ color: C.faint }}>({items.length})</span>
      </div>
      <div style={{ overflowY: "auto" }}>
        {items.length === 0 && <div style={{ padding: "22px 14px", textAlign: "center", fontSize: 13, color: C.faint }}>No content items match the current filters.</div>}
        {dated.map(row)}
        {undated.length > 0 && (
          <>
            <div style={{ padding: "8px 14px 6px", fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", background: C.bg, borderTop: `1px solid ${C.bdr}` }}>Unscheduled</div>
            {undated.map(row)}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── LIST VIEW ──────────────────────────────────────────────────────── */
function ListView({ items, users, campaigns, onOpenItem }) {
  const [sortKey, setSortKey] = useState("publishDate");
  const [sortDir, setSortDir] = useState("asc");
  const cols = [
    { key: "publishDate", label: "Date" },
    { key: "channel", label: "Channel" },
    { key: "title", label: "Title" },
    { key: "campaignId", label: "Campaign" },
    { key: "assigneeId", label: "Assignee" },
    { key: "status", label: "Status" },
  ];
  const valueFor = (item, key) => {
    if (key === "campaignId") return campaigns.find(c => c.id === item.campaignId)?.name || "";
    if (key === "assigneeId") return users.find(u => u.id === assigneesOf(item)[0])?.name || "";
    return item[key] || "";
  };
  const sorted = [...items].sort((a, b) => {
    const av = valueFor(a, sortKey), bv = valueFor(b, sortKey);
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  if (items.length === 0) {
    return <EmptyState icon="calendar_month" title="Nothing scheduled" sub="No content items match the current filters." />;
  }

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.bg }}>
            {cols.map(c => (
              <th key={c.key} onClick={() => toggleSort(c.key)}
                style={{
                  padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: C.mut,
                  borderBottom: `1.5px solid ${C.bdr}`, cursor: "pointer", whiteSpace: "nowrap",
                  textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", userSelect: "none",
                }}>
                {c.label}{sortKey === c.key && <Icon name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} style={{ marginLeft: 4, verticalAlign: "middle" }} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((it, ri) => {
            const ch = contentChannelMeta[it.channel] || CONTENT_CHANNELS[0];
            const sm = contentStatusMeta[it.status] || CONTENT_STATUSES[0];
            const campaign = campaigns.find(c => c.id === it.campaignId);
            const itAssignees = assigneesOf(it).map(id => users.find(u => u.id === id)).filter(Boolean);
            const overdue = isOverdue(it.publishDate, it.status === "published");
            return (
              <tr key={it.id} onClick={() => onOpenItem(it)}
                style={{ borderBottom: `1px solid ${C.bdr}`, cursor: "pointer", background: ri % 2 === 0 ? C.sur : C.bg }}
                onMouseEnter={e => e.currentTarget.style.background = C.s2}
                onMouseLeave={e => e.currentTarget.style.background = ri % 2 === 0 ? C.sur : C.bg}>
                <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: overdue ? C.red : C.mut, fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>
                  {it.publishDate ? fmtDateShort(it.publishDate) : "—"}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.txt2 }}>
                    <Icon name={ch.icon} size={14} />{ch.label}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 14, fontWeight: 600, color: C.txt, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {contentTypeLabel(it.channel, it.type) && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS, marginRight: 7 }}>{contentTypeLabel(it.channel, it.type)}</span>
                  )}
                  {it.title || "Untitled"}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: campaign?.color || C.faint, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {campaign?.name || "—"}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                  {itAssignees.length > 0 ? <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Avatar name={itAssignees[0].name} size={18} /><span style={{ fontSize: 12, color: C.mut }}>{itAssignees[0].name}{itAssignees.length > 1 ? ` +${itAssignees.length - 1}` : ""}</span></div> : <span style={{ fontSize: 12, color: C.faint }}>Unassigned</span>}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}><Pill color={sm.col}>{sm.label}</Pill></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* One row of the Links section — label + shared web/internal LinkPopover,
   same treatment as TaskManager's TaskLinkRow so magnet linking looks
   identical everywhere. */
function ContentLinkRow({ link, nav, onChange, onRemove }) {
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
            border: `1.5px solid ${link.url ? C.moss : C.bdr}`, background: link.url ? C.mossSoft : C.sur,
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

/* Compact read-only mockup of how a GBP post will look — internal preview
   only (no client-approval step; this app has no client portal). */
function GbpPreview({ form }) {
  const cta = GBP_CTA_TYPES.find(c => c.key === form.ctaType);
  const cat = GBP_CATEGORIES.find(c => c.key === (form.category || "update"));
  const img = (form.images || [])[0];
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 11, overflow: "hidden" }}>
      {img && <img src={img.src} alt="" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />}
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {cat && <Pill color={C.moss}>{cat.label}</Pill>}
        <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {form.body ? <MentionText text={linkifyMagnets(form.body)} /> : <span style={{ color: C.faint }}>Post text preview…</span>}
        </div>
        {cta && cta.key && (
          <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: C.moss, border: `1.5px solid ${C.moss}`, borderRadius: 99, padding: "5px 14px" }}>
            {cta.label}
          </span>
        )}
      </div>
    </div>
  );
}

/* Performance metrics. All channels get manual number fields. Email items
   linked to an Omnisend campaign pull opens/clicks/revenue live instead. */
function MetricsSection({ form, setMetric, set }) {
  const [picking, setPicking] = useState(null); // anchorRect
  const [omniList, setOmniList] = useState(null); // null=not loaded, []=loaded
  const [loadingStats, setLoadingStats] = useState(false);
  const isEmail = form.channel === "email";
  const linked = form.omnisendCampaignId;

  const openPicker = async (e) => {
    setPicking(e.currentTarget.getBoundingClientRect());
    if (omniList === null) {
      try { setOmniList(await fetchOmnisendCampaigns()); }
      catch (err) { triggerToast(err.message || "Couldn't load Omnisend campaigns"); setOmniList([]); }
    }
  };
  const refreshStats = async () => {
    if (!linked) return;
    setLoadingStats(true);
    try {
      const stats = await fetchOmnisendCampaignStats(linked);
      if (!stats) { triggerToast("No stats available for this campaign yet"); setLoadingStats(false); return; }
      set("omnisendStats", { ...stats, fetchedAt: new Date().toISOString() });
    } catch (err) { triggerToast(err.message || "Couldn't refresh stats"); }
    setLoadingStats(false);
  };

  const metricFields = [
    ["likes", "Likes"], ["shares", "Shares"], ["clicks", "Clicks"], ["saves", "Saves"], ["sales", "Sales ($)"],
  ];

  return (
    <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Metrics</div>

      {isEmail && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <OBtn onClick={openPicker} style={{ padding: "7px 12px" }}>
              <Icon name="link" size={15} />{linked ? "Change Omnisend campaign" : "Link Omnisend campaign"}
            </OBtn>
            {linked && <OBtn onClick={refreshStats} style={{ padding: "7px 12px" }} disabled={loadingStats}><Icon name="refresh" size={15} />{loadingStats ? "Refreshing…" : "Refresh stats"}</OBtn>}
          </div>
          {form.omnisendStats && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: C.txt }}>
              <span><b>{form.omnisendStats.opens}</b> opens</span>
              <span><b>{form.omnisendStats.clicks}</b> clicks</span>
              <span><b>${form.omnisendStats.revenue}</b> revenue</span>
              {form.omnisendStats.fetchedAt && <span style={{ color: C.faint }}>as of {fmtDateShort(form.omnisendStats.fetchedAt)}</span>}
            </div>
          )}
          {picking && (
            <Popover anchorRect={picking} onClose={() => setPicking(null)} width={280}>
              {omniList === null && <div style={{ fontSize: 13, color: C.mut, padding: "4px 6px" }}>Loading…</div>}
              {omniList && omniList.length === 0 && <div style={{ fontSize: 13, color: C.mut, padding: "4px 6px" }}>No Omnisend campaigns found. Use the manual fields below.</div>}
              {(omniList || []).map(c => (
                <button key={c.id} type="button" onClick={() => { set("omnisendCampaignId", c.id); setPicking(null); }}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "7px 9px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.s2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 13.5, color: C.txt, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: C.faint }}>{c.status}{c.sentAt ? " · " + c.sentAt : ""}</span>
                </button>
              ))}
            </Popover>
          )}
          <div style={{ fontSize: 12, color: C.faint }}>No Omnisend campaign linked? Enter numbers manually below.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {metricFields.map(([k, label]) => (
          <div key={k} style={{ flex: "1 1 90px" }}>
            <label style={lbl()}>{label}</label>
            <input type="number" min="0" value={(form.metrics || {})[k] ?? ""} onChange={e => setMetric(k, e.target.value)}
              placeholder="0" style={inp({ fontSize: 13, padding: "7px 10px" })} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* Compact multi-select staff dropdown (#62) — a closed control showing the
   picked names/count that opens a checklist, so assignees take one field's
   worth of space instead of a wrapping chip row. */
function MultiSelectStaff({ users, selectedIds, onToggle }) {
  const [open, setOpen] = useState(false);
  const selected = users.filter(u => selectedIds.includes(u.id));
  const label = selected.length === 0 ? "Unassigned"
    : selected.length <= 2 ? selected.map(u => u.name.split(" ")[0]).join(", ")
    : `${selected.length} staff`;
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...inp(), display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}>
        <span style={{ flex: 1, minWidth: 0, color: selected.length ? C.txt : C.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <Icon name="expand_more" size={18} style={{ color: C.mut, flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 41, background: C.sur, border: `1.5px solid ${C.bdr2}`, borderRadius: 10, boxShadow: C.shadowMd, maxHeight: 230, overflowY: "auto", padding: 6 }}>
            {users.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: C.faint }}>No staff yet.</div>}
            {users.map(u => {
              const on = selectedIds.includes(u.id);
              return (
                <button key={u.id} type="button" onClick={() => onToggle(u.id)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "7px 9px", background: on ? C.mossSoft : "transparent", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = C.s2; }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, border: `1.5px solid ${on ? C.moss : C.bdr2}`, background: on ? C.moss : C.sur, display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Icon name="check" size={13} style={{ color: "#fff" }} />}</span>
                  <Avatar name={u.name} size={20} />
                  <span style={{ fontSize: 14, color: C.txt }}>{u.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── CONTENT ITEM SLIDE-OUT EDITOR ──────────────────────────────────── */
function ContentItemModal({ initial, users, campaigns, nav, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setMetric = (k, v) => setForm(f => ({ ...f, metrics: { ...(f.metrics || {}), [k]: v } }));
  // Multi-assignee (Batch 3): assigneeIds is the source of truth; keep the
  // legacy assigneeId synced to the first entry for older readers/ICS feed.
  const itemAssigneeIds = form.assigneeIds || (form.assigneeId ? [form.assigneeId] : []);
  const toggleAssignee = (id) => setForm(f => {
    const cur = f.assigneeIds || (f.assigneeId ? [f.assigneeId] : []);
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    return { ...f, assigneeIds: next, assigneeId: next[0] || "" };
  });

  const createCampaign = () => {
    if (!newCampaignName.trim()) return;
    const next = addCampaign({ ...defCampaign(), name: newCampaignName.trim() });
    triggerSaved();
    const created = next[next.length - 1];
    set("campaignId", created.id);
    setNewCampaignName(""); setAddingCampaign(false);
  };

  const addLink = () => set("links", [...(form.links || []), { id: uid(), label: "", url: "" }]);
  const changeLink = (id, changes) => set("links", (form.links || []).map(l => l.id === id ? { ...l, ...changes } : l));
  const removeLink = (id) => set("links", (form.links || []).filter(l => l.id !== id));

  const addImage = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const src = await processAndStoreImage(file);
      set("images", [...(form.images || []), { id: uid(), src, caption: "" }]);
    } catch (err) { triggerToast(err.message || "Couldn't upload image"); }
    setUploading(false);
  };
  const removeImage = (id) => set("images", (form.images || []).filter(i => i.id !== id));
  const setImageCaption = (id, caption) => set("images", (form.images || []).map(i => i.id === id ? { ...i, caption } : i));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,12,10,0.35)" }} onClick={onClose} />
      <div className="gk-fade-in" onClick={e => e.stopPropagation()} style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 520, maxWidth: "92vw",
        background: C.sur, borderLeft: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "18px 22px", borderBottom: `1.5px solid ${C.bdr}`, flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? "New Content Item" : "Edit Content Item"}</div>
          {!isNew && <IconBtn icon="my_location" size={16} title="Copy magnet link to this item" onClick={() => copyMagnet("content", form.id)} />}
          {!isNew && <IconBtn icon="add_task" size={16} title="Create a task from this item" onClick={() => createTaskFromItem(taskPrefillFromItem("content", form.id, form.title))} />}
          {!isNew && <IconBtn icon="delete" danger title="Delete" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
              <label style={lbl()}>Channel</label>
              <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value, type: "" }))} style={inp()}>
                {CONTENT_CHANNELS.map(ch => <option key={ch.key} value={ch.key}>{ch.label}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label style={lbl()}>Assignees</label>
              <MultiSelectStaff users={users} selectedIds={itemAssigneeIds} onToggle={toggleAssignee} />
            </div>
          </div>

          <div>
            <label style={lbl()}>Title</label>
            <input autoFocus value={form.title} onChange={e => set("title", e.target.value)} placeholder="Content title…" style={inp()} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)} style={inp()}>
                {CONTENT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {CONTENT_TYPES[form.channel] && (
              <div style={{ flex: "1 1 140px" }}>
                <label style={lbl()}>Type</label>
                <select value={form.type || ""} onChange={e => set("type", e.target.value)} style={inp()}>
                  <option value="">—</option>
                  {CONTENT_TYPES[form.channel].map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            )}
            <div style={{ flex: "1 1 120px" }}>
              <label style={lbl()}>Start date</label>
              <input type="date" value={form.startDate || ""} onChange={e => set("startDate", e.target.value)} max={form.publishDate || undefined} style={inp()} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={lbl()}>Publish date</label>
              <input type="date" value={form.publishDate || ""} onChange={e => set("publishDate", e.target.value)} min={form.startDate || undefined} style={inp()} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 100%" }}>
              <label style={lbl()}>Campaign</label>
              {addingCampaign ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input autoFocus value={newCampaignName} onChange={e => setNewCampaignName(e.target.value)}
                    placeholder="New campaign name…" style={inp({ fontSize: 14, padding: "8px 11px" })}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); createCampaign(); } }} />
                  <IconBtn icon="check" title="Create" onClick={createCampaign} style={{ color: C.moss }} />
                  <IconBtn icon="close" title="Cancel" onClick={() => { setAddingCampaign(false); setNewCampaignName(""); }} />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={form.campaignId || ""} onChange={e => set("campaignId", e.target.value)} style={inp()}>
                    <option value="">No campaign</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name || "Untitled campaign"}</option>)}
                  </select>
                  <IconBtn icon="add" title="New campaign" onClick={() => setAddingCampaign(true)} />
                </div>
              )}
            </div>
          </div>

          <div>
            <label style={lbl()}>Body</label>
            <RichMentionField multiline value={form.body || ""} onChange={v => set("body", v)} placeholder="Draft copy, description, or internal notes…" style={inp({ lineHeight: 1.55, minHeight: 92 })} />
          </div>

          {/* Channel-specific fields */}
          {form.channel === "gbp" && (
            <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Google Business Details</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 140px" }}>
                  <label style={lbl()}>CTA type</label>
                  <select value={form.ctaType || ""} onChange={e => set("ctaType", e.target.value)} style={inp()}>
                    {GBP_CTA_TYPES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <label style={lbl()}>Post category</label>
                  <select value={form.category || "update"} onChange={e => set("category", e.target.value)} style={inp()}>
                    {GBP_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl()}>CTA URL</label>
                <input value={form.ctaUrl || ""} onChange={e => set("ctaUrl", e.target.value)} placeholder="https://…" style={inp()} />
              </div>
              <GbpPreview form={form} />
            </div>
          )}
          {form.channel === "blog" && (
            <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Blog Details</div>
              <div>
                <label style={lbl()}>Target keyword</label>
                <input value={form.targetKeyword || ""} onChange={e => set("targetKeyword", e.target.value)} placeholder="e.g. natural face oil" style={inp()} />
              </div>
              <div>
                <label style={lbl()}>Slug / URL</label>
                <input value={form.url || ""} onChange={e => set("url", e.target.value)} placeholder="/blog/…" style={inp()} />
              </div>
            </div>
          )}
          {form.channel === "email" && (
            <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Email Details</div>
              <div>
                <label style={lbl()}>Subject line</label>
                <input value={form.subjectLine || ""} onChange={e => set("subjectLine", e.target.value)} placeholder="Subject…" style={inp()} />
              </div>
              <div>
                <label style={lbl()}>Preview text</label>
                <input value={form.previewText || ""} onChange={e => set("previewText", e.target.value)} placeholder="Shown next to the subject line in the inbox…" style={inp()} />
              </div>
            </div>
          )}
          {form.channel === "instagram" && (
            <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em" }}>Instagram Details</div>
              <div>
                <label style={lbl()}>Caption</label>
                <RichMentionField multiline value={form.caption || ""} onChange={v => set("caption", v)} placeholder="What actually posts…" style={inp({ lineHeight: 1.55, minHeight: 74 })} />
              </div>
              <div>
                <label style={lbl()}>Hashtags</label>
                <input value={form.hashtags || ""} onChange={e => set("hashtags", e.target.value)} placeholder="#greenkiss #naturalbeauty" style={inp()} />
              </div>
            </div>
          )}

          <div>
            <label style={lbl()}>Images</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(form.images || []).map(img => (
                <div key={img.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <img src={img.src} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 7, border: `1px solid ${C.bdr}`, flexShrink: 0 }} />
                  <input value={img.caption} onChange={e => setImageCaption(img.id, e.target.value)} placeholder="Caption…"
                    style={inp({ fontSize: 13, padding: "7px 10px", flex: 1 })} />
                  <IconBtn icon="close" title="Remove image" onClick={() => removeImage(img.id)} />
                </div>
              ))}
              <label style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: C.moss,
                cursor: uploading ? "default" : "pointer", padding: "8px 14px", borderRadius: 9,
                border: `1.5px solid ${C.moss}55`, background: C.mossSoft, width: "fit-content",
                textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: "0.06em", opacity: uploading ? 0.6 : 1,
              }}>
                <Icon name="add_photo_alternate" size={16} />{uploading ? "Uploading…" : "Add image"}
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading}
                  onChange={e => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
          </div>

          <div>
            <label style={lbl()}>Links</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {(form.links || []).map(l => (
                <ContentLinkRow key={l.id} link={l} nav={nav}
                  onChange={changes => changeLink(l.id, changes)} onRemove={() => removeLink(l.id)} />
              ))}
            </div>
            <OBtn onClick={addLink} style={{ padding: "7px 14px" }}><Icon name="add" size={15} />Add link</OBtn>
          </div>

          <MetricsSection form={form} setMetric={setMetric} set={set} />


          <div>
            <label style={lbl()}>Internal notes</label>
            <RichMentionField multiline value={form.notes || ""} onChange={v => set("notes", v)} placeholder="Not published — team notes only…" style={inp({ lineHeight: 1.55, minHeight: 56 })} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 22px", borderTop: `1.5px solid ${C.bdr}`, flexShrink: 0 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.title.trim()}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── CAMPAIGN MODAL ─────────────────────────────────────────────────── */
function CampaignModal({ initial, users, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleStaff = (id) => set("assigneeIds", (form.assigneeIds || []).includes(id)
    ? (form.assigneeIds || []).filter(x => x !== id)
    : [...(form.assigneeIds || []), id]);
  return (
    <Modal onClose={onClose} scrim={0.35} zIndex={500} cardStyle={{ maxWidth: 480, maxHeight: "88vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? "New Campaign" : "Edit Campaign"}</div>
          {!isNew && <IconBtn icon="my_location" size={16} title="Copy magnet link to this campaign" onClick={() => copyMagnet("campaign", form.id)} />}
          {!isNew && <IconBtn icon="add_task" size={16} title="Create a task from this campaign" onClick={() => createTaskFromItem(taskPrefillFromItem("campaign", form.id, form.name))} />}
          {!isNew && <IconBtn icon="delete" danger title="Delete campaign" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl()}>Name</label>
            <input autoFocus value={form.name} onChange={e => set("name", e.target.value)} placeholder="Campaign name…" style={inp()} />
          </div>
          <div>
            <label style={lbl()}>Description</label>
            <RichMentionField multiline value={form.description || ""} onChange={v => set("description", v)} placeholder="What's this campaign about?" style={inp({ lineHeight: 1.55, minHeight: 74 })} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Start date</label>
              <input type="date" value={form.startDate || ""} onChange={e => set("startDate", e.target.value)} style={inp()} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>End date</label>
              <input type="date" value={form.endDate || ""} onChange={e => set("endDate", e.target.value)} style={inp()} />
            </div>
          </div>
          <div>
            <label style={lbl()}>Status</label>
            <select value={form.status} onChange={e => set("status", e.target.value)} style={inp()}>
              {CAMPAIGN_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl()}>Color</label>
            <div style={{ display: "flex", gap: 7 }}>
              {CATEGORY_COLORS.map(c => (
                <button key={c} type="button" onClick={() => set("color", c)}
                  style={{ width: 26, height: 26, borderRadius: 99, background: c, cursor: "pointer", border: form.color === c ? `2px solid ${C.txt}` : "2px solid transparent" }} />
              ))}
            </div>
          </div>
          <div>
            <label style={lbl()}>Assigned staff</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {users.map(u => {
                const on = (form.assigneeIds || []).includes(u.id);
                return (
                  <button key={u.id} type="button" onClick={() => toggleStaff(u.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "5px 11px 5px 5px", borderRadius: 99, cursor: "pointer",
                      border: `1.5px solid ${on ? C.moss : C.bdr}`, background: on ? C.mossSoft : C.sur, color: on ? C.moss : C.txt2,
                      fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                    }}>
                    <Avatar name={u.name} size={20} />{u.name}
                  </button>
                );
              })}
              {users.length === 0 && <span style={{ fontSize: 13, color: C.faint }}>No staff to assign.</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, position: "sticky", bottom: 0, margin: "24px -28px -28px", padding: "16px 28px", background: C.sur, borderTop: `1.5px solid ${C.bdr}`, zIndex: 3 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.name.trim()}>Save</Btn>
        </div>
    </Modal>
  );
}

/* ─── CAMPAIGNS VIEW ─────────────────────────────────────────────────── */
function CampaignCard({ campaign, items, users, editable, onOpen, onEdit }) {
  const sm = campaignStatusMeta[campaign.status] || CAMPAIGN_STATUSES[0];
  const counts = campaignChannelCounts(campaign.id, items);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const staff = (campaign.assigneeIds || []).map(id => users.find(u => u.id === id)).filter(Boolean);
  return (
    <div style={{ display: "flex", background: C.sur, borderRadius: 12, border: `1.5px solid ${C.bdr}`, overflow: "hidden" }}>
      <div style={{ width: 6, flexShrink: 0, background: campaign.color || C.moss }} />
      <div onClick={() => onOpen(campaign)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(campaign); } }}
        style={{ padding: "16px 18px", flex: 1, minWidth: 0, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Pill color={sm.col}>{sm.label}</Pill>
          {(campaign.startDate || campaign.endDate) && (
            <span style={{ fontSize: 11, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>
              {campaign.startDate ? fmtDateShort(campaign.startDate) : "…"} – {campaign.endDate ? fmtDateShort(campaign.endDate) : "…"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>{campaign.name || "Untitled campaign"}</div>
        {campaign.description && <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5 }}><MentionText text={linkifyMagnets(campaign.description)} /></div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CONTENT_CHANNELS.map(ch => counts[ch.key] ? (
            <span key={ch.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.txt2, background: C.s2, borderRadius: 99, padding: "3px 9px" }}>
              <Icon name={ch.icon} size={12} />{counts[ch.key]}
            </span>
          ) : null)}
          {total === 0 && <span style={{ fontSize: 12, color: C.faint }}>No content items yet</span>}
        </div>
        {staff.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex" }}>
              {staff.slice(0, 5).map((u, i) => (
                <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6, border: `2px solid ${C.sur}`, borderRadius: 99 }}>
                  <Avatar name={u.name} size={22} />
                </div>
              ))}
            </div>
            {staff.length > 5 && <span style={{ fontSize: 11, color: C.mut }}>+{staff.length - 5}</span>}
          </div>
        )}
      </div>
      {editable && (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 10px" }}>
          <IconBtn icon="edit" title="Edit campaign" onClick={() => onEdit(campaign)} />
        </div>
      )}
    </div>
  );
}

function CampaignsView({ campaigns, items, users, editable, onOpenCampaign, onEditCampaign, onNewCampaign }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem("gkCampaignsView") || "cards"; } catch { return "cards"; } });
  const setV = (v) => { setView(v); try { localStorage.setItem("gkCampaignsView", v); } catch { /* private */ } };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {campaigns.length > 0 && <Segmented value={view} onChange={setV} options={[{ key: "cards", label: "Cards", icon: "view_agenda" }, { key: "timeline", label: "Timeline", icon: "calendar_view_week" }]} />}
        <div style={{ flex: 1 }} />
        {editable && <Btn onClick={onNewCampaign}><Icon name="add" size={17} />New Campaign</Btn>}
      </div>
      {campaigns.length === 0 ? (
        <EmptyState icon="campaign" title="No campaigns yet" sub="Group related content across channels and track it together."
          action={editable && <Btn onClick={onNewCampaign}><Icon name="add" size={17} />New Campaign</Btn>} />
      ) : view === "timeline" ? (
        <CampaignsTimeline campaigns={campaigns} onOpenCampaign={onOpenCampaign} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {campaigns.map(c => (
            <CampaignCard key={c.id} campaign={c} items={items} users={users} editable={editable}
              onOpen={onOpenCampaign} onEdit={onEditCampaign} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── CAMPAIGN MANAGER (#56) ──────────────────────────────────────────
   Mirrors the per-project manager: open a campaign → Board | Timeline |
   Split over its content items. Board = Kanban by CONTENT_STATUSES with
   drag-to-restatus; Timeline = Gantt of content items (bars span optional
   startDate→publishDate, single-day marker if publish-only) framed by the
   campaign's own start/end range. */

/* Compact content-item card for the Kanban (mirrors TaskCard's role). */
function ContentCard({ item, users, onOpen, onDragStart }) {
  const ch = contentChannelMeta[item.channel] || {};
  const staff = assigneesOf(item).map(id => users.find(u => u.id === id)).filter(Boolean);
  const overdue = isOverdue(item.publishDate, item.status === "published");
  const typeLabel = contentTypeLabel(item.channel, item.type);
  return (
    <div draggable onDragStart={onDragStart} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: "11px 13px", cursor: "pointer", boxShadow: C.shadowSm, display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name={ch.icon || "article"} size={15} style={{ color: C.faint, flexShrink: 0 }} title={ch.label} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || "Untitled"}</div>
      </div>
      {typeLabel && <div style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS }}>{typeLabel}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {item.publishDate && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: overdue ? C.red : C.mut, fontFamily: "'IBM Plex Mono',monospace" }}><Icon name="event" size={12} />{fmtDateShort(item.publishDate)}</span>}
        <div style={{ flex: 1 }} />
        {staff.slice(0, 3).map((u, i) => <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -5, border: `2px solid ${C.sur}`, borderRadius: 99 }}><Avatar name={u.name} size={18} /></div>)}
      </div>
    </div>
  );
}

/* Kanban of a campaign's content items by status, drag-to-restatus. */
function CampaignContentBoard({ items, users, onOpenItem, onRestatus }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const drop = (status) => { if (dragId) onRestatus(dragId, status); setDragId(null); setOverCol(null); };
  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
      {CONTENT_STATUSES.map(s => {
        const colItems = items.filter(i => i.status === s.key).sort((a, b) => (a.publishDate || "9999").localeCompare(b.publishDate || "9999"));
        return (
          <div key={s.key}
            onDragOver={e => { e.preventDefault(); setOverCol(s.key); }} onDrop={() => drop(s.key)}
            style={{ flex: "1 1 240px", minWidth: 220, background: overCol === s.key ? C.mossSoft : C.bg, border: `1.5px solid ${overCol === s.key ? C.moss : C.bdr}`, borderRadius: 13, padding: 12, transition: "background .12s, border-color .12s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
              <div style={{ width: 9, height: 9, borderRadius: 99, background: s.col }} />
              <div style={{ fontSize: 14, fontWeight: 800, color: C.txt }}>{s.label}</div>
              <span style={{ fontSize: 12, color: C.mut, background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 99, padding: "1px 8px" }}>{colItems.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {colItems.map(it => (
                <ContentCard key={it.id} item={it} users={users}
                  onOpen={() => onOpenItem(it)} onDragStart={(e) => { setDragId(it.id); if (e?.dataTransfer) e.dataTransfer.effectAllowed = "move"; }} />
              ))}
              {colItems.length === 0 && <div style={{ textAlign: "center", padding: "18px 0", fontSize: 13, color: C.faint }}>Drop here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Gantt of a campaign's content items — bars span optional startDate→publishDate
   (single-day marker if publish-only), framed by the campaign's date range. */
function CampaignTimeline({ campaign, items, users, onOpenItem }) {
  const [zoom, setZoom] = useState("month");
  const px = TIMELINE_ZOOMS.find(z => z.key === zoom).px;
  const today = todayLocalISO();
  const dated = items.filter(i => i.publishDate || i.startDate);
  if (dated.length === 0) {
    return <EmptyState icon="calendar_view_week" title="Nothing scheduled yet" sub="Give content items a publish (and optional start) date to see them on the timeline." />;
  }
  const lo = [campaign.startDate, today, ...dated.map(i => i.startDate || i.publishDate)].filter(Boolean).sort()[0];
  const hi = [campaign.endDate, today, ...dated.map(i => i.publishDate || i.startDate)].filter(Boolean).sort().slice(-1)[0];
  const rangeStart = addDaysISO(lo, -3);
  const rangeEnd = addDaysISO(hi, 4);
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1);
  const trackW = totalDays * px;
  const xOf = (iso) => daysBetween(rangeStart, iso) * px;

  const months = [];
  { let cur = rangeStart.slice(0, 8) + "01";
    if (parseDate(cur) < parseDate(rangeStart)) cur = rangeStart;
    let guard = 0;
    while (parseDate(cur) <= parseDate(rangeEnd) && guard++ < 120) {
      const d = parseDate(cur);
      const nextMonthISO = addDaysISO(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, 32).slice(0, 8) + "01";
      const segStart = parseDate(cur) < parseDate(rangeStart) ? rangeStart : cur;
      const segEnd = parseDate(nextMonthISO) > parseDate(rangeEnd) ? rangeEnd : nextMonthISO;
      months.push({ label: `${MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`, left: xOf(segStart), width: Math.max(daysBetween(segStart, segEnd) * px, 0) });
      cur = nextMonthISO;
    }
  }

  const rows = dated.slice().sort((a, b) => (a.publishDate || a.startDate || "").localeCompare(b.publishDate || b.startDate || ""));
  const NAME_W = 230, ROW_H = 38;
  return (
    <div style={{ border: `1.5px solid ${C.bdr}`, borderRadius: 13, overflow: "hidden", background: C.sur }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1.5px solid ${C.bdr}` }}>
        <Icon name="calendar_view_week" size={16} style={{ color: C.moss }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.txt }}>Timeline</div>
        <Segmented options={TIMELINE_ZOOMS.map(z => ({ key: z.key, label: z.label }))} value={zoom} onChange={setZoom} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: NAME_W + trackW }}>
          <div style={{ display: "flex", position: "relative", height: 26, borderBottom: `1.5px solid ${C.bdr}` }}>
            <div style={{ width: NAME_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: C.sur, borderRight: `1.5px solid ${C.bdr}` }} />
            <div style={{ position: "relative", width: trackW }}>
              {months.map((mo, i) => (
                <div key={i} style={{ position: "absolute", left: mo.left, width: mo.width, top: 0, height: 26, borderLeft: `1px solid ${C.bdr}`, fontSize: 11, fontWeight: 700, color: C.mut, fontFamily: FONT_CAPS, textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 0 0 6px", overflow: "hidden", whiteSpace: "nowrap" }}>{mo.label}</div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: NAME_W + xOf(today), top: 0, bottom: 0, width: 2, background: C.clay, zIndex: 1, pointerEvents: "none" }} />
            {rows.map(it => {
              const owner = users.find(u => u.id === assigneesOf(it)[0]);
              const hasSpan = it.startDate && it.publishDate && it.publishDate >= it.startDate;
              const barStart = hasSpan ? it.startDate : (it.publishDate || it.startDate);
              const barEnd = hasSpan ? it.publishDate : (it.publishDate || it.startDate);
              const left = xOf(barStart);
              const width = Math.max((daysBetween(barStart, barEnd) + 1) * px, 14);
              const published = it.status === "published";
              const overdue = isOverdue(it.publishDate, published);
              const barColor = published ? C.moss : (overdue ? C.red : (campaign.color || C.moss));
              const ch = contentChannelMeta[it.channel] || {};
              return (
                <div key={it.id} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.bdr}` }}>
                  <div onClick={() => onOpenItem(it)} title={it.title} style={{ width: NAME_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: C.sur, borderRight: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", cursor: "pointer", overflow: "hidden" }}>
                    <Icon name={ch.icon || "article"} size={14} style={{ color: C.faint, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: published ? "line-through" : "none", opacity: published ? 0.6 : 1 }}>{it.title || "Untitled"}</span>
                    {owner ? <Avatar name={owner.name} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: 99, border: `1.5px dashed ${C.bdr2}`, flexShrink: 0 }} />}
                  </div>
                  <div style={{ position: "relative", width: trackW }}>
                    <div onClick={() => onOpenItem(it)} title={`${it.title}${hasSpan ? ` · ${fmtDateShort(barStart)} – ${fmtDateShort(barEnd)}` : ` · ${fmtDateShort(barEnd)}`}`}
                      style={{ position: "absolute", left, top: 8, height: ROW_H - 16, width, background: barColor, opacity: published ? 0.55 : 1, borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: "0 6px", overflow: "hidden" }}>
                      {owner && <Avatar name={owner.name} size={16} />}
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title || "Untitled"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Campaign detail — the per-campaign mirror of ProjectDetail. */
function CampaignDetail({ campaign, allItems, users, editable, onBack, onOpenItem, onNewItem, onEditCampaign, onFilterCalendar, onRestatus }) {
  const [view, setView] = useState(() => { try { return localStorage.getItem("gkCampaignItemView") || "board"; } catch { return "board"; } });
  const setV = (v) => { setView(v); try { localStorage.setItem("gkCampaignItemView", v); } catch { /* private */ } };
  const items = allItems.filter(i => i.campaignId === campaign.id);
  const sm = campaignStatusMeta[campaign.status] || CAMPAIGN_STATUSES[0];
  const staff = (campaign.assigneeIds || []).map(id => users.find(u => u.id === id)).filter(Boolean);
  return (
    <div className="gk-fade-in">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back to campaigns" onClick={onBack} />
        <div style={{ flex: 1 }} />
        <OBtn onClick={() => onFilterCalendar(campaign.id)}><Icon name="calendar_month" size={16} />View on calendar</OBtn>
        {editable && <OBtn onClick={() => onEditCampaign(campaign)}><Icon name="edit" size={16} />Edit</OBtn>}
      </div>

      <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, padding: "14px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 5, alignSelf: "stretch", minHeight: 34, borderRadius: 99, background: campaign.color || C.moss, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill color={sm.col}>{sm.label}</Pill>
              <div style={{ fontSize: 19, fontWeight: 800, color: C.txt }}>{campaign.name || "Untitled campaign"}</div>
              {(campaign.startDate || campaign.endDate) && (
                <span style={{ fontSize: 12, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>
                  · {campaign.startDate ? fmtDate(campaign.startDate) : "…"} – {campaign.endDate ? fmtDate(campaign.endDate) : "…"}
                </span>
              )}
            </div>
            {campaign.description && <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5, maxWidth: 640, marginTop: 3 }}><MentionText text={linkifyMagnets(campaign.description)} /></div>}
          </div>
          {staff.length > 0 && (
            <div style={{ display: "flex" }}>
              {staff.slice(0, 6).map((u, i) => <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6, border: `2px solid ${C.sur}`, borderRadius: 99 }}><Avatar name={u.name} size={24} /></div>)}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>Content</div>
        <Segmented value={view} onChange={setV} options={[{ key: "board", label: "Board", icon: "view_kanban" }, { key: "timeline", label: "Timeline", icon: "calendar_view_week" }, { key: "split", label: "Split", icon: "view_agenda" }]} />
        <div style={{ flex: 1 }} />
        {editable && <Btn onClick={() => onNewItem(campaign.id)}><Icon name="add" size={17} />New Content</Btn>}
      </div>

      {items.length === 0 ? (
        <EmptyState icon="post_add" title="No content in this campaign yet" sub="Add the first content item to start planning."
          action={editable && <Btn onClick={() => onNewItem(campaign.id)}><Icon name="add" size={17} />New Content</Btn>} />
      ) : view === "timeline" ? (
        <CampaignTimeline campaign={campaign} items={items} users={users} onOpenItem={onOpenItem} />
      ) : view === "split" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <CampaignTimeline campaign={campaign} items={items} users={users} onOpenItem={onOpenItem} />
          <CampaignContentBoard items={items} users={users} onOpenItem={onOpenItem} onRestatus={onRestatus} />
        </div>
      ) : (
        <CampaignContentBoard items={items} users={users} onOpenItem={onOpenItem} onRestatus={onRestatus} />
      )}
    </div>
  );
}

/* All-campaigns Gantt for the Campaigns tab overview — each campaign a bar
   spanning startDate→endDate, click to open its detail. */
function CampaignsTimeline({ campaigns, onOpenCampaign }) {
  const [zoom, setZoom] = useState("month");
  const px = TIMELINE_ZOOMS.find(z => z.key === zoom).px;
  const today = todayLocalISO();
  const dated = campaigns.filter(c => c.startDate || c.endDate);
  if (dated.length === 0) return <EmptyState icon="calendar_view_week" title="No dated campaigns" sub="Give campaigns a start and end date to see them on the timeline." />;
  const lo = [today, ...dated.map(c => c.startDate || c.endDate)].filter(Boolean).sort()[0];
  const hi = [today, ...dated.map(c => c.endDate || c.startDate)].filter(Boolean).sort().slice(-1)[0];
  const rangeStart = addDaysISO(lo, -3);
  const rangeEnd = addDaysISO(hi, 4);
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1);
  const trackW = totalDays * px;
  const xOf = (iso) => daysBetween(rangeStart, iso) * px;
  const months = [];
  { let cur = rangeStart.slice(0, 8) + "01";
    if (parseDate(cur) < parseDate(rangeStart)) cur = rangeStart;
    let guard = 0;
    while (parseDate(cur) <= parseDate(rangeEnd) && guard++ < 120) {
      const d = parseDate(cur);
      const nextMonthISO = addDaysISO(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, 32).slice(0, 8) + "01";
      const segStart = parseDate(cur) < parseDate(rangeStart) ? rangeStart : cur;
      const segEnd = parseDate(nextMonthISO) > parseDate(rangeEnd) ? rangeEnd : nextMonthISO;
      months.push({ label: `${MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`, left: xOf(segStart), width: Math.max(daysBetween(segStart, segEnd) * px, 0) });
      cur = nextMonthISO;
    }
  }
  const NAME_W = 200, ROW_H = 40;
  return (
    <div style={{ border: `1.5px solid ${C.bdr}`, borderRadius: 13, overflow: "hidden", background: C.sur }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1.5px solid ${C.bdr}` }}>
        <Icon name="calendar_view_week" size={16} style={{ color: C.moss }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.txt }}>Campaign timeline</div>
        <Segmented options={TIMELINE_ZOOMS.map(z => ({ key: z.key, label: z.label }))} value={zoom} onChange={setZoom} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: NAME_W + trackW }}>
          <div style={{ display: "flex", position: "relative", height: 26, borderBottom: `1.5px solid ${C.bdr}` }}>
            <div style={{ width: NAME_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: C.sur, borderRight: `1.5px solid ${C.bdr}` }} />
            <div style={{ position: "relative", width: trackW }}>
              {months.map((mo, i) => (
                <div key={i} style={{ position: "absolute", left: mo.left, width: mo.width, top: 0, height: 26, borderLeft: `1px solid ${C.bdr}`, fontSize: 11, fontWeight: 700, color: C.mut, fontFamily: FONT_CAPS, textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 0 0 6px", overflow: "hidden", whiteSpace: "nowrap" }}>{mo.label}</div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: NAME_W + xOf(today), top: 0, bottom: 0, width: 2, background: C.clay, zIndex: 1, pointerEvents: "none" }} />
            {dated.map(c => {
              const cs = c.startDate || c.endDate, ce = c.endDate || c.startDate;
              const left = xOf(cs);
              const width = Math.max((daysBetween(cs, ce) + 1) * px, 14);
              return (
                <div key={c.id} style={{ display: "flex", height: ROW_H, borderBottom: `1px solid ${C.bdr}` }}>
                  <div onClick={() => onOpenCampaign(c)} title={c.name} style={{ width: NAME_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: C.sur, borderRight: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", cursor: "pointer", overflow: "hidden" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: c.color || C.moss, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "Untitled"}</span>
                  </div>
                  <div style={{ position: "relative", width: trackW }}>
                    <div onClick={() => onOpenCampaign(c)} title={`${c.name} · ${fmtDateShort(cs)} – ${fmtDateShort(ce)}`}
                      style={{ position: "absolute", left, top: 9, height: ROW_H - 18, width, background: c.color || C.moss, borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", padding: "0 8px", overflow: "hidden" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "Untitled"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────── */
/* ─── REPORTS (Batch 3) ───────────────────────────────────────────────
   Rolls the manually-entered post-publish metrics up into simple SVG-free
   bar charts (CSS bars — no chart lib, matching the app's zero-dep build).
   Configurable: date range, channel, and which metric drives the charts —
   the end user is expected to re-point these. */
function BarChart({ rows, color }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (rows.length === 0) return <div style={{ fontSize: 13, color: C.faint, padding: "8px 0" }}>No data in this range yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 108, fontSize: 12.5, color: C.txt2, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
          <div style={{ flex: 1, height: 20, background: C.s2, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: r.color || color || C.moss, borderRadius: 6, minWidth: r.value > 0 ? 4 : 0, transition: "width .3s" }} />
          </div>
          <div style={{ width: 60, fontSize: 12.5, fontWeight: 700, color: C.txt, textAlign: "right", fontFamily: "'IBM Plex Mono',monospace" }}>{r.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function StatTile({ label, value, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: "1 1 110px", textAlign: "left", background: active ? C.mossSoft : C.sur, border: `1.5px solid ${active ? C.moss : C.bdr}`, borderRadius: 12, padding: "12px 15px", cursor: "pointer", fontFamily: "inherit" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: color || C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 800, color: C.txt, marginTop: 4, fontFamily: "'IBM Plex Mono',monospace" }}>{value.toLocaleString()}</div>
    </button>
  );
}

function ReportsView({ items, campaigns, editable, bump }) {
  const [rangeMode, setRangeMode] = useState("all"); // #51 dynamic ranges
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState("");
  const [metric, setMetric] = useState("clicks");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [reportsV, setReportsV] = useState(0); // re-read saved list after save/delete
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  // Resolve the active window: dynamic presets recompute against today; the
  // date inputs only drive the "custom" mode.
  const range = reportRange(rangeMode, from, to);
  const saved = getContentReports();

  const applyReport = (r) => {
    setRangeMode(r.rangeMode || "all");
    setChannel(r.channel || "");
    setMetric(r.metric || "clicks");
    if (r.rangeMode === "custom") { setFrom(r.from || ""); setTo(r.to || ""); }
  };
  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    addContentReport({ name, rangeMode, channel, metric, ...(rangeMode === "custom" ? { from, to } : {}) });
    setSaveName(""); setSaveOpen(false); setReportsV(v => v + 1); triggerSaved(); bump && bump();
  };
  const removeReport = async (r) => {
    if (!(await confirmDelete(`Delete saved report "${r.name}"?`))) return;
    deleteContentReport(r.id); setReportsV(v => v + 1); triggerSaved(); bump && bump();
  };
  void reportsV;

  const filtered = items.filter(i => {
    if (channel && i.channel !== channel) return false;
    if (range.from && (i.publishDate || "") < range.from) return false;
    if (range.to && (i.publishDate || "") > range.to) return false;
    return true;
  });
  const sumMetric = (list, key) => list.reduce((s, i) => s + num((i.metrics || {})[key]), 0);
  const totals = Object.fromEntries(REPORT_METRICS.map(m => [m.key, sumMetric(filtered, m.key)]));
  const metricMeta = REPORT_METRICS.find(m => m.key === metric) || REPORT_METRICS[0];

  const byChannel = CONTENT_CHANNELS
    .map(ch => ({ key: ch.key, label: ch.label, value: sumMetric(filtered.filter(i => i.channel === ch.key), metric) }))
    .filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  const byCampaign = campaigns
    .map(c => ({ key: c.id, label: c.name || "Untitled", color: c.color, value: sumMetric(filtered.filter(i => i.campaignId === c.id), metric) }))
    .filter(r => r.value > 0).sort((a, b) => b.value - a.value);

  const cardStyle = { flex: "1 1 320px", minWidth: 0, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, padding: 18 };
  const chartTitle = { fontSize: 13, fontWeight: 700, color: C.txt2, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS, marginBottom: 14 };
  const secLabel = { fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS, marginBottom: 10 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {saved.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS }}>Saved</span>
          {saved.map(r => (
            <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.s2, border: `1.5px solid ${C.bdr}`, borderRadius: 99, padding: "3px 4px 3px 11px" }}>
              <button type="button" onClick={() => applyReport(r)} title="Open this report"
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.txt, padding: 0 }}>{r.name}</button>
              {editable && <button type="button" onClick={() => removeReport(r)} title="Delete report" style={{ display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: C.faint, padding: 2, borderRadius: 99 }}><Icon name="close" size={13} /></button>}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={lbl()}>Range</label>
          <select value={rangeMode} onChange={e => setRangeMode(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
            {REPORT_RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        {rangeMode === "custom" && (
          <>
            <div><label style={lbl()}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })} /></div>
            <div><label style={lbl()}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })} /></div>
          </>
        )}
        <div>
          <label style={lbl()}>Channel</label>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
            <option value="">All channels</option>
            {CONTENT_CHANNELS.map(ch => <option key={ch.key} value={ch.key}>{ch.label}</option>)}
          </select>
        </div>
        {editable && (
          <div style={{ position: "relative" }}>
            <OBtn onClick={() => setSaveOpen(o => !o)} style={{ fontSize: 12, padding: "8px 12px" }}><Icon name="bookmark_add" size={15} />Save report</OBtn>
            {saveOpen && (
              <>
                <div onClick={() => setSaveOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, zIndex: 41, width: 240, background: C.sur, border: `1.5px solid ${C.bdr2}`, borderRadius: 12, boxShadow: C.shadowMd, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doSave(); }}
                    placeholder="Report name…" style={inp({ fontSize: 13, padding: "8px 10px" })} />
                  <div style={{ fontSize: 11.5, color: C.faint }}>Saves the range, channel &amp; metric — dynamic ranges recompute each time.</div>
                  <Btn onClick={doSave} disabled={!saveName.trim()} style={{ padding: "7px 12px", fontSize: 12 }}>Save</Btn>
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: C.mut }}>{filtered.length} item{filtered.length === 1 ? "" : "s"} in range</div>
      </div>

      <div>
        <div style={secLabel}>Totals — click a metric to chart it</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {REPORT_METRICS.map(m => <StatTile key={m.key} label={m.label} value={totals[m.key]} color={m.color} active={metric === m.key} onClick={() => setMetric(m.key)} />)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={cardStyle}>
          <div style={chartTitle}>{metricMeta.label} by channel</div>
          <BarChart rows={byChannel} color={metricMeta.color} />
        </div>
        <div style={cardStyle}>
          <div style={chartTitle}>{metricMeta.label} by campaign</div>
          <BarChart rows={byCampaign} color={metricMeta.color} />
        </div>
      </div>
    </div>
  );
}

function ContentCalendar({ user, focusItemId, focusCampaignId, onClearFocus, onClearCampaignFocus, onOpenSop, onNavigateOut }) {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  const [tab, setTab] = useState("calendar");
  const [addAnchor, setAddAnchor] = useState(null); // "Add +" menu (#52)
  const [monthKey, setMonthKey] = useState(() => nowISO().slice(0, 7));
  const [modal, setModal] = useState(null); // {item, isNew}
  const [campaignModal, setCampaignModal] = useState(null); // {campaign, isNew}
  const [openCampaignId, setOpenCampaignId] = useState(null); // campaign detail view (#56)
  const [filterChannel, setFilterChannel] = useState("");
  const [filterCampaign, setFilterCampaign] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const users = getUsers();
  const campaigns = getCampaigns();
  const allItems = getContentItems();
  const editable = canEdit(user);
  // Tasks opted onto the calendar (#53) — per-task flag OR their project's flag,
  // keyed by dueDate for the month grid.
  const projById = {};
  getProjects().forEach(p => { projById[p.id] = p; });
  const tasksByDay = {};
  getTasks().forEach(t => {
    if (t.archived || !t.dueDate) return;
    if (!taskOnCalendar(t, projById[t.projectId])) return;
    (tasksByDay[t.dueDate] = tasksByDay[t.dueDate] || []).push(t);
  });

  // Magnet-link navigation for content links — mirrors TaskManager's nav.
  const nav = {
    goToSop: (id, blockId) => onOpenSop ? onOpenSop(id, blockId) : onNavigateOut && onNavigateOut("sop", id, blockId),
    goToTask: (id) => onNavigateOut && onNavigateOut("task", id),
    goToPlaybookSection: (id) => onNavigateOut && onNavigateOut("playbook", id),
  };

  React.useEffect(() => {
    if (focusItemId) {
      const found = allItems.find(i => i.id === focusItemId);
      if (found) { setModal({ item: { ...found }, isNew: false }); setTab("calendar"); }
      onClearFocus && onClearFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);

  // A campaign deep-link (dashboard "Upcoming Campaigns" / magnet / search)
  // opens that campaign's detail manager (#56).
  React.useEffect(() => {
    if (focusCampaignId) {
      setOpenCampaignId(focusCampaignId);
      setTab("campaigns");
      onClearCampaignFocus && onClearCampaignFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCampaignId]);

  const items = allItems.filter(i => {
    if (filterChannel && i.channel !== filterChannel) return false;
    if (filterCampaign && i.campaignId !== filterCampaign) return false;
    if (filterAssignee && !assigneesOf(i).includes(filterAssignee)) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    return true;
  });

  const openNew = (dateStr) => setModal({ item: { ...defContentItem(), publishDate: dateStr || "" }, isNew: true });
  const openNewForCampaign = (campId) => setModal({ item: { ...defContentItem(), campaignId: campId }, isNew: true });
  const restatusItem = (id, status) => { updateContentItem(id, { status }); triggerSaved(); bump(); };
  const openEdit = (item) => setModal({ item: { ...item }, isNew: false });
  const saveItem = (form) => {
    if (modal.isNew) addContentItem(form); else updateContentItem(form.id, form);
    triggerSaved(); setModal(null); bump();
  };
  const deleteItem = async () => {
    const ok = await confirmDelete(`Delete "${modal.item.title || "this content item"}"? This can't be undone.`);
    if (!ok) return;
    deleteContentItem(modal.item.id);
    triggerSaved(); setModal(null); bump();
  };

  const openNewCampaign = () => setCampaignModal({ campaign: defCampaign(), isNew: true });
  const openEditCampaign = (c) => setCampaignModal({ campaign: { ...c }, isNew: false });
  const saveCampaignModal = (form) => {
    if (campaignModal.isNew) addCampaign(form); else updateCampaign(form.id, form);
    triggerSaved(); setCampaignModal(null); bump();
  };
  const deleteCampaignModal = async () => {
    const ok = await confirmDelete(`Delete "${campaignModal.campaign.name}"? Its content items stay, just unlinked from the campaign. This can't be undone.`);
    if (!ok) return;
    deleteCampaign(campaignModal.campaign.id);
    triggerSaved(); setCampaignModal(null); bump();
  };
  const filterByCampaign = (id) => { setFilterCampaign(id); setTab("calendar"); };

  const upcoming = allItems.filter(i => i.status !== "published" && i.publishDate >= todayStr()).length;
  const activeCampaign = filterCampaign ? campaigns.find(c => c.id === filterCampaign) : null;
  const openCampaign = openCampaignId ? campaigns.find(c => c.id === openCampaignId) : null;

  // Campaign detail manager (#56) takes over the whole view when open; the
  // item + campaign edit modals stay mounted so New Content / Edit work here.
  if (openCampaign) {
    return (
      <div className="gk-fade-in">
        <CampaignDetail campaign={openCampaign} allItems={allItems} users={users} editable={editable}
          onBack={() => setOpenCampaignId(null)}
          onOpenItem={openEdit} onNewItem={openNewForCampaign} onEditCampaign={openEditCampaign}
          onFilterCalendar={(id) => { setOpenCampaignId(null); filterByCampaign(id); }}
          onRestatus={restatusItem} />
        {modal && (
          <ContentItemModal initial={modal.item} isNew={modal.isNew} users={users} campaigns={campaigns} nav={nav}
            onSave={saveItem} onDelete={!modal.isNew ? deleteItem : undefined} onClose={() => setModal(null)} />
        )}
        {campaignModal && (
          <CampaignModal initial={campaignModal.campaign} isNew={campaignModal.isNew} users={users}
            onSave={saveCampaignModal} onDelete={!campaignModal.isNew ? deleteCampaignModal : undefined} onClose={() => setCampaignModal(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="gk-fade-in">
      <SectionHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            Content Calendar
            {activeCampaign && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 8, textTransform: "none",
                fontFamily: "'Manrope',sans-serif", letterSpacing: "normal", fontSize: 14, fontWeight: 600,
                color: C.moss, background: C.mossSoft, border: `1.5px solid ${C.moss}55`, borderRadius: 99, padding: "4px 6px 4px 12px",
              }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: activeCampaign.color || C.moss }} />
                {activeCampaign.name || "Untitled campaign"}
                <button type="button" title="Clear campaign filter" onClick={() => setFilterCampaign("")}
                  style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: C.moss, padding: 2, borderRadius: 99 }}>
                  <Icon name="close" size={15} />
                </button>
              </span>
            )}
          </span>
        }
        sub={`${allItems.length} content item${allItems.length === 1 ? "" : "s"} · ${upcoming} upcoming`}
        right={editable && (
          <>
            <Btn onClick={e => setAddAnchor(e.currentTarget.getBoundingClientRect())}><Icon name="add" size={17} />Add</Btn>
            {addAnchor && (
              <Popover anchorRect={addAnchor} onClose={() => setAddAnchor(null)} width={190}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {[
                    { icon: "post_add", label: "Content", onClick: () => openNew() },
                    { icon: "campaign", label: "Campaign", onClick: () => openNewCampaign() },
                    { icon: "insights", label: "Report", onClick: () => setTab("reports") },
                  ].map(o => (
                    <button key={o.label} type="button" onClick={() => { setAddAnchor(null); o.onClick(); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 11px", background: "none", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: C.txt, textAlign: "left" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Icon name={o.icon} size={17} style={{ color: C.moss }} />{o.label}
                    </button>
                  ))}
                </div>
              </Popover>
            )}
          </>
        )} />

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {VIEW_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {(tab === "calendar" || tab === "list") && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
          <select value={filterChannel} onChange={e => setFilterChannel(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
            <option value="">All channels</option>
            {CONTENT_CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {campaigns.length > 0 && (
            <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
              <option value="">All campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name || "Untitled campaign"}</option>)}
            </select>
          )}
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
            <option value="">All assignees</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inp({ width: "auto", fontSize: 13, padding: "8px 12px" })}>
            <option value="">All statuses</option>
            {CONTENT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {(filterChannel || filterCampaign || filterAssignee || filterStatus) && (
            <OBtn onClick={() => { setFilterChannel(""); setFilterCampaign(""); setFilterAssignee(""); setFilterStatus(""); }} style={{ fontSize: 12, padding: "7px 12px" }}>
              Clear filters
            </OBtn>
          )}
        </div>
      )}

      {tab === "calendar" && (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 520px", minWidth: 0 }}>
            <CalendarView items={items} campaigns={campaigns} bandCampaigns={activeCampaign ? [activeCampaign] : campaigns}
              tasksByDay={tasksByDay} onOpenTask={(t) => navigateItem("task", t.id)}
              monthKey={monthKey} setMonthKey={setMonthKey} onOpenItem={openEdit}
              onNewAt={editable ? openNew : () => {}} onFilterCampaign={filterByCampaign} />
          </div>
          <div style={{ flex: "1 1 280px", minWidth: 250, maxWidth: 360 }}>
            <ItemRail items={items} campaigns={campaigns} onOpenItem={openEdit} />
          </div>
        </div>
      )}
      {tab === "list" && <ListView items={items} users={users} campaigns={campaigns} onOpenItem={openEdit} />}
      {tab === "campaigns" && (
        <CampaignsView campaigns={campaigns} items={allItems} users={users} editable={editable}
          onOpenCampaign={(c) => setOpenCampaignId(c.id)} onEditCampaign={openEditCampaign} onNewCampaign={openNewCampaign} />
      )}
      {tab === "reports" && <ReportsView items={allItems} campaigns={campaigns} editable={editable} bump={bump} />}

      {modal && (
        <ContentItemModal initial={modal.item} isNew={modal.isNew} users={users} campaigns={campaigns} nav={nav}
          onSave={saveItem} onDelete={!modal.isNew ? deleteItem : undefined} onClose={() => setModal(null)} />
      )}
      {campaignModal && (
        <CampaignModal initial={campaignModal.campaign} isNew={campaignModal.isNew} users={users}
          onSave={saveCampaignModal} onDelete={!campaignModal.isNew ? deleteCampaignModal : undefined} onClose={() => setCampaignModal(null)} />
      )}
    </div>
  );
}

export default ContentCalendar;
