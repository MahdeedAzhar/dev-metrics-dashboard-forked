# Dev PR Velocity & AI-Contribution Dashboard

Replaces a manually-maintained spreadsheet with an on-demand tool that pulls real
GitHub PR data and Jira ticket data, and generates a self-contained HTML dashboard
covering PR velocity, review/merge turnaround, AI-assisted contribution (parsed
from the AI Contribution Checklist already embedded in PR bodies), and stale/gap
flags for PRs that have been open far longer than their story points would predict.

It's a script you run on demand, not a live service — each run fetches whatever's
new since the last run, recomputes everything fresh, and (re)writes `dashboard.html`.

## Setup

```bash
cp .env.example .env
# fill in GITHUB_TOKEN, JIRA_EMAIL, JIRA_API_TOKEN in .env
```

- `GITHUB_TOKEN`: a GitHub personal access token with read access to the repos in
  `config/config.js` (PRs, reviews, comments).
- `JIRA_EMAIL` / `JIRA_API_TOKEN`: a Jira Cloud API token
  (id.atlassian.com → Security → API tokens) for `JIRA_BASE_URL`
  (defaults to `https://arbisoft.atlassian.net`).

Requires Node.js 20+.

## Usage

```bash
npm start                    # fetch + regenerate the dashboard
npm start -- --since 2026-06-01   # override the reporting window's start date
npm start -- --refresh-jira  # force-refresh all linked Jira tickets, not just changed/stale ones
npm start -- --release 8.6.0 # scope to every PR linked to a Jira fixVersion, instead of a calendar window
```

Output:
- `data/output/dashboard.html` — open this in a browser. Re-run the script any
  time to refresh it with the latest data.
- `data/output/aggregated.json` — the same data as JSON, useful for debugging or
  feeding into something else.
- `data/cache/` — raw GitHub PR/review data and Jira issue data, cached locally so
  re-runs only fetch what changed since the last run.

## Configuration

Everything tunable lives in `config/config.js` — repos tracked, the SP→expected-days
heuristic, the stale-PR ratio threshold, composite score weights, color band
cutoffs, and the gap-detection threshold. Change constants there, not code.

Notably:
- `repos`: starts with `bvs-xiangqi/xiangqi-client` and `bvs-xiangqi/xiangqi-server`.
  Add more as `"org/repo"` strings.
- `jiraStoryPointsFieldId`: confirmed live against a real ticket (XQ-5043) on this
  Jira instance. Custom field IDs are per-Jira-site, so re-verify if this ever
  points at a different Jira instance.

## How scoring works

Each developer's **composite score** (0–100, shown with a green/yellow/red rating)
is a weighted average of three sub-scores, each independently visible on their
scorecard so the number is never a black box:

- **Speed (40%)** — how a merged PR's actual time-to-merge compares to the
  duration its SP implies (capped at 100 for finishing early, not rewarded
  beyond). SP is resolved **Jira Story Points first** (set at planning time,
  not self-reported per-PR), falling back to the PR body's own Planned/Actual
  SP fields only when Jira has none — a PR author can't inflate their own SP
  in the PR description to make Speed look better.
- **Quality (30%)** — first-pass approval rate (merged with zero
  "changes requested" reviews) as a proxy for review quality. There's no
  separate defect/QA data source wired up yet — treat this as a proxy, not a
  full picture.
- **AI Leverage (30%)** — blends two signals: the PR-body AI Contribution
  Checklist (self-reported, can be skipped) and the share of a PR's **commits
  carrying a "Co-Authored-By: Claude ..." trailer** (structured, present on
  nearly every AI-assisted commit, much harder to game). When both exist for a
  PR they're averaged; when only one exists, that one is used; a PR with
  neither is excluded from the average, never scored as 0.

**Each sub-score's weight is additionally scaled by its own data coverage.**
A Speed score built from 2 of a developer's 10 merged PRs (because the other 8
had no SP anywhere) pulls a small fraction of its normal 40% weight instead of
counting the same as a score built from 9 of 10 — this is what stops a small,
favorable sample from producing a misleadingly high composite. Coverage is
shown directly on every meter, with a low-sample caveat below ~50%.

**PR volume is tracked separately, not folded into the composite.** Each
developer's PRs-opened count is compared against the team's median for the
window; falling below half that median trips a `LOW_VOLUME` flag on the
scorecard and in the full-metrics table (config: `lowVolumeRatioThreshold`).
It's deliberately a flag rather than a score deduction, since a lower PR count
isn't inherently bad (could mean fewer, larger tickets) — it's a prompt to look
closer, which the scorecard's open-PR list right below it lets you do.

Weights, color-band cutoffs, the stale-PR ratio threshold, and the low-volume
threshold are all value judgments the team already made once — see
`config/config.js` for the current numbers and the project's plan doc for the
reasoning.

## Scoping to a release

`npm start -- --release 8.6.0` filters to every PR whose linked Jira ticket has
that fixVersion, instead of a calendar window — useful for "how did 8.6.0 go"
reporting rather than "last 14 days." This only sees PRs within `lookbackDays`
(default 90) of the cache, so bump that config value first if scoping to an
older or longer-running release.

## Known limitations

- **Reviewer bottlenecks leak into Speed.** Time-to-merge partly reflects how
  fast a reviewer responded, not just the author's own pace — the dashboard
  shows raw time-to-review alongside it for context.
- **Multiple concurrently-open PRs**: gap-justification anchors on the single
  open PR with the largest SP-implied duration, not a sum of all open PRs.
- **AI Contribution Checklist data is only as good as what's in the PR body** —
  older PRs, or PRs not opened via the `/create-pr` Claude Code workflow, won't
  have it. The commit co-authorship signal covers most of that gap, but a PR
  with neither a checklist nor any AI-co-authored commits is still excluded
  from AI-leverage scoring (never assumed 0).
- **The "team median PR duration" fallback** (used for stale-PR detection when
  a PR has no SP anywhere) is computed only from PRs that *do* have an SP —
  pooling in trivial one-line/config PRs would drag it toward a near-zero
  "typical duration" and make every unestimated open PR look wildly stale.
- **Low-volume flag is a prompt, not a verdict** — it doesn't know if a
  developer's tickets were larger/harder; check their open-PR list and Jira
  tickets before drawing a conclusion from the flag alone.
- **`xiangqi-server`'s exact GitHub slug** was confirmed via its local git remote,
  but if repos are added later, always confirm the exact `org/repo` slug first.
