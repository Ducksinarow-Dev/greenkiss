import React, { useState } from 'react';
import {
  C, FONT_CAPS, uid, nowISO, CATEGORY_COLORS, inp,
  getCampaigns, addCampaign, updateCampaign, deleteCampaign, defCampaign,
  getContentItems, addContentItem, updateContentItem, deleteContentItem, defContentItem,
  getUsers, confirmDelete, triggerSaved, canEdit, fmtDateShort, isOverdue,
  CAMPAIGN_STATUSES, campaignStatusMeta, CONTENT_CHANNELS, contentChannelMeta,
  CONTENT_STATUSES, contentStatusMeta, GBP_CTA_TYPES, GBP_CATEGORIES,
  campaignChannelCounts, processAndStoreImage,
  fetchOmnisendCampaigns, fetchOmnisendCampaignStats, triggerToast,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Avatar, SectionHeader, EmptyState, lbl, LinkPopover, ItemLink, Popover } from './shared.jsx';

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

function CalendarView({ items, campaigns, bandCampaigns, monthKey, setMonthKey, onOpenItem, onNewAt, onFilterCampaign }) {
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
    if (key === "assigneeId") return users.find(u => u.id === item.assigneeId)?.name || "";
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
            const assignee = users.find(u => u.id === it.assigneeId);
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
                  {it.title || "Untitled"}
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: campaign?.color || C.faint, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {campaign?.name || "—"}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                  {assignee ? <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Avatar name={assignee.name} size={18} /><span style={{ fontSize: 12, color: C.mut }}>{assignee.name}</span></div> : <span style={{ fontSize: 12, color: C.faint }}>Unassigned</span>}
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
          {form.body || <span style={{ color: C.faint }}>Post text preview…</span>}
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

/* ─── CONTENT ITEM SLIDE-OUT EDITOR ──────────────────────────────────── */
function ContentItemModal({ initial, users, campaigns, nav, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setMetric = (k, v) => setForm(f => ({ ...f, metrics: { ...(f.metrics || {}), [k]: v } }));

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
    } catch { /* upload failure is surfaced by the global offline indicator */ }
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
          {!isNew && <IconBtn icon="delete" danger title="Delete" onClick={onDelete} />}
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl()}>Channel</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CONTENT_CHANNELS.map(ch => (
                <button key={ch.key} type="button" onClick={() => set("channel", ch.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9, cursor: "pointer",
                    fontFamily: FONT_CAPS, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                    border: `1.5px solid ${form.channel === ch.key ? C.moss : C.bdr}`,
                    background: form.channel === ch.key ? C.mossSoft : C.sur,
                    color: form.channel === ch.key ? C.moss : C.txt2,
                  }}>
                  <Icon name={ch.icon} size={15} />{ch.label}
                </button>
              ))}
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
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Publish date</label>
              <input type="date" value={form.publishDate || ""} onChange={e => set("publishDate", e.target.value)} style={inp()} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={lbl()}>Assignee</label>
              <select value={form.assigneeId || ""} onChange={e => set("assigneeId", e.target.value)} style={inp()}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 140px" }}>
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
            <textarea rows={4} value={form.body || ""} onChange={e => set("body", e.target.value)} placeholder="Draft copy, description, or internal notes…" style={inp({ lineHeight: 1.55 })} />
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
                <textarea rows={3} value={form.caption || ""} onChange={e => set("caption", e.target.value)} placeholder="What actually posts…" style={inp({ lineHeight: 1.55 })} />
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
            <textarea rows={2} value={form.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Not published — team notes only…" style={inp({ lineHeight: 1.55 })} />
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.txt, flex: 1 }}>{isNew ? "New Campaign" : "Edit Campaign"}</div>
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
            <textarea rows={3} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What's this campaign about?" style={inp({ lineHeight: 1.55 })} />
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={() => onSave(form)} disabled={!form.name.trim()}>Save</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── CAMPAIGNS VIEW ─────────────────────────────────────────────────── */
function CampaignCard({ campaign, items, users, editable, onOpen, onFilter }) {
  const sm = campaignStatusMeta[campaign.status] || CAMPAIGN_STATUSES[0];
  const counts = campaignChannelCounts(campaign.id, items);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const staff = (campaign.assigneeIds || []).map(id => users.find(u => u.id === id)).filter(Boolean);
  return (
    <div style={{ display: "flex", background: C.sur, borderRadius: 12, border: `1.5px solid ${C.bdr}`, overflow: "hidden" }}>
      <div style={{ width: 6, flexShrink: 0, background: campaign.color || C.moss }} />
      <div onClick={() => onFilter(campaign.id)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFilter(campaign.id); } }}
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
        {campaign.description && <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.5 }}>{campaign.description}</div>}
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
          <IconBtn icon="edit" title="Edit campaign" onClick={onOpen} />
        </div>
      )}
    </div>
  );
}

function CampaignsView({ campaigns, items, users, editable, onOpenCampaign, onNewCampaign, onFilterCampaign }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        {editable && <Btn onClick={onNewCampaign}><Icon name="add" size={17} />New Campaign</Btn>}
      </div>
      {campaigns.length === 0 ? (
        <EmptyState icon="campaign" title="No campaigns yet" sub="Group related content across channels and track it together."
          action={editable && <Btn onClick={onNewCampaign}><Icon name="add" size={17} />New Campaign</Btn>} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {campaigns.map(c => (
            <CampaignCard key={c.id} campaign={c} items={items} users={users} editable={editable}
              onOpen={() => onOpenCampaign(c)} onFilter={onFilterCampaign} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────── */
function ContentCalendar({ user, focusItemId, focusCampaignId, onClearFocus, onClearCampaignFocus, onOpenSop, onNavigateOut }) {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  const [tab, setTab] = useState("calendar");
  const [monthKey, setMonthKey] = useState(() => nowISO().slice(0, 7));
  const [modal, setModal] = useState(null); // {item, isNew}
  const [campaignModal, setCampaignModal] = useState(null); // {campaign, isNew}
  const [filterChannel, setFilterChannel] = useState("");
  const [filterCampaign, setFilterCampaign] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const users = getUsers();
  const campaigns = getCampaigns();
  const allItems = getContentItems();
  const editable = canEdit(user);

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

  // Dashboard "Upcoming Campaigns" click (#23): land on the calendar filtered
  // to that campaign, so its items + date band are front-and-centre.
  React.useEffect(() => {
    if (focusCampaignId) {
      setFilterCampaign(focusCampaignId);
      setTab("calendar");
      onClearCampaignFocus && onClearCampaignFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCampaignId]);

  const items = allItems.filter(i => {
    if (filterChannel && i.channel !== filterChannel) return false;
    if (filterCampaign && i.campaignId !== filterCampaign) return false;
    if (filterAssignee && i.assigneeId !== filterAssignee) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    return true;
  });

  const openNew = (dateStr) => setModal({ item: { ...defContentItem(), publishDate: dateStr || "" }, isNew: true });
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
        right={editable && <Btn onClick={() => openNew()}><Icon name="add" size={17} />New Content</Btn>} />

      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {VIEW_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {tab !== "campaigns" && (
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
          onOpenCampaign={openEditCampaign} onNewCampaign={openNewCampaign} onFilterCampaign={filterByCampaign} />
      )}

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
