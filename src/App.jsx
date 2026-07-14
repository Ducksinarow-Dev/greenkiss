import React, { useState } from 'react';
import { C, getCurrentUser, isAdmin } from './globals.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import SOPLibrary from './components/SOPLibrary.jsx';
import TaskManager from './components/TaskManager.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { ConfirmDialog, SavedToast } from './components/ConfirmDialog.jsx';

function App() {
  const [user, setUser] = useState(() => getCurrentUser());
  const [section, setSection] = useState("library");
  const [sopFocus, setSopFocus] = useState(null); // {id, mode}

  if (!user) {
    return <Login onLogin={() => setUser(getCurrentUser())} />;
  }

  const goToSop = (id) => { setSopFocus({ id, mode: "view" }); setSection("library"); };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar section={section} setSection={s => { setSection(s); if (s !== "library") setSopFocus(null); }} user={user} onLogout={() => setUser(null)} />
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: 1400, minWidth: 0 }}>
        {section === "library" && (
          <SOPLibrary user={user} focusId={sopFocus?.id} focusMode={sopFocus?.mode} onClearFocus={() => setSopFocus(null)} />
        )}
        {section === "tasks" && <TaskManager user={user} onOpenSop={goToSop} />}
        {section === "admin" && isAdmin(user) && <AdminPanel />}
      </div>
      <ConfirmDialog />
      <SavedToast />
    </div>
  );
}

export default App;
