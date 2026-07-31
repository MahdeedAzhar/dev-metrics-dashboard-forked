import { jiraStoryPointsFieldId } from '../../config/config.js';

const CHUNK_SIZE = 50;

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error('JIRA_EMAIL / JIRA_API_TOKEN are not set (see .env.example)');
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function toIssueRecord(issue) {
  return {
    ticket_id: issue.key,
    summary: issue.fields.summary ?? null,
    status: issue.fields.status?.name ?? null,
    issue_type: issue.fields.issuetype?.name ?? null,
    story_points: issue.fields[jiraStoryPointsFieldId] ?? null,
    resolved_at: issue.fields.resolutiondate ?? null,
    fix_versions: (issue.fields.fixVersions ?? []).map((v) => v.name),
  };
}

/**
 * Batch-fetches Jira issues by key (JQL `key in (...)`), chunked to keep each
 * request small. Keys that don't resolve (deleted/inaccessible ticket) are simply
 * absent from the returned map rather than causing the whole batch to fail.
 */
export async function fetchIssuesByKeys(keys) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }

  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  const issuesByKey = {};

  for (const batch of chunk(uniqueKeys, CHUNK_SIZE)) {
    const jql = `key in (${batch.join(',')})`;
    const response = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jql,
        maxResults: CHUNK_SIZE,
        fields: ['summary', 'status', 'issuetype', 'resolutiondate', 'fixVersions', jiraStoryPointsFieldId],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API ${response.status} for batch [${batch.join(',')}]: ${body}`);
    }

    const { issues } = await response.json();
    for (const issue of issues) {
      issuesByKey[issue.key] = toIssueRecord(issue);
    }
  }

  return issuesByKey;
}
