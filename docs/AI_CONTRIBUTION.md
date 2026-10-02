# AI contribution tracking

The dashboard reports how much AI assistance went into delivered work, from
three independent sources. Each project can turn the feature off, use only
some sources, or change the parsing rules — all via configuration.

| Source                           | Who records it             | Where it shows                     | Feeds ticket/release numbers? |
| -------------------------------- | -------------------------- | ---------------------------------- | ----------------------------- |
| Jira field on the ticket         | The developer, in Jira     | Ticket, developer and release AI % | **Yes**                       |
| Checklist table in PR body       | The developer, in the PR   | Next to the linked PR (evidence)   | No                            |
| `Co-Authored-By` commit trailers | The AI tool, automatically | Next to the linked PR (evidence)   | No                            |

Keeping the PR signals separate from the Jira number is deliberate: one is
what the team declares, the other is what the tooling observed. The dashboard
never blends them into the headline figure.

## Configuration

```
AI_CONTRIBUTION_ENABLED=true              # false hides everything AI-related
JIRA_AI_CONTRIBUTION_FIELD=customfield_11729
JIRA_AI_CONTRIBUTION_SCALE=fraction       # or percent
AI_CHECKLIST_HEADING=AI Contribution Checklist
AI_COAUTHOR_PATTERNS=claude,copilot,cursor,codex,gemini,devin,aider
```

Combinations:

- **Jira field only** — leave `GITHUB_REPOS` blank or ignore the PR columns.
- **PR signals only** — leave `JIRA_AI_CONTRIBUTION_FIELD` blank; ticket AI %
  stays blank and only PR evidence is shown.
- **Off** — `AI_CONTRIBUTION_ENABLED=false`.

## 1. Jira field

A numeric custom field on the ticket, 0–1 or 0–100 (`JIRA_AI_CONTRIBUTION_SCALE`).
It is editable inline from the dashboard (enter 0–100; the tool converts to
the stored scale). `0` means "confirmed no AI use"; blank means "not recorded".

## 2. PR body checklist

Add a section to your PR template. The heading text must match
`AI_CHECKLIST_HEADING` (any markdown heading level, or bold). The table needs
at least four columns: activity, weight, AI %, score.

```markdown
#### AI Contribution Checklist

| Activity               | Weight | AI % | Score |
| ---------------------- | ------ | ---- | ----- |
| Requirement Analysis   | 10     | 50   | 5     |
| Technical Planning     | 15     | 80   | 12    |
| Code Generation        | 25     | 90   | 22.5  |
| Refactoring            | 10     | -    | -     |
| Documentation          | 5      | 100  | 5     |
| Debugging              | 10     | 60   | 6     |
| Code Review Assistance | 10     | -    | -     |

**AI Contribution Score:** 74%
```

Parsing rules (`src/parse/aiChecklist.js`):

- Rows whose AI % / score is blank (`-`, `n/a`, `tbd`, empty) mean "activity
  not performed" and are excluded, never counted as 0.
- The explicit `**AI Contribution Score:** N%` line is trusted when present.
- Otherwise the score is `sum(score) / sum(weight of filled rows) × 100`.
- No section → `available: false` (shown as blank, not 0).

Activity names and weights are free-form; the tool doesn't enforce a specific
set. Teams using the Arbisoft workflow's `/ai-contribution` command get this
table generated automatically.

## 3. Commit co-authorship

Coding assistants add a trailer to commits they author, e.g.
`Co-Authored-By: Claude <noreply@anthropic.com>`. The tool computes the share
of a PR's commits whose trailer names any of `AI_COAUTHOR_PATTERNS`
(case-insensitive, matched anywhere on the trailer line). Zero commits → `null`.

## Customising the rules

| Want to…                               | Change                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| Use a different heading                | `AI_CHECKLIST_HEADING`                                                                |
| Count another tool's trailers          | `AI_COAUTHOR_PATTERNS`                                                                |
| Change the blend of the two PR signals | `combineAiSignals()` in `src/parse/aiChecklist.js` (+ tests)                          |
| Make PR signals feed the ticket number | `normalizeJiraIssue()` in `src/normalize/ticketRecord.js` — document it in METRICS.md |
| Parse a different table layout         | `parseActivityRows()` in `src/parse/aiChecklist.js` (+ tests)                         |

After changing parsing rules run `npm run cache:clear` so cached PRs are
re-parsed.
