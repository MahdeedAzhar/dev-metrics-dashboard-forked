// Code-review timing derived from a PR's formal reviews and conversation
// comments. Definitions (all in hours, `null` when the event never happened):
//
//   time_to_first_review     PR opened → first review or comment by someone
//                            other than the author (bots excluded)
//   time_to_approval         PR opened → first APPROVED review
//   review_completion_time   first review activity → merge (only for merged PRs
//                            that received a review) — how long the review
//                            phase itself took
//
// Reviewers are the distinct logins that submitted a formal review, excluding
// the PR author. Comment-only participants count for "first response" timing
// but are not listed as reviewers.

const BOT_LOGIN_RE = /\[bot\]$/i;

function hoursBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return (end - start) / (1000 * 60 * 60);
}

function isHuman(login, authorLogin) {
  return Boolean(login) && login !== authorLogin && !BOT_LOGIN_RE.test(login);
}

function earliest(isoDates) {
  const valid = isoDates.filter(Boolean).sort();
  return valid.length ? valid[0] : null;
}

/**
 * @param {object} rawPr    GitHub PR object (needs created_at, merged_at, user.login)
 * @param {object[]} reviews GET /pulls/{n}/reviews
 * @param {object[]} comments GET /issues/{n}/comments
 */
export function summarizePrReviews(rawPr, reviews = [], comments = []) {
  const authorLogin = rawPr?.user?.login ?? null;
  const createdAt = rawPr?.created_at ?? null;
  const mergedAt = rawPr?.merged_at ?? null;

  const humanReviews = (reviews ?? []).filter((r) => isHuman(r.user?.login, authorLogin) && r.submitted_at);
  const humanComments = (comments ?? []).filter((c) => isHuman(c.user?.login, authorLogin) && c.created_at);

  const reviewers = [...new Set(humanReviews.map((r) => r.user.login))].sort();
  const firstActivityAt = earliest([
    ...humanReviews.map((r) => r.submitted_at),
    ...humanComments.map((c) => c.created_at),
  ]);
  const firstApprovalAt = earliest(humanReviews.filter((r) => r.state === 'APPROVED').map((r) => r.submitted_at));

  return {
    author_login: authorLogin,
    reviewers,
    review_count: humanReviews.length,
    first_review_at: firstActivityAt,
    first_approval_at: firstApprovalAt,
    time_to_first_review_hours: hoursBetween(createdAt, firstActivityAt),
    time_to_approval_hours: hoursBetween(createdAt, firstApprovalAt),
    review_completion_time_hours: mergedAt && firstActivityAt ? hoursBetween(firstActivityAt, mergedAt) : null,
  };
}
