# The Green Kiss — Dev Backlog

Development backlog for the greenkiss ops tool itself (features, bugs). Numbered items, roughly in priority order within each section. Completed items get struck through and moved to the bottom with the date shipped.

## In progress / just fixed

- ~~#1: 1Password/LastPass/Dashlane repeatedly prompting to save the PIN as a password~~ — **fixed 2026-07-15**, shipped as v0.1.2. Root cause: browsers deliberately ignore `autocomplete="off"` for password-manager save-prompts; added the vendor-specific `data-1p-ignore`/`data-lpignore`/`data-form-type="other"` opt-outs to every PIN field.

## Priority queue

### Design / theming
- **#2: Light mode switch.** Currently dark-login/light-app only — no user-facing theme toggle at all despite `getTheme()` existing in globals.js. Add a light/dark toggle (Sidebar, near user info) with persisted preference.
- **#3: Typography pass** — switch nav/headers/buttons off Jost, keep the ALL-CAPS letterspaced treatment, but move body/UI text to **Manrope**.

### SOP Library
- **#4: Add new categories inline from the SOP editor**, not just Admin Panel. Editors currently can only pick existing categories when creating/editing an SOP.
- **#5: SOP importer from PDF/Word.** Parse an uploaded .pdf/.docx into a starter SOP (headings → heading blocks, paragraphs → text blocks, embedded images → image blocks) for editors to clean up rather than retype from scratch.

### Task Manager — overhaul
- **#6: Board columns.** Hide "Done" behind a slide-out/collapsible panel instead of a permanent 4th column; add **Reassigned** and **Review Before Closing** columns to the main board.
- **#7: Task types.** Tasks currently have no `type` field — add Task / Note / Milestone (and room for more), each with a distinct icon/treatment on the card.
- **#8: Inline task metadata popovers (ClickUp-style).** Tag, Priority, Due Date, and Assignee each become a small icon on the task card; clicking any one opens a focused dropdown/modal to edit just that field, not the full task modal.
  - Tags need their own lightweight create-on-the-fly flow inside that popover (new concept — no tag system exists yet, needs a `tags` KV store + task.tagIds).
  - Due Date popover needs a real date picker plus a "set recurring" option (recurrence is a new concept for tasks — needs a recurrence rule + generation logic).
- **#9: Task tile hover actions.** On hover, show a compact 4-icon row: Mark Complete, Add Subtask, Rename, and a "⋮" overflow menu with: Favourite, Alert staff member, Duplicate, Merge, Add to…, Templates (Apply / Save as / Create), Archive, Delete, Convert to… (List / Project / Subtask). Large item — several of these (Favourite, Alert, Merge, Templates, Convert-to) are net-new subsystems, not just UI; should probably be split into smaller sub-tickets once we scope it.
- **#10: Task ↔ Project attach/detach**, including tasks that already have subtasks — confirm moving a task in/out of a project preserves its subtasks and reassigns cleanly. (Likely already works since `projectId` is just a field on task — needs a verification pass more than new code.)

### Admin / Ops
- **#13: Rollback to previous release.** One-click button next to Software Update's "Update Now" (Admin Panel) that redeploys a prior commit from the `release` branch's history, for when a freshly deployed release turns out to be broken. Explicitly scoped OUT of the initial deploy-button batch — needs its own design pass (how far back to allow, how to list candidate commits, whether it reuses `admin_deploy`'s pull/deploy mechanism against a specific SHA instead of just `HEAD` of `release`).

### AI features (needs a scoping conversation before estimating — see note below)
- **#11: AI search agent across the whole app** — natural-language search over SOPs/tasks/projects/content.
- **#12: AI action agent** — natural-language prompts to create/assign/reassign SOPs and tasks, pull from a project or campaign, and generate a presentation-style summary with imagery and links.

## Notes for whoever picks up #11/#12
Both need a decision on: which model/API (cost target — "low cost" was specified), whether calls proxy through `api.php` (keeps the key server-side, required either way) or hit a provider directly from the client (insecure — never expose an API key client-side), and how much scope for v1 (search-only first is a much smaller lift than the full action-agent in #12; recommend shipping #11 before attempting #12).
