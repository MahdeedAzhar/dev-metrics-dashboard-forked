# GitHub setup

GitHub is **optional**. Leave `GITHUB_REPOS` blank and the dashboard runs on
Jira data alone (no PR evidence, PR trends or review timings). No GitHub App,
webhook or MCP server is needed — only the REST API with a token.

## 1. Create a token

**Fine-grained personal access token** (recommended):

1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
2. Resource owner: the organisation that owns the repositories.
3. Repository access: only the repositories in `GITHUB_REPOS`.
4. Permissions (Repository): **Pull requests: Read**, **Contents: Read**,
   **Metadata: Read** (added automatically).
5. Organisation tokens may need approval by an org admin.

**Classic token**: scope `repo` (private repos) or `public_repo`.

Put it in `GITHUB_TOKEN`. The tool never writes to GitHub.

## 2. Configure repositories

```
GITHUB_REPOS=acme/web,acme/api
GITHUB_BASE_BRANCH=main        # optional: ignore PRs into other branches
GITHUB_LOOKBACK_DAYS=90        # first-run window
GITHUB_STALE_PR_AFTER_DAYS=14
```

Any number of repositories across any organisations is supported as long as
the token can read them.

## 3. Link PRs to tickets

PRs are matched to Jira tickets by key, title first, then body. Recognised
conventions (case-sensitive key, project must equal `JIRA_PROJECT_KEY`):

| Where | Pattern                                    | Example                               |
| ----- | ------------------------------------------ | ------------------------------------- |
| Title | `KEY-123: …`, `KEY-123 - …`                | `ABC-123: Add login`                  |
| Title | `[KEY-123] …`                              | `[ABC-123] Add login`                 |
| Title | `type(KEY-123): …`, `type: KEY-123 …`      | `feat(ABC-123): add login`            |
| Body  | A leading markdown link `[KEY-123](…)`     | `[ABC-123](https://…/browse/ABC-123)` |
| Body  | A `Jira: KEY-123` / `Ticket: KEY-123` line | `Jira: ABC-123`                       |

A PR whose only key belongs to another project is treated as unlinked. Unlinked
PRs are still cached but never shown.

## 4. What is fetched

Per run: `GET /repos/{o}/{r}/pulls?state=all&sort=updated` (stops at the last
seen `updated_at`), then for each new/changed PR: commits, reviews and issue
comments. Results are cached in `data/cache/github/`; a first run on a busy
repository can take a few minutes.

Review timing definitions are in [METRICS.md](METRICS.md#code-review).

## 5. Verify

```bash
npm run check
```

prints the token's user and each repository's visibility and default branch.

## Changing repositories later

After editing `GITHUB_REPOS`, `GITHUB_BASE_BRANCH`, `GITHUB_LOOKBACK_DAYS` or the
AI-contribution parsing settings, run `npm run cache:clear` so PR records are
rebuilt with the new rules (the watermark would otherwise skip old PRs).
