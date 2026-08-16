import React, { useState } from 'react';
import {
  C, FONT_CAPS, canEdit, inp, uid, fmtDate,
  getUsers, getGroups,
  getClients, addClient, updateClient, deleteClient,
  getProducts, addProduct, updateProduct, deleteProduct,
  getWaitlist, addWaitlistEntry, updateWaitlistEntry, deleteWaitlistEntry, waitlistForProduct,
  getCallbacks, defCallback, addCallback, updateCallback,
  callbackTargetsUser, hasAckedCallback, ackCallback, getCallbackAcks,
  confirmDelete, triggerSaved, linkifyMagnets,
  copyMagnet, createTaskFromItem, taskPrefillFromItem, startCallbackForProduct,
} from '../globals.js';
import { Icon, Btn, OBtn, IconBtn, Pill, SectionHeader, EmptyState, Avatar, lbl, ItemLink, MentionText, onMagnetPaste, Segmented, Modal } from './shared.jsx';

/* Waitlist & Callbacks (Batch 4). Clients waitlist for out-of-stock products;
   when stock lands, ops logs a callback that alerts sales staff/group (see
   CallbackDelivery + the dashboard strip) to work the waitlist for that
   product and close it out. */

const clientName = (clients, id) => clients.find(c => c.id === id)?.name || "Unknown client";
const productName = (products, id) => products.find(p => p.id === id)?.name || "Unknown product";

/* ─── type-ahead picker: search existing OR create new inline ──────────
   Start typing → matching records autocomplete; if there's no match you can
   create one right there (which also adds it to the Clients & Products
   repository). `subFor(option)` optionally renders a dim sub-label (e.g. a
   product's waiting count). */
function TypeaheadAdd({ label, options, value, onChange, onCreate, placeholder, subFor }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);
  const q = query.trim().toLowerCase();
  const matches = (q ? options.filter(o => (o.name || "").toLowerCase().includes(q)) : options).slice(0, 6);
  const exact = options.find(o => (o.name || "").trim().toLowerCase() === q);
  const pick = (id) => { onChange(id); setQuery(""); setOpen(false); };
  const create = () => { const name = query.trim(); if (!name) return; const rec = onCreate(name); pick(rec.id); };

  if (selected) {
    return (
      <div>
        <label style={lbl()}>{label}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", border: `1.5px solid ${C.bdr}`, borderRadius: 9, background: C.inset }}>
          <Avatar name={selected.name} size={22} />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</span>
          <IconBtn icon="close" title="Change" onClick={() => onChange("")} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <label style={lbl()}>{label}</label>
      <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} style={inp()} />
      {open && (matches.length > 0 || (q && !exact)) && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, marginTop: 4, background: C.sur, border: `1.5px solid ${C.bdr2}`, borderRadius: 10, boxShadow: C.shadowMd, maxHeight: 240, overflowY: "auto", padding: 6 }}>
          {matches.map(o => {
            const sub = subFor && subFor(o);
            return (
              <button key={o.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(o.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 9px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <Avatar name={o.name} size={20} />
                <span style={{ flex: 1, fontSize: 14, color: C.txt }}>{o.name}</span>
                {sub && <span style={{ fontSize: 12, color: C.mut }}>{sub}</span>}
              </button>
            );
          })}
          {q && !exact && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={create}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 9px", background: "none", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: C.moss, fontWeight: 600 }}
              onMouseEnter={e => e.currentTarget.style.background = C.mossSoft} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <Icon name="add" size={16} />Create "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── links editor (for products) ──────────────────────────────────── */
function LinksEditor({ links, onChange }) {
  const set = (id, ch) => onChange(links.map(l => l.id === id ? { ...l, ...ch } : l));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {links.map(l => (
        <div key={l.id} style={{ display: "flex", gap: 6 }}>
          <input value={l.label} onChange={e => set(l.id, { label: e.target.value })} placeholder="Label" style={inp({ fontSize: 13, padding: "7px 9px", flex: "0 0 130px" })} />
          <input value={l.url} onChange={e => set(l.id, { url: e.target.value })} placeholder="https://…" style={inp({ fontSize: 13, padding: "7px 9px", flex: 1 })} />
          <IconBtn icon="close" title="Remove" onClick={() => onChange(links.filter(x => x.id !== l.id))} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...links, { id: uid(), label: "", url: "" }])}
        style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: C.moss, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
        <Icon name="add_link" size={15} />Add link
      </button>
    </div>
  );
}

/* ─── DIRECTORY tab (clients + products management) ────────────────── */
function DirectoryTab({ clients, products, bump }) {
  const [cName, setCName] = useState(""); const [cPhone, setCPhone] = useState(""); const [cEmail, setCEmail] = useState("");
  const [editClient, setEditClient] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [pName, setPName] = useState(""); const [pColl, setPColl] = useState("");

  const createClient = () => { if (!cName.trim()) return; addClient({ name: cName, phone: cPhone, email: cEmail }); triggerSaved(); setCName(""); setCPhone(""); setCEmail(""); bump(); };
  const createProduct = () => { if (!pName.trim()) return; addProduct({ name: pName, collection: pColl }); triggerSaved(); setPName(""); setPColl(""); bump(); };
  const removeClient = async (c) => { if (await confirmDelete(`Remove client "${c.name}"?`)) { deleteClient(c.id); triggerSaved(); bump(); } };
  const removeProduct = async (p) => { if (await confirmDelete(`Remove product "${p.name}"?`)) { deleteProduct(p.id); triggerSaved(); bump(); } };

  const panel = { background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" };
  const head = { padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, fontSize: 17, fontWeight: 800, color: C.txt };
  const addRow = { display: "flex", gap: 8, padding: "12px 18px", background: C.bg, borderBottom: `1.5px solid ${C.bdr}`, flexWrap: "wrap", alignItems: "center" };

  return (
    <div className="gk-admin-grid">
      <div style={panel}>
        <div style={head}>Clients</div>
        <div style={addRow}>
          <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 120px" })} />
          <input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Phone" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 100px" })} />
          <input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="Email" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 120px" })} />
          <Btn onClick={createClient} disabled={!cName.trim()} style={{ padding: "8px 16px" }}>Add</Btn>
        </div>
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {clients.length === 0 && <div style={{ padding: 14, fontSize: 14, color: C.mut }}>No clients yet.</div>}
          {clients.map(c => editClient === c.id ? (
            <ClientEditRow key={c.id} client={c} onSave={ch => { updateClient(c.id, ch); triggerSaved(); setEditClient(null); bump(); }} onCancel={() => setEditClient(null)} />
          ) : (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10 }}>
              <Avatar name={c.name} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.txt }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.mut }}>{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
              </div>
              <IconBtn icon="my_location" size={16} title="Copy magnet link to this client" onClick={() => copyMagnet("client", c.id)} />
              <IconBtn icon="add_task" size={16} title="Create a task about this client" onClick={() => createTaskFromItem(taskPrefillFromItem("client", c.id, c.name))} />
              <IconBtn icon="edit" title="Edit" onClick={() => setEditClient(c.id)} />
              <IconBtn icon="delete" danger title="Remove" onClick={() => removeClient(c)} />
            </div>
          ))}
        </div>
      </div>

      <div style={panel}>
        <div style={head}>Products</div>
        <div style={addRow}>
          <input value={pName} onChange={e => setPName(e.target.value)} placeholder="Product name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 140px" })} />
          <input value={pColl} onChange={e => setPColl(e.target.value)} placeholder="Collection (optional)" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 120px" })} />
          <Btn onClick={createProduct} disabled={!pName.trim()} style={{ padding: "8px 16px" }}>Add</Btn>
        </div>
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {products.length === 0 && <div style={{ padding: 14, fontSize: 14, color: C.mut }}>No products yet.</div>}
          {products.map(p => editProduct === p.id ? (
            <ProductEditRow key={p.id} product={p} onSave={ch => { updateProduct(p.id, ch); triggerSaved(); setEditProduct(null); bump(); }} onCancel={() => setEditProduct(null)} />
          ) : (
            <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.txt }}>{p.name}{p.collection && <span style={{ fontSize: 12, color: C.mut, fontWeight: 500 }}> · {p.collection}</span>}</div>
                {(p.links || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 3, fontSize: 12.5 }}>
                    {p.links.map(l => l.url && <ItemLink key={l.id} url={l.url}>{l.label || l.url}</ItemLink>)}
                  </div>
                )}
              </div>
              <IconBtn icon="my_location" size={16} title="Copy magnet link to this product" onClick={() => copyMagnet("product", p.id)} />
              <IconBtn icon="add_task" size={16} title="Create a task about this product" onClick={() => createTaskFromItem(taskPrefillFromItem("product", p.id, p.name))} />
              <IconBtn icon="notifications_active" size={16} title="Start a callback for this product" onClick={() => startCallbackForProduct(p.id)} />
              <IconBtn icon="edit" title="Edit" onClick={() => setEditProduct(p.id)} />
              <IconBtn icon="delete" danger title="Remove" onClick={() => removeProduct(p)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientEditRow({ client, onSave, onCancel }) {
  const [f, setF] = useState({ name: client.name, phone: client.phone || "", email: client.email || "" });
  return (
    <div style={{ display: "flex", gap: 6, padding: "9px 12px", background: C.s2, borderRadius: 10, flexWrap: "wrap" }}>
      <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={inp({ fontSize: 13, padding: "7px 9px", flex: "1 1 110px" })} />
      <input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="Phone" style={inp({ fontSize: 13, padding: "7px 9px", flex: "1 1 90px" })} />
      <input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="Email" style={inp({ fontSize: 13, padding: "7px 9px", flex: "1 1 110px" })} />
      <IconBtn icon="check" title="Save" onClick={() => onSave(f)} style={{ color: C.moss }} />
      <IconBtn icon="close" title="Cancel" onClick={onCancel} />
    </div>
  );
}
function ProductEditRow({ product, onSave, onCancel }) {
  const [f, setF] = useState({ name: product.name, collection: product.collection || "", links: product.links || [] });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 12px", background: C.s2, borderRadius: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={inp({ fontSize: 13, padding: "7px 9px", flex: "1 1 140px" })} />
        <input value={f.collection} onChange={e => setF({ ...f, collection: e.target.value })} placeholder="Collection" style={inp({ fontSize: 13, padding: "7px 9px", flex: "1 1 110px" })} />
        <IconBtn icon="check" title="Save" onClick={() => onSave(f)} style={{ color: C.moss }} />
        <IconBtn icon="close" title="Cancel" onClick={onCancel} />
      </div>
      <LinksEditor links={f.links} onChange={links => setF({ ...f, links })} />
    </div>
  );
}

/* ─── WAITLIST tab ─────────────────────────────────────────────────── */
function WaitlistTab({ clients, products, waitlist, editor, bump }) {
  const [adding, setAdding] = useState(false);
  const [clientId, setClientId] = useState(""); const [productId, setProductId] = useState(""); const [note, setNote] = useState("");
  const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  const [showFulfilled, setShowFulfilled] = useState(false);

  // When a client is chosen/created, seed the contact fields from their record
  // so the editor sees current details and can fill in what's missing (#45).
  React.useEffect(() => {
    if (!clientId) { setPhone(""); setEmail(""); return; }
    const c = clients.find(x => x.id === clientId);
    if (c) { setPhone(c.phone || ""); setEmail(c.email || ""); }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    if (!clientId || !productId) return;
    // Write contact details back to the client so the directory stays current
    // (only non-empty fields, so we never wipe existing data). #45
    const patch = {};
    if (phone.trim()) patch.phone = phone.trim();
    if (email.trim()) patch.email = email.trim();
    if (Object.keys(patch).length) updateClient(clientId, patch);
    addWaitlistEntry({ clientId, productId, note }); triggerSaved();
    setClientId(""); setProductId(""); setNote(""); setPhone(""); setEmail(""); setAdding(false); bump();
  };
  // Group active entries by product so demand is visible at a glance.
  const active = waitlist.filter(e => showFulfilled || !e.fulfilled);
  const byProduct = {};
  active.forEach(e => { (byProduct[e.productId] = byProduct[e.productId] || []).push(e); });
  const productIds = Object.keys(byProduct).sort((a, b) => byProduct[b].length - byProduct[a].length);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {editor && <Btn onClick={() => setAdding(a => !a)}><Icon name="add" size={16} />Add to waitlist</Btn>}
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.mut, cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={showFulfilled} onChange={e => setShowFulfilled(e.target.checked)} />Show fulfilled
        </label>
      </div>

      {adding && (
        <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 13, padding: 16, marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}><TypeaheadAdd label="Client" options={clients} value={clientId} onChange={setClientId} onCreate={name => addClient({ name })} placeholder="Type a client's name…" /></div>
            <div style={{ flex: "1 1 200px" }}><TypeaheadAdd label="Product" options={products} value={productId} onChange={setProductId} onCreate={name => addProduct({ name })} placeholder="Type a product name…" /></div>
          </div>
          {clientId && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label style={lbl()}>Phone (optional)</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Best number to reach them…" style={inp()} />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label style={lbl()}>Email (optional)</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email…" style={inp()} />
              </div>
            </div>
          )}
          <div>
            <label style={lbl()}>Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Size, colour, how to reach them…" style={inp()} />
          </div>
          {clientId && (phone.trim() || email.trim()) && (
            <div style={{ fontSize: 12, color: C.faint }}><Icon name="sync" size={12} style={{ verticalAlign: "-2px" }} /> Contact details will be saved to this client.</div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <OBtn onClick={() => setAdding(false)}>Cancel</OBtn>
            <Btn onClick={create} disabled={!clientId || !productId}>Add</Btn>
          </div>
        </div>
      )}

      {productIds.length === 0 ? (
        <EmptyState icon="support_agent" title="Waitlist is empty" sub="Add a client waiting on an out-of-stock product; when it arrives, log a callback to work the list." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {productIds.map(pid => (
            <div key={pid} style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 13, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.txt, flex: 1 }}>{productName(products, pid)}</div>
                <Pill color={C.clay}>{byProduct[pid].length} waiting</Pill>
              </div>
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                {byProduct[pid].map(e => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, opacity: e.fulfilled ? 0.55 : 1 }}>
                    <Avatar name={clientName(clients, e.clientId)} size={24} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, textDecoration: e.fulfilled ? "line-through" : "none" }}>{clientName(clients, e.clientId)}</div>
                      {(() => { const c = clients.find(x => x.id === e.clientId); const contact = [c?.phone, c?.email].filter(Boolean).join(" · "); return contact ? <div style={{ fontSize: 12, color: C.mut }}>{contact}</div> : null; })()}
                      {e.note && <div style={{ fontSize: 12, color: C.mut }}><MentionText text={linkifyMagnets(e.note)} /></div>}
                    </div>
                    {editor && (
                      <>
                        <button type="button" onClick={() => { updateWaitlistEntry(e.id, { fulfilled: !e.fulfilled, fulfilledAt: e.fulfilled ? null : new Date().toISOString() }); triggerSaved(); bump(); }}
                          title={e.fulfilled ? "Mark as still waiting" : "Mark fulfilled"}
                          style={{ background: "none", border: "none", cursor: "pointer", color: e.fulfilled ? C.moss : C.mut, display: "flex", padding: 4 }}>
                          <Icon name={e.fulfilled ? "check_circle" : "radio_button_unchecked"} size={19} />
                        </button>
                        <IconBtn icon="delete" danger title="Remove" onClick={() => { deleteWaitlistEntry(e.id); triggerSaved(); bump(); }} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── CALLBACKS tab ────────────────────────────────────────────────── */
function CallbackForm({ user, products, users, groups, onClose, onSaved, initialProductId }) {
  const [draft, setDraft] = useState(() => ({ ...defCallback(user), productId: initialProductId || "" }));
  const set = (ch) => setDraft(d => ({ ...d, ...ch }));
  const toggle = (field, id) => set({ [field]: draft[field].includes(id) ? draft[field].filter(x => x !== id) : [...draft[field], id] });
  const save = () => {
    if (!draft.productId) return;
    if (draft.assigneeIds.length === 0 && draft.groupIds.length === 0) return;
    addCallback(draft); triggerSaved(); onSaved(); onClose();
  };
  const chip = (on, color, labelText, onClick, keyId) => (
    <button key={keyId} type="button" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, cursor: "pointer", border: `1.5px solid ${on ? (color || C.moss) : C.bdr}`, background: on ? C.s2 : C.sur, color: on ? C.txt : C.mut, fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
      {color && <span style={{ width: 9, height: 9, borderRadius: 99, background: color, opacity: on ? 1 : 0.4 }} />}{labelText}
    </button>
  );
  return (
    <Modal onClose={onClose} scrim={0.4} zIndex={620} cardStyle={{ maxWidth: 520, maxHeight: "90vh", overflowY: "auto", padding: 26, display: "flex", flexDirection: "column", gap: 15 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.txt, flex: 1 }}>New callback</div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        <TypeaheadAdd label="Product that arrived" options={products} value={draft.productId}
          onChange={id => set({ productId: id })} onCreate={name => addProduct({ name })}
          placeholder="Type a product name…"
          subFor={p => { const n = waitlistForProduct(p.id).filter(e => !e.fulfilled).length; return n ? `${n} waiting` : ""; }} />
        <div>
          <label style={lbl()}>Assign to staff</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{users.map(u => chip(draft.assigneeIds.includes(u.id), null, u.name, () => toggle("assigneeIds", u.id), u.id))}</div>
        </div>
        <div>
          <label style={lbl()}>…and/or groups</label>
          {groups.length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>No groups yet.</div> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{groups.map(g => chip(draft.groupIds.includes(g.id), g.color, g.name, () => toggle("groupIds", g.id), g.id))}</div>
          )}
        </div>
        <div>
          <label style={lbl()}>Note (optional)</label>
          <input value={draft.note} onChange={e => set({ note: e.target.value })} onPaste={e => onMagnetPaste(e, draft.note || "", v => set({ note: v }))} placeholder="How many arrived, hold policy…" style={inp()} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, position: "sticky", bottom: 0, margin: "0 -26px -26px", padding: "16px 26px", background: C.sur, borderTop: `1.5px solid ${C.bdr}`, zIndex: 3 }}>
          <OBtn onClick={onClose}>Cancel</OBtn>
          <Btn onClick={save} disabled={!draft.productId || (draft.assigneeIds.length === 0 && draft.groupIds.length === 0)}>Create &amp; alert</Btn>
        </div>
    </Modal>
  );
}

function CallbackDetail({ callback, user, clients, products, users, groups, editor, onClose, bump }) {
  const entries = waitlistForProduct(callback.productId);
  const acks = getCallbackAcks()[callback.id] || {};
  const targeted = callbackTargetsUser(callback, user);
  const acked = hasAckedCallback(callback.id, user.id);
  const assignees = (callback.assigneeIds || []).map(id => users.find(u => u.id === id)).filter(Boolean);
  const grps = (callback.groupIds || []).map(id => groups.find(g => g.id === id)).filter(Boolean);
  const remaining = entries.filter(e => !e.fulfilled).length;

  return (
    <Modal onClose={onClose} scrim={0.4} zIndex={620} cardStyle={{ maxWidth: 540, maxHeight: "90vh", overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.txt }}>{productName(products, callback.productId)}</div>
            <div style={{ fontSize: 13, color: C.mut, marginTop: 3 }}>Logged by {callback.createdByName || "someone"} · {fmtDate(callback.createdAt)}</div>
          </div>
          <Pill color={callback.status === "done" ? C.moss : C.clay}>{callback.status === "done" ? "Closed" : `${remaining} to call`}</Pill>
          <IconBtn icon="my_location" size={16} title="Copy magnet link to this callback" onClick={() => copyMagnet("callback", callback.id)} />
          <IconBtn icon="add_task" size={16} title="Create a task from this callback" onClick={() => createTaskFromItem(taskPrefillFromItem("callback", callback.id, productName(products, callback.productId)))} />
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>
        {callback.note && <div style={{ fontSize: 13.5, color: C.txt2, background: C.bg, border: `1.5px solid ${C.bdr}`, borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-wrap" }}><MentionText text={linkifyMagnets(callback.note)} /></div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.mut }}>For:</span>
          {assignees.map(u => <span key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: C.txt2 }}><Avatar name={u.name} size={18} />{u.name}{acks[u.id] && <Icon name="check" size={13} style={{ color: C.moss }} />}</span>)}
          {grps.map(g => <Pill key={g.id} color={g.color}>{g.name}</Pill>)}
        </div>

        {targeted && !acked && callback.status !== "done" && (
          <Btn onClick={() => { ackCallback(callback.id, user.id); triggerSaved(); bump(); }}><Icon name="check" size={16} />Acknowledge</Btn>
        )}

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.mut, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_CAPS, marginBottom: 8 }}>Waitlist for this product</div>
          {entries.length === 0 ? <div style={{ fontSize: 13, color: C.faint }}>Nobody is on the waitlist for this product.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {entries.map(e => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, background: e.fulfilled ? "transparent" : C.bg, opacity: e.fulfilled ? 0.55 : 1 }}>
                  <Avatar name={clientName(clients, e.clientId)} size={24} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, textDecoration: e.fulfilled ? "line-through" : "none" }}>{clientName(clients, e.clientId)}</div>
                    <div style={{ fontSize: 12, color: C.mut }}>{[clients.find(c => c.id === e.clientId)?.phone, clients.find(c => c.id === e.clientId)?.email, e.note].filter(Boolean).join(" · ")}</div>
                  </div>
                  {editor && (
                    <button type="button" onClick={() => { updateWaitlistEntry(e.id, { fulfilled: !e.fulfilled, fulfilledAt: e.fulfilled ? null : new Date().toISOString() }); triggerSaved(); bump(); }}
                      title={e.fulfilled ? "Mark as still waiting" : "Mark called"}
                      style={{ background: "none", border: "none", cursor: "pointer", color: e.fulfilled ? C.moss : C.mut, display: "flex", padding: 4 }}>
                      <Icon name={e.fulfilled ? "check_circle" : "radio_button_unchecked"} size={20} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {editor && callback.status !== "done" && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: `1.5px solid ${C.bdr}`, position: "sticky", bottom: 0, margin: "0 -24px -24px", padding: "14px 24px", background: C.sur, zIndex: 3 }}>
            <Btn onClick={() => { updateCallback(callback.id, { status: "done", doneAt: new Date().toISOString() }); triggerSaved(); bump(); onClose(); }}><Icon name="check" size={16} />Close callback</Btn>
          </div>
        )}
    </Modal>
  );
}

function CallbacksTab({ user, clients, products, callbacks, users, groups, editor, bump, focusId, onClearFocus, startProductId, onConsumeStart }) {
  const [creating, setCreating] = useState(false);
  const [startProduct, setStartProduct] = useState(null);
  const [openId, setOpenId] = useState(focusId || null);
  React.useEffect(() => { if (focusId) { setOpenId(focusId); onClearFocus && onClearFocus(); } }, [focusId, onClearFocus]);
  // #47: a product row asked to start a callback pre-targeting that product.
  React.useEffect(() => { if (startProductId) { setStartProduct(startProductId); setCreating(true); onConsumeStart && onConsumeStart(); } }, [startProductId, onConsumeStart]);
  const [showDone, setShowDone] = useState(false);
  const list = callbacks.filter(c => showDone || c.status !== "done");
  const openCb = openId && callbacks.find(c => c.id === openId);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {editor && <Btn onClick={() => setCreating(true)}><Icon name="add" size={16} />New callback</Btn>}
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.mut, cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Show closed
        </label>
      </div>
      {list.length === 0 ? (
        <EmptyState icon="notifications_active" title="No callbacks" sub={editor ? "When a waitlisted product arrives, log a callback to alert the floor and work the list." : "Callbacks assigned to you will show up here and on your dashboard."} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map(c => {
            const remaining = waitlistForProduct(c.productId).filter(e => !e.fulfilled).length;
            const mine = callbackTargetsUser(c, user);
            const acked = hasAckedCallback(c.id, user.id);
            return (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)}
                style={{ textAlign: "left", background: C.sur, border: `1.5px solid ${mine && !acked && c.status !== "done" ? C.clay : C.bdr}`, borderRadius: 13, padding: "14px 16px", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12 }}>
                <Icon name="inventory_2" size={20} style={{ color: C.moss, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.txt }}>{productName(products, c.productId)}</div>
                  <div style={{ fontSize: 12.5, color: C.mut, marginTop: 2 }}>Logged by {c.createdByName || "someone"} · {fmtDate(c.createdAt)}</div>
                </div>
                {mine && !acked && c.status !== "done" && <Pill color={C.clay}>New for you</Pill>}
                <Pill color={c.status === "done" ? C.moss : C.txt2}>{c.status === "done" ? "Closed" : `${remaining} to call`}</Pill>
              </button>
            );
          })}
        </div>
      )}
      {creating && <CallbackForm user={user} products={products} users={users} groups={groups} initialProductId={startProduct} onClose={() => { setCreating(false); setStartProduct(null); }} onSaved={bump} />}
      {openCb && <CallbackDetail callback={openCb} user={user} clients={clients} products={products} users={users} groups={groups} editor={editor} onClose={() => setOpenId(null)} bump={bump} />}
    </div>
  );
}

const TABS = [{ key: "waitlist", label: "Waitlist" }, { key: "callbacks", label: "Callbacks" }, { key: "directory", label: "Clients & Products" }];

function Waitlist({ user, focusCallbackId, onClearFocus, newCallbackProductId, onConsumeNewCallback }) {
  const editor = canEdit(user);
  const [tab, setTab] = useState(focusCallbackId || newCallbackProductId ? "callbacks" : "waitlist");
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);
  // #47: a product row elsewhere asked to open the New Callback form here.
  React.useEffect(() => { if (newCallbackProductId) setTab("callbacks"); }, [newCallbackProductId]);

  const clients = getClients();
  const products = getProducts();
  const waitlist = getWaitlist();
  const callbacks = getCallbacks();
  const users = getUsers();
  const groups = getGroups();

  return (
    <div className="gk-fade-in">
      <SectionHeader title="Waitlist & Callbacks" sub="Track who's waiting on out-of-stock products, and work the list when stock lands"
        right={<Segmented options={TABS} value={tab} onChange={setTab}
          btnStyle={{ padding: "8px 15px", borderRadius: 8, fontSize: 12.5, letterSpacing: "0.05em" }} />} />

      {tab === "waitlist" && <WaitlistTab clients={clients} products={products} waitlist={waitlist} editor={editor} bump={bump} />}
      {tab === "callbacks" && <CallbacksTab user={user} clients={clients} products={products} callbacks={callbacks} users={users} groups={groups} editor={editor} bump={bump} focusId={focusCallbackId} onClearFocus={onClearFocus} startProductId={newCallbackProductId} onConsumeStart={onConsumeNewCallback} />}
      {tab === "directory" && <DirectoryTab clients={clients} products={products} bump={bump} />}
    </div>
  );
}

export default Waitlist;
