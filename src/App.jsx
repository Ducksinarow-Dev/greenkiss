import React, { useState, useEffect } from 'react';
import { C, getCurrentUser, clearCurrentUser, isAdmin, REMOTE_MODE, isRemoteWarm, remoteBootstrap } from './globals.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import SOPLibrary from './components/SOPLibrary.jsx';
import TaskManager from './components/TaskManager.jsx';
import Projects from './components/Projects.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { ConfirmDialog, SavedToast, OfflineIndicator } from './components/ConfirmDialog.jsx';

function BootScreen() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 34, height: 34, border: `3px solid ${C.bdr}`, borderTopColor: C.moss, borderRadius: "50%", animation: "gkspin .7s linear infinite" }} />
      <div style={{ fontSize: 13, color: C.mut }}>Loading The Green Kiss…</div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => getCurrentUser());
  const [booting, setBooting] = useState(() => REMOTE_MODE && !!getCurrentUser() && !isRemoteWarm());
  const [section, setSection] = useState("library");
  const [sopFocus, setSopFocus] = useState(null); // {id, mode}
  const [projectFocus, setProjectFocus] = useState(null); // project id

  // Page reload with an existing remote session: the token/user survive in
  // sessionStorage but the in-memory kv cache doesn't, so warm it before
  // rendering anything that reads db.getSync().
  useEffect(() => {
    if (!booting) return;
    let alive = true;
    remoteBootstrap().catch(() => {
      clearCurrentUser();
      if (alive) setUser(null);
    }).finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, [booting]);

  if (!user) {
    return <Login onLogin={() => { setUser(getCurrentUser()); setBooting(false); }} />;
  }
  if (booting) return <BootScreen />;

  const goToSop = (id) => { setSopFocus({ id, mode: "view" }); setSection("library"); };
  const goToProject = (id) => { setProjectFocus(id); setSection("projects"); };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar section={section} setSection={s => { setSection(s); if (s !== "library") setSopFocus(null); if (s !== "projects") setProjectFocus(null); }} user={user} onLogout={() => setUser(null)} />
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: 1400, minWidth: 0 }}>
        {section === "library" && (
          <SOPLibrary user={user} focusId={sopFocus?.id} focusMode={sopFocus?.mode} onClearFocus={() => setSopFocus(null)} />
        )}
        {section === "tasks" && <TaskManager user={user} onOpenSop={goToSop} />}
        {section === "projects" && <Projects user={user} onOpenSop={goToSop} focusProjectId={projectFocus} onClearFocus={() => setProjectFocus(null)} />}
        {section === "admin" && isAdmin(user) && <AdminPanel />}
      </div>
      <ConfirmDialog />
      <SavedToast />
      <OfflineIndicator />
    </div>
  );
}

export default App;
