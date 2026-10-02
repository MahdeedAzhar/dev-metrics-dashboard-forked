import { getConfig } from '../config/index.js';
import { fromJiraAiValue } from '../fetch/jira.js';
import { deriveCycleTimeFromChangelog } from './cycleTime.js';

function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Shapes a raw Jira issue into the ticket record the dashboard is built around.
 *
 * - `prIndex`: Map<ticketKey, evidence[]> from merge/ticketPrIndex.js. A ticket
 *   with no entry gets an empty array — no linked PR is neutral, never negative.
 * - `changelogByKey`: Map<ticketKey, changelogValues[]>. A missing entry means
 *   "never transitioned", not an error.
 *
 * `0` is a real value ("confirmed zero") for every numeric field and must never
 * be confused with `null` ("not recorded"). Fields the project hasn't
 * configured (actual points, AI contribution) are always `null`.
 */
export function normalizeJiraIssue(issue, prIndex, changelogByKey = new Map(), config = getConfig()) {
  const fields = issue.fields ?? {};
  const { fields: fieldIds, statuses, baseUrl } = config.jira;
  const cycleTime = deriveCycleTimeFromChangelog(changelogByKey.get(issue.key), {
    inProgressStatuses: statuses.inProgress,
    codeReviewStatuses: statuses.codeReview,
  });

  return {
    key: issue.key,
    summary: fields.summary ?? null,
    issue_type: fields.issuetype?.name ?? null,
    status: fields.status?.name ?? null,
    status_category: fields.status?.statusCategory?.key ?? null,
    assignee_display_name: fields.assignee?.displayName ?? null,
    assignee_account_id: fields.assignee?.accountId ?? null,
    sp: toNumber(fields[fieldIds.storyPoints]),
    ap: fieldIds.actualPoints ? toNumber(fields[fieldIds.actualPoints]) : null,
    ai_contribution_percent: fieldIds.aiContribution
      ? fromJiraAiValue(toNumber(fields[fieldIds.aiContribution]), config)
      : null,
    fix_versions: (fields.fixVersions ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      released: v.released ?? false,
      release_date: v.releaseDate ?? null,
    })),
    created_at: fields.created ?? null,
    updated_at: fields.updated ?? null,
    resolved_at: fields.resolutiondate ?? null,
    jira_url: `${baseUrl}/browse/${issue.key}`,
    linked_prs: prIndex.get(issue.key) ?? [],
    first_in_progress_at: cycleTime.first_in_progress_at,
    first_code_review_at_after_in_progress: cycleTime.first_code_review_at_after_in_progress,
    in_progress_to_code_review_hours: cycleTime.in_progress_to_code_review_hours,
  };
}
