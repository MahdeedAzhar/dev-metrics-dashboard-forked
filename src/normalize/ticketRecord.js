import {
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
} from '../../config/config.js';
import { deriveCycleTimeFromChangelog } from './cycleTime.js';

function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Shapes a raw Jira issue (from fetch/jira.js's fetchTicketsByFixVersions) into
 * the ticket record the dashboard is built around. `prIndex` is a
 * Map<ticketKey, evidence[]> from merge/ticketPrIndex.js — a ticket with no
 * entry gets an empty array (no linked PR is neutral, never a negative signal).
 * `changelogByKey` is a Map<ticketKey, changelogValues[]> (see
 * fetch/jiraChangelog.js) — a ticket with no entry gets an empty changelog,
 * which deriveCycleTimeFromChangelog already treats as "never transitioned",
 * not an error.
 *
 * The AI Contribution Percentage field is stored in Jira as a 0-1 fraction
 * (confirmed live against real tickets), so it's ×100'd here — but only when
 * present; `0` is a real, valid value ("confirmed zero AI use") and must not be
 * confused with `null` ("not recorded").
 */
export function normalizeJiraIssue(issue, prIndex, jiraBaseUrl, changelogByKey = new Map()) {
  const fields = issue.fields ?? {};
  const aiFraction = toNumber(fields[jiraAiContributionFieldId]);
  const cycleTime = deriveCycleTimeFromChangelog(changelogByKey.get(issue.key));

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
    created_at: fields.created ?? null,
    resolved_at: fields.resolutiondate ?? null,
    jira_url: `${jiraBaseUrl}/browse/${issue.key}`,
    linked_prs: prIndex.get(issue.key) ?? [],
    first_in_progress_at: cycleTime.first_in_progress_at,
    first_code_review_at_after_in_progress: cycleTime.first_code_review_at_after_in_progress,
    in_progress_to_code_review_hours: cycleTime.in_progress_to_code_review_hours,
  };
}
