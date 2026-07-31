import {
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
} from '../../config/config.js';

function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Shapes a raw Jira issue (from fetch/jira.js's fetchTicketsByFixVersions) into
 * the ticket record the dashboard is built around. `prIndex` is a
 * Map<ticketKey, evidence[]> from merge/ticketPrIndex.js — a ticket with no
 * entry gets an empty array (no linked PR is neutral, never a negative signal).
 *
 * The AI Contribution Percentage field is stored in Jira as a 0-1 fraction
 * (confirmed live against real tickets), so it's ×100'd here — but only when
 * present; `0` is a real, valid value ("confirmed zero AI use") and must not be
 * confused with `null` ("not recorded").
 */
export function normalizeJiraIssue(issue, prIndex, jiraBaseUrl) {
  const fields = issue.fields ?? {};
  const aiFraction = toNumber(fields[jiraAiContributionFieldId]);

  return {
    key: issue.key,
    summary: fields.summary ?? null,
    issue_type: fields.issuetype?.name ?? null,
    status: fields.status?.name ?? null,
    status_category: fields.status?.statusCategory?.key ?? null,
    assignee_display_name: fields.assignee?.displayName ?? null,
    assignee_account_id: fields.assignee?.accountId ?? null,
    sp: toNumber(fields[jiraStoryPointsFieldId]),
    ap: toNumber(fields[jiraActualPointsFieldId]),
    ai_contribution_percent: aiFraction === null ? null : aiFraction * 100,
    fix_versions: (fields.fixVersions ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      released: v.released ?? false,
      release_date: v.releaseDate ?? null,
    })),
    resolved_at: fields.resolutiondate ?? null,
    jira_url: `${jiraBaseUrl}/browse/${issue.key}`,
    linked_prs: prIndex.get(issue.key) ?? [],
  };
}
