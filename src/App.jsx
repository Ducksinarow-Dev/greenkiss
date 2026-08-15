import React, { useState, useEffect } from 'react';
import { C, getTheme, setTheme, getCurrentUser, clearCurrentUser, isAdmin, REMOTE_MODE, isRemoteWarm, remoteBootstrap, refreshCache, getSOP, sectionsForUser, chatPoll, setMagnetNav, setTaskCreator, setCallbackStarter, chatOpenDM, refreshPresence } from './globals.js';
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
import Announcements from './components/Announcements.jsx';
import Waitlist from './components/Waitlist.jsx';
import Chat from './components/Chat.jsx';
import { ConfirmDialog, SavedToast, OfflineIndicator } from './components/ConfirmDialog.jsx';
import LoginReminders from './components/LoginReminders.jsx';
import AnnouncementDelivery from './components/AnnouncementDelivery.jsx';
import CallbackDelivery from './components/CallbackDelivery.jsx';
import ChatDelivery from './components/ChatDelivery.jsx';
import ChatDock from './components/ChatDock.jsx';
import GlobalSearch from './components/GlobalSearch.jsx';

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
  const [sectionRaw, setSection] = useState("dashboard");
  const [sopFocus, setSopFocus] = useState(null); // {id, mode, blockId, subId}
  const [projectFocus, setProjectFocus] = useState(null); // project id
  const [contentFocus, setContentFocus] = useState(null); // content item id
  const [campaignFocus, setCampaignFocus] = useState(null); // campaign id (dashboard → calendar filter)
  const [playbookFocus, setPlaybookFocus] = useState(null); // playbook section id
  const [taskFocus, setTaskFocus] = useState(null); // task id (magnet deep-link)
  const [callbackFocus, setCallbackFocus] = useState(null); // callback id (toast/dashboard deep-link)
  const [chatUnread, setChatUnread] = useState(0); // total unread chat messages, for the sidebar badge
  const [newTaskPrefill, setNewTaskPrefill] = useState(null); // {title, description} to open a prefilled new task (act-from-item, #47)
  const [newCallbackProduct, setNewCallbackProduct] = useState(null); // productId to open a prefilled New Callback (act-from-item, #47)
  const [chatFocus, setChatFocus] = useState(null); // channel id to open (from a chat toast / dashboard strip)

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

  // The kv cache is warmed once at login and never again, so a tab left open
  // all day builds its writes from an ever-staler view of the data — which is
  // what makes any whole-value write dangerous. Re-pull when this tab regains
  // focus, then force a re-render the same way themeVersion does. A state bump
  // rather than a remount, so edit mode, scroll position and open editors all
  // survive the refresh.
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    if (!REMOTE_MODE) return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      refreshCache().then(ok => { if (ok) setDataVersion(v => v + 1); }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Background chat-unread poll feeding the sidebar badge (Phase 1). Only runs
  // for users who can see the Chat section; every 12s, cheap.
  useEffect(() => {
    if (!user || !sectionsForUser(user).includes("chat")) { setChatUnread(0); return; }
    let alive = true;
    const tick = () => chatPoll("", 0)
      .then(({ channels }) => { if (alive) setChatUnread(channels.reduce((s, c) => s + (c.unread || 0), 0)); })
      .catch(() => {});
    tick();
    const t = setInterval(tick, 12000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // Presence poll (#49) — refresh the cached online/offline map every 30s so
  // presence dots (chat + admin) stay live. Cheap; runs for any signed-in user.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = () => { if (alive) refreshPresence(); };
    tick();
    const t = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // Register the app-wide navigation surface so magnet/mention pills are
  // clickable anywhere (chat, notes, etc.). Uses the stable state setters so
  // it works for every internal item kind without threading nav props.
  useEffect(() => {
    setMagnetNav((kind, id, blockId) => {
      if (kind === "sop" || kind === "form") { setSopFocus({ id, mode: "view", blockId: blockId || null }); setSection(getSOP(id)?.kind === "form" ? "forms" : "library"); }
      else if (kind === "task") { setTaskFocus(id); setSection("tasks"); }
      else if (kind === "playbook") { setPlaybookFocus(id); setSection("playbook"); }
      else if (kind === "content") { setContentFocus(id); setSection("calendar"); }
      else if (kind === "campaign") { setCampaignFocus(id); setSection("calendar"); }
      else if (kind === "callback") { setCallbackFocus(id); setSection("waitlist"); }
      else if (kind === "product" || kind === "client") setSection("waitlist");
      else if (kind === "project") { setProjectFocus(id); setSection("projects"); }
      else if (kind === "imagerepo") setSection("imagerepo");
      else if (kind === "user") { chatOpenDM(id).then(cid => { setChatFocus(cid); setSection("chat"); }).catch(() => setSection("chat")); }
    });
    // #47: let any item view create a task / start a callback via the app surface.
    setTaskCreator((prefill) => { setNewTaskPrefill(prefill); setSection("tasks"); });
    setCallbackStarter((productId) => { setNewCallbackProduct(productId); setSection("waitlist"); });
  }, []);

  if (!user) {
    return <Login onLogin={() => { setUser(getCurrentUser()); setBooting(false); }} />;
  }
  if (booting) return <BootScreen />;

  // Per-user access (#38): a non-admin can only ever render a section they're
  // allowed to see. If the raw section (default "dashboard", or a deep-link
  // into a hidden section) isn't permitted, fall back to their first allowed
  // one. Admins always pass through. Derived, not stored, so it re-resolves
  // whenever access or the raw selection changes.
  const allowed = sectionsForUser(user);
  // "admin" isn't in NAV_ITEMS (it's the pinned admin-only panel), so allow it
  // explicitly for admins alongside their section list.
  const canView = (s) => allowed.includes(s) || (s === "admin" && isAdmin(user));
  const section = canView(sectionRaw) ? sectionRaw : (allowed[0] || "dashboard");

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
  const goToCampaign = (id) => { setCampaignFocus(id); setSection("calendar"); };
  const goToPlaybookSection = (id) => { setPlaybookFocus(id); setSection("playbook"); };
  const goToTask = (id) => { setTaskFocus(id); setSection("tasks"); };
  const goToCallback = (id) => { setCallbackFocus(id); setSection("waitlist"); };
  const goToChat = (channelId) => { setChatFocus(channelId || null); setSection("chat"); };
  // Create a new task prefilled from another item (#47 act-from-item).
  const createTaskFrom = (prefill) => { setNewTaskPrefill(prefill); setSection("tasks"); };
  // Shared by both SOPLibrary mounts (library/forms) as onNavigateOut — a
  // mention/magnet pointing at the other kind, a Playbook section, or a task.
  const onNavigateOut = (kind, id, blockId) => {
    if (kind === "playbook") goToPlaybookSection(id);
    else if (kind === "task") goToTask(id);
    else goToSop(id, blockId);
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
      <Sidebar section={section} setSection={s => { setSection(s); if (s !== "library" && s !== "forms") setSopFocus(null); if (s !== "projects") setProjectFocus(null); if (s !== "calendar") { setContentFocus(null); setCampaignFocus(null); } if (s !== "playbook") setPlaybookFocus(null); }} user={user} onLogout={() => setUser(null)} onToggleTheme={toggleTheme} chatUnread={chatUnread} />
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: 1400, minWidth: 0 }}>
        {section === "dashboard" && <MyDashboard user={user} onOpenProject={goToProject} onOpenContent={goToContent} onOpenCampaign={goToCampaign} onOpenSubmission={goToSubmission} onNavigateOut={onNavigateOut} onOpenStore={() => setSection("store")} onOpenAnnouncements={() => setSection("announcements")} onOpenCallback={goToCallback} chatUnread={chatUnread} onOpenChat={() => setSection("chat")} />}
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
        {section === "tasks" && <TaskManager user={user} onOpenSop={goToSop} focusTaskId={taskFocus} onClearFocus={() => setTaskFocus(null)} onNavigateOut={onNavigateOut} newTaskPrefill={newTaskPrefill} onConsumePrefill={() => setNewTaskPrefill(null)} />}
        {section === "projects" && <Projects user={user} onOpenSop={goToSop} focusProjectId={projectFocus} onClearFocus={() => setProjectFocus(null)} />}
        {section === "calendar" && <ContentCalendar user={user} focusItemId={contentFocus} focusCampaignId={campaignFocus} onClearFocus={() => setContentFocus(null)} onClearCampaignFocus={() => setCampaignFocus(null)} onOpenSop={goToSop} onNavigateOut={onNavigateOut} />}
        {section === "announcements" && <Announcements user={user} />}
        {section === "chat" && <Chat user={user} onNavigate={onNavigateOut} focusChannelId={chatFocus} onClearFocus={() => setChatFocus(null)} onCreateTask={createTaskFrom} />}
        {section === "waitlist" && <Waitlist user={user} focusCallbackId={callbackFocus} onClearFocus={() => setCallbackFocus(null)} newCallbackProductId={newCallbackProduct} onConsumeNewCallback={() => setNewCallbackProduct(null)} />}
        {section === "admin" && isAdmin(user) && <AdminPanel />}
      </div>
      <ConfirmDialog />
      <SavedToast />
      <OfflineIndicator />
      <LoginReminders user={user} onOpenTasks={() => setSection("tasks")} onOpenTask={goToTask} />
      <AnnouncementDelivery user={user} onOpen={() => setSection("announcements")} />
      <CallbackDelivery user={user} onOpen={goToCallback} />
      <ChatDelivery onOpen={goToChat} />
      {canView("chat") && section !== "chat" && <ChatDock user={user} chatUnread={chatUnread} onNavigate={onNavigateOut} onCreateTask={createTaskFrom} />}
      <GlobalSearch />
    </div>
  );
}

export default App;
