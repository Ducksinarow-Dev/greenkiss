import React, { useState } from 'react';
import {
  C, uid, nowISO, CATEGORY_COLORS, inp,
  getCampaigns, addCampaign, updateCampaign, deleteCampaign, defCampaign,
  getContentItems, addContentItem, updateContentItem, deleteContentItem, defContentItem,
  getUsers, confirmDelete, triggerSaved, canEdit, fmtDateShort, isOverdue,
  CAMPAIGN_STATUSES, campaignStatusMeta, CONTENT_CHANNELS, contentChannelMeta,
  CONTENT_STATUSES, contentStatusMeta, GBP_CTA_TYPES, GBP_CATEGORIES,
  campaignChannelCounts, processAndStoreImage,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, Avatar, SectionHeader, EmptyState, lbl } from './shared.jsx';

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
    fontFamily: "inherit", border: `1.5px solid ${active ? C.moss : C.bdr}`,
    textTransform: "uppercase", letterSpacing: "0.07em",
    background: active ? C.mossSoft : C.sur, color: active ? C.moss : C.mut,
  };
}

/* ─── CONTENT CHIP (calendar cell + list row glyph) ─────────────────── */
function ContentChip({ item, campaign, onClick }) {
  const ch = contentChannelMeta[item.channel] || CONTENT_CHANNELS[0];
  const railColor = campaign?.color || C.faint;
  return (
    <div onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      title={item.title || "Untitled"}
      style={{
        display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
        background: C.sur, border: `1px solid ${C.bdr}`, borderRadius: 5,
        padding: "2px 6px 2px 4px", overflow: "hidden",
      }}>
      <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: railColor, flexShrink: 0 }} />
      <Icon name={ch.icon} size={11} style={{ color: C.txt2, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: C.txt, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {item.title || "Untitled"}
      </span>
    </div>
  );
}

/* ─── CALENDAR VIEW ──────────────────────────────────────────────────── */
function CalendarView({ items, campaigns, monthKey, setMonthKey, onOpenItem, onNewAt }) {
  const { y, m, days } = monthMeta(monthKey);
  const byDay = {};
  items.forEach(i => {
    if (!i.publishDate) return;
    (byDay[i.publishDate] = byDay[i.publishDate] || []).push(i);
  });
  const today = todayStr();

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}` }}>
        <IconBtn icon="chevron_left" title="Previous month" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} />
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, textTransform: "uppercase", letterSpacing: "0.06em" }}>{fmtMonthLabel(monthKey)}</div>
        <IconBtn icon="chevron_right" title="Next month" onClick={() => setMonthKey(shiftMonth(monthKey, 1))} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1.5px solid ${C.bdr}` }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 10, fontWeight: 700, color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {days.map((d, i) => {
          if (d === null) return <div key={"e" + i} style={{ minHeight: 92, borderRight: `1px solid ${C.bdr}`, borderBottom: `1px solid ${C.bdr}`, background: C.bg }} />;
          const ds = dayStr(y, m, d);
          const dayItems = byDay[ds] || [];
          const isToday = ds === today;
          return (
            <div key={ds} onClick={() => onNewAt(ds)}
              style={{
                minHeight: 92, padding: "6px 5px", borderRight: `1px solid ${C.bdr}`, borderBottom: `1px solid ${C.bdr}`,
                cursor: "pointer", position: "relative", background: isToday ? C.dew : C.sur,
              }}>
              <div style={{
                fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? C.moss : C.mut,
                fontFamily: "'IBM Plex Mono',monospace", marginBottom: 4,
              }}>{d}</div>
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
                  textTransform: "uppercase", letterSpacing: "0.06em", userSelect: "none",
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

/* ─── CONTENT ITEM SLIDE-OUT EDITOR ──────────────────────────────────── */
function ContentItemModal({ initial, users, campaigns, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [addingCampaign, setAddingCampaign] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const createCampaign = () => {
    if (!newCampaignName.trim()) return;
    const next = addCampaign({ ...defCampaign(), name: newCampaignName.trim() });
    triggerSaved();
    const created = next[next.length - 1];
    set("campaignId", created.id);
    setNewCampaignName(""); setAddingCampaign(false);
  };

  const addLink = () => {
    if (!linkLabel.trim() || !linkUrl.trim()) return;
    set("links", [...(form.links || []), { id: uid(), label: linkLabel.trim(), url: linkUrl.trim() }]);
    setLinkLabel(""); setLinkUrl("");
  };
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
                    fontFamily: "inherit", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
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
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", letterSpacing: "0.06em" }}>Google Business Details</div>
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
            </div>
          )}
          {form.channel === "blog" && (
            <div style={{ background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 11, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", letterSpacing: "0.06em" }}>Blog Details</div>
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
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", letterSpacing: "0.06em" }}>Email Details</div>
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
              <div style={{ fontSize: 12, fontWeight: 700, color: C.moss, textTransform: "uppercase", letterSpacing: "0.06em" }}>Instagram Details</div>
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
                textTransform: "uppercase", letterSpacing: "0.06em", opacity: uploading ? 0.6 : 1,
              }}>
                <Icon name="add_photo_alternate" size={16} />{uploading ? "Uploading…" : "Add image"}
                <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading}
                  onChange={e => { addImage(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            </div>
          </div>

          <div>
            <label style={lbl()}>Links</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {(form.links || []).map(l => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: C.bg, borderRadius: 8, border: `1px solid ${C.bdr}` }}>
                  <Icon name="link" size={14} style={{ color: C.faint }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, flex: 1 }}>{l.label}</span>
                  <a href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.moss, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{l.url}</a>
                  <IconBtn icon="close" title="Remove" onClick={() => removeLink(l.id)} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Label" style={inp({ fontSize: 13, padding: "7px 10px", flex: "0 0 120px" })} />
              <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" style={inp({ fontSize: 13, padding: "7px 10px", flex: 1 })}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
              <OBtn onClick={addLink} style={{ padding: "7px 14px" }}>Add</OBtn>
            </div>
          </div>

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
function CampaignModal({ initial, onSave, onDelete, onClose, isNew }) {
  const [form, setForm] = useState(initial);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
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
function CampaignCard({ campaign, items, editable, onOpen, onFilter }) {
  const sm = campaignStatusMeta[campaign.status] || CAMPAIGN_STATUSES[0];
  const counts = campaignChannelCounts(campaign.id, items);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
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
      </div>
      {editable && (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 10px" }}>
          <IconBtn icon="edit" title="Edit campaign" onClick={onOpen} />
        </div>
      )}
    </div>
  );
}

function CampaignsView({ campaigns, items, editable, onOpenCampaign, onNewCampaign, onFilterCampaign }) {
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
            <CampaignCard key={c.id} campaign={c} items={items} editable={editable}
              onOpen={() => onOpenCampaign(c)} onFilter={onFilterCampaign} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── ROOT ───────────────────────────────────────────────────────────── */
function ContentCalendar({ user, focusItemId, onClearFocus }) {
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

  React.useEffect(() => {
    if (focusItemId) {
      const found = allItems.find(i => i.id === focusItemId);
      if (found) { setModal({ item: { ...found }, isNew: false }); setTab("calendar"); }
      onClearFocus && onClearFocus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);

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

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Content Calendar" sub={`${allItems.length} content item${allItems.length === 1 ? "" : "s"} · ${upcoming} upcoming`}
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
        <CalendarView items={items} campaigns={campaigns} monthKey={monthKey} setMonthKey={setMonthKey}
          onOpenItem={openEdit} onNewAt={editable ? openNew : () => {}} />
      )}
      {tab === "list" && <ListView items={items} users={users} campaigns={campaigns} onOpenItem={openEdit} />}
      {tab === "campaigns" && (
        <CampaignsView campaigns={campaigns} items={allItems} editable={editable}
          onOpenCampaign={openEditCampaign} onNewCampaign={openNewCampaign} onFilterCampaign={filterByCampaign} />
      )}

      {modal && (
        <ContentItemModal initial={modal.item} isNew={modal.isNew} users={users} campaigns={campaigns}
          onSave={saveItem} onDelete={!modal.isNew ? deleteItem : undefined} onClose={() => setModal(null)} />
      )}
      {campaignModal && (
        <CampaignModal initial={campaignModal.campaign} isNew={campaignModal.isNew}
          onSave={saveCampaignModal} onDelete={!campaignModal.isNew ? deleteCampaignModal : undefined} onClose={() => setCampaignModal(null)} />
      )}
    </div>
  );
}

export default ContentCalendar;
