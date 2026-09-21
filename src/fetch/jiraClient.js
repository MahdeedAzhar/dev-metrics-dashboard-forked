import { getConfig } from '../config/index.js';

// One place for Jira Cloud REST v3 plumbing: auth, headers, error shaping and
// issue-key validation. Every Jira call in the codebase goes through
// `jiraRequest` so tests can stub `globalThis.fetch` once and so a wrong token
// or URL fails with the same readable message everywhere.

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Pulls the human-readable part out of a Jira error body. */
export function describeJiraError(body) {
  try {
    const parsed = JSON.parse(body);
    const messages = [...(parsed?.errorMessages ?? []), ...Object.values(parsed?.errors ?? {})];
    if (messages.length) return messages.join('; ');
    if (parsed?.message) return String(parsed.message);
  } catch {
    // not JSON
  }
  return truncate(body);
}

export class JiraApiError extends Error {
  constructor(status, action, body) {
    super(`Jira API ${status} ${action}: ${describeJiraError(body)}`);
    this.name = 'JiraApiError';
    this.status = status;
  }
}

function truncate(text, max = 300) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Validates and normalises a Jira issue key (e.g. "ABC-123"). Rejecting
 * anything else before it reaches a URL or JQL string is the first line of
 * defence for every write endpoint.
 */
export function assertIssueKey(value) {
  const key = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!ISSUE_KEY_RE.test(key)) {
    throw new Error(`"${value}" is not a valid Jira issue key (expected e.g. ABC-123).`);
  }
  return key;
}

export function jiraHeaders(config = getConfig()) {
  const { email, apiToken } = config.jira;
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Performs a Jira REST request. `path` is relative to the site root, e.g.
 * `/rest/api/3/issue/ABC-1`. `action` is a human description used in errors.
 * Returns the parsed JSON body (or null for 204).
 */
export async function jiraRequest(
  path,
  { method = 'GET', body, action = `${method} ${path}`, config = getConfig() } = {},
) {
  const response = await fetch(`${config.jira.baseUrl}${path}`, {
    method,
    headers: jiraHeaders(config),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new JiraApiError(response.status, action, await response.text());
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** GET /rest/api/3/myself — the cheapest way to verify credentials. */
export async function fetchCurrentUser(config = getConfig()) {
  return jiraRequest('/rest/api/3/myself', { action: 'verifying Jira credentials', config });
}
