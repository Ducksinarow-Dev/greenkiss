# GK Hub — Session Handoff

Snapshot for a new chat picking up work on this repo. Pair with `BACKLOG.md`, `DEPLOY.md`, `USER_GUIDE.md`, and `GBP_PUSH.md`.

## What this is
The Green Kiss internal ops hub ("GK Hub") — SOPs, tasks, projects, content calendar, image repository, announcements, waitlist/callbacks, and staff chat. Replaces Notion + scattered tools.
- **Repo:** `Ducksinarow-Dev/greenkiss` (cloned at `/Users/super-dad/Projects/GK Hub/greenkiss`)
- **Production:** https://hub.thegreenkiss.com · **Old tool being replaced:** https://team.thegreenkiss.com
- **Latest release:** `v0.1.42` (on the `release` branch)

## Stack & architecture
- **Frontend:** React 18 + Vite, no router — `src/App.jsx` switches "sections" (nav keys). Components in `src/components/`. All shared state/data + helpers live in `src/globals.js` (~2.9k lines). Shared UI kit in `src/components/shared.jsx`.
- **Backend:** single-file PHP `api.php` + MySQL. Config in `config.php` (server-only, gitignored; template `config.sample.php`).
- **Data model:** most data is JSON blobs in a `kv_store` table via `db.get/set` + `getX/saveX` helpers. Some things are **real tables** (append-heavy or auth): `users`, `tokens`, `revisions`, `login_sessions`, `chat_channels/chat_members/chat_messages`. New tables are **lazily created** by api.php (`ensureLoginSessionsTable`, `ensureChatTables`) so a live DB needs **no manual schema import** on deploy.
- **Dual mode:** `REMOTE_MODE` (production, talks to `api.php`) vs **dev** (localStorage). The Vite dev preview runs in **localStorage mode, not REMOTE_MODE**. Most features have a dev shim so they work in the preview; a few are remote-only (backups, deploy, calendar-sync, and chat has a dev shim).

## Running it
- **Dev preview:** `npm --prefix greenkiss run dev` (or the `gk-dev` launch config, port 5173). Seed logins: **Hayden**/**Megan** (admin), **Jessica**/**Liz** (editor) — all PIN **1234**.
- **Lint + build (the gate):** `npm run check` (eslint + vite build). Baseline is ~36 warnings (mostly an unused `React` import per file — matches existing convention); **0 errors** is the bar.
- **Publish a release:** `npm run release` (`scripts/release.sh`) — bumps patch, runs check, builds, replaces the `release` branch with the build output, pushes `release` **and** `main`. **Does not deploy live.**
- **Go live:** an admin clicks **Admin Panel → Software Update → Update Now** on hub.thegreenkiss.com (or cPanel → Git Version Control → Manage → Pull/Deploy). **Claude cannot do this** — it needs a prod admin login + PIN, which Claude must not enter. Always hand this step to the user.
- **Permissions:** `../.claude/settings.local.json` allowlists `git *` and `npm run release` so commits/releases aren't blocked by the auto-mode classifier. Run git/release as **bare** commands (a piped `| tail` can defeat the allow-rule match).

## Shipped this engagement (all on `release`, may need the Update Now click)
- **Vendor logins** migrated into the Image Repository (per-brand login box: 100% Pure + Josh Rosebrook creds; Glow Jar + Joni notes).
- **Batch 1 — Staff foundation:** groups (multi-group, Admin panel), login history, seed Jessica/Liz, collapsible icon-sidebar, per-module access.
- **Batch 2 — Notifications:** Announcements (toast / full-screen must-ack, target all/groups/staff, live-now vs at-sign-in, read receipts) + Current News dashboard feed.
- **Batch 3 — Content/Campaigns:** per-channel Type field, **multi-assignee** on tasks + content, **Reports** tab (metric roll-ups), **Manager** view (tasks + campaign content in one list).
- **Batch 4 — Waitlist + Callbacks:** clients/products directory, waitlist grouped by product, callbacks that alert assigned staff/group (must-ack toast + dashboard strip), work-the-waitlist + close.
- **Chat (all 4 phases):** public + private channels, 1:1 DMs, group DMs; near-real-time short-polling; admin-managed channels; sidebar unread badge + @mention/DM toast + dashboard strip; @mentions; edit/delete own; archive; history pagination. Built self-contained (`chat_*` API, `Chat.jsx`) to be **portable to DuckTracks** later.
- **Refinements:** type-ahead client/product pickers (search-or-create inline) in Waitlist/Callbacks; **universal magnets (#47)** — magnet/@mention pills for people/products/clients/content/campaigns/callbacks, clickable everywhere via an app-wide nav surface, rendered in chat + notes + announcement bodies, plus **"Create task from this"** on any chat message.

## Remaining / next
- **Track X (needs external setup):** PWA + Web Push (biggest buildable win; iOS needs "Add to Home Screen"); GBP posting API (needs Google Cloud OAuth — see `GBP_PUSH.md`); two Google Calendars for email/IG campaign assignment.
- **Pending on Maria (external):** content-calendar field list + campaign-types PDF.

## Shipped Aug 2026 (on `release` as v0.1.42; awaits the Update Now click)
- **#51 saved reports:** Content Reports gained a **Range** dropdown with dynamic presets (last 7/14/30/90, this/last month, QTD, YTD, custom) that recompute on open; **Save report** stores name+range+channel+metric in shared kv `contentReports`, shown as clickable chips. Globals: `reportRange`/`REPORT_RANGES` + `getContentReports`/`addContentReport`/`deleteContentReport`.
- **#58 brand sub-categories (Image Repository):** title blocks gained optional `brand`; galleries sharing a brand render under a collapsible `BrandGroup` header (`groupByBrand`/`GalleryRow`); `letterOf` prefers brand; edit mode gained a "Brand group" field. Backward-compatible with the flat blocks.
- **#59:** Image Repository back-to-top button moved to `bottom:88 right:26` so it no longer overlaps the `ChatDock` bubble.
- **v0.1.40 (another chat): code-cleanup pass** — extracted shared `Segmented` + `Modal` in `shared.jsx`, consolidated drifting constants into single sources of truth, removed dead code, fixed correctness bugs. Baseline lint warnings dropped to ~33.
- **#56 campaign manager (mirrors the project manager):** click a campaign → `CampaignDetail` with **Board | Timeline | Split** over its content items — `CampaignContentBoard` (drag-to-restatus by `CONTENT_STATUSES`) + `CampaignTimeline` (Gantt; bars span optional content `startDate`→`publishDate`, framed by campaign start/end, Today line, Week/Month/Quarter zoom via shared `Segmented`). Campaigns tab gained **Cards | Timeline** where Timeline = all-campaigns Gantt (`CampaignsTimeline`). Content items gained optional `startDate`. Timeline helpers `MS_DAY`/`daysBetween`/`addDaysISO`/`MONTHS_ABBR`/`TIMELINE_ZOOMS` now live in globals (shared by both managers). Deep-linking a campaign opens the detail.
- **#54 project Split view:** third option in `ProjectDetail`'s Board|Timeline toggle — stacks `ProjectTimeline` over `ProjectTasksBoard`.
- **#55 system-wide search:** `GlobalSearch.jsx` command palette (Cmd/Ctrl+K + sidebar **Search…** button) over `globalSearch()` in globals; grouped results (SOPs/forms/tasks/projects/content/campaigns/clients/products/callbacks/playbook/image-repo/staff), keyboard nav, deep-link via `navigateItem` (extended for `project` + `imagerepo`).

- **#47 create/act-from-item (complete):** "Create task from this" on products/clients/content/campaigns/callbacks + a task-overflow row (chat already had it); "Start callback" from a product; link-popover search extended to the new kinds. App-wide surfaces `createTaskFromItem`/`startCallbackForProduct` + `taskPrefillFromItem` in globals, registered in App alongside `setMagnetNav`.
- **Magnets on task tiles + paste bug:** tiles render title/description mentions as clickable pills + a copy-magnet button; pasting a raw `gk:` code auto-converts to a mention token (`onMagnetPaste`), and bare codes resolve to pills everywhere via `linkifyMagnets`. MentionText pills now `stopPropagation`. Task description is now a `MentionField` (gains `@`-mention).
- **#44 floating Save/Done:** sticky modal footers (Task/Campaign/Callback) + a Done button in Image Repository's sticky edit toolbar.
- **#45 waitlist email/phone:** captured in the add form, written back to the client record, shown on rows.
- **#46 chat bubble:** `ChatDock.jsx` launcher + docked `<Chat embedded />` panel, full-screen on mobile; nav section retained; hidden while on the chat section.
- **#48 collapsible chat headers** (persisted `gkChatCollapsed`).
- **#49 presence dots** (chat DMs + admin): api.php `presence` action, `refreshPresence`/`isUserOnline` (5-min window) + `subscribePresence`, 30s poll in App. Dev derives from the login-history mirror.
- **#50 Image Repository Letter Finder in edit mode** — shared `LetterFinder` filters the flat edit list to one letter.
- **#52 Content Calendar "Add" menu** (Content / Campaign / Report) replacing "New Content".
- **#53 Notion-style per-project views:** Board (drag Kanban) | Timeline (Gantt) toggle in `ProjectDetail`; tasks gained `startDate` + `onCalendar`, projects gained `includeTasksOnCalendar` (`taskOnCalendar()` = either); calendar-flagged tasks render on the Content Calendar + ICS feed. **NOTE for a follow-up:** #51 (saved dynamic-range reports) is still backlog.

## Post-deploy TODOs on the production DB (seed only applies to fresh DBs)
- Add **Jessica & Liz** via Admin Panel → Users (or the `INSERT`s in `schema.sql`).

## Gotchas
- **Chat messages + login_sessions are in tables, not kv** — so they're NOT in the app's Export/Backup (which covers kv only). Off-site DB backup covers them.
- **Dev preview localStorage resets** between some restarts — recreate test data or inject via the browser console (keys are prefixed `gk_`).
- **Browser automation** can't reliably drive Enter-to-send or hover-reveal actions (synthetic events) — those work live; spot-check them after deploy.
- Detailed state lives in the auto-memory files `gk-hub-roadmap.md` and `gk-hub-chat-plan.md`.
