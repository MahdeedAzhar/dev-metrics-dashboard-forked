/**
 * Derives "how long did it take this ticket to reach code review" from its raw
 * Jira changelog. Uses the FIRST transition into any configured "in progress"
 * status and the FIRST transition into any configured "code review" status
 * *after* that — tickets can bounce between review and QA several times, so
 * later re-entries into review are ignored rather than averaged in.
 *
 * Either transition missing (never reached that status, or — a known and
 * documented limitation — created directly into "In Progress" with no recorded
 * transition) leaves the corresponding field(s) `null` rather than estimating.
 *
 * Status names are case-insensitive and come from JIRA_IN_PROGRESS_STATUSES /
 * JIRA_CODE_REVIEW_STATUSES so teams with different workflows can map their own.
 */
export function deriveCycleTimeFromChangelog(changelogValues, { inProgressStatuses, codeReviewStatuses }) {
  const inProgress = new Set(inProgressStatuses.map((s) => s.toLowerCase()));
  const codeReview = new Set(codeReviewStatuses.map((s) => s.toLowerCase()));

  const statusTransitions = (changelogValues ?? [])
    .flatMap((entry) =>
      (entry.items ?? [])
        .filter((item) => item.field === 'status')
        .map((item) => ({ at: new Date(entry.created), toStatus: String(item.toString ?? '').toLowerCase() })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const firstInProgress = statusTransitions.find((t) => inProgress.has(t.toStatus));
  const firstInProgressAt = firstInProgress ? firstInProgress.at : null;

  const firstCodeReviewAfter = firstInProgressAt
    ? statusTransitions.find((t) => codeReview.has(t.toStatus) && t.at > firstInProgressAt)
    : undefined;
  const firstCodeReviewAt = firstCodeReviewAfter ? firstCodeReviewAfter.at : null;

  const hours =
    firstInProgressAt && firstCodeReviewAt
      ? (firstCodeReviewAt.getTime() - firstInProgressAt.getTime()) / (1000 * 60 * 60)
      : null;

  return {
    first_in_progress_at: firstInProgressAt ? firstInProgressAt.toISOString() : null,
    first_code_review_at_after_in_progress: firstCodeReviewAt ? firstCodeReviewAt.toISOString() : null,
    in_progress_to_code_review_hours: hours,
  };
}
