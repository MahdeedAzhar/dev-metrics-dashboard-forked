import { getConfig } from '../config/index.js';
import { assertIssueKey, jiraRequest } from './jiraClient.js';

const PAGE_SIZE = 100;

/**
 * The only ticket fields the dashboard is allowed to write, and how each maps
 * onto Jira's update payload. Anything not listed here is rejected before a
 * request is made — an authenticated dashboard user must never be able to set
 * arbitrary Jira fields through this tool.
 */
export const EDITABLE_FIELDS = Object.freeze([
  'summary',
  'status',
  'assignee',
  'issue_type',
  'sp',
  'ap',
  'ai_contribution_percent',
]);

const FIELD_ALIASES = Object.freeze({
  story_points: 'sp',
  actual_points: 'ap',
  ai_contribution: 'ai_contribution_percent',
});

export function normalizeFieldName(field) {
  const name = String(field ?? '').trim();
  return FIELD_ALIASES[name] ?? name;
}

function toNumberOrNull(value, fieldName) {
  if (value === '' || value === null || value === undefined) return null;
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    throw new Error(`Expected ${fieldName} to be numeric, received "${value}"`);
  }
  return numericValue;
}

/** Converts a 0-100 percentage into the unit the Jira field stores. */
export function toJiraAiValue(percent, config = getConfig()) {
  if (percent === null) return null;
  return config.jira.aiContributionScale === 'fraction' ? percent / 100 : percent;
}

/** Converts the raw Jira field value into a 0-100 percentage (or null). */
export function fromJiraAiValue(raw, config = getConfig()) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
  return config.jira.aiContributionScale === 'fraction' ? raw * 100 : raw;
}

/**
 * Builds the body for PUT /rest/api/3/issue/{key}. Throws for fields outside
 * EDITABLE_FIELDS and for fields the project hasn't configured (e.g. `ap` when
 * JIRA_ACTUAL_POINTS_FIELD is unset).
 */
export function buildJiraFieldUpdatePayload(field, value, config = getConfig()) {
  const name = normalizeFieldName(field);
  if (!EDITABLE_FIELDS.includes(name)) {
    throw new Error(`Field "${field}" cannot be edited through the dashboard.`);
  }
  if (!config.features.jiraEditing) {
    throw new Error('Jira editing is disabled for this deployment (JIRA_EDITING_ENABLED=false).');
  }
  const { fields } = config.jira;

  switch (name) {
    case 'summary': {
      const summary = String(value ?? '').trim();
      if (!summary) throw new Error('Summary must not be empty.');
      return { fields: { summary } };
    }
    case 'assignee':
      return value === '' || value == null
        ? { fields: { assignee: null } }
        : { fields: { assignee: { accountId: String(value) } } };
    case 'issue_type':
      return { fields: { issuetype: { name: String(value) } } };
    case 'sp':
      return { fields: { [fields.storyPoints]: toNumberOrNull(value, 'story points') } };
    case 'ap':
      if (!fields.actualPoints) throw new Error('Actual points are not configured (JIRA_ACTUAL_POINTS_FIELD).');
      return { fields: { [fields.actualPoints]: toNumberOrNull(value, 'actual points') } };
    case 'ai_contribution_percent': {
      if (!fields.aiContribution) throw new Error('AI contribution is not configured (JIRA_AI_CONTRIBUTION_FIELD).');
      const percent = toNumberOrNull(value, 'AI contribution');
      if (percent !== null && (percent < 0 || percent > 100))
        throw new Error('AI contribution must be between 0 and 100.');
      return { fields: { [fields.aiContribution]: toJiraAiValue(percent, config) } };
    }
    case 'status':
      // Status changes go through transitions, not a field update.
      throw new Error('Status is changed via transitions, not a field payload.');
    default:
      throw new Error(`Field "${field}" cannot be edited through the dashboard.`);
  }
}

/** The fields the bulk ticket search requests, derived from configuration. */
export function ticketSearchFields(config = getConfig()) {
  const { fields } = config.jira;
  return [
    'summary',
    'issuetype',
    'status',
    'assignee',
    'fixVersions',
    'created',
    'updated',
    'resolutiondate',
    fields.storyPoints,
    ...(fields.actualPoints ? [fields.actualPoints] : []),
    ...(fields.aiContribution ? [fields.aiContribution] : []),
  ];
}

async function fetchTransitions(issueKey, config) {
  return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    action: `fetching transitions for ${issueKey}`,
    config,
  });
}

async function updateIssueStatus(issueKey, statusName, config) {
  const wanted = String(statusName ?? '')
    .trim()
    .toLowerCase();
  if (!wanted) throw new Error('Status must not be empty.');
  const { transitions = [] } = (await fetchTransitions(issueKey, config)) ?? {};
  const transition = transitions.find((candidate) => (candidate.to?.name ?? candidate.name)?.toLowerCase() === wanted);
  if (!transition) {
    const available = transitions.map((t) => t.to?.name ?? t.name).filter(Boolean);
    throw new Error(
      `No Jira transition to "${statusName}" is available from the ticket's current status` +
        (available.length ? ` (available: ${available.join(', ')})` : '') +
        '.',
    );
  }
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    body: { transition: { id: transition.id } },
    action: `transitioning ${issueKey} to ${statusName}`,
    config,
  });
}

/**
 * Updates one editable field on one ticket. Validates the key and field
 * before any network call; a Jira rejection surfaces as a thrown error with
 * Jira's own message so nothing fails silently.
 */
export async function updateJiraIssueField(issueKey, field, value, config = getConfig()) {
  const key = assertIssueKey(issueKey);
  const name = normalizeFieldName(field);
  if (!EDITABLE_FIELDS.includes(name)) {
    throw new Error(`Field "${field}" cannot be edited through the dashboard.`);
  }
  if (!config.features.jiraEditing) {
    throw new Error('Jira editing is disabled for this deployment (JIRA_EDITING_ENABLED=false).');
  }

  if (name === 'status') {
    await updateIssueStatus(key, value, config);
    return { key, field: name, value };
  }

  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: buildJiraFieldUpdatePayload(name, value, config),
    action: `updating ${name} on ${key}`,
    config,
  });
  return { key, field: name, value };
}

/**
 * Minimal Atlassian Document Format (ADF) doc wrapping plain text. Jira Cloud
 * REST v3 requires comment bodies in ADF, not plain strings.
 */
export function buildJiraCommentAdf(text) {
  const trimmed = String(text || '').trim();
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: trimmed ? [{ type: 'text', text: trimmed }] : [] }],
  };
}

/** Posts a plain-text comment on a ticket. */
export async function postJiraComment(issueKey, body, config = getConfig()) {
  const key = assertIssueKey(issueKey);
  const commentText = String(body || '').trim();
  if (!commentText) throw new Error('Comment body must not be empty.');

  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: { body: buildJiraCommentAdf(commentText) },
    action: `commenting on ${key}`,
    config,
  });
  return { key, comment: commentText };
}

/** GET a single issue with the dashboard's field set (used by the assistant). */
export async function fetchJiraIssue(issueKey, config = getConfig()) {
  const key = assertIssueKey(issueKey);
  const fields = ticketSearchFields(config).join(',');
  return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${encodeURIComponent(fields)}`, {
    action: `fetching ${key}`,
    config,
  });
}

function jqlString(value) {
  return `"${String(value).replace(/["\\]/g, '\\$&')}"`;
}

/** The JQL for a release set — exported so tests can pin it down. */
export function buildReleaseJql(releaseNames, config = getConfig()) {
  const clauses = [
    `project = ${jqlString(config.jira.projectKey)}`,
    `fixVersion in (${releaseNames.map(jqlString).join(', ')})`,
  ];
  if (config.jira.issueTypes.length > 0) {
    clauses.push(`issuetype in (${config.jira.issueTypes.map(jqlString).join(', ')})`);
  }
  return `${clauses.join(' AND ')} ORDER BY key`;
}

/**
 * Fetches every issue in the configured project belonging to any of the given
 * fixVersions, in one paginated JQL query (POST /rest/api/3/search/jql with
 * nextPageToken — the older startAt-based /search endpoint is deprecated).
 * Scoping to the project matters: version names like "1.2.0" commonly exist in
 * several projects on the same Jira site.
 */
export async function fetchTicketsByFixVersions(releaseNames, config = getConfig()) {
  if (releaseNames.length === 0) return [];
  const jql = buildReleaseJql(releaseNames, config);
  const fields = ticketSearchFields(config);

  const issues = [];
  let nextPageToken;
  do {
    const page = await jiraRequest('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, maxResults: PAGE_SIZE, fields, ...(nextPageToken ? { nextPageToken } : {}) },
      action: `fetching tickets for releases [${releaseNames.join(', ')}]`,
      config,
    });
    issues.push(...(page?.issues ?? []));
    nextPageToken = page?.isLast ? undefined : page?.nextPageToken;
  } while (nextPageToken);

  return issues;
}
