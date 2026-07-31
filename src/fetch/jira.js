import {
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
} from '../../config/config.js';

const PAGE_SIZE = 100;

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error('JIRA_EMAIL / JIRA_API_TOKEN are not set (see .env.example)');
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

const TICKET_FIELDS = [
  'summary',
  'issuetype',
  'status',
  'assignee',
  'fixVersions',
  'resolutiondate',
  jiraStoryPointsFieldId,
  jiraActualPointsFieldId,
  jiraAiContributionFieldId,
];

/**
 * Fetches every Jira issue belonging to any of the given fixVersions, in one JQL
 * query covering the whole set (not one call per release), paginated via
 * `nextPageToken` — the current contract for POST /rest/api/3/search/jql. The
 * older startAt-based /rest/api/3/search endpoint is deprecated (410) on this
 * Jira site, hence this endpoint.
 * Returns raw Jira issue objects; normalize/ticketRecord.js shapes them.
 */
export async function fetchTicketsByFixVersions(releaseNames) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }
  if (releaseNames.length === 0) return [];

  const versionList = releaseNames.map((name) => `"${name}"`).join(',');
  const jql = `fixVersion in (${versionList}) ORDER BY key`;

  const issues = [];
  let nextPageToken;

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults: PAGE_SIZE,
        fields: TICKET_FIELDS,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await response.text();
      throw new Error(
        `Jira API ${response.status} fetching tickets for releases [${releaseNames.join(', ')}]: ${body}`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const page = await response.json();
    issues.push(...page.issues);
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);

  return issues;
}
