import React, { useState, useEffect } from 'react';
import { C } from '../globals.js';
import { Icon, IconBtn } from './shared.jsx';
import Chat from './Chat.jsx';

/* Floating chat bubble (#46). A persistent launcher pinned bottom-right that
   opens a docked Chat panel overlaying whatever screen the user is on — so
   staff can chat without leaving their SOP/task. Reuses the full <Chat> pane
   (embedded mode) and the app-level unread poll (chatUnread) for the badge.
   The full Chat nav section stays for focused sessions. On mobile the panel
   goes full-screen. Mounted in App next to the delivery toasts. */
function ChatDock({ user, chatUnread, onNavigate, onCreateTask, focusChannelId, onClearFocus }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A chat toast / dashboard strip asking to open a specific channel pops the
  // dock open on that channel (deep-link handled by Chat's focusChannelId).
  useEffect(() => { if (focusChannelId) setOpen(true); }, [focusChannelId]);

  const badge = chatUnread > 0 ? (chatUnread > 99 ? "99+" : chatUnread) : null;

  const panelStyle = mobile
    ? { position: "fixed", inset: 0, zIndex: 690, background: C.bg, display: "flex", flexDirection: "column" }
    : { position: "fixed", right: 20, bottom: 88, width: 760, maxWidth: "calc(100vw - 40px)", height: 620, maxHeight: "calc(100vh - 120px)", zIndex: 690, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 16, boxShadow: C.shadowMd, display: "flex", flexDirection: "column", overflow: "hidden" };

  return (
    <>
      {open && (
        <div className="gk-fade-in" style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1.5px solid ${C.bdr}`, flexShrink: 0 }}>
            <Icon name="forum" size={18} style={{ color: C.moss }} />
            <div style={{ flex: 1, fontSize: 15, fontWeight: 800, color: C.txt }}>Chat</div>
            <IconBtn icon={mobile ? "close_fullscreen" : "remove"} title="Minimise" onClick={() => { setOpen(false); onClearFocus && onClearFocus(); }} />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
            <Chat user={user} onNavigate={onNavigate} onCreateTask={onCreateTask} focusChannelId={focusChannelId} onClearFocus={onClearFocus} embedded />
          </div>
        </div>
      )}
      <button type="button" onClick={() => { if (open) { onClearFocus && onClearFocus(); } setOpen(o => !o); }}
        title={open ? "Minimise chat" : "Open chat"}
        style={{
          position: "fixed", right: 20, bottom: 20, zIndex: 691,
          width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
          background: C.moss, color: "#fff", boxShadow: C.shadowMd,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
        <Icon name={open ? "close" : "forum"} size={24} />
        {!open && badge && (
          <span style={{ position: "absolute", top: -2, right: -2, background: C.red, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "1px 6px", minWidth: 18, textAlign: "center", border: `2px solid ${C.bg}` }}>{badge}</span>
        )}
      </button>
    </>
  );
}

export default ChatDock;
