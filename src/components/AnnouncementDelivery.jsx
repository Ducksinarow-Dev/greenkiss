import React, { useState, useEffect, useRef } from 'react';
import {
  C, REMOTE_MODE, refreshCache, linkifyMagnets,
  announcementsForUser, hasAckedAnnouncement, ackAnnouncement, triggerSaved,
} from '../globals.js';
import { Icon, Btn, MentionText } from './shared.jsx';

/* Announcement delivery surfaces (Batch 2). Sits alongside LoginReminders in
   App and turns live announcements into either:
   - a full-screen must-acknowledge blocker (surface:"fullscreen"), or
   - top-right toasts (surface:"toast").
   Delivery gating:
   - "signin"  → only the announcements present at THIS sign-in show (captured
     once at mount), so a notice published mid-shift waits for the next login.
   - "now"     → surfaces for anyone already in the app; a gentle refresh poll
     pulls freshly-posted ones into the cache so they actually arrive live.
   Must-ack items persist until acknowledged (dismiss only hides them for the
   session); non-ack items can be dismissed outright. */

function FullscreenBlocker({ a, onAck, onDismiss }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(12,14,12,0.78)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="gk-fade-in" style={{ background: C.sur, borderRadius: 18, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd, width: "100%", maxWidth: 500, padding: "34px 32px", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 99, background: C.mossSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Icon name="campaign" size={28} style={{ color: C.moss }} />
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, color: C.txt, marginBottom: 10 }}><MentionText text={linkifyMagnets(a.title || "")} /></div>
        {a.body && <div style={{ fontSize: 14.5, color: C.txt2, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 24 }}><MentionText text={linkifyMagnets(a.body)} /></div>}
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          {a.requireAck
            ? <Btn onClick={onAck} style={{ padding: "12px 26px", fontSize: 15 }}><Icon name="check" size={17} />Acknowledge</Btn>
            : <Btn onClick={onDismiss} style={{ padding: "12px 26px", fontSize: 15 }}>Got it</Btn>}
        </div>
      </div>
    </div>
  );
}

function Toast({ a, onAck, onDismiss, onOpen }) {
  return (
    <div className="gk-fade-in" style={{ background: C.sur, border: `1.5px solid ${a.requireAck ? C.moss : C.bdr}`, borderRadius: 13, boxShadow: C.shadowMd, padding: "13px 15px", width: 330 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: a.body ? 6 : 0 }}>
        <Icon name="campaign" size={17} style={{ color: C.moss }} />
        <div onClick={onOpen} style={{ fontSize: 13.5, fontWeight: 800, color: C.txt, flex: 1, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><MentionText text={linkifyMagnets(a.title || "")} /></div>
        <button onClick={onDismiss} title="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 2, display: "flex" }}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {a.body && <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.45, maxHeight: 54, overflow: "hidden" }}><MentionText text={linkifyMagnets(a.body)} /></div>}
      {a.requireAck && (
        <div style={{ marginTop: 10 }}>
          <Btn onClick={onAck} style={{ padding: "7px 14px", fontSize: 12.5 }}><Icon name="check" size={15} />Acknowledge</Btn>
        </div>
      )}
    </div>
  );
}

function AnnouncementDelivery({ user, onOpen }) {
  const [, force] = useState(0);
  const rerender = () => force(n => n + 1);
  const [dismissed, setDismissed] = useState(() => new Set());
  // The announcements that existed at this sign-in — "signin" delivery only
  // ever shows these (captured once), so mid-shift posts wait for next login.
  const signinIds = useRef(null);
  if (signinIds.current === null) {
    signinIds.current = new Set(
      announcementsForUser(user, "announcement").filter(a => a.delivery === "signin").map(a => a.id)
    );
  }

  // Poll so "live now" announcements actually reach an already-open app.
  useEffect(() => {
    const t = setInterval(() => {
      if (REMOTE_MODE) refreshCache().then(rerender).catch(() => {});
      else rerender();
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const shouldShow = (a) => {
    if (dismissed.has(a.id)) return false;
    if (a.requireAck && hasAckedAnnouncement(a.id, user.id)) return false;
    return a.delivery === "now" || signinIds.current.has(a.id);
  };
  const active = announcementsForUser(user, "announcement").filter(shouldShow);
  const fullscreen = active.find(a => a.surface === "fullscreen");
  const toasts = active.filter(a => a.surface === "toast").slice(0, 3);

  const ack = (a) => { ackAnnouncement(a.id, user.id); triggerSaved(); rerender(); };
  const dismiss = (a) => setDismissed(s => { const n = new Set(s); n.add(a.id); return n; });

  if (fullscreen) {
    return <FullscreenBlocker a={fullscreen} onAck={() => ack(fullscreen)} onDismiss={() => dismiss(fullscreen)} />;
  }
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: "fixed", top: 18, right: 18, zIndex: 720, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(a => (
        <Toast key={a.id} a={a}
          onAck={() => ack(a)} onDismiss={() => dismiss(a)}
          onOpen={() => onOpen && onOpen()} />
      ))}
    </div>
  );
}

export default AnnouncementDelivery;
