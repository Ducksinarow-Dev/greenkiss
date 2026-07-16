# The Green Kiss — Dev Backlog

Development backlog for the greenkiss ops tool itself (features, bugs). Numbered items, roughly in priority order within each section. Completed items get struck through and moved to the bottom with the date shipped.

## In progress / just fixed

- ~~#2: Light/dark mode toggle~~ — **shipped 2026-07-16**. The C_LIGHT/C_DARK palettes, `setTheme()`/`getTheme()`, and the dark CSS overrides already existed in globals.js/global.css from earlier work — what was missing was the actual toggle. Added an icon button (light_mode/dark_mode) in the Sidebar next to Log out, available to every role. App.jsx holds a `themeVersion` counter bumped on toggle; since no component here is memoized, that one state change cascades a full re-render through the tree and every inline style re-reads the freshly-mutated `C` object — no remount needed. Persists via the existing `localStorage["gk_theme"]` key. Fixed two light-only spots found during the sweep: the MyDashboard empty-state logo (added the same invert+screen dark variant Sidebar already used) and the SOPLibrary category count chip (`rgba(255,255,255,0.6)` → `C.sur`). Verified in both themes across Dashboard, SOP Library/Viewer/Editor, Task Manager (board + Done slide-over + task modal), Projects (board + list), Content Calendar (calendar + item editor), Admin Panel, and the PIN modal — plus persistence across reload. Print stylesheet was already forced to black-on-white regardless of theme; left untouched.
- ~~#3: Typography pass~~ — **shipped 2026-07-16**. Body/UI now runs on Manrope (loaded in index.html alongside Jost, weights trimmed to what's actually used: Jost 400/500/600, Manrope 400-800). Jost is kept only for the uppercase letterspaced treatment via a new `FONT_CAPS` constant in globals.js, centralized in shared.jsx (`Btn`, `OBtn`, `Pill`, `lbl()`, `SectionHeader`, `SlideOver`) and swept onto every remaining `textTransform:"uppercase"` call site across every component (nav, tabs, pills, section headers, category chips). `inp()` switched from Jost to Manrope since form field text isn't part of the caps treatment. IBM Plex Mono untouched.
- ~~#1: 1Password/LastPass/Dashlane repeatedly prompting to save the PIN as a password~~ — **fixed 2026-07-15**, shipped as v0.1.2. Root cause: browsers deliberately ignore `autocomplete="off"` for password-manager save-prompts; added the vendor-specific `data-1p-ignore`/`data-lpignore`/`data-form-type="other"` opt-outs to every PIN field.
- ~~#6: Task Manager board columns~~ — **shipped 2026-07-16**. Done removed from the main board; new `reassigned`/`review` statuses (labeled Reassigned / Review Before Closing) added between In Progress and Done. Done lives behind a "Done (n)" button that opens a right-hand slide-over (shared `SlideOver` component in shared.jsx, reused by Projects too) — unchecking a card there sends it back to To Do. Project detail's task grouping mirrors the same columns + Done slide-over.
- ~~#7: Task types~~ — **shipped 2026-07-16**. `TASK_TYPES` (task/note/milestone) in globals.js, segmented type picker in the task modal, distinct icon per type on cards (milestones get the icon in brand green + bolder title), notes skip the overdue-red treatment. Untyped legacy tasks normalize to "task" on read via `taskType()` — no migration write.
- ~~#10: Task ↔ Project attach/detach verification~~ — **verified 2026-07-16**, no bugs found. Created a milestone task with 2 subtasks (one assigned + dated), attached to a project, confirmed it appeared in project detail with subtasks intact, detached back to "No project," confirmed subtasks/assignee/date and type all survived and it left the project view. `projectId` being a plain field already made this work correctly — no code changes needed.
- ~~#14: Project board + list view~~ — **shipped 2026-07-16**. Project statuses remapped to `upcoming`/`in_progress`/`approval`/`done` (+ `archived`), normalized on every `getProjects()`/`getProject()` read (`active`→`in_progress`, `on_hold`→`upcoming`) rather than a bulk migration write — old values persist until a project is next saved through `updateProject`/`addProject`. Board view (default) has Upcoming/In Progress/Approval columns with drag-to-change-status; Done + Archived hide behind the same slide-over treatment as #6 (archived projects keep their own "Archived" pill inside it). List view groups the same projects into vertical sections by status, Done+Archived collapsed at the bottom. Board/List toggle persists per-browser via `localStorage["gkProjectsView"]`. Pills updated everywhere projects render (board, list, detail header, My Dashboard cards) via the existing shared `projectStatusMeta`.
- ~~#4: Inline category creation from the SOP editor~~ — **shipped 2026-07-16**. Category `<select>` in SOPEditor gained a "+ New category…" option that opens a small popover (name + the same `CATEGORY_COLORS` swatch set Admin Panel uses); creates via the existing collision-safe `addCategory()` path and selects the new category immediately. Admin Panel remains the only place to rename/recolor/delete.

## Priority queue

### Design / theming
- ~~#2: Light mode switch.~~ — shipped 2026-07-16, see top of file.
- ~~#3: Typography pass~~ — shipped 2026-07-16, see top of file.

### SOP Library
- ~~#4: Add new categories inline from the SOP editor~~ — shipped 2026-07-16, see top of file.
- **#5: SOP importer from PDF/Word.** Parse an uploaded .pdf/.docx into a starter SOP (headings → heading blocks, paragraphs → text blocks, embedded images → image blocks) for editors to clean up rather than retype from scratch.

### Task Manager — overhaul
- ~~#6: Board columns~~ — shipped 2026-07-16, see top of file.
- ~~#7: Task types~~ — shipped 2026-07-16, see top of file.
- **#8: Inline task metadata popovers (ClickUp-style).** Tag, Priority, Due Date, and Assignee each become a small icon on the task card; clicking any one opens a focused dropdown/modal to edit just that field, not the full task modal.
  - Tags need their own lightweight create-on-the-fly flow inside that popover (new concept — no tag system exists yet, needs a `tags` KV store + task.tagIds).
  - Due Date popover needs a real date picker plus a "set recurring" option (recurrence is a new concept for tasks — needs a recurrence rule + generation logic).
- **#9: Task tile hover actions.** On hover, show a compact 4-icon row: Mark Complete, Add Subtask, Rename, and a "⋮" overflow menu with: Favourite, Alert staff member, Duplicate, Merge, Add to…, Templates (Apply / Save as / Create), Archive, Delete, Convert to… (List / Project / Subtask). Large item — several of these (Favourite, Alert, Merge, Templates, Convert-to) are net-new subsystems, not just UI; should probably be split into smaller sub-tickets once we scope it.

  **Reference design notes for #8/#9 (from Hayden's ClickUp screenshots, Jul 16 2026):**
  1. **Standard tile**: title on top; optional description indicator (small lines icon) under it; then a row of four small OUTLINED icon buttons — assignee (person), due date (calendar), priority (flag), tags (tag) — shown as placeholder outlines even when the field is unset (click = the #8 popover for that field); subtask count at the bottom with a small subtask glyph ("1 subtask").
  2. **Hover overlay**: compact floating pill anchored to the tile's top-right with four icons — ✓ mark complete, ⊕ add subtask, ✎ rename, ⋯ overflow menu (the #9 action list).
  3. **Subtask dropdown**: the subtask count line becomes a disclosure toggle ("▾ 4 subtasks"); expanding renders each subtask as its own nested mini-card, indented under the parent, each with its OWN four-icon metadata row (assignee/date/priority/tags) — subtasks are first-class, individually assignable/dateable from the board without opening the parent.
- ~~#10: Task ↔ Project attach/detach~~ — verified 2026-07-16, see top of file.

### Projects
- ~~#14: Project board columns.~~ — shipped 2026-07-16, see top of file.

### Admin / Ops
- **#13: Rollback to previous release.** One-click button next to Software Update's "Update Now" (Admin Panel) that redeploys a prior commit from the `release` branch's history, for when a freshly deployed release turns out to be broken. Explicitly scoped OUT of the initial deploy-button batch — needs its own design pass (how far back to allow, how to list candidate commits, whether it reuses `admin_deploy`'s pull/deploy mechanism against a specific SHA instead of just `HEAD` of `release`).

### AI features (needs a scoping conversation before estimating — see note below)
- **#11: AI search agent across the whole app** — natural-language search over SOPs/tasks/projects/content.
- **#12: AI action agent** — natural-language prompts to create/assign/reassign SOPs and tasks, pull from a project or campaign, and generate a presentation-style summary with imagery and links.

## Notes for whoever picks up #11/#12
Both need a decision on: which model/API (cost target — "low cost" was specified), whether calls proxy through `api.php` (keeps the key server-side, required either way) or hit a provider directly from the client (insecure — never expose an API key client-side), and how much scope for v1 (search-only first is a much smaller lift than the full action-agent in #12; recommend shipping #11 before attempting #12).
