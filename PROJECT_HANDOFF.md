# Jefferson Budget — Project Handoff

Personal construction budget/schedule manager for a home renovation + addition at
**3120 Jefferson St, Boulder CO 80304**. Owner: Josh Meyer. Builder/GC: Marc David Homes.
Construction loan bank: FirstBank.

This is an addition/alteration to an existing house (not ground-up new construction) —
the existing garage is being converted to an office/gym, and a new detached garage is
being built separately. Crawlspace foundation (not slab-on-grade or basement).

---

## 1. Repo & workflow

- Local path: `~/Documents/jefferson-budget`
- GitHub: `brinkjrm/jefferson-budget`, branch `main`
- **Workflow preference: commit and push directly to `main` — no PRs.**
- ⚠️ **Uncommitted as of this handoff:** `src/components/ScheduleTab.jsx` has local edits
  (see §5) that were never committed — Bash was broken in that session the whole time.
  Run `git status` / `git diff` and commit before doing anything else.

## 2. Stack

- React 18 + Vite, Tailwind via CDN (Apple-dark theme, see `index.html` for the design tokens)
- Supabase: Postgres + Storage + auto REST (PostgREST)
  - URL: `https://qxffadumpshyaseayndy.supabase.co`
  - Anon publishable key (already public in shipped client code, not a secret):
    `sb_publishable_jOL4vqNZCBd8vw0U7CYOqQ_-unZJWfi`
  - RLS policies allow full access to the `anon` role on every table — this is intentionally
    a personal single-user app, not multi-tenant.
- jsPDF + jspdf-autotable for the Draw Sheet PDF export
- Vercel serverless functions (`api/*.js`) call the Anthropic API server-side for AI features
  (needs `ANTHROPIC_API_KEY` env var in Vercel)

## 3. App structure — 8 tabs (`src/App.jsx`)

| Tab | Component | Purpose |
|---|---|---|
| Budget | `BudgetTab.jsx` | Soft/hard cost line items, material+labor split, drag-reorder w/ auto code gen, payments |
| Schedule | `ScheduleTab.jsx` | Custom-built Gantt chart — phases + nested tasks, drag to move/resize bars, drag rows to reorder/renest, dependency arrows |
| Bids | `BidsTab.jsx` | Drop a contractor bid PDF (or poll iCloud email) → Claude extracts structured data → review → accept links it to a budget line item + schedule tasks |
| Selections | `SelectionsTab.jsx` | Product selections by category (Plumbing/Lighting/Hardware/Bath Access/Appliances/Exterior) and room |
| Plans | `PlansTab.jsx` | Upload plan PDFs, view inline, ask Claude questions about them |
| Prepaid | `PrepaidTab.jsx` | Log of already-paid items, print view for the bank |
| Draw Sheets | `DrawsTab.jsx` | Construction loan disbursement requests, generates a formal PDF via `src/utils/pdf.js` |
| Settings | `SettingsTab.jsx` | Bank/borrower/property/loan fields that pre-fill new draw sheets |

Plus a floating `ChatPanel.jsx` (bottom-right "✦" button) — an AI assistant that loads the
live budget/prepaid/draw data as context and answers questions about it.

## 4. Database schema (inferred from code — `supabase_setup.sql` only has the original
seed for `line_items`/`prepaid_items`/`draw_sheets`/`draw_items`/`settings`; the tables
below exist live in Supabase but aren't in a checked-in migration)

- **line_items**: id, code, section(`soft`/`hard`), name, est_material_cost, est_labor_cost,
  estimated_cost, actual_cost, status(`pending`/`locked`), vendor, date_paid, notes,
  payments(jsonb array of `{date, amount}`), sort_order, created_at, updated_at
- **schedule_tasks**: id, name, parent_id(self-ref — null = phase, set = task under a phase),
  start_date, end_date, status(`not_started`/`in_progress`/`complete`/`blocked`), sort_order,
  color(hex, phases only), depends_on(uuid array, finish-to-start deps), created_at, updated_at
- **bids**: id, contractor_id, trade, description, total_amount, line_items(jsonb),
  pdf_url, source(`pdf_upload`/`email`/`manual`), status(`pending`/`accepted`/`rejected`),
  budget_line_item_id, schedule_task_ids(array), email_subject/from/date/message_id, notes
- **contractors**: id, name, company, email, phone, trade, notes
- **selections**: id, category, section, room, item_description, qty, brand_model,
  product_link, unit_price, status(`TBD`/`CONSIDERING`/`SELECTED`), sort_order, notes
- **plans**: id, name, file_url, file_size, created_at
- **prepaid_items**: id, description, vendor, amount, date_paid, payment_method,
  check_number, notes, created_at
- **draw_sheets**: id, draw_number, draw_date, borrower, property_address, builder,
  bank_name, loan_amount, loan_number, previous_draws_total, this_draw_amount,
  status(`draft`/`submitted`), notes
- **draw_items**: id, draw_sheet_id, line_item_id, description, previous_amount,
  this_draw_amount, invoice_url, invoice_filename, sort_order
- **settings**: key/value pairs — bank_name, borrower, property_address, builder,
  loan_amount, loan_number

Storage buckets: `plan-pdfs`, `bid-pdfs`, `invoices` (all public, anon full access).

## 5. Work done in the most recent session

1. Reviewed all the newly-pulled tabs (Bids/Plans/Schedule/Selections). Found a real
   temporal-dead-zone bug in `api/poll-email.js` (a `const pdfAttachment` used before its
   declaration, silently caught, breaking every email import). **Fixed it, then reverted
   at the user's request — they're redesigning email polling separately, so don't touch
   `api/poll-email.js` without checking with them first.**

2. Built out the full construction schedule in `schedule_tasks` (this is live in the DB,
   not just local): **14 phases, 61 tasks, Aug 24, 2026 → Apr 27, 2027 (~8 months)**:
   - Demolition & Abatement (Asbestos Abatement → Deconstruction, dependent)
   - Site Work & Excavation (Site Clearing → Rough Grading, dependent; Erosion Control
     concurrent with grading)
   - Crawlspace Foundation, Framing, Roofing, Exterior, Rough MEP — each fully broken into
     sequential dependent sub-tasks (not just uniform phase-wide placeholders) with the
     **detached garage folded in as parallel tasks** aligned to the matching house
     construction stage (e.g. garage foundation runs during the house's footing/wall-pour
     window, garage framing during the house's wall/roof framing window, etc.) — per the
     user's direction that the garage "follows the same timeline" as the house.
   - Insulation, Drywall, Interior Finish, Flooring, Final Trades, Site Finish,
     Punch List & Closeout — chained sequentially after.
   - All durations are industry-standard assumptions for a custom home at this budget
     scale ($125k framing, $54k windows, etc. per the budget line items) — **not yet
     validated against the actual architectural/structural plans** (see §6).

3. Fixed two real bugs in `ScheduleTab.jsx` (**this is the uncommitted change — §1**):
   - `STATUS_MAP.not_started` had a real color value (`#8E8E93`, grey), which always won
     the `STATUS_MAP[task.status]?.color || phaseColor` fallback since every task starts
     as `not_started` — meaning **every single Gantt bar rendered identically grey**
     regardless of its phase's intended color. Fixed so only meaningfully-progressed
     statuses (`in_progress`/`complete`/`blocked`) override the phase color.
   - Task bars are now visually distinct from phase bars (lighter tint + colored border
     vs. solid fill), and every bar now always shows its full `start – end` date range
     underneath (previously only showed the end date, and only if the bar was wide enough).

## 6. Open items for whoever picks this up next

- **Schedule refinement pending real plan data.** The user has the actual architectural,
  structural, mechanical, and garage plans (PDFs) for this project and wants the schedule
  durations refined against them. What's needed specifically: total finished square
  footage, bedroom/bathroom count, roof type/complexity (gable vs. hip, # of planes,
  dormers), and garage square footage/stall count. If your tool can read PDFs directly,
  ask the user for those files.
- **Don't touch `api/poll-email.js`** — user is redesigning it themselves.
- The `supabase_setup.sql` seed data for `line_items` reflects the *initial* seed only —
  the live table has since been edited through the app (costs locked, vendors added,
  etc.), so treat the SQL file as historical/structural reference, not current values.

## 7. Connecting a new tool to GitHub, Vercel, and Supabase

To let a new AI tool actually *make changes* (not just read this doc), it needs real
credentials for each service. I don't have any of these and can't generate them — they're
security-sensitive and worth deciding deliberately rather than bundling into a copy-paste
export. Here's exactly what's needed and where to get it:

**GitHub** — repo is `brinkjrm/jefferson-budget`, branch `main`.
- If your new tool pushes code itself, it needs a Personal Access Token:
  GitHub → Settings → Developer settings → Personal access tokens → generate one scoped
  to just this repo (fine-grained token, `Contents: Read and write` is enough — don't grant
  org-wide or all-repo access).
- If you're doing the git commands yourself and just want the AI to write code, you don't
  need a token at all — just copy its file changes over like we did tonight.

**Vercel** — hosts the `api/*.js` serverless functions (and likely the frontend build).
- Log into vercel.com → your dashboard to get the actual project name (not in this repo
  locally, so I can't hand you the real one).
- Required env vars on the Vercel project (Settings → Environment Variables):
  `ANTHROPIC_API_KEY` (required — powers bid extraction, plan Q&A, budget chat),
  `ANTHROPIC_MODEL` (optional, defaults to `claude-sonnet-4-5-20250929`),
  `ICLOUD_EMAIL` / `ICLOUD_APP_PASSWORD` / `SUPABASE_SERVICE_KEY` (only needed if you keep
  the email-polling feature — currently being redesigned, see §6).
- If your new tool needs to trigger deploys itself, generate a token at
  Vercel → Account Settings → Tokens.

**Supabase** — project `qxffadumpshyaseayndy`.
- The **anon key is already in this doc (§2) and in the shipped client code** — it's
  public by design, safe to hand to any tool. Because RLS policies on every table are
  "allow all" for the anon role, this key alone is enough for a new tool to read/write
  everything the app itself can (budget, schedule, bids, etc.) — you almost certainly
  don't need anything more privileged than this.
- The **service role key** (used only server-side by `api/poll-email.js`) bypasses RLS
  entirely. I've never had it — it only lives in Vercel's env vars. Don't paste it into a
  chat unless you specifically need something the anon key can't do; if so, grab it from
  Supabase → Project Settings → API, and treat it like a master password.

## 8. A note on why this handoff exists

The previous session hit two unrelated, unfixable local-environment bugs on that specific
machine: the Bash tool's proxy never acquired a port (`APPLE_CLAUDE_CODE_PORT: Not set`,
survived multiple app restarts and a full reinstall), and PDF page-rendering was missing
its `pdftoppm`/poppler-utils dependency. Logs also indicated that Claude Code install was
an Apple-internal managed build (`appleconnect` auth, network allowlisted to `.apple.com`
only) rather than the standard public app — worth being aware of for data-handling
purposes regardless of which AI tool is used going forward.
