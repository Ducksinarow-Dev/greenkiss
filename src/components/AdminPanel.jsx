import React, { useState } from 'react';
import {
  C, getUsers, addUser, updateUser, deleteUser, getCategories, addCategory, updateCategory,
  deleteCategory, confirmDelete, triggerSaved, getCurrentUser, CATEGORY_COLORS, ROLE_LABELS, inp,
} from '../globals.js';
import { Btn, OBtn, IconBtn, Icon, Pill, SectionHeader, Avatar } from './shared.jsx';

/* ─── USERS ──────────────────────────────────────────────────────── */
function UserRow({ u, isSelf, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(u.name);
  const [pin, setPin] = useState(u.pin);
  const [role, setRole] = useState(u.role);

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: C.s2, borderRadius: 10, flexWrap: "wrap" }}>
        <input value={name} onChange={e => setName(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", flex: "1 1 140px" })} />
        <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" style={inp({ fontSize: 14, padding: "7px 10px", width: 90, flex: "0 0 auto", fontFamily: "'IBM Plex Mono',monospace" })} />
        <select value={role} onChange={e => setRole(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", width: "auto", flex: "0 0 auto" })}>
          {Object.keys(ROLE_LABELS).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <IconBtn icon="check" title="Save" onClick={() => { onUpdate({ name: name.trim() || u.name, pin: pin || u.pin, role }); setEditing(false); }} style={{ color: C.moss }} />
        <IconBtn icon="close" title="Cancel" onClick={() => { setName(u.name); setPin(u.pin); setRole(u.role); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10 }}
      onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <Avatar name={u.name} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{u.name}{isSelf && <span style={{ fontSize: 12, color: C.mut, fontWeight: 500 }}> (you)</span>}</div>
        <div style={{ fontSize: 12, color: C.mut, fontFamily: "'IBM Plex Mono',monospace" }}>PIN {"•".repeat(u.pin?.length || 4)}</div>
      </div>
      <Pill color={u.role === "admin" ? C.moss : u.role === "editor" ? "#5a7a9a" : C.faint}>{ROLE_LABELS[u.role] || u.role}</Pill>
      <IconBtn icon="edit" title="Edit" onClick={() => setEditing(true)} />
      {!isSelf && <IconBtn icon="delete" danger title="Remove user" onClick={onDelete} />}
    </div>
  );
}

function UsersPanel({ bump }) {
  const users = getUsers();
  const me = getCurrentUser();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("editor");

  const create = () => {
    if (!name.trim() || !pin.trim()) return;
    addUser({ name: name.trim(), pin: pin.trim(), role });
    triggerSaved();
    setName(""); setPin(""); setRole("editor"); setAdding(false); bump();
  };

  const removeUser = async (u) => {
    const ok = await confirmDelete(`Remove ${u.name}? They won't be able to log in anymore.`);
    if (!ok) return;
    deleteUser(u.id); triggerSaved(); bump();
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Users</div>
        <OBtn onClick={() => setAdding(a => !a)}><Icon name="person_add" size={16} />Add user</OBtn>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 8, padding: "12px 18px", background: C.bg, borderBottom: `1.5px solid ${C.bdr}`, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 140px" })} />
          <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" style={inp({ fontSize: 14, padding: "8px 11px", width: 100, flex: "0 0 auto", fontFamily: "'IBM Plex Mono',monospace" })} />
          <select value={role} onChange={e => setRole(e.target.value)} style={inp({ fontSize: 14, padding: "8px 11px", width: "auto", flex: "0 0 auto" })}>
            {Object.keys(ROLE_LABELS).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <Btn onClick={create} disabled={!name.trim() || !pin.trim()} style={{ padding: "8px 16px" }}>Create</Btn>
        </div>
      )}
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {users.map(u => <UserRow key={u.id} u={u} isSelf={me?.id === u.id}
          onUpdate={c => { updateUser(u.id, c); triggerSaved(); bump(); }}
          onDelete={() => removeUser(u)} />)}
        {users.length === 0 && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>No users.</div>}
      </div>
    </div>
  );
}

/* ─── CATEGORIES ─────────────────────────────────────────────────── */
function CategoryRow({ cat, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: C.s2, borderRadius: 10, flexWrap: "wrap" }}>
        <input value={name} onChange={e => setName(e.target.value)} style={inp({ fontSize: 14, padding: "7px 10px", flex: "1 1 140px" })} />
        <div style={{ display: "flex", gap: 5 }}>
          {CATEGORY_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: 99, background: c, border: color === c ? `2px solid ${C.txt}` : "2px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
        <IconBtn icon="check" title="Save" onClick={() => { onUpdate({ name: name.trim() || cat.name, color }); setEditing(false); }} style={{ color: C.moss }} />
        <IconBtn icon="close" title="Cancel" onClick={() => { setName(cat.name); setColor(cat.color); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10 }}
      onMouseEnter={e => e.currentTarget.style.background = C.s2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div style={{ width: 14, height: 14, borderRadius: 4, background: cat.color, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.txt }}>{cat.name}</div>
      <IconBtn icon="edit" title="Edit" onClick={() => setEditing(true)} />
      <IconBtn icon="delete" danger title="Delete category" onClick={onDelete} />
    </div>
  );
}

function CategoriesPanel({ bump }) {
  const categories = getCategories();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);

  const create = () => {
    if (!name.trim()) return;
    addCategory(name.trim(), color);
    triggerSaved();
    setName(""); setColor(CATEGORY_COLORS[0]); setAdding(false); bump();
  };
  const removeCategory = async (cat) => {
    const ok = await confirmDelete(`Delete "${cat.name}"? Any SOPs in this category will become uncategorized — they won't be deleted.`);
    if (!ok) return;
    deleteCategory(cat.id); triggerSaved(); bump();
  };

  return (
    <div style={{ background: C.sur, border: `1.5px solid ${C.bdr}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, flex: 1 }}>Categories</div>
        <OBtn onClick={() => setAdding(a => !a)}><Icon name="add" size={16} />Add category</OBtn>
      </div>
      {adding && (
        <div style={{ display: "flex", gap: 10, padding: "12px 18px", background: C.bg, borderBottom: `1.5px solid ${C.bdr}`, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" style={inp({ fontSize: 14, padding: "8px 11px", flex: "1 1 160px" })} />
          <div style={{ display: "flex", gap: 5 }}>
            {CATEGORY_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 99, background: c, border: color === c ? `2px solid ${C.txt}` : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
          <Btn onClick={create} disabled={!name.trim()} style={{ padding: "8px 16px" }}>Create</Btn>
        </div>
      )}
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        {categories.map(c => <CategoryRow key={c.id} cat={c}
          onUpdate={ch => { updateCategory(c.id, ch); triggerSaved(); bump(); }}
          onDelete={() => removeCategory(c)} />)}
        {categories.length === 0 && <div style={{ padding: "16px", fontSize: 14, color: C.mut }}>No categories.</div>}
      </div>
    </div>
  );
}

function AdminPanel() {
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh(r => r + 1);
  return (
    <div className="gk-fade-in">
      <SectionHeader title="Admin Panel" sub="Manage users and SOP categories" />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <UsersPanel bump={bump} />
        <CategoriesPanel bump={bump} />
      </div>
    </div>
  );
}

export default AdminPanel;
