import React, { useState, useEffect } from 'react';
import { C, getTheme, setTheme, getCurrentUser, clearCurrentUser, isAdmin, REMOTE_MODE, isRemoteWarm, remoteBootstrap, getSOP } from './globals.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import MyDashboard from './components/MyDashboard.jsx';
import SOPLibrary from './components/SOPLibrary.jsx';
import OperationsPlaybook from './components/OperationsPlaybook.jsx';
import ImageRepository from './components/ImageRepository.jsx';
import ToolsPromptsRepository from './components/ToolsPromptsRepository.jsx';
import TaskManager from './components/TaskManager.jsx';
import Projects from './components/Projects.jsx';
import ContentCalendar from './components/ContentCalendar.jsx';
import StoreUpdate from './components/StoreUpdate.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { ConfirmDialog, SavedToast, OfflineIndicator } from './components/ConfirmDialog.jsx';
import LoginReminders from './components/LoginReminders.jsx';

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
  const [sopFocus, setSopFocus] = useState(null); // {id, mode, blockId, subId}
  const [projectFocus, setProjectFocus] = useState(null); // project id
  const [contentFocus, setContentFocus] = useState(null); // content item id
  const [playbookFocus, setPlaybookFocus] = useState(null); // playbook section id
  const [taskFocus, setTaskFocus] = useState(null); // task id (magnet deep-link)

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

  // Routes to the SOP Library or the Forms section depending on the
  // target document's own `kind` — so a mention/backlink click lands in
  // the right nav section without the caller needing to know which.
  const goToSop = (id, blockId) => {
    const doc = getSOP(id);
    setSopFocus({ id, mode: "view", blockId: blockId || null });
    setSection(doc && doc.kind === "form" ? "forms" : "library");
  };
  const goToProject = (id) => { setProjectFocus(id); setSection("projects"); };
  // Dashboard "My Forms" deep-link (R4 E): open one submission in fill mode.
  const goToSubmission = (docId, subId) => { setSopFocus({ id: docId, mode: "view", blockId: null, subId }); setSection("forms"); };
  const goToContent = (id) => { setContentFocus(id); setSection("calendar"); };
  const goToPlaybookSection = (id) => { setPlaybookFocus(id); setSection("playbook"); };
  const goToTask = (id) => { setTaskFocus(id); setSection("tasks"); };
  // Shared by both SOPLibrary mounts (library/forms) as onNavigateOut — a
  // mention/magnet pointing at the other kind, a Playbook section, or a task.
  const onNavigateOut = (kind, id, blockId) => {
    if (kind === "playbook") goToPlaybookSection(id);
    else if (kind === "task") goToTask(id);
    else goToSop(id, blockId);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar section={section} setSection={s => { setSection(s); if (s !== "library" && s !== "forms") setSopFocus(null); if (s !== "projects") setProjectFocus(null); if (s !== "calendar") setContentFocus(null); if (s !== "playbook") setPlaybookFocus(null); }} user={user} onLogout={() => setUser(null)} onToggleTheme={toggleTheme} />
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: 1400, minWidth: 0 }}>
        {section === "dashboard" && <MyDashboard user={user} onOpenProject={goToProject} onOpenContent={goToContent} onOpenSubmission={goToSubmission} onNavigateOut={onNavigateOut} onOpenStore={() => setSection("store")} />}
        {section === "store" && <StoreUpdate user={user} />}
        {section === "library" && (
          <SOPLibrary user={user} kind="sop" focusId={sopFocus?.id} focusMode={sopFocus?.mode} focusBlockId={sopFocus?.blockId} onClearFocus={() => setSopFocus(null)} onNavigateOut={onNavigateOut} onOpenTasks={() => setSection("tasks")} />
        )}
        {section === "forms" && (
          <SOPLibrary user={user} kind="form" focusId={sopFocus?.id} focusMode={sopFocus?.mode} focusBlockId={sopFocus?.blockId} focusSubId={sopFocus?.subId} onClearFocus={() => setSopFocus(null)} onNavigateOut={onNavigateOut} onOpenTasks={() => setSection("tasks")} />
        )}
        {section === "imagerepo" && <ImageRepository user={user} />}
        {section === "toolsprompts" && <ToolsPromptsRepository user={user} onOpenSop={goToSop} onNavigateOut={onNavigateOut} />}
        {section === "playbook" && (
          <OperationsPlaybook user={user} focusSectionId={playbookFocus} onClearFocus={() => setPlaybookFocus(null)} onNavigateSop={goToSop} onNavigateOut={onNavigateOut} />
        )}
        {section === "tasks" && <TaskManager user={user} onOpenSop={goToSop} focusTaskId={taskFocus} onClearFocus={() => setTaskFocus(null)} onNavigateOut={onNavigateOut} />}
        {section === "projects" && <Projects user={user} onOpenSop={goToSop} focusProjectId={projectFocus} onClearFocus={() => setProjectFocus(null)} />}
        {section === "calendar" && <ContentCalendar user={user} focusItemId={contentFocus} onClearFocus={() => setContentFocus(null)} onOpenSop={goToSop} onNavigateOut={onNavigateOut} />}
        {section === "admin" && isAdmin(user) && <AdminPanel />}
      </div>
      <ConfirmDialog />
      <SavedToast />
      <OfflineIndicator />
      <LoginReminders user={user} onOpenTasks={() => setSection("tasks")} onOpenTask={goToTask} />
    </div>
  );
}

export default App;
