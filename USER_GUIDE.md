# The Green Kiss — How-To Guide

A quick reference for using the ops tool. For server setup instead, see [DEPLOY.md](DEPLOY.md).

## Logging in

Pick your name from the list and enter your 4-digit PIN. Seed accounts:

- **Hayden** — PIN `1234`, Admin
- **Megan** — PIN `1234`, Admin

Change your PIN after first login (Admin Panel → your row → edit, or the change-PIN flow in your own profile). Everyone else gets added by an admin and defaults to the Editor role.

**Roles:**
- **Viewer** — read SOPs, view tasks/projects/calendar, can't create or edit
- **Editor** — full read/write on SOPs, tasks, projects, content calendar
- **Admin** — everything Editor can do, plus Admin Panel (users, categories, backups). Admin is restricted to Hayden and Megan.

## My Dashboard

This is what you land on after logging in — it's *your* work, not a team overview.

- **Overdue** (red) — anything assigned to you past its due date
- **Due today**, **This week**, **Later / no date** — everything else assigned to you, grouped
- Pulls from three sources at once: tasks, subtasks (shown with their parent task's name), and content calendar items
- Check the box to mark something done right from the dashboard, or click through to open it in full
- **My Projects** — a row of project cards where you're the lead or a member, with a progress bar and due date

## SOP Library

Your procedures live here, organized by category with a search bar and filter pills across the top.

**Reading an SOP:** click a card to open it. Use **Print / PDF** for a clean paper copy — the print layout strips out the navigation and just shows the document with the GK header.

**Marking as read:** at the bottom of any SOP there's a "Mark as read" button. If the SOP gets updated after you've read it, it'll show an amber "Updated since you last read" prompt so you know to re-check it. Editors/admins can see a "Read by" list on each SOP showing who's confirmed and who's stale.

**Creating/editing an SOP** (Editor+): click **New SOP**, give it a title and category, and build it out of blocks:
- **Heading** — section titles
- **Text** — a paragraph (line breaks are preserved)
- **Checklist** — a titled list of checkboxes (great for step-by-step procedures; prints as blank boxes for paper use)
- **Links** — a group of labeled reference links that open in a new tab
- **Image** — upload a photo or paste a URL; uploads are automatically resized

Drag the handle on the left of any block to reorder it. Changes autosave as you go — you'll see a small "Saved" confirmation.

**Draft vs Published:** toggle this on the SOP. Draft SOPs are still visible but marked as not-yet-final.

**Other actions:** Duplicate (makes a "(copy)" draft you can adapt), Archive (hides it from the default library view — toggle "Show archived" to see it again), and Version History (see and restore any prior save of the SOP).

## Task Manager

A three-column board: **To Do → In Progress → Done**.

- **New Task**: title, priority (Low/Medium/High/Urgent), assignee, due date, optional sub-tasks (each with its own assignee and due date), and an optional **Related SOP** link so the task can point straight to the procedure it's about
- Drag a task between columns to change its status, or drag within a column to reorder
- Filter by assignee, priority, or search text
- Link a task to a **Project** from the task's edit modal — it'll show a small project chip on the card
- Overdue tasks get a red due-date badge automatically

## Projects

For work that's bigger than one task — a project groups multiple tasks together with a shared timeline.

- **New Project**: name, description, start date, due date, a lead, and team members
- The project detail page shows a timeline bar from start to due date with a "today" marker and a dot for every task's due date (red dots = overdue)
- Tasks inside a project use the same board/card system as the main Task Manager — create a task from inside the project and it's automatically linked
- Progress is calculated live from done vs. total tasks in the project
- Project statuses: Active, On Hold, Done, Archived

## Content Calendar

Plans out everything you post or send: Google Business Profile posts, blog posts, email newsletters, and Instagram posts, optionally grouped into **Campaigns**.

**Campaigns tab:** create a campaign (name, description, date range, status) to group related content — e.g. "Spring Botanicals Launch" might include a GBP post, an Instagram post, and a newsletter feature all at once. Each campaign shows how many items it has per channel. Click a campaign to filter the calendar down to just its items.

**Calendar tab:** a month grid. Each content item shows as a small chip with a colored rail (matching its campaign color) and a channel icon. Click any day to create a new item there, or click a chip to open it. Use the arrows to move between months; today is highlighted.

**List tab:** the same content as a sortable table — click any column header to sort by date, channel, title, campaign, assignee, or status.

**Creating/editing content** (Editor+): pick a channel, which changes the fields you fill in:
- **GBP** — CTA button type (Book/Order/Buy/Learn more/Sign up/Call), CTA link, category (Update/Offer/Event)
- **Blog** — target keyword, slug/URL
- **Email** — subject line, preview text
- **Instagram** — caption, hashtags

Every item also gets: a title, publish date, assignee, body text, notes, plus images and links you can add freely. You can create a new campaign right from the item editor without leaving the flow. Assigned items automatically show up on that person's My Dashboard.

Content statuses: Idea → Draft → Scheduled → Published.

## Admin Panel (Hayden & Megan only)

- **Users** — add staff, set their role, reset PINs, remove access
- **Categories** — manage the SOP category list (rename, recolor, delete — deleting a category just leaves its SOPs uncategorized, nothing is lost)
- **Backups** — "Back up now" for an on-demand snapshot, a list of past backups you can download or restore, and a separate **Export/Import** for a full JSON download of everything (works even before the server backend is set up)

Backups also happen automatically: any write triggers a fresh backup if the last one is more than 24 hours old, and once deployed, a daily cron job keeps one running even if nobody touches the app that day. The newest 60 are kept.

## Everyday tips

- Search boxes (SOP Library, Task Manager, Content Calendar list) all do live text filtering — no need to hit enter
- Anything overdue is flagged in the same deep-rose red across the whole app — dashboard, tasks, projects, subtasks
- The build number and date show at the bottom of the sidebar under your name — handy if you're ever unsure whether you're looking at the latest deploy
