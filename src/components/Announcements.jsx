import React, { useState } from 'react';
import {
  C, FONT_CAPS, canEdit, inp, nowISO, fmtDate,
  getUsers, getGroups,
  ANNOUNCEMENT_SURFACES, ANNOUNCEMENT_DELIVERY, NEWS_SECTIONS, newsSectionMeta,
  getAnnouncements, defAnnouncement, addAnnouncement, updateAnnouncement, deleteAnnouncement,
  announcementIsLive, announcementTargetsUser, announcementRecipientIds,
  hasAckedAnnouncement, announcementAckList, ackAnnouncement,
  confirmDelete, triggerSaved, linkifyMagnets,
} from '../globals.js';
import { Icon, Btn, OBtn, IconBtn, Pill, SectionHeader, EmptyState, Chk, lbl, MentionText } from './shared.jsx';

/* Announcements + Current News (Batch 2). One page, two kinds: active
   announcements (toast / full-screen, acknowledge-tracked) and passive news
   cards for the dashboard feed. Editors compose + see read receipts; everyone
   else sees what's aimed at them and can acknowledge. */

// datetime-local <-> ISO, keeping the picker in the viewer's local zone.
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const userName = (id) => getUsers().find(u => u.id === id)?.name || "Unknown";

function AudiencePicker({ draft, set }) {
  const groups = getGroups();
  const users = getUsers();
  const opt = (key, label) => (
    <button key={key} type="button" onClick={() => set({ audience: key })}
      style={{
        padding: "7px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
        border: `1.5px solid ${draft.audience === key ? C.moss : C.bdr}`,
        background: draft.audience === key ? C.mossSoft : C.sur, color: draft.audience === key ? C.moss : C.mut,
      }}>{label}</button>
  );
  const chip = (on, color, label, onClick) => (
    <button type="button" onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
        border: `1.5px solid ${on ? (color || C.moss) : C.bdr}`, background: on ? C.s2 : C.sur,
        color: on ? C.txt : C.mut, fontSize: 13, fontWeight: 600, fontFamily: "inherit",
      }}>
      {color && <span style={{ width: 9, height: 9, borderRadius: 99, background: color, opacity: on ? 1 : 0.4 }} />}
      <Icon name={on ? "check" : "add"} size={14} />{label}
    </button>
  );
  const toggle = (field, id) => set({ [field]: draft[field].includes(id) ? draft[field].filter(x => x !== id) : [...draft[field], id] });
  return (
    <div>
      <label style={lbl()}>Who sees this</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: draft.audience === "all" ? 0 : 10 }}>
        {opt("all", "Everyone")}
        {opt("groups", "Groups")}
        {opt("users", "Specific staff")}
      </div>
      {draft.audience === "groups" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {groups.length === 0 && <div style={{ fontSize: 12.5, color: C.faint }}>No groups yet — create some in the Admin panel.</div>}
          {groups.map(g => chip(draft.groupIds.includes(g.id), g.color, g.name, () => toggle("groupIds", g.id)))}
        </div>
      )}
      {draft.audience === "users" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {users.map(u => chip(draft.userIds.includes(u.id), null, u.name, () => toggle("userIds", u.id)))}
        </div>
      )}
    </div>
  );
}

function Composer({ draft: initial, user, onClose, onSaved }) {
  const isNew = !getAnnouncements().some(a => a.id === initial.id);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const set = (changes) => setDraft(d => ({ ...d, ...changes }));
  const isNews = draft.kind === "news";

  const save = () => {
    if (!draft.title.trim()) { setError("Give it a title."); return; }
    if (draft.audience === "groups" && draft.groupIds.length === 0) { setError("Pick at least one group, or choose Everyone."); return; }
    if (draft.audience === "users" && draft.userIds.length === 0) { setError("Pick at least one person, or choose Everyone."); return; }
    const rec = { ...draft, title: draft.title.trim(), body: draft.body.trim() };
    if (isNew) addAnnouncement(rec); else updateAnnouncement(rec.id, rec);
    triggerSaved();
    onSaved && onSaved();
    onClose();
  };

  const field = { ...inp({ fontSize: 14, padding: "9px 11px" }) };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 620, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 26, display: "flex", flexDirection: "column", gap: 15,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>
            {isNew ? (isNews ? "Post news" : "New announcement") : (isNews ? "Edit news post" : "Edit announcement")}
          </div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div>
          <label style={lbl()}>Title</label>
          <input value={draft.title} onChange={e => set({ title: e.target.value })} placeholder={isNews ? "e.g. Spring gift-with-purchase is live" : "e.g. Store closes early Friday"} style={field} autoFocus />
        </div>
        <div>
          <label style={lbl()}>{isNews ? "Details" : "Message"}</label>
          <textarea value={draft.body} onChange={e => set({ body: e.target.value })} rows={4} placeholder="Write the details…" style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {isNews ? (
          <div>
            <label style={lbl()}>Section</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NEWS_SECTIONS.map(s => (
                <button key={s.key} type="button" onClick={() => set({ section: s.key })}
                  style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                    border: `1.5px solid ${draft.section === s.key ? s.color : C.bdr}`, background: draft.section === s.key ? C.s2 : C.sur, color: draft.section === s.key ? C.txt : C.mut,
                  }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: s.color }} />{s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label style={lbl()}>How it shows</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ANNOUNCEMENT_SURFACES.map(s => (
                  <button key={s.key} type="button" onClick={() => set({ surface: s.key })}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                      border: `1.5px solid ${draft.surface === s.key ? C.moss : C.bdr}`, background: draft.surface === s.key ? C.mossSoft : C.sur, color: draft.surface === s.key ? C.moss : C.mut,
                    }}>
                    <Icon name={s.key === "fullscreen" ? "fullscreen" : "notifications"} size={16} />{s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl()}>When</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ANNOUNCEMENT_DELIVERY.map(d => (
                  <button key={d.key} type="button" onClick={() => set({ delivery: d.key })}
                    style={{
                      padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                      border: `1.5px solid ${draft.delivery === d.key ? C.moss : C.bdr}`, background: draft.delivery === d.key ? C.mossSoft : C.sur, color: draft.delivery === d.key ? C.moss : C.mut,
                    }}>{d.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>
                {draft.delivery === "now" ? "Appears for anyone in the app within a minute." : "Waits and shows the next time each person signs in."}
              </div>
            </div>
            <Chk checked={draft.requireAck} onChange={() => set({ requireAck: !draft.requireAck })} label="Require an acknowledgement" />
          </>
        )}

        <AudiencePicker draft={draft} set={set} />

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={lbl()}>Publish{draft.publishAt && new Date(draft.publishAt) > new Date() ? " (scheduled)" : ""}</label>
            <input type="datetime-local" value={toLocalInput(draft.publishAt)} onChange={e => set({ publishAt: fromLocalInput(e.target.value) || nowISO() })} style={field} />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={lbl()}>Expires {isNews ? "" : "(optional)"}</label>
            <input type="datetime-local" value={toLocalInput(draft.expiresAt)} onChange={e => set({ expiresAt: fromLocalInput(e.target.value) })} style={field} />
          </div>
        </div>

        {error && <div style={{ fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={save}>{isNew ? "Publish" : "Save"}</Btn>
        </div>
      </div>
    </div>
  );
}

function ReadReceipts({ a }) {
  const [open, setOpen] = useState(false);
  const recipients = announcementRecipientIds(a);
  const acked = new Set(announcementAckList(a.id).map(x => x.userId));
  const ackedCount = recipients.filter(id => acked.has(id)).length;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: C.mut, fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: 0 }}>
        <Icon name="done_all" size={15} style={{ color: ackedCount === recipients.length && recipients.length ? C.moss : C.mut }} />
        {ackedCount} of {recipients.length} acknowledged
        <Icon name={open ? "expand_less" : "expand_more"} size={16} />
      </button>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {recipients.map(id => {
            const on = acked.has(id);
            return (
              <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: on ? C.moss : C.mut, background: on ? C.mossSoft : C.s2, border: `1px solid ${on ? C.moss + "55" : C.bdr}`, borderRadius: 99, padding: "3px 9px" }}>
                <Icon name={on ? "check" : "schedule"} size={13} />{userName(id)}
              </span>
            );
          })}
          {recipients.length === 0 && <span style={{ fontSize: 12.5, color: C.faint }}>No recipients resolved.</span>}
        </div>
      )}
    </div>
  );
}

function audienceLabel(a) {
  if (a.audience === "all") return "Everyone";
  if (a.audience === "groups") return `${a.groupIds.length} group${a.groupIds.length === 1 ? "" : "s"}`;
  return `${a.userIds.length} staff`;
}

function AnnouncementCard({ a, user, editor, onEdit, onDelete, onChange }) {
  const live = announcementIsLive(a);
  const scheduled = a.publishAt && new Date(a.publishAt) > new Date();
  const mine = announcementTargetsUser(a, user);
  const acked = hasAckedAnnouncement(a.id, user.id);
  const doAck = () => { ackAnnouncement(a.id, user.id); triggerSaved(); onChange && onChange(); };
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: "15px 17px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.txt }}>{a.title}</div>
          {a.body && <div style={{ fontSize: 13.5, color: C.txt2, marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}><MentionText text={linkifyMagnets(a.body)} /></div>}
        </div>
        {editor && (
          <div style={{ display: "flex", flexShrink: 0 }}>
            <IconBtn icon="edit" title="Edit" onClick={onEdit} />
            <IconBtn icon="delete" danger title="Delete" onClick={onDelete} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 11 }}>
        <Pill color={a.surface === "fullscreen" ? C.clay : C.moss}>{a.surface === "fullscreen" ? "Full screen" : "Toast"}</Pill>
        {a.requireAck && <Pill color={C.txt2}>Ack required</Pill>}
        {!live && <Pill color={scheduled ? C.clay : C.faint}>{scheduled ? "Scheduled" : "Expired"}</Pill>}
        {editor && <span style={{ fontSize: 12, color: C.mut }}>· {audienceLabel(a)} · {a.delivery === "now" ? "Live now" : "At sign-in"}</span>}
      </div>
      {editor && a.requireAck && <ReadReceipts a={a} />}
      {!editor && mine && a.requireAck && (
        <div style={{ marginTop: 12 }}>
          {acked
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.moss }}><Icon name="check_circle" size={17} />Acknowledged</span>
            : <Btn onClick={doAck}><Icon name="check" size={16} />Acknowledge</Btn>}
        </div>
      )}
    </div>
  );
}

function NewsCard({ a, editor, onEdit, onDelete }) {
  const meta = newsSectionMeta(a.section);
  const live = announcementIsLive(a);
  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: "15px 17px", borderLeft: `4px solid ${meta.color}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <Pill color={meta.color}>{meta.label}</Pill>
            {!live && <Pill color={C.faint}>Expired</Pill>}
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.txt }}>{a.title}</div>
          {a.body && <div style={{ fontSize: 13.5, color: C.txt2, marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}><MentionText text={linkifyMagnets(a.body)} /></div>}
          {a.expiresAt && <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>Expires {fmtDate(a.expiresAt)}</div>}
        </div>
        {editor && (
          <div style={{ display: "flex", flexShrink: 0 }}>
            <IconBtn icon="edit" title="Edit" onClick={onEdit} />
            <IconBtn icon="delete" danger title="Delete" onClick={onDelete} />
          </div>
        )}
      </div>
    </div>
  );
}

function Announcements({ user }) {
  const editor = canEdit(user);
  const [composing, setComposing] = useState(null);
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);

  const all = getAnnouncements();
  const forList = (kind) => {
    const items = all.filter(a => a.kind === kind);
    return editor ? items : items.filter(a => announcementIsLive(a) && announcementTargetsUser(a, user));
  };
  const announcements = forList("announcement");
  const news = forList("news");

  const startNews = () => {
    const d = defAnnouncement("news", user);
    d.expiresAt = new Date(Date.now() + 14 * 864e5).toISOString(); // news defaults to a 2-week shelf life
    setComposing(d);
  };
  const remove = async (a) => {
    const ok = await confirmDelete(`Delete "${a.title}"?`);
    if (!ok) return;
    deleteAnnouncement(a.id); triggerSaved(); bump();
  };

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Announcements" sub="Push notices to staff and post news to everyone's dashboard"
        right={editor && (
          <>
            <OBtn onClick={startNews}><Icon name="feed" size={16} />Post news</OBtn>
            <Btn onClick={() => setComposing(defAnnouncement("announcement", user))}><Icon name="campaign" size={16} />New announcement</Btn>
          </>
        )} />

      <div style={{ fontSize: 13, fontWeight: 700, color: C.txt2, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT_CAPS, marginBottom: 12 }}>Announcements</div>
      {announcements.length === 0 ? (
        <EmptyState icon="campaign" title="No announcements" sub={editor ? "Push a toast or a full-screen notice to staff, with read tracking." : "Notices aimed at you will show up here."}
          action={editor && <Btn onClick={() => setComposing(defAnnouncement("announcement", user))}><Icon name="add" size={16} />New announcement</Btn>} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 30 }}>
          {announcements.map(a => (
            <AnnouncementCard key={a.id} a={a} user={user} editor={editor}
              onEdit={() => setComposing(a)} onDelete={() => remove(a)} onChange={bump} />
          ))}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.txt2, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT_CAPS, margin: "26px 0 12px" }}>Current News</div>
      {news.length === 0 ? (
        <EmptyState icon="feed" title="No news posts" sub={editor ? "Post news to the dashboard feed — it auto-expires so the board stays current." : "Company news will appear here and on your dashboard."}
          action={editor && <OBtn onClick={startNews}><Icon name="add" size={16} />Post news</OBtn>} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {news.map(a => (
            <NewsCard key={a.id} a={a} editor={editor} onEdit={() => setComposing(a)} onDelete={() => remove(a)} />
          ))}
        </div>
      )}

      {composing && <Composer draft={composing} user={user} onClose={() => setComposing(null)} onSaved={bump} />}
    </div>
  );
}

export default Announcements;
