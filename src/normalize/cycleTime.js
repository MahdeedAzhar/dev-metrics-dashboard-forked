const IN_PROGRESS_STATUS = 'In Progress';
const CODE_REVIEW_STATUS = 'Code Review';

/**
 * Derives "how long did it take this ticket to reach code review" from its raw
 * Jira changelog (GET /rest/api/3/issue/{key}/changelog — NOT available via the
 * bulk search endpoint, confirmed live). Uses the FIRST transition into
 * "In Progress" and the FIRST transition into "Code Review" *after* that —
 * tickets in this workflow can cycle Code Review <-> Internal QA multiple times
 * before finishing (confirmed on real data), so later re-entries into Code
 * Review must be ignored, not averaged in or taken as the last occurrence.
 *
 * Either transition missing (ticket never reached that status, or — a known,
 * disclosed limitation — was created directly into "In Progress" with no
 * recorded transition into it) leaves the corresponding field(s) `null` rather
 * than estimating a duration.
 */
export function deriveCycleTimeFromChangelog(changelogValues) {
  const statusTransitions = (changelogValues ?? [])
    .flatMap((entry) =>
      (entry.items ?? [])
        .filter((item) => item.field === 'status')
        .map((item) => ({ at: new Date(entry.created), toStatus: item.toString })),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const firstInProgress = statusTransitions.find((t) => t.toStatus === IN_PROGRESS_STATUS);
  const firstInProgressAt = firstInProgress ? firstInProgress.at : null;

  const firstCodeReviewAfter = firstInProgressAt
    ? statusTransitions.find((t) => t.toStatus === CODE_REVIEW_STATUS && t.at > firstInProgressAt)
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
