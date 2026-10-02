# Jira setup

The tool talks to **Jira Cloud REST API v3** with an Atlassian API token over
HTTP Basic auth. No Jira app, webhook, Marketplace add-on or MCP server is
required.

## 1. Create an API token

1. Sign in at <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. **Create API token**, name it (e.g. `dev-metrics`), copy it.
3. Put the account's email in `JIRA_EMAIL` and the token in `JIRA_API_TOKEN`.

Use a dedicated service account where possible: comments and edits made
through the dashboard appear under this account in Jira.

## 2. Required permissions

The account needs, on the project in `JIRA_PROJECT_KEY`:

| Permission             | Needed for                                             |
| ---------------------- | ------------------------------------------------------ |
| Browse Projects        | Everything (ticket search, versions, changelog)        |
| View Development Tools | Not required                                           |
| Edit Issues            | Inline editing (`JIRA_EDITING_ENABLED=true`)           |
| Transition Issues      | Changing status from the dashboard                     |
| Assign Issues          | Changing assignee from the dashboard                   |
| Add Comments           | "Log code review time" (`REVIEW_LOGGING_ENABLED=true`) |

A read-only deployment (`JIRA_EDITING_ENABLED=false`,
`REVIEW_LOGGING_ENABLED=false`) only needs Browse Projects.

## 3. Find your custom field ids

```bash
npm run jira:fields
```

prints every numeric custom field with a suggested mapping, e.g.

```
JIRA_STORY_POINTS_FIELD=customfield_10016  # "Story point estimate"
JIRA_ACTUAL_POINTS_FIELD=customfield_10833 # "Actual Points"
JIRA_AI_CONTRIBUTION_FIELD=customfield_11729  # "AI Contribution Percentage"
```

Custom field ids are global per Jira site, so they are the same across
projects on the same site. Verify the name matches what your team actually
fills in — many sites have several "Story Points" fields.

If your team doesn't track actual points or AI contribution, leave those
variables blank; the corresponding columns disappear.

### AI contribution scale

Check how the field stores its value: open a ticket with a known value and
compare. If Jira shows `0.4` for "40 %", use `JIRA_AI_CONTRIBUTION_SCALE=fraction`
(the default); if it shows `40`, use `percent`.

## 4. Map your workflow statuses

Cycle time measures the first move into an "in progress" status until the
first subsequent move into a "code review" status. List your workflow's names:

```
JIRA_IN_PROGRESS_STATUSES=In Progress,Development
JIRA_CODE_REVIEW_STATUSES=Code Review,In Review
```

Matching is case-insensitive. The status breakdown chart uses Jira's built-in
status categories (To Do / In Progress / Done) and needs no mapping.

## 5. Releases

The dashboard is organised by **versions** (fixVersion). Make sure tickets
carry a fixVersion; tickets without one are never fetched. Auto-discovery
tracks every unreleased version and anything released in the last
`JIRA_RELEASE_LOOKBACK_MONTHS`. To pin an explicit list use `JIRA_RELEASES`.

Boards, sprints and epics are not used.

## 6. Verify

```bash
npm run check
```

verifies credentials (`/myself`), project access, version listing and that
each configured field id exists.

## What the tool writes to Jira

| Action                                                | Endpoint                                   | Guard                                                                   |
| ----------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Edit SP / AP / AI % / summary / assignee / issue type | `PUT /rest/api/3/issue/{key}`              | Field allowlist (`EDITABLE_FIELDS`), numeric validation, 0–100 for AI % |
| Change status                                         | `POST /rest/api/3/issue/{key}/transitions` | Only transitions Jira offers from the current status                    |
| Log review time                                       | `POST /rest/api/3/issue/{key}/comment`     | Non-empty body, ticket must be in the current bundle                    |

Every write is behind Basic Auth on Vercel, validates the issue key, is
applied one field at a time (stopping at the first failure), and returns
Jira's error message verbatim. The assistant can only **propose** a write; the
user confirms it in the UI before the same code path runs. Nothing is ever
deleted in Jira.

## Rate limits

A refresh makes: 1 versions call, ⌈tickets/100⌉ search calls, and one
changelog call per ticket whose `updated` changed since the last run. Jira
Cloud's limits are generous for this; if you see HTTP 429, lower the refresh
frequency (locally `REFRESH_INTERVAL_MS` in `src/server.js`) or the release
window.
