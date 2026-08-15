import React, { useState, useEffect, useRef } from 'react';
import { C, getUsers, chatAlerts } from '../globals.js';
import { Icon } from './shared.jsx';

/* Chat alert toasts (Phase 3). A toast pops for a new DM/group message or an
   @mention of you. Primes on mount (existing unread don't toast — the badge
   covers those); after that a ~15s poll surfaces genuinely new arrivals.
   Clicking opens that conversation. */
const stripTokens = (s) => (s || "").replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1");

function CTToast({ a, onOpen, onClose }) {
  return (
    <div className="gk-fade-in" style={{ background: C.sur, border: `1.5px solid ${C.moss}`, borderRadius: 13, boxShadow: C.shadowMd, padding: "12px 14px", width: 330 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Icon name="forum" size={17} style={{ color: C.moss }} />
        <div onClick={onOpen} style={{ fontSize: 13.5, fontWeight: 800, color: C.txt, flex: 1, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
        <button onClick={onClose} title="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 2, display: "flex" }}><Icon name="close" size={16} /></button>
      </div>
      <div onClick={onOpen} style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.45, cursor: "pointer", maxHeight: 54, overflow: "hidden" }}>{a.snippet}</div>
    </div>
  );
}

function ChatDelivery({ onOpen }) {
  const users = getUsers();
  const userName = (id) => users.find(u => u.id === id)?.name || "Someone";
  const [toasts, setToasts] = useState([]);
  const sinceRef = useRef(null); // null until primed

  useEffect(() => {
    let alive = true;
    const poll = () => {
      const primed = sinceRef.current !== null;
      chatAlerts(primed ? sinceRef.current : 0).then(msgs => {
        if (!alive) return;
        const maxId = msgs.reduce((mx, m) => Math.max(mx, m.id), sinceRef.current || 0);
        if (!primed) { sinceRef.current = maxId; return; } // prime — don't toast pre-existing unread
        if (msgs.length) {
          sinceRef.current = maxId;
          setToasts(t => [...msgs.map(m => ({
            id: m.id, channelId: m.channel_id,
            title: m.channel_kind === "channel" ? `${userName(m.user_id)} in #${m.channel_name || "channel"}` : userName(m.user_id),
            snippet: stripTokens(m.body),
          })), ...t].slice(0, 4));
        }
      }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (toasts.length === 0) return null;
  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));
  return (
    <div style={{ position: "fixed", top: 18, right: 18, zIndex: 725, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(a => <CTToast key={a.id} a={a} onOpen={() => { onOpen && onOpen(a.channelId); dismiss(a.id); }} onClose={() => dismiss(a.id)} />)}
    </div>
  );
}

export default ChatDelivery;
