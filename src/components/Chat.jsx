import React, { useState, useEffect, useRef } from 'react';
import {
  C, FONT_CAPS, isAdmin, getUsers, inp,
  chatBootstrap, chatChannelCreate, chatFetchMessages, chatSend, chatMarkRead, chatPoll, triggerSaved,
} from '../globals.js';
import { Icon, Btn, OBtn, IconBtn, Avatar, EmptyState, lbl } from './shared.jsx';

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

function NewChannelModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { const id = await chatChannelCreate({ name: name.trim().replace(/^#/, ""), kind: "channel", visibility: "public" }); triggerSaved(); onCreated(id); onClose(); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 620, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{ background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd, width: "100%", maxWidth: 400, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>New channel</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div>
          <label style={lbl()}>Channel name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. floor, ops, general"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); create(); } }} style={inp()} />
          <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Public — visible to everyone with chat access.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={create} disabled={!name.trim() || busy}>Create</Btn>
        </div>
      </div>
    </div>
  );
}

function Chat({ user }) {
  const admin = isAdmin(user);
  const users = getUsers();
  const userName = (id) => users.find(u => u.id === id)?.name || "Someone";
  const [channels, setChannels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const cursorRef = useRef(0);
  const scrollRef = useRef(null);
  const activeRef = useRef(null);
  activeRef.current = activeId;

  const loadChannels = () => chatBootstrap().then(cs => {
    setChannels(cs);
    setActiveId(prev => prev || (cs[0]?.id ?? null));
  }).finally(() => setLoading(false));
  useEffect(() => { loadChannels(); /* eslint-disable-next-line */ }, []);

  // Load history when the active channel changes; mark read.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    chatFetchMessages(activeId).then(ms => {
      if (!alive) return;
      setMessages(ms);
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

  // Keep the message list pinned to the bottom by scrolling the CONTAINER
  // (not scrollIntoView, which would scroll the whole page).
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, activeId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setDraft("");
    const msg = await chatSend(activeId, text);
    if (msg) { setMessages(prev => [...prev, msg]); cursorRef.current = Math.max(cursorRef.current, msg.id); }
    loadChannels();
  };

  const active = channels.find(c => c.id === activeId);

  return (
    <div className="gk-fade-in" style={{ display: "flex", gap: 16, height: "calc(100vh - 64px)" }}>
      {/* Channel list */}
      <div style={{ width: 236, flexShrink: 0, background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, flex: 1, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: FONT_CAPS }}>Channels</div>
          {admin && <IconBtn icon="add" title="New channel" onClick={() => setCreating(true)} />}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {loading && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>Loading…</div>}
          {!loading && channels.length === 0 && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>No channels yet.{admin ? " Create one." : ""}</div>}
          {channels.map(c => {
            const on = c.id === activeId;
            const unread = on ? 0 : c.unread;
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "left", width: "100%", background: on ? C.mossSoft : "transparent", fontFamily: "inherit" }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = C.s2; }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                <Icon name="tag" size={16} style={{ color: on ? C.moss : C.faint, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: unread ? 800 : (on ? 700 : 500), color: on ? C.moss : C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                {unread > 0 && <span style={{ background: C.red, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{unread > 99 ? "99+" : unread}</span>}
              </button>
            );
          })}
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
              <Icon name="tag" size={18} style={{ color: C.moss }} />
              <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>{active.name}</div>
            </div>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
              {messages.length === 0 && <div style={{ margin: "auto", fontSize: 13.5, color: C.faint }}>No messages yet — say hello 👋</div>}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const grouped = prev && prev.user_id === m.user_id && (new Date(msgTs(m)) - new Date(msgTs(prev))) < 5 * 60000;
                const mine = m.user_id === user.id;
                return (
                  <div key={m.id} style={{ display: "flex", gap: 10, padding: grouped ? "1px 0" : "8px 0 1px" }}>
                    <div style={{ width: 32, flexShrink: 0 }}>{!grouped && <Avatar name={userName(m.user_id)} size={32} />}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {!grouped && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 800, color: mine ? C.moss : C.txt }}>{userName(m.user_id)}</span>
                          <span style={{ fontSize: 11, color: C.faint, fontFamily: "'IBM Plex Mono',monospace" }}>{msgTime(m.created_at)}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 14, color: m.deleted_at ? C.faint : C.txt2, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontStyle: m.deleted_at ? "italic" : "normal" }}>
                        {m.deleted_at ? "Message deleted" : m.body}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "12px 16px", borderTop: `1.5px solid ${C.bdr}`, display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Message ${active.name}…`}
                style={{ ...inp({ fontSize: 14, padding: "10px 13px", lineHeight: 1.5 }), resize: "none", maxHeight: 140 }} />
              <Btn onClick={send} disabled={!draft.trim()} style={{ padding: "10px 16px", flexShrink: 0 }}><Icon name="send" size={16} /></Btn>
            </div>
          </>
        )}
      </div>

      {creating && <NewChannelModal onClose={() => setCreating(false)} onCreated={(id) => { loadChannels(); setActiveId(id); }} />}
    </div>
  );
}

// Parse a server/dev timestamp to a Date-parseable string for grouping math.
function msgTs(m) {
  const s = m.created_at || "";
  return /[TZ]/.test(s) ? s : s.replace(" ", "T") + "Z";
}

export default Chat;
