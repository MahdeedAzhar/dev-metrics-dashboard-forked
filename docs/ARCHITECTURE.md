# Architecture

Dev Metrics is a small Node.js (≥ 20, ESM) application with **no framework, no
build step and one runtime dependency** (`@vercel/blob`, used only on Vercel).
It pulls tickets from Jira and pull requests from GitHub, normalises them into
one JSON "bundle", and renders that bundle into a self-contained HTML page whose
charts and tables are computed in the browser.

```
             ┌────────────────────────── generateDashboard() ──────────────────────────┐
             │                                                                          │
 Jira  ──────┤ fetch/jiraVersions  → releases (fixVersions, state)                      │
 REST v3     │ fetch/jira          → raw issues (JQL scoped to project + releases)      │
             │ fetch/jiraChangelog → status history per ticket (cached by `updated`)    │
             │                                                                          │
 GitHub ─────┤ fetch/github        → PRs updated since watermark + commits/reviews/comments
 REST        │   parse/ticketId        PR → ticket key                                  │
             │   parse/aiChecklist     PR body checklist → AI %                         │
             │   parse/commitCoAuthorship  commit trailers → AI %                       │
             │   parse/prReviews       reviews/comments → reviewers, review timings     │
             │                                                                          │
             │ merge/ticketPrIndex → Map<ticketKey, PR evidence[]>                      │
             │ normalize/ticketRecord (+ normalize/cycleTime) → ticket records          │
             │                                                                          │
             └──────────────► bundle { project, features, releases, tickets, warnings } │
                                            │
                       dashboard/render.js  │  inlines client scripts + bundle JSON
                                            ▼
                       self-contained dashboard.html  ──►  browser computes every metric
                                                           (dashboard/client/*.js)
```

## Directory map

| Path                             | Responsibility                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/config/index.js`            | Reads/validates all environment variables; exposes `getConfig()`, `publicConfig()`, feature flags. |
| `src/index.js`                   | Pipeline orchestration (`generateDashboard`) and the `npm run generate` CLI.                       |
| `src/fetch/jiraClient.js`        | Jira auth, request helper, error type, issue-key validation.                                       |
| `src/fetch/jira.js`              | Ticket search (JQL), field updates (allowlisted), transitions, comments.                           |
| `src/fetch/jiraVersions.js`      | Release discovery and classification (released / active / upcoming).                               |
| `src/fetch/jiraChangelog.js`     | Per-ticket status history.                                                                         |
| `src/fetch/github.js`            | PR listing with watermark, per-PR activity, token/repo verification.                               |
| `src/parse/*`                    | Pure parsers: ticket id, AI checklist, commit co-authorship, PR review timings.                    |
| `src/merge/ticketPrIndex.js`     | Groups PR evidence by ticket key.                                                                  |
| `src/normalize/*`                | Shapes raw Jira issues into ticket records; derives cycle time.                                    |
| `src/cache/store.js`             | File-based working cache (GitHub PRs + watermarks, Jira changelogs) and output files.              |
| `src/cache/dashboardSnapshot.js` | Durable bundle snapshot in Vercel Blob (serverless only).                                          |
| `src/cache/reviewLogs.js`        | Durable code-review time logs (Blob on Vercel, file locally).                                      |
| `src/reviews/service.js`         | Add/update/delete review logs and post the matching Jira comment.                                  |
| `src/ai/assistant.js`            | Optional tool-calling assistant over the bundle (OpenAI-compatible API).                           |
| `src/http/*`                     | Transport-agnostic request handlers, body parsing and response helpers shared by both servers.     |
| `src/server.js`                  | Local/self-hosted HTTP server (`npm run dev` / `npm start`).                                       |
| `api/*.js`                       | Vercel serverless functions — thin wrappers around `src/http`.                                     |
| `src/dashboard/render.js`        | HTML shell + CSS; inlines the client scripts and the bundle.                                       |
| `src/dashboard/client/*.js`      | Browser code (plain scripts, no modules): metric math, charts, UI state, assistant panel.          |
| `scripts/*`                      | `check` (validate + verify credentials), `jira:fields`, `cache:clear`, `validate:sheet`.           |
| `test/**`                        | `node:test` suites; external APIs are mocked via `globalThis.fetch`.                               |
| `docs/*`                         | This documentation set.                                                                            |

## Key design decisions

**Configuration is environment-only.** A team points the tool at their project
by editing `.env` (or Vercel env vars). Nothing project-specific lives in code,
and `publicConfig()` is the single place that decides what reaches the browser
(never tokens).

**Nothing happens at import time.** Modules read config lazily through
`getConfig()`; no module performs I/O when imported. Tests import anything
without a `.env`.

**Aggregation happens in the browser.** Metrics like "% of highest AP" or the
cycle-time histogram only mean something relative to the selected releases, so
the server ships a flat `tickets` map and the page recomputes on every
selection change. `deliveryMath.js` and `timeSeries.js` are plain scripts
inlined into the HTML; Node runs the identical source through
`*Node.js` wrappers (`vm.runInThisContext`) so tests and the CSV validator
exercise the exact code the browser runs.

**Feature flags, not empty columns.** Anything a project hasn't configured
(actual points, AI contribution, GitHub, assistant, editing) is hidden in the
UI and rejected by the API, driven by `config.features`.

**Incremental, resumable fetching.** GitHub PRs are fetched newest-updated
first and paging stops at the last seen `updated_at` (watermark). Jira
changelogs are cached per ticket keyed by the ticket's `updated` timestamp.
Jira ticket fields are always refetched in full (one bulk call) because SP/AP/AI
values are edited throughout a release.

**Writes fail loudly and narrowly.** Only the fields in `EDITABLE_FIELDS` can be
written; issue keys are validated before any URL is built; a Jira rejection is
returned with Jira's own message; a multi-field update stops at the first
failure and reports exactly which fields were applied.

**Two transports, one implementation.** `src/server.js` (Node `http`) and
`api/*.js` (Vercel) both call the handlers in `src/http/handlers.js`, which
return `{ status, json | html }` and are tested without sockets.

## Data model

### Release

```json
{
  "id": "16212",
  "name": "1.2.0",
  "released": false,
  "archived": false,
  "start_date": "2026-08-15",
  "release_date": "2026-10-01",
  "state": "active"
}
```

`state` ∈ `released | active | upcoming | unknown` (see METRICS.md).

### Ticket

```json
{
  "key": "ABC-123",
  "summary": "...",
  "issue_type": "Story",
  "status": "Code Review",
  "status_category": "indeterminate",
  "assignee_display_name": "Jane Doe",
  "assignee_account_id": "5e8f...",
  "sp": 5,
  "ap": 3,
  "ai_contribution_percent": 40,
  "fix_versions": [{ "id": "16212", "name": "1.2.0", "released": false, "release_date": null }],
  "created_at": "...",
  "updated_at": "...",
  "resolved_at": null,
  "jira_url": "https://acme.atlassian.net/browse/ABC-123",
  "linked_prs": [/* PR evidence, below */],
  "first_in_progress_at": "...",
  "first_code_review_at_after_in_progress": "...",
  "in_progress_to_code_review_hours": 31.5
}
```

`null` always means "not recorded"; `0` is a real value.

### PR evidence (per linked PR)

```json
{
  "repo": "acme/web",
  "pr_number": 41,
  "pr_url": "...",
  "pr_title": "ABC-123: ...",
  "pr_state": "merged",
  "pr_created_at": "...",
  "pr_merged_at": "...",
  "pr_ai_checklist_percent": 85,
  "pr_commit_co_author_percent": 60,
  "pr_author_login": "jane",
  "pr_assignee_login": null,
  "pr_reviewers": ["bob"],
  "pr_time_to_first_review_hours": 6,
  "pr_time_to_approval_hours": 24,
  "pr_review_completion_time_hours": 42
}
```

## Runtime environments

| Concern        | Local (`npm run dev`)               | Vercel                                               |
| -------------- | ----------------------------------- | ---------------------------------------------------- |
| Refresh        | On boot, then every 60 s in-process | Daily cron → `/api/refresh`, plus the Refresh button |
| Bundle storage | Memory + `data/output/`             | Private Blob (`dashboardSnapshot.js`)                |
| Working cache  | `data/cache/`                       | `/tmp` (best effort, per warm instance)              |
| Review logs    | `data/cache/review-logs.json`       | Private Blob                                         |
| Auth           | Optional Basic Auth                 | Basic Auth mandatory (503 until configured)          |

## Extension points

- **New metric** — add a pure function to `src/dashboard/client/deliveryMath.js`
  or `timeSeries.js`, export it from the matching `*Node.js` wrapper, write a
  test under `test/dashboard/client/`, then add a `render…()` function and a
  section container in `picker.js` / `render.js`. If it needs new data, add
  the field in `normalize/ticketRecord.js` (tickets) or `buildPrRecord` in
  `src/index.js` (PRs). See METRICS.md for definitions.
- **New Jira field** — add the env var in `src/config/index.js`, request it in
  `ticketSearchFields()`, map it in `normalizeJiraIssue()`, and (if editable)
  add it to `EDITABLE_FIELDS` + `buildJiraFieldUpdatePayload()`.
- **New integration** — add a `src/fetch/<name>.js` client that takes `config`
  as a parameter and throws typed errors, wire it in `generateDashboard()`
  behind a feature flag, and push a human-readable message into
  `bundle.warnings` on failure instead of aborting the run.
- **New write action** — implement it in a service module (see
  `src/reviews/service.js`), expose it through a handler in
  `src/http/handlers.js`, and mount it in both `src/server.js` and `api/`.
- **AI contribution rules** — parsers live in `src/parse/`; the blend rule is
  `combineAiSignals()` in `aiChecklist.js`. See AI_CONTRIBUTION.md.
