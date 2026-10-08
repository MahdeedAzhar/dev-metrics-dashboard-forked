# Metrics reference

Every number on the dashboard is defined here, with where it comes from and
what it does **not** mean. Nothing on the dashboard is a performance score;
there is no ranking, no composite index and no "at risk" label.

Conventions used throughout:

- `null` / "—" means _not recorded_. `0` is a real value. Averages exclude
  `null`s and always show a coverage count (`n / total`) next to them.
- All metrics are computed **in the browser over the currently selected
  releases** (`src/dashboard/client/deliveryMath.js`, `timeSeries.js`). A
  ticket in two selected releases is counted once (it is one object keyed by
  ticket key) — except in the per-release comparison chart, which is
  explicitly per release.

## Releases

Source: Jira project versions (`GET /rest/api/3/project/{key}/versions`),
`src/fetch/jiraVersions.js`.

| Term            | Definition                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tracked release | Every non-archived unreleased version + versions released within `JIRA_RELEASE_LOOKBACK_MONTHS` (or `JIRA_RELEASES` if set). |
| `released`      | Jira's own released flag is true. Shown under "Released" with its release date.                                              |
| `active`        | Unreleased and its start date has passed (or it has no start date). Shown under "Current & upcoming".                        |
| `upcoming`      | Unreleased with a start date in the future.                                                                                  |
| `unknown`       | Named in `JIRA_RELEASES` / `?releases=` but not found in Jira — flagged in the picker rather than hidden.                    |

"Current release" is whichever `active` release(s) the viewer selects (or
`DEFAULT_RELEASES`); the tool does not guess a single current release.

Membership of a release is the ticket's `fixVersions`. Tickets are fetched
with `project = KEY AND fixVersion in (...)` so version names shared with other
projects on the same Jira site are never mixed in.

## Story points

| Metric                          | Definition                                                                                                                     | Source                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| SP (planned)                    | Value of `JIRA_STORY_POINTS_FIELD` on the ticket.                                                                              | Jira                            |
| AP (delivered / actual)         | Value of `JIRA_ACTUAL_POINTS_FIELD`. Whole feature hidden when the field isn't configured.                                     | Jira                            |
| Total planned SP                | Sum of SP over selected tickets (`null` counts as 0 in sums, never in averages).                                               | `computeReleaseSummary`         |
| Total delivered AP              | Sum of AP over selected tickets. Note: it is **not** filtered by status — AP is whatever the team recorded.                    | `computeReleaseSummary`         |
| Completed / remaining           | Ticket count by Jira status category `done` vs everything else.                                                                | `computeReleaseSummary`         |
| Planned vs delivered by release | SP and AP summed per selected release; a ticket in two releases appears in both (per-release view). Optional developer filter. | `computeReleasePointComparison` |
| Release progress over time      | Cumulative AP and cumulative tickets completed by `resolutiondate`, against a flat total-planned-SP line.                      | `buildReleaseProgressSeries`    |

> Ambiguity worth knowing: "Delivered AP" includes AP recorded on tickets that
> are not yet `done`. Some teams record AP only at completion, in which case the
> two coincide; others record progressively. If your team wants "AP of done
> tickets only", that is a one-line change in `computeReleaseSummary` — please
> document it in this file if you change it.

## Developer delivery

Source: `computeDeveloperDelivery`. Developer identity is **strictly the Jira
assignee** (`assignee.accountId`); there is no GitHub-login ↔ Jira mapping.

| Column          | Definition                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Tickets         | Selected tickets assigned to the developer.                                                        |
| Planned SP      | Sum of SP.                                                                                         |
| Delivered AP    | Sum of AP.                                                                                         |
| % of highest AP | `developer AP / max(AP over developers in the selection) × 100`. Relative to the selection only.   |
| % of team AP    | `developer AP / sum(AP over the selection) × 100`.                                                 |
| AI contribution | Mean of ticket-level AI % over the developer's tickets that have a value, with `n/total` coverage. |

Unassigned tickets are grouped under "Unassigned".

## Ticket status and issue type

- **Status breakdown** — count and % by Jira `statusCategory.key`
  (`new` → To Do, `indeterminate` → In Progress, `done` → Done). This uses
  Jira's universal categories, not workflow-specific status names, so it works
  on any project.
- **Issue type breakdown** — ticket count, SP and AP per `issuetype.name`.

## Cycle time: In Progress → Code Review

Source: Jira changelog per ticket (`src/normalize/cycleTime.js`).

- `first_in_progress_at`: timestamp of the **first** transition into any status
  listed in `JIRA_IN_PROGRESS_STATUSES`.
- `first_code_review_at_after_in_progress`: the **first** transition into any
  `JIRA_CODE_REVIEW_STATUSES` status **after** that moment. Later re-entries
  (review ↔ QA ping-pong) are ignored.
- `in_progress_to_code_review_hours`: difference in hours, or `null` if either
  transition is missing.

Displayed as median and mean (both, because the distribution is skewed), a
fixed-bucket histogram (<1d, 1–2d, 2–4d, 4–7d, 7–14d, 14d+), coverage, and up
to 10 tickets currently "aging" (in the In Progress category, started, no
review transition yet).

Known gap: a ticket **created directly** into an in-progress status has no
transition into it and therefore no cycle time. This is disclosed, not
estimated.

## Engineering and PR activity

Source: `buildEngineeringActivityTrend`, `buildPrActivityTrend`. PRs are the
`linked_prs` of the selected tickets, deduplicated by `repo#number`.

| Metric                       | Definition                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PRs opened / merged by day   | Count of linked PRs by `created_at` / `merged_at`.                                                                |
| Tickets → In Progress by day | Count by `first_in_progress_at`.                                                                                  |
| Tickets completed by day     | Count by `resolutiondate`.                                                                                        |
| Currently open               | Linked PRs with state `open`.                                                                                     |
| Average open-PR age          | Mean days since `created_at` over open PRs.                                                                       |
| Stale PRs                    | Open PRs older than `GITHUB_STALE_PR_AFTER_DAYS`. Team-level list, never per developer.                           |
| Per-repository table         | Opened / merged / open counts per repo, with a drill-down list of open PRs.                                       |
| Developer activity timeline  | The developer's own tickets' completions and their linked PRs opened/merged. Personal timeline, not a comparison. |

### Chart window and bucket size

Counts are _presented_ at whatever granularity the window deserves; the
underlying per-day counts are unchanged and bucket totals always sum to the
same numbers.

| Window (first → last activity in the selection) | Bucket | Caption shown      |
| ----------------------------------------------- | ------ | ------------------ |
| ≤ 70 days                                       | day    | "Counts per day"   |
| 71–400 days                                     | week   | "Counts per week"  |
| > 400 days                                      | month  | "Counts per month" |

The window spans the first to the most recent **activity** (PR opened/merged,
ticket started, ticket completed) and never runs past today. It is deliberately
not anchored on ticket creation: a release carrying tickets filed months
earlier would otherwise stretch the chart across a long empty stretch and
squash the part being read. The most recent bucket can be partial (a week or
month still in progress) — read a final dip with that in mind.

PR evidence is only as complete as the GitHub fetch window
(`GITHUB_LOOKBACK_DAYS` on first run; incremental afterwards). "No linked PR
found" is neutral.

## Code review

Two independent sources:

### 1. Review timing from GitHub (automatic)

Source: PR reviews and conversation comments, `src/parse/prReviews.js`. Bots
(`*[bot]`) and the PR author are excluded.

| Field                             | Definition                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `pr_reviewers`                    | Distinct logins that submitted a formal review (approve / request changes / comment).   |
| `pr_time_to_first_review_hours`   | PR `created_at` → first review **or** first conversation comment by a non-author human. |
| `pr_time_to_approval_hours`       | PR `created_at` → first `APPROVED` review.                                              |
| `pr_review_completion_time_hours` | First review activity → `merged_at`. `null` unless the PR is merged and was reviewed.   |

Shown next to each linked PR in the ticket tables (`[reviewers] (Xh)` where X
is review completion time). PRs cached before this metric existed show `null`
until the PR changes again or `npm run cache:clear` is run.

### 2. Review time logged by people (manual)

"Log code review time" records `{reviewer, time_spent}` per ticket and posts a
Jira comment (`REVIEW_COMMENT_TEMPLATE`). Logs are stored by the tool
(`review-logs.json` locally, Blob on Vercel) — they are **not** parsed back
from Jira, and deleting a log does not delete the Jira comment. This is the
team's self-reported review effort and is not aggregated into any metric.

## AI contribution

See [AI_CONTRIBUTION.md](AI_CONTRIBUTION.md) for collection details.

| Level     | Metric                               | Definition                                                                                                       |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Ticket    | `ai_contribution_percent`            | `JIRA_AI_CONTRIBUTION_FIELD` value, scaled to 0–100 by `JIRA_AI_CONTRIBUTION_SCALE`. Recorded by people in Jira. |
| Release   | Team AI contribution                 | Mean of ticket-level values that exist, with coverage `n / total tickets`.                                       |
| Developer | AI contribution                      | Same mean over the developer's tickets.                                                                          |
| PR        | `pr_ai_checklist_percent`            | Stated score from the PR body checklist, or the weighted recomputation if no stated line.                        |
| PR        | `pr_commit_co_author_percent`        | Share of the PR's commits with a `Co-Authored-By:` trailer naming a tool in `AI_COAUTHOR_PATTERNS`.              |
| PR        | `overall_score_percent` (cache only) | Average of the two PR signals when both exist, else whichever exists; `null` when neither.                       |

**Important:** PR-level signals are shown as evidence next to PRs; they do
**not** feed the ticket/release/developer numbers, which come only from the
Jira field. That keeps "what the team recorded" and "what the tooling
observed" separate.

## Changing a metric

1. Change the pure function in `deliveryMath.js` / `timeSeries.js` /
   `normalize/` / `parse/`.
2. Update or add the test next to it (`test/…`).
3. Update the definition in this file, including what changed and why.
4. If the change alters what a number means for existing users, mention it in
   the PR description and consider a `warnings` entry for one release cycle.
