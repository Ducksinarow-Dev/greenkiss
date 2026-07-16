import React, { useState, useEffect } from 'react';
import { C, getTheme, setTheme, getCurrentUser, clearCurrentUser, isAdmin, REMOTE_MODE, isRemoteWarm, remoteBootstrap } from './globals.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import MyDashboard from './components/MyDashboard.jsx';
import SOPLibrary from './components/SOPLibrary.jsx';
import TaskManager from './components/TaskManager.jsx';
import Projects from './components/Projects.jsx';
import ContentCalendar from './components/ContentCalendar.jsx';
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
  const [section, setSection] = useState("dashboard");
  const [sopFocus, setSopFocus] = useState(null); // {id, mode}
  const [projectFocus, setProjectFocus] = useState(null); // project id
  const [contentFocus, setContentFocus] = useState(null); // content item id

  // Theme toggle (#2): setTheme() mutates the shared C object + <html> dataset
  // in place — it doesn't trigger React re-renders on its own. themeVersion is
  // pure App-level state whose only job is forcing this re-render; since no
  // component here is memoized, one App re-render cascades through every
  // child and every inline style re-reads the freshly-mutated C values.
  const [themeVersion, setThemeVersion] = useState(0);
  const toggleTheme = () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
    setThemeVersion(v => v + 1);
  };

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
  const goToContent = (id) => { setContentFocus(id); setSection("calendar"); };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar section={section} setSection={s => { setSection(s); if (s !== "library") setSopFocus(null); if (s !== "projects") setProjectFocus(null); if (s !== "calendar") setContentFocus(null); }} user={user} onLogout={() => setUser(null)} onToggleTheme={toggleTheme} />
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: 1400, minWidth: 0 }}>
        {section === "dashboard" && <MyDashboard user={user} onOpenProject={goToProject} onOpenContent={goToContent} />}
        {section === "library" && (
          <SOPLibrary user={user} focusId={sopFocus?.id} focusMode={sopFocus?.mode} onClearFocus={() => setSopFocus(null)} />
        )}
        {section === "tasks" && <TaskManager user={user} onOpenSop={goToSop} />}
        {section === "projects" && <Projects user={user} onOpenSop={goToSop} focusProjectId={projectFocus} onClearFocus={() => setProjectFocus(null)} />}
        {section === "calendar" && <ContentCalendar user={user} focusItemId={contentFocus} onClearFocus={() => setContentFocus(null)} />}
        {section === "admin" && isAdmin(user) && <AdminPanel />}
      </div>
      <ConfirmDialog />
      <SavedToast />
      <OfflineIndicator />
    </div>
  );
}

export default App;
