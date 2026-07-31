import { warn } from '../utils/logger.js';

const API_BASE = 'https://api.github.com';

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set (see .env.example)');
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const nextPart = linkHeader.split(',').find((part) => part.includes('rel="next"'));
  if (!nextPart) return null;
  const match = /<([^>]+)>/.exec(nextPart);
  return match ? match[1] : null;
}

async function githubGet(url) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return response;
}

async function githubGetJson(url) {
  const response = await githubGet(url);
  return response.json();
}

/**
 * Lists pull requests for a repo, newest-updated first, and stops paging as soon
 * as a PR's `updated_at` is at or before the watermark — this is what keeps
 * re-runs cheap. Returns only PRs strictly newer than the watermark.
 */
export async function fetchNewOrUpdatedPullRequests(repo, lastUpdatedAtSeen) {
  const [owner, name] = repo.split('/');
  const watermarkTime = lastUpdatedAtSeen ? new Date(lastUpdatedAtSeen).getTime() : null;
  const results = [];
  let url = `${API_BASE}/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=100`;

  while (url) {
    const response = await githubGet(url);
    const page = await response.json();

    for (const pr of page) {
      if (watermarkTime !== null && new Date(pr.updated_at).getTime() <= watermarkTime) {
        return results;
      }
      results.push(pr);
    }

    url = parseNextLink(response.headers.get('link'));
  }

  return results;
}

export async function fetchPullRequestReviews(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100`);
}

export async function fetchPullRequestReviewComments(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/comments?per_page=100`);
}

export async function fetchIssueComments(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/issues/${number}/comments?per_page=100`);
}

export async function fetchPullRequestCommits(repo, number) {
  const [owner, name] = repo.split('/');
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/commits?per_page=100`);
}

/**
 * Derives review-turnaround fields from a PR's reviews/comments, excluding the
 * PR author's own activity and bot accounts (a self-comment isn't a review).
 */
export function deriveReviewTimestamps(prAuthorLogin, { reviews, reviewComments, issueComments }) {
  const isOtherHuman = (login, type) =>
    login && login !== prAuthorLogin && type !== 'Bot' && !login.endsWith('[bot]');

  const candidateTimestamps = [
    ...reviews
      .filter((r) => isOtherHuman(r.user?.login, r.user?.type))
      .map((r) => r.submitted_at),
    ...reviewComments
      .filter((c) => isOtherHuman(c.user?.login, c.user?.type))
      .map((c) => c.created_at),
    ...issueComments
      .filter((c) => isOtherHuman(c.user?.login, c.user?.type))
      .map((c) => c.created_at),
  ].filter(Boolean);

  const approvals = reviews
    .filter((r) => r.state === 'APPROVED' && isOtherHuman(r.user?.login, r.user?.type))
    .map((r) => r.submitted_at)
    .filter(Boolean)
    .sort();

  const firstApprovalAt = approvals[0] ?? null;

  const changesRequestedBeforeApproval = reviews.filter(
    (r) =>
      r.state === 'CHANGES_REQUESTED' &&
      isOtherHuman(r.user?.login, r.user?.type) &&
      (!firstApprovalAt || new Date(r.submitted_at).getTime() < new Date(firstApprovalAt).getTime()),
  ).length;

  return {
    first_review_at: candidateTimestamps.sort()[0] ?? null,
    first_approval_at: firstApprovalAt,
    review_cycle_count: changesRequestedBeforeApproval,
  };
}

/**
 * Fetches everything needed to derive review timestamps and commit-level AI
 * co-authorship for a single PR. Callers should only invoke this for new/changed
 * PRs (see the watermark logic in fetchNewOrUpdatedPullRequests) — it's 4 API
 * calls per PR.
 */
export async function fetchPullRequestActivity(repo, number) {
  try {
    const [reviews, reviewComments, issueComments, commits] = await Promise.all([
      fetchPullRequestReviews(repo, number),
      fetchPullRequestReviewComments(repo, number),
      fetchIssueComments(repo, number),
      fetchPullRequestCommits(repo, number),
    ]);
    return { reviews, reviewComments, issueComments, commits };
  } catch (error) {
    warn(`Failed to fetch activity for ${repo}#${number}: ${error.message}`);
    return { reviews: [], reviewComments: [], issueComments: [], commits: [] };
  }
}
