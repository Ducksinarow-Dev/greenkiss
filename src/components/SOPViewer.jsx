import React, { useState, useEffect } from 'react';
import {
  C, FONT_CAPS, getCategories, getUsers, getCurrentUser, fmtDate, fmtDateShort, nowISO, todayLocalISO, inp,
  getAcks, ackSop, isAckStale, triggerSaved,
  hasFillableBlocks, getTodayInstance, getInstances, addInstance, updateInstance, findBacklinks,
} from '../globals.js';
import { IconBtn, Btn, OBtn, Pill, Icon, SlideOver, MentionText } from './shared.jsx';

/* Instance-backed checklist (Phase 2) — checked state lives on the active
   fill-out Instance, not component state, so it survives navigation and
   feeds the per-document run history. With no active instance (nobody's
   started today's run yet) it renders as an inert preview. Locked (a
   completed or historical instance) is read-only. Print always reflects
   the actual instance state now that state is real, not session-only. */
function ChecklistViewerBlock({ block, instance, locked, onToggleCheck, hideFillHint }) {
  const items = block.items || [];
  if (!items.length) return null;
  const checkedMap = (instance && instance.values[block.id]) || {};
  const interactive = !!instance && !locked;
  return (
    <div style={{ margin: "0 0 20px" }}>
      {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>{block.title}</div>}

      <div className="gk-no-print" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => {
          const isChecked = !!checkedMap[it.id];
          return (
            <div key={it.id} role="checkbox" aria-checked={isChecked} tabIndex={interactive ? 0 : -1}
              onClick={() => interactive && onToggleCheck(block.id, it.id, !isChecked)}
              onKeyDown={e => { if (interactive && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggleCheck(block.id, it.id, !isChecked); } }}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: interactive ? "pointer" : "default", userSelect: "none", opacity: instance ? 1 : 0.55 }}>
              <div style={{
                width: 19, height: 19, borderRadius: 6, flexShrink: 0,
                border: `1.5px solid ${isChecked ? C.moss : C.bdr2}`, background: isChecked ? C.moss : C.sur,
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
              }}>
                {isChecked && <svg width="11" height="11" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <span style={{ fontSize: 15, color: isChecked ? C.mut : C.txt2, textDecoration: isChecked ? "line-through" : "none", opacity: isChecked ? 0.55 : 1, transition: "opacity .15s" }}>{it.text}</span>
            </div>
          );
        })}
        {!instance && !hideFillHint && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>Start today's run above to check items off.</div>
        )}
      </div>

      {/* Static print view — reflects the same checked state as the screen. */}
      <div className="gk-print-only">
        {items.map(it => (
          <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5, fontSize: 14 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>{checkedMap[it.id] ? "☑" : "☐"}</span>
            <span>{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Plain/bulleted/numbered list, optionally with a trailing "entry" blank
 * per line. With no active instance the entry (if any) shows the
 * template's own default value, read-only; inside an unlocked instance
 * it's a live input bound to that run's values. */
function ListViewerBlock({ block, instance, locked, onEntryChange, onNavigate }) {
  const items = block.items || [];
  if (!items.length) return null;
  const values = (instance && instance.values[block.id]) || null;
  const editable = block.withEntry && !!instance && !locked;
  return (
    <div style={{ margin: "0 0 20px" }}>
      {items.map((it, idx) => {
        const val = values ? (values[it.id] ?? "") : (it.value || "");
        return (
          <div key={it.id} style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 15, color: C.faint, flexShrink: 0, minWidth: 16 }}>{block.style === "numbered" ? `${idx + 1}.` : "•"}</span>
            <span style={{ fontSize: 15, color: C.txt2, flex: block.withEntry ? "0 0 auto" : 1 }}><MentionText text={it.text} onNavigate={onNavigate} /></span>
            {block.withEntry && (
              editable ? (
                <input value={val} onChange={e => onEntryChange(block.id, it.id, e.target.value)}
                  style={{ flex: 1, minWidth: 60, background: "transparent", border: "none", borderBottom: `1.5px solid ${C.bdrFocus}`, fontSize: 15, color: C.txt, outline: "none", fontFamily: "inherit", padding: "0 0 2px" }} />
              ) : (
                <span style={{ flex: 1, borderBottom: `1.5px solid ${C.bdr2}`, minWidth: 40, fontSize: 15, color: C.txt, paddingBottom: 1 }}>{val || " "}</span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Completion block — the only block whose fields don't exist until a run
 * is underway. No instance -> a prompt to start one. In-progress instance
 * -> Completed By/Date auto-filled from the session, Notes editable, a
 * Submit button that locks the whole instance. Completed/historical -> a
 * read-only summary of who/when/notes (Phase 2, "auto-fill + lock"). */
function CompletionViewerBlock({ block, instance, locked, onNotesChange, onSubmit }) {
  const users = getUsers();
  const nameFor = (id) => users.find(u => u.id === id)?.name || "—";
  if (!instance) {
    return (
      <div className="gk-no-print" style={{ margin: "8px 0 20px", padding: "16px 18px", border: `1.5px dashed ${C.bdr2}`, borderRadius: 12, color: C.mut, fontSize: 13 }}>
        Start today's run above to complete this section.
      </div>
    );
  }
  const values = instance.values[block.id] || {};
  if (locked) {
    return (
      <div style={{ margin: "8px 0 20px", padding: "16px 18px", background: C.mossSoft, border: `1.5px solid ${C.moss}55`, borderRadius: 12 }}>
        <div style={{ fontWeight: 700, color: C.moss, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><Icon name="task_alt" size={16} />Completed</div>
        <div style={{ fontSize: 14, color: C.txt2 }}>Completed By: {nameFor(instance.completedBy)}</div>
        <div style={{ fontSize: 14, color: C.txt2 }}>Date: {fmtDate(instance.completedAt)}</div>
        {values.notes && <div style={{ fontSize: 14, color: C.txt2, marginTop: 6, whiteSpace: "pre-wrap" }}>Notes: {values.notes}</div>}
      </div>
    );
  }
  const me = getCurrentUser();
  return (
    <div className="gk-no-print" style={{ margin: "8px 0 20px", padding: "16px 18px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12 }}>
      <div style={{ fontWeight: 700, color: C.txt, marginBottom: 10 }}>Completion</div>
      <div style={{ fontSize: 14, color: C.txt2, marginBottom: 6 }}>Completed By: <strong>{me?.name || "—"}</strong></div>
      <div style={{ fontSize: 14, color: C.txt2, marginBottom: 10 }}>Date: <strong>{fmtDate(nowISO())}</strong></div>
      <textarea value={values.notes || ""} onChange={e => onNotesChange(block.id, e.target.value)} placeholder="Notes…" rows={3}
        style={{ ...inp({ fontSize: 14, lineHeight: 1.6, minHeight: 64, marginBottom: 12 }) }} />
      <Btn onClick={() => onSubmit(block.id)}><Icon name="task_alt" size={15} />Mark Complete</Btn>
    </div>
  );
}

function ViewerBlock({ block, instance, locked, onToggleCheck, onEntryChange, onNotesChange, onSubmitCompletion, hideFillHint, onNavigate }) {
  if (block.type === "heading") {
    return (
      <div style={{ margin: "26px 0 10px" }}>
        <h2 style={{ fontSize: 21, fontWeight: 800, color: C.txt, margin: 0 }}>{block.text}</h2>
        {block.description && <p style={{ fontSize: 14, color: C.mut, margin: "6px 0 0", lineHeight: 1.6 }}><MentionText text={block.description} onNavigate={onNavigate} /></p>}
      </div>
    );
  }
  if (block.type === "list") {
    return <ListViewerBlock block={block} instance={instance} locked={locked} onEntryChange={onEntryChange} onNavigate={onNavigate} />;
  }
  if (block.type === "text") {
    if (!block.text) return null;
    return <p style={{ fontSize: 16, lineHeight: 1.75, color: C.txt2, whiteSpace: "pre-wrap", margin: "0 0 16px" }}><MentionText text={block.text} onNavigate={onNavigate} /></p>;
  }
  if (block.type === "checklist") {
    return <ChecklistViewerBlock block={block} instance={instance} locked={locked} onToggleCheck={onToggleCheck} hideFillHint={hideFillHint} />;
  }
  if (block.type === "completion") {
    return <CompletionViewerBlock block={block} instance={instance} locked={locked} onNotesChange={onNotesChange} onSubmit={onSubmitCompletion} />;
  }
  if (block.type === "links") {
    const links = block.links || [];
    if (!links.length) return null;
    return (
      <div style={{ margin: "0 0 20px" }}>
        {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>{block.title}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {links.map(l => (
            <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: C.moss, textDecoration: "none", fontWeight: 600 }}>
              <Icon name="open_in_new" size={15} />{l.label || l.url}
            </a>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "image") {
    if (!block.src) return null;
    return (
      <figure style={{ margin: "0 0 22px" }}>
        <img src={block.src} alt={block.caption || ""} style={{ maxWidth: "100%", borderRadius: 12, border: `1.5px solid ${C.bdr}`, display: "block" }} />
        {block.caption && <figcaption style={{ fontSize: 13, color: C.mut, marginTop: 8, textAlign: "center" }}>{block.caption}</figcaption>}
      </figure>
    );
  }
  return null;
}

/* Phase 6 #2: read acknowledgments. Any role can mark an SOP read; if the
   SOP has been updated since their last ack, the button flips to an amber
   re-confirm state instead of showing "Read on <date>". */
function ReadReceipts({ sop, user, onAcked }) {
  if (!user) return null;
  const acks = getAcks();
  const mine = (acks[sop.id] && acks[sop.id][user.id]) || null;
  const stale = isAckStale(mine, sop);

  const markRead = () => {
    ackSop(sop.id, user.id, sop.updatedAt);
    triggerSaved();
    onAcked && onAcked();
  };

  return (
    <div className="gk-no-print" style={{ marginTop: 28, paddingTop: 20, borderTop: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {mine && !stale && (
        <div style={{ fontSize: 13, color: C.moss, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="check_circle" size={16} />Read on {fmtDate(mine.at)}
        </div>
      )}
      {mine && stale && (
        <div style={{ fontSize: 13, color: C.orange, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, background: C.orange + "18", padding: "6px 12px", borderRadius: 8 }}>
          <Icon name="warning" size={16} />Updated since you last read — re-confirm
        </div>
      )}
      {(!mine || stale) && (
        <Btn onClick={markRead}><Icon name="task_alt" size={16} />Mark as read</Btn>
      )}
    </div>
  );
}

/** Editors/admins only — a compact roster of who's acked this SOP. */
function ReadByList({ sop }) {
  const acksForSop = getAcks()[sop.id] || {};
  const users = getUsers();
  const entries = Object.keys(acksForSop).map(userId => {
    const u = users.find(x => x.id === userId);
    const ack = acksForSop[userId];
    return { name: u?.name || "Unknown", at: ack.at, stale: isAckStale(ack, sop) };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  if (entries.length === 0) return null;
  return (
    <div className="gk-no-print" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>Read by ({entries.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.txt2 }}>
            <Icon name={e.stale ? "warning" : "check_circle"} size={14} style={{ color: e.stale ? C.orange : C.moss }} />
            {e.name} · {fmtDate(e.at)}{e.stale ? " — stale" : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Today's Run strip + history (Phase 2). Only shown for documents that
 * actually capture fill-state (checklist/list-with-entry/completion) —
 * reference-only docs (vendor directory, appendices) never show this and
 * behave exactly as a plain read-only document. */
function InstanceStrip({ instance, historyView, onStart, onContinueOther, onOpenHistory, nameFor }) {
  return (
    <div className="gk-no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18, padding: "12px 16px", background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 12 }}>
      {historyView ? (
        <>
          <Icon name="history" size={17} style={{ color: C.mut }} />
          <div style={{ fontSize: 13, color: C.txt2, flex: 1 }}>
            Viewing the run from {fmtDateShort(historyView.date)} — {historyView.status === "completed" ? `completed by ${nameFor(historyView.completedBy)}` : "in progress"}
          </div>
          <OBtn onClick={onContinueOther}>Back to current</OBtn>
        </>
      ) : instance ? (
        <>
          <Icon name={instance.status === "completed" ? "task_alt" : "pending_actions"} size={17} style={{ color: instance.status === "completed" ? C.moss : C.mut }} />
          <div style={{ fontSize: 13, color: C.txt2, flex: 1 }}>
            {instance.status === "completed"
              ? `Completed today by ${nameFor(instance.completedBy)}`
              : `Today's run in progress — started by ${nameFor(instance.startedBy)}`}
          </div>
          {instance.status === "completed" && <OBtn onClick={onStart}>Start another run today</OBtn>}
        </>
      ) : (
        <>
          <Icon name="today" size={17} style={{ color: C.mut }} />
          <div style={{ fontSize: 13, color: C.txt2, flex: 1 }}>No run started for today yet.</div>
          <Btn onClick={onStart}>Start Today's Run</Btn>
        </>
      )}
      <IconBtn icon="list_alt" title="Past runs" onClick={onOpenHistory} />
    </div>
  );
}

function RunsHistorySlideOver({ sop, onClose, onSelect, nameFor }) {
  const runs = getInstances(sop.id);
  return (
    <SlideOver title="Past Runs" icon="history" onClose={onClose}>
      {runs.length === 0 && <div style={{ fontSize: 13, color: C.mut }}>No runs yet.</div>}
      {runs.map(i => (
        <button key={i.id} onClick={() => onSelect(i)}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.bdr}`, background: C.sur, marginBottom: 8, cursor: "pointer", fontFamily: "inherit" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{fmtDate(i.date)}</div>
          <div style={{ fontSize: 12, color: C.mut }}>
            {i.status === "completed" ? `Completed by ${nameFor(i.completedBy)}` : `In progress — started by ${nameFor(i.startedBy)}`}
          </div>
        </button>
      ))}
    </SlideOver>
  );
}

/** "Referenced by" — every other document/playbook-section that mentions
 * this one, computed lazily at render time (no reverse index to maintain). */
function BacklinksList({ sop, onNavigate }) {
  const refs = findBacklinks(sop.kind === "form" ? "form" : "sop", sop.id);
  if (!refs.length) return null;
  return (
    <div className="gk-no-print" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", fontFamily: FONT_CAPS, letterSpacing: 0.4, marginBottom: 8 }}>Referenced by ({refs.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {refs.map(r => (
          <button key={r.kind + r.id} onClick={() => onNavigate && onNavigate(r.kind, r.id)}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.moss, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "fit-content" }}>
            <Icon name={r.kind === "playbook" ? "menu_book" : "description"} size={14} />{r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SOPViewer({ sop, user, canEditSop, onClose, onEdit, onNavigate }) {
  const categories = getCategories();
  const cat = categories.find(c => c.id === sop.categoryId);
  const printedOn = fmtDate(nowISO());
  // ReadReceipts and ReadByList both read getAcks() fresh on render, but
  // they're siblings — marking read only re-renders ReadReceipts itself,
  // so the editor-facing "Read by" list needs this to force its own
  // re-render too (bumped by ReadReceipts.onAcked).
  const [ackVersion, setAckVersion] = useState(0);

  const fillable = hasFillableBlocks(sop.blocks);
  const [instance, setInstance] = useState(() => fillable ? getTodayInstance(sop.id) : null);
  const [historyView, setHistoryView] = useState(null);
  const [showRuns, setShowRuns] = useState(false);
  useEffect(() => {
    setInstance(fillable ? getTodayInstance(sop.id) : null);
    setHistoryView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop.id]);

  const users = getUsers();
  const nameFor = (id) => users.find(u => u.id === id)?.name || "—";

  const activeInstance = historyView || instance;
  const locked = !!historyView || (!!instance && instance.status === "completed");
  const displayBlocks = activeInstance ? activeInstance.blocksSnapshot : sop.blocks;

  const startRun = () => {
    const created = addInstance({
      docId: sop.id, docKind: sop.kind || "sop", date: todayLocalISO(),
      blocksSnapshot: sop.blocks, startedBy: user?.id || "", startedAt: nowISO(),
      status: "in_progress",
    });
    setInstance(created);
    setHistoryView(null);
    triggerSaved();
  };
  const patchInstanceValues = (blockId, patch) => {
    if (!instance) return;
    const values = { ...instance.values, [blockId]: { ...(instance.values[blockId] || {}), ...patch } };
    setInstance({ ...instance, values });
    updateInstance(instance.id, { values });
  };
  const toggleCheck = (blockId, itemId, checked) => patchInstanceValues(blockId, { [itemId]: checked });
  const changeEntry = (blockId, itemId, text) => patchInstanceValues(blockId, { [itemId]: text });
  const changeNotes = (blockId, text) => patchInstanceValues(blockId, { notes: text });
  const submitCompletion = () => {
    if (!instance) return;
    const changes = { status: "completed", completedBy: user?.id || "", completedAt: nowISO() };
    setInstance({ ...instance, ...changes });
    updateInstance(instance.id, changes);
    triggerSaved();
  };

  return (
    <div className="gk-fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="gk-no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <IconBtn icon="arrow_back" title="Back to library" onClick={onClose} />
        <div style={{ flex: 1 }} />
        {canEditSop && <OBtn onClick={onEdit}><Icon name="edit" size={16} />Edit</OBtn>}
        <Btn onClick={() => window.print()}><Icon name="print" size={16} />Print / PDF</Btn>
      </div>

      {fillable && (
        <InstanceStrip instance={instance} historyView={historyView}
          onStart={startRun} onContinueOther={() => setHistoryView(null)}
          onOpenHistory={() => setShowRuns(true)} nameFor={nameFor} />
      )}

      <div className="gk-print-area" style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 16, padding: "36px 40px" }}>
        {/* Phase 6 QoL (d): print-only header — wordmark + title + printed-on date */}
        <div className="gk-print-only" style={{ marginBottom: 22, paddingBottom: 14, borderBottom: "1.5px solid #ccc" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: FONT_CAPS }}>The Green Kiss</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{sop.title || "Untitled SOP"}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Printed on {printedOn}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {cat && <Pill color={cat.color}>{cat.name}</Pill>}
          {sop.code && <Pill color={C.faint}>{sop.code}</Pill>}
          <Pill color={sop.status === "published" ? C.moss : sop.status === "archived" ? C.faint : C.faint}>
            {sop.status === "published" ? "Published" : sop.status === "archived" ? "Archived" : "Draft"}
          </Pill>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: C.txt, margin: "0 0 8px", letterSpacing: -0.4 }}>{sop.title || "Untitled SOP"}</h1>
        <div style={{ fontSize: 13, color: C.mut, marginBottom: 26 }}>
          Updated {fmtDate(sop.updatedAt)}{sop.updatedBy ? ` by ${sop.updatedBy}` : ""}
        </div>
        {(displayBlocks || []).length === 0 && <div style={{ color: C.mut, fontSize: 15 }}>This SOP has no content yet.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 24px" }}>
          {(displayBlocks || []).map(b => (
            <div key={b.id} style={{ flex: `0 0 calc(${b.width || 100}% - 24px)`, minWidth: 0 }}>
              <ViewerBlock block={b} instance={activeInstance} locked={locked}
                onToggleCheck={toggleCheck} onEntryChange={changeEntry} onNotesChange={changeNotes}
                onSubmitCompletion={submitCompletion} onNavigate={onNavigate} />
            </div>
          ))}
        </div>
      </div>

      <ReadReceipts sop={sop} user={user} onAcked={() => setAckVersion(v => v + 1)} />
      {canEditSop && <ReadByList key={ackVersion} sop={sop} />}
      <BacklinksList sop={sop} onNavigate={onNavigate} />

      {showRuns && (
        <RunsHistorySlideOver sop={sop} onClose={() => setShowRuns(false)} nameFor={nameFor}
          onSelect={(i) => { setHistoryView(i); setShowRuns(false); }} />
      )}
    </div>
  );
}

export default SOPViewer;
export { ViewerBlock };
