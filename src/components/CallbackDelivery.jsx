import React, { useState, useEffect } from 'react';
import {
  C, REMOTE_MODE, refreshCache,
  openCallbacksForUser, hasAckedCallback, ackCallback, getProducts, triggerSaved,
} from '../globals.js';
import { Icon, Btn } from './shared.jsx';

/* Callback alerts (Batch 4). Sits alongside the other delivery surfaces in
   App: any open callback aimed at the current user (named or via a group)
   that they haven't acknowledged shows as a must-acknowledge toast — it only
   goes away once they Acknowledge (or open it). A gentle poll pulls
   freshly-logged callbacks into an already-open app. */
function Toast({ cb, productName, onAck, onOpen }) {
  return (
    <div className="gk-fade-in" style={{ background: C.sur, border: `1.5px solid ${C.clay}`, borderRadius: 13, boxShadow: C.shadowMd, padding: "13px 15px", width: 330 }}>
      <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
        <Icon name="inventory_2" size={17} style={{ color: C.clay }} />
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Stock in — call your waitlist</div>
      </div>
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.45 }}>
        <b>{productName}</b> has arrived{cb.note ? ` — ${cb.note}` : ""}.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn onClick={onAck} style={{ padding: "7px 14px", fontSize: 12.5 }}><Icon name="check" size={15} />Acknowledge</Btn>
        <button type="button" onClick={onOpen} style={{ background: "none", border: "none", cursor: "pointer", color: C.moss, fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" }}>Work the list →</button>
      </div>
    </div>
  );
}

function CallbackDelivery({ user, onOpen }) {
  const [, force] = useState(0);
  const rerender = () => force(n => n + 1);

  useEffect(() => {
    const t = setInterval(() => {
      if (REMOTE_MODE) refreshCache().then(rerender).catch(() => {});
      else rerender();
    }, 60000);
    return () => clearInterval(t);
  }, []);

  const products = getProducts();
  const productName = (id) => products.find(p => p.id === id)?.name || "A product";
  const pending = openCallbacksForUser(user).filter(c => !hasAckedCallback(c.id, user.id)).slice(0, 3);
  if (pending.length === 0) return null;

  const ack = (c) => { ackCallback(c.id, user.id); triggerSaved(); rerender(); };
  return (
    <div style={{ position: "fixed", top: 18, right: 18, zIndex: 715, display: "flex", flexDirection: "column", gap: 10 }}>
      {pending.map(c => (
        <Toast key={c.id} cb={c} productName={productName(c.productId)}
          onAck={() => ack(c)} onOpen={() => onOpen && onOpen(c.id)} />
      ))}
    </div>
  );
}

export default CallbackDelivery;
