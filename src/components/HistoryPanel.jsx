import React, { useState, useEffect } from 'react';
import { C, fmtDate, getRevisions, getRevision, restoreRevision, confirmDelete, triggerSaved } from '../globals.js';
import { Btn, IconBtn, Icon } from './shared.jsx';

/* Version history — editor-only panel over an SOP's revisions.
   Remote mode: revisions_list/revision_get/revision_restore.
   Dev mode: the last 10 snapshots kept in localStorage "rev:"+sopId
   (see globals.js _devSnapshotIfChanged). Same shape either way, so this
   component doesn't need to know which mode it's in. */
function HistoryPanel({ sopId, onClose, onRestored }) {
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getRevisions(sopId)
      .then(list => { if (alive) setRevisions(list); })
      .catch(e => { if (alive) setError(e.message || "Could not load history."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sopId]);

  const openPreview = async (rev) => {
    setPreviewId(rev.id);
    setPreview(null);
    setError("");
    try {
      const full = await getRevision(sopId, rev.id);
      setPreview(full);
    } catch (e) {
      setError(e.message || "Could not load this version.");
    }
  };

  const doRestore = async () => {
    if (!preview) return;
    const ok = await confirmDelete(`Restore the version from ${fmtDate(preview.savedAt)}? Your current version is saved to history first, so nothing is lost.`);
    if (!ok) return;
    setRestoring(true);
    setError("");
    try {
      const restored = await restoreRevision(sopId, previewId);
      triggerSaved();
      onRestored && onRestored(restored);
    } catch (e) {
      setError(e.message || "Could not restore this version.");
    } finally {
      setRestoring(false);
    }
  };

  const blockCount = preview?.snapshot?.blocks?.length ?? 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,10,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 550, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="gk-fade-in" style={{
        background: C.sur, borderRadius: 16, border: `1.5px solid ${C.bdr}`, boxShadow: C.shadowMd,
        width: "100%", maxWidth: 640, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: `1.5px solid ${C.bdr}` }}>
          <Icon name="history" size={20} style={{ color: C.moss, marginRight: 10 }} />
          <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Version History</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 220, flexShrink: 0, borderRight: `1.5px solid ${C.bdr}`, overflowY: "auto", padding: 8 }}>
            {loading && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>Loading…</div>}
            {!loading && revisions.length === 0 && <div style={{ padding: 12, fontSize: 13, color: C.mut }}>No earlier versions yet — edits create one automatically.</div>}
            {revisions.map(r => (
              <button key={r.id} onClick={() => openPreview(r)} style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 8, border: "none",
                background: previewId === r.id ? C.mossSoft : "transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: 2,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: previewId === r.id ? C.moss : C.txt }}>{fmtDate(r.savedAt)}</div>
                <div style={{ fontSize: 12, color: C.mut }}>{r.savedBy || "Unknown"}</div>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: 20, overflowY: "auto" }}>
            {!previewId && <div style={{ fontSize: 14, color: C.mut }}>Pick a version on the left to preview it.</div>}
            {previewId && !preview && !error && <div style={{ fontSize: 14, color: C.mut }}>Loading preview…</div>}
            {preview && (
              <div>
                <div style={{ fontSize: 12, color: C.faint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{fmtDate(preview.savedAt)} · {preview.savedBy || "Unknown"}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.txt, marginBottom: 6 }}>{preview.snapshot?.title || "Untitled SOP"}</div>
                <div style={{ fontSize: 13, color: C.mut, marginBottom: 20, textTransform: "capitalize" }}>{blockCount} block{blockCount === 1 ? "" : "s"} · {preview.snapshot?.status || "draft"}</div>
                <Btn disabled={restoring} onClick={doRestore}>
                  <Icon name="restore" size={16} />{restoring ? "Restoring…" : "Restore this version"}
                </Btn>
              </div>
            )}
            {error && <div style={{ marginTop: 14, fontSize: 13, color: C.red, fontWeight: 600 }}>{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HistoryPanel;
