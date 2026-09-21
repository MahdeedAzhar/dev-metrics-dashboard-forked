import { getConfig } from '../config/index.js';
import { warn } from '../utils/logger.js';

const API_BASE = 'https://api.github.com';

/** Pulls the human-readable part out of a GitHub error body. */
export function describeGitHubError(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) return String(parsed.message);
  } catch {
    // not JSON
  }
  return String(body ?? '').slice(0, 300);
}

export class GitHubApiError extends Error {
  constructor(status, url, body) {
    super(`GitHub API ${status} for ${url.replace(/\?.*$/, '')}: ${describeGitHubError(body)}`);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

function authHeaders(config) {
  if (!config.github.token) {
    throw new Error('GITHUB_TOKEN is not set (see .env.example)');
  }
  return {
    Authorization: `Bearer ${config.github.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dev-metrics-dashboard',
  };
}

export function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const nextPart = linkHeader.split(',').find((part) => part.includes('rel="next"'));
  if (!nextPart) return null;
  const match = /<([^>]+)>/.exec(nextPart);
  return match ? match[1] : null;
}

/** Splits "owner/name" and validates it. */
export function splitRepo(repo) {
  const [owner, name, ...rest] = String(repo).split('/');
  if (!owner || !name || rest.length) throw new Error(`"${repo}" is not an owner/name GitHub repository.`);
  return { owner, name };
}

async function githubGet(url, config) {
  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new GitHubApiError(response.status, url, await response.text());
  }
  return response;
}

async function githubGetJson(url, config) {
  return (await githubGet(url, config)).json();
}

/** GET /user — the cheapest way to verify a token. */
export async function fetchCurrentUser(config = getConfig()) {
  return githubGetJson(`${API_BASE}/user`, config);
}

/** GET /repos/{owner}/{name} — verifies the token can see the repository. */
export async function fetchRepository(repo, config = getConfig()) {
  const { owner, name } = splitRepo(repo);
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}`, config);
}

/**
 * Lists pull requests for a repo, newest-updated first, and stops paging as soon
 * as a PR's `updated_at` is at or before the watermark — this is what keeps
 * re-runs cheap. Returns only PRs strictly newer than the watermark. When
 * GITHUB_BASE_BRANCH is set, only PRs targeting that branch are returned.
 */
export async function fetchNewOrUpdatedPullRequests(repo, lastUpdatedAtSeen, config = getConfig()) {
  const { owner, name } = splitRepo(repo);
  const watermarkTime = lastUpdatedAtSeen ? new Date(lastUpdatedAtSeen).getTime() : null;
  const results = [];
  const base = config.github.baseBranch ? `&base=${encodeURIComponent(config.github.baseBranch)}` : '';
  let url = `${API_BASE}/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=100${base}`;

  while (url) {
    const response = await githubGet(url, config);
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

export async function fetchPullRequestCommits(repo, number, config = getConfig()) {
  const { owner, name } = splitRepo(repo);
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/commits?per_page=100`, config);
}

export async function fetchPullRequestReviews(repo, number, config = getConfig()) {
  const { owner, name } = splitRepo(repo);
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/pulls/${number}/reviews?per_page=100`, config);
}

export async function fetchPullRequestComments(repo, number, config = getConfig()) {
  const { owner, name } = splitRepo(repo);
  return githubGetJson(`${API_BASE}/repos/${owner}/${name}/issues/${number}/comments?per_page=100`, config);
}

/**
 * Everything needed to derive commit-level AI co-authorship and code-review
 * timing for a single PR: commits, formal reviews and conversation comments.
 * Callers should only invoke this for new/changed PRs (see the watermark logic
 * in fetchNewOrUpdatedPullRequests). A failure degrades to empty lists with a
 * warning rather than aborting the whole sync.
 */
export async function fetchPullRequestActivity(repo, number, config = getConfig()) {
  try {
    const [commits, reviews, comments] = await Promise.all([
      fetchPullRequestCommits(repo, number, config),
      fetchPullRequestReviews(repo, number, config),
      fetchPullRequestComments(repo, number, config),
    ]);
    return { commits, reviews, comments };
  } catch (error) {
    warn(`Failed to fetch activity for ${repo}#${number}: ${error.message}`);
    return { commits: [], reviews: [], comments: [] };
  }
}

/** Search open/closed PRs in one repo (used by the assistant's live lookup). */
export async function searchPullRequests(repo, state = 'open', config = getConfig()) {
  splitRepo(repo);
  const q = `type:pr+state:${encodeURIComponent(state)}+repo:${encodeURIComponent(repo)}`;
  return githubGetJson(`${API_BASE}/search/issues?q=${q}&per_page=10`, config);
}
