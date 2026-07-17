import React, { useState, useEffect, useRef } from 'react';
import { _gkRefs, C } from '../globals.js';
import { Icon } from './shared.jsx';

function ConfirmDialog() {
  const [state, setState] = useState({ open: false, msg: "" });
  useEffect(() => { _gkRefs.setConfirmState = setState; return () => { _gkRefs.setConfirmState = null; }; }, []);
  if (!state.open) return null;
  const answer = (v) => { setState({ open: false, msg: "" }); if (_gkRefs.confirmResolve) { _gkRefs.confirmResolve(v); _gkRefs.confirmResolve = null; } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999 }} onClick={() => answer(false)}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.sur, borderRadius: 16, padding: "30px 32px", maxWidth: 400, width: "90%", boxShadow: C.shadowMd, textAlign: "center", border: `1.5px solid ${C.bdr}` }}>
        <div style={{ marginBottom: 14 }}><Icon name="warning" size={34} style={{ color: C.clay }} /></div>
        <div style={{ fontSize: 17, color: C.txt, fontWeight: 700, marginBottom: 8 }}>Are you sure?</div>
        <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.6, marginBottom: 22 }}>{state.msg}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={() => answer(false)} style={{ padding: "9px 22px", borderRadius: 9, border: `1.5px solid ${C.bdr}`, background: C.sur, color: C.mut, fontSize: 14, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>Cancel</button>
          <button onClick={() => answer(true)} style={{ padding: "9px 22px", borderRadius: 9, border: "none", background: C.red, color: "white", fontSize: 14, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function SavedToast() {
  const [vis, setVis] = useState(false);
  const [msg, setMsg] = useState("Saved");
  const timer = useRef(null);
  useEffect(() => {
    // Doubles as the generic toast: triggerToast("Copied") passes a message,
    // plain triggerSaved() passes none and falls back to "Saved".
    _gkRefs.showSavedToast = (m) => { setMsg(typeof m === "string" && m ? m : "Saved"); setVis(true); clearTimeout(timer.current); timer.current = setTimeout(() => setVis(false), 1600); };
    return () => { _gkRefs.showSavedToast = null; clearTimeout(timer.current); };
  }, []);
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, background: C.sur, border: `1.5px solid ${C.moss}`,
      borderRadius: 10, padding: "9px 18px", fontSize: 14, color: C.moss, fontWeight: 700,
      boxShadow: C.shadowMd, display: "flex", alignItems: "center", gap: 7, zIndex: 99998,
      opacity: vis ? 1 : 0, transform: vis ? "translateY(0)" : "translateY(-12px)",
      transition: "opacity .25s, transform .25s", pointerEvents: "none",
    }}>
      <Icon name="check_circle" size={17} /> {msg}
    </div>
  );
}

/** Small persistent red banner shown when a write fails after one retry
 * (remote mode only). Wired via _gkRefs.setOffline, same pattern as the
 * confirm dialog / saved toast above. */
function OfflineIndicator() {
  const [offline, setOffline] = useState(false);
  useEffect(() => { _gkRefs.setOffline = setOffline; return () => { _gkRefs.setOffline = null; }; }, []);
  if (!offline) return null;
  return (
    <div style={{
      position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
      background: C.red, color: "#fff", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700,
      boxShadow: C.shadowMd, display: "flex", alignItems: "center", gap: 7, zIndex: 99998,
    }}>
      <Icon name="cloud_off" size={16} /> Offline — changes not saved
    </div>
  );
}

export { ConfirmDialog, SavedToast, OfflineIndicator };
