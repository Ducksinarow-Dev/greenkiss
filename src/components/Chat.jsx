import React, { useState, useEffect, useRef } from 'react';
import {
  C, FONT_CAPS, isAdmin, getUsers, inp,
  chatBootstrap, chatChannelCreate, chatOpenDM, chatFetchMessages, chatSend, chatMarkRead, chatPoll, triggerSaved,
  chatEditMessage, chatDeleteMessage, chatArchiveChannel, confirmDelete, linkifyMagnets,
} from '../globals.js';
import { Icon, Btn, OBtn, IconBtn, Avatar, EmptyState, lbl, MentionField, MentionText } from './shared.jsx';

/* Staff chat (Phase 1). Two-pane: channel list + message pane. Public
   channels only for now (DMs, group DMs, private channels are Phase 2;
   magnet/mention linking + toasts are Phase 3). Near-real-time via a 4s poll
   of the open channel plus per-channel unread refresh. Self-contained so it
   can be lifted into DuckTracks. */

// Server sends "YYYY-MM-DD HH:MM:SS" (UTC); dev sends ISO. Show local HH:MM.
const msgTime = (s) => {
  if (!s) return "";
  const d = new Date(/[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

function StaffChips({ users, selected, onToggle, excludeId }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {users.filter(u => u.id !== excludeId).map(u => {
        const on = selected.includes(u.id);
        return (
          <button key={u.id} type="button" onClick={() => onToggle(u.id)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
              border: `1.5px solid ${on ? C.moss : C.bdr}`, background: on ? C.mossSoft : C.sur, color: on ? C.moss : C.mut, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
            <Avatar name={u.name} size={18} />{u.name.split(" ")[0]}{on && <Icon name="check" size={14} />}
          </button>
        );
      })}
    </div>
  );
}

function ModalShell({ title, onClose, children, footer }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 620, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{ background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd, width: "100%", maxWidth: 440, maxHeight: "90vh", overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>{title}</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>{footer}</div>
      </div>
    </div>
  );
}

function NewChannelModal({ users, me, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { const id = await chatChannelCreate({ name: name.trim().replace(/^#/, ""), kind: "channel", visibility, memberIds: visibility === "private" ? members : [] }); triggerSaved(); onCreated(id); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <ModalShell title="New channel" onClose={onClose}
      footer={<><OBtn onClick={onClose}>Cancel</OBtn><Btn onClick={create} disabled={!name.trim() || busy}>Create</Btn></>}>
      <div>
        <label style={lbl()}>Channel name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. floor, ops, general" style={inp()} />
      </div>
      <div>
        <label style={lbl()}>Visibility</label>
        <div style={{ display: "flex", gap: 8 }}>
          {[["public", "Public — everyone"], ["private", "Private — invite only"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setVisibility(k)}
              style={{ padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                border: `1.5px solid ${visibility === k ? C.moss : C.bdr}`, background: visibility === k ? C.mossSoft : C.sur, color: visibility === k ? C.moss : C.mut }}>{l}</button>
          ))}
        </div>
      </div>
      {visibility === "private" && (
        <div>
          <label style={lbl()}>Members</label>
          <StaffChips users={users} selected={members} excludeId={me?.id} onToggle={id => setMembers(m => m.includes(id) ? m.filter(x => x !== id) : [...m, id])} />
        </div>
      )}
    </ModalShell>
  );
}

function NewMessageModal({ users, me, onClose, onOpened }) {
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const id = selected.length === 1 ? await chatOpenDM(selected[0]) : await chatChannelCreate({ kind: "group", name: name.trim(), memberIds: selected });
      onOpened(id); onClose();
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title="New message" onClose={onClose}
      footer={<><OBtn onClick={onClose}>Cancel</OBtn><Btn onClick={start} disabled={selected.length === 0 || busy}>{selected.length > 1 ? "Start group" : "Message"}</Btn></>}>
      <div>
        <label style={lbl()}>To</label>
        <StaffChips users={users} selected={selected} excludeId={me?.id} onToggle={id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])} />
        {selected.length === 0 && <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Pick one person for a direct message, or several for a group.</div>}
      </div>
      {selected.length > 1 && (
        <div>
          <label style={lbl()}>Group name (optional)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Window team" style={inp()} />
        </div>
      )}
    </ModalShell>
  );
}

function MessageRow({ m, grouped, mine, userName, onMention, onEdit, onDelete, onCreateTask }) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const edited = m.edited_at || m.editedAt;
  const deleted = m.deleted_at || m.deletedAt;
  const saveEdit = () => { const t = draft.trim(); if (t && t !== m.body) onEdit(m.id, t); setEditing(false); };
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", gap: 10, padding: grouped ? "1px 0" : "8px 0 1px", position: "relative" }}>
      <div style={{ width: 32, flexShrink: 0 }}>{!grouped && <Avatar name={userName(m.user_id)} size={32} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!grouped && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: mine ? C.moss : C.txt }}>{userName(m.user_id)}</span>
            <span style={{ fontSize: 11, color: C.faint, fontFamily: "'IBM Plex Mono',monospace" }}>{msgTime(m.created_at)}</span>
          </div>
        )}
        {editing ? (
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") { setEditing(false); setDraft(m.body); } }}
              style={{ ...inp({ fontSize: 14, padding: "6px 10px" }), resize: "none", flex: 1 }} />
            <IconBtn icon="check" title="Save" onClick={saveEdit} style={{ color: C.moss }} />
            <IconBtn icon="close" title="Cancel" onClick={() => { setEditing(false); setDraft(m.body); }} />
          </div>
        ) : (
          <div style={{ fontSize: 14, color: deleted ? C.faint : C.txt2, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontStyle: deleted ? "italic" : "normal" }}>
            {deleted ? "Message deleted" : <MentionText text={linkifyMagnets(m.body)} onNavigate={onMention} />}
            {edited && !deleted && <span style={{ fontSize: 11, color: C.faint, marginLeft: 6 }}>(edited)</span>}
          </div>
        )}
      </div>
      {hover && !deleted && !editing && (
        <div style={{ position: "absolute", top: 2, right: 2, display: "flex", gap: 2, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 8, padding: 2, boxShadow: C.shadowSm }}>
          <IconBtn icon="add_task" title="Create task from this" onClick={() => onCreateTask(m)} />
          {mine && <IconBtn icon="edit" title="Edit" onClick={() => { setDraft(m.body); setEditing(true); }} />}
          {mine && <IconBtn icon="delete" danger title="Delete" onClick={() => onDelete(m)} />}
        </div>
      )}
    </div>
  );
}

function Chat({ user, onNavigate, focusChannelId, onClearFocus, onCreateTask, embedded }) {
  const admin = isAdmin(user);
  const users = getUsers();
  const userName = (id) => users.find(u => u.id === id)?.name || "Someone";
  // Clicking an @mention: a person opens a DM with them; anything else (SOP,
  // task, playbook, form) routes out to the host app's navigator.
  const handleMention = (kind, id) => {
    if (kind === "user") { chatOpenDM(id).then(cid => { loadChannels(); setActiveId(cid); }); return; }
    onNavigate && onNavigate(kind, id);
  };
  const [channels, setChannels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState(null); // "channel" | "message"
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef(0);
  const scrollRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const loadChannels = () => chatBootstrap().then(cs => {
    setChannels(cs);
    setActiveId(prev => prev || (cs[0]?.id ?? null));
  }).finally(() => setLoading(false));
  useEffect(() => { loadChannels(); /* eslint-disable-next-line */ }, []);

  // Deep-link: a chat toast or the dashboard strip can open a specific channel.
  useEffect(() => {
    if (!focusChannelId) return;
    setActiveId(focusChannelId);
    loadChannels();
    onClearFocus && onClearFocus();
    /* eslint-disable-next-line */
  }, [focusChannelId]);

  // Load history when the active channel changes; mark read.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    chatFetchMessages(activeId).then(ms => {
      if (!alive) return;
      setMessages(ms);
      setHasMore(ms.length >= 50);
      cursorRef.current = ms.length ? ms[ms.length - 1].id : 0;
      chatMarkRead(activeId).then(loadChannels);
    });
    return () => { alive = false; };
  }, [activeId]);

  // Poll: new messages for the open channel + per-channel unread refresh.
  useEffect(() => {
    const t = setInterval(() => {
      const open = activeRef.current;
      chatPoll(open || "", cursorRef.current).then(({ channels: chs, newMessages }) => {
        setChannels(prev => prev.map(c => { const u = chs.find(x => x.id === c.id); return u ? { ...c, unread: u.unread, lastMsgId: u.lastMsgId } : c; }));
        if (open && newMessages.length) {
          setMessages(prev => {
            const have = new Set(prev.map(m => m.id));
            const add = newMessages.filter(m => !have.has(m.id));
            if (!add.length) return prev;
            cursorRef.current = add[add.length - 1].id;
            return [...prev, ...add];
          });
          chatMarkRead(open, newMessages[newMessages.length - 1].id);
        }
      }).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // Keep pinned to the bottom by scrolling the CONTAINER when a NEW message
  // lands (the last id grows) — not on prepend of older history.
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lastId, activeId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setDraft("");
    const msg = await chatSend(activeId, text);
    if (msg) { setMessages(prev => [...prev, msg]); cursorRef.current = Math.max(cursorRef.current, msg.id); }
    loadChannels();
  };
  const loadEarlier = async () => {
    if (!messages.length) return;
    const older = await chatFetchMessages(activeId, messages[0].id);
    if (older.length < 50) setHasMore(false);
    if (older.length) setMessages(prev => [...older, ...prev]);
  };
  const doEdit = (id, text) => {
    chatEditMessage(id, text);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, body: text, edited_at: new Date().toISOString() } : m));
  };
  const doDelete = async (m) => {
    if (!(await confirmDelete("Delete this message?"))) return;
    chatDeleteMessage(m.id);
    setMessages(prev => prev.map(x => x.id === m.id ? { ...x, deleted_at: new Date().toISOString() } : x));
  };
  const doArchive = async () => {
    if (!active) return;
    if (!(await confirmDelete(`Archive ${channelLabel(active)}? It'll be hidden for everyone.`))) return;
    await chatArchiveChannel(active.id);
    triggerSaved();
    setActiveId(null);
    loadChannels();
  };

  const active = channels.find(c => c.id === activeId);
  const channelLabel = (c) => {
    if (!c) return "";
    if (c.kind === "channel") return c.name;
    const others = (c.memberIds || []).filter(id => id !== user.id);
    if (c.kind === "dm") return userName(others[0]);
    return c.name || (others.map(userName).join(", ") || "Group");
  };
  const channelIcon = (c) => c.kind === "channel" ? (c.visibility === "private" ? "lock" : "tag") : (c.kind === "dm" ? "person" : "group");
  const chChannels = channels.filter(c => c.kind === "channel");
  const chDMs = channels.filter(c => c.kind === "dm" || c.kind === "group");
  // Act-from-item (#47): spin up a task prefilled from a message.
  const createTaskFromMessage = (m) => {
    if (!onCreateTask) return;
    const body = m.body || "";
    const firstLine = body.split("\n")[0].slice(0, 80);
    onCreateTask({ title: firstLine || "Follow-up from chat", description: `${body}\n\n— from ${active ? channelLabel(active) : "chat"} (${userName(m.user_id)})` });
  };

  const ChannelRow = (c) => {
    const on = c.id === activeId;
    const unread = on ? 0 : c.unread;
    return (
      <button key={c.id} onClick={() => setActiveId(c.id)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left", width: "100%", background: on ? C.mossSoft : "transparent", fontFamily: "inherit" }}
        onMouseEnter={e => { if (!on) e.currentTarget.style.background = C.s2; }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
        <Icon name={channelIcon(c)} size={16} style={{ color: on ? C.moss : C.faint, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: unread ? 800 : (on ? 700 : 500), color: on ? C.moss : C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channelLabel(c)}</span>
        {unread > 0 && <span style={{ background: C.red, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{unread > 99 ? "99+" : unread}</span>}
      </button>
    );
  };
  const listHeader = (label, onAdd, addTitle) => (
    <div style={{ display: "flex", alignItems: "center", padding: "10px 12px 4px" }}>
      <div style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT_CAPS }}>{label}</div>
      {onAdd && <IconBtn icon="add" title={addTitle} onClick={onAdd} />}
    </div>
  );

  return (
    <div className="gk-fade-in" style={{ display: "flex", gap: embedded ? 10 : 16, height: embedded ? "100%" : "calc(100vh - 64px)", minHeight: 0 }}>
      {/* Channel + DM list */}
      <div style={{ width: 244, flexShrink: 0, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1.5px solid ${C.bdr}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS }}>Chat</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {loading && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>Loading…</div>}
          {!loading && (
            <>
              {listHeader("Channels", admin ? () => setModal("channel") : null, "New channel")}
              {chChannels.length === 0 && <div style={{ padding: "4px 12px 8px", fontSize: 12.5, color: C.faint }}>{admin ? "Create a channel." : "No channels yet."}</div>}
              {chChannels.map(ChannelRow)}
              {listHeader("Direct Messages", () => setModal("message"), "New message")}
              {chDMs.length === 0 && <div style={{ padding: "4px 12px 8px", fontSize: 12.5, color: C.faint }}>No direct messages yet.</div>}
              {chDMs.map(ChannelRow)}
            </>
          )}
        </div>
      </div>

      {/* Message pane */}
      <div style={{ flex: 1, minWidth: 0, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!active ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <EmptyState icon="forum" title="No channel selected" sub={channels.length ? "Pick a channel on the left." : (admin ? "Create the first channel to get the team talking." : "Ask an admin to set up a channel.")} />
          </div>
        ) : (
          <>
            <div style={{ padding: "13px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name={channelIcon(active)} size={18} style={{ color: C.moss }} />
              <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>{channelLabel(active)}</div>
              {active.kind === "group" && <span style={{ fontSize: 12, color: C.mut }}>· {(active.memberIds || []).length} people</span>}
              <div style={{ flex: 1 }} />
              {(active.kind !== "channel" || admin) && <IconBtn icon="archive" title="Archive conversation" onClick={doArchive} />}
            </div>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
              {hasMore && (
                <button type="button" onClick={loadEarlier}
                  style={{ alignSelf: "center", margin: "4px 0 10px", background: C.s2, border: `1.5px solid ${C.bdr}`, borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, color: C.mut, cursor: "pointer", fontFamily: "inherit" }}>
                  Load earlier messages
                </button>
              )}
              {messages.length === 0 && <div style={{ margin: "auto", fontSize: 13.5, color: C.faint }}>No messages yet — say hello 👋</div>}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const grouped = prev && prev.user_id === m.user_id && (new Date(msgTs(m)) - new Date(msgTs(prev))) < 5 * 60000;
                return <MessageRow key={m.id} m={m} grouped={grouped} mine={m.user_id === user.id} userName={userName} onMention={handleMention} onEdit={doEdit} onDelete={doDelete} onCreateTask={createTaskFromMessage} />;
              })}
            </div>
            <div style={{ padding: "12px 16px", borderTop: `1.5px solid ${C.bdr}`, display: "flex", gap: 10, alignItems: "flex-end" }}>
              <MentionField value={draft} onChange={setDraft} multiline rows={1}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Message ${channelLabel(active)}…  (@ to mention)`}
                style={{ ...inp({ fontSize: 14, padding: "10px 13px", lineHeight: 1.5 }), resize: "none", maxHeight: 140 }} />
              <Btn onClick={send} disabled={!draft.trim()} style={{ padding: "10px 16px", flexShrink: 0 }}><Icon name="send" size={16} /></Btn>
            </div>
          </>
        )}
      </div>

      {modal === "channel" && <NewChannelModal users={users} me={user} onClose={() => setModal(null)} onCreated={(id) => { loadChannels(); setActiveId(id); }} />}
      {modal === "message" && <NewMessageModal users={users} me={user} onClose={() => setModal(null)} onOpened={(id) => { loadChannels(); setActiveId(id); }} />}
    </div>
  );
}

// Parse a server/dev timestamp to a Date-parseable string for grouping math.
function msgTs(m) {
  const s = m.created_at || "";
  return /[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z";
}

export default Chat;
