import React from 'react';
import { C, clearCurrentUser, isAdmin } from '../globals.js';
import { Icon, Avatar } from './shared.jsx';

const NAV_ITEMS = [
  { key: "library", label: "SOP Library", icon: "menu_book" },
  { key: "tasks", label: "Task Manager", icon: "checklist" },
];

function Sidebar({ section, setSection, user, onLogout }) {
  const items = [...NAV_ITEMS];
  if (isAdmin(user)) items.push({ key: "admin", label: "Admin Panel", icon: "tune" });

  return (
    <div style={{
      width: 232, flexShrink: 0, background: C.bg, borderRight: `1.5px solid ${C.bdr}`,
      display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0,
    }}>
      {/* Wordmark */}
      <div style={{ padding: "24px 20px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: C.moss, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon name="spa" size={20} style={{ color: "#fff" }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.txt, letterSpacing: -0.2, lineHeight: 1.15 }}>The Green Kiss</div>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>Ops</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map(it => {
          const active = section === it.key;
          return (
            <button key={it.key} onClick={() => setSection(it.key)}
              style={{
                display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9,
                border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                background: active ? C.mossSoft : "transparent",
                color: active ? C.moss : C.txt2, fontWeight: active ? 700 : 500, fontSize: 15,
                transition: "all .15s",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.s2; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon name={it.icon} size={20} style={{ color: active ? C.moss : C.faint }} />
              {it.label}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Current user + logout */}
      <div style={{ padding: 14, borderTop: `1.5px solid ${C.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={user?.name} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: C.mut, textTransform: "capitalize" }}>{user?.role}</div>
        </div>
        <button onClick={() => { clearCurrentUser(); onLogout(); }} title="Log out"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, padding: 6, borderRadius: 7, display: "flex" }}
          onMouseEnter={e => e.currentTarget.style.background = C.s2}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <Icon name="logout" size={19} />
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
