function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error('JIRA_EMAIL / JIRA_API_TOKEN are not set (see .env.example)');
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

const PAGE_SIZE = 100;

/**
 * Fetches a single ticket's full status/field change history. Confirmed live:
 * the bulk /rest/api/3/search/jql endpoint does NOT support changelog
 * expansion — this dedicated per-issue endpoint (paginated via startAt) is the
 * only way to get it, which is why it's cached separately (see
 * cache/store.js's readJiraChangelogCache) rather than fetched on every run
 * like the ticket fields themselves.
 */
export async function fetchTicketChangelog(ticketKey) {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL is not set (see .env.example)');
  }

  const values = [];
  let startAt = 0;
  let total = Infinity;

  while (startAt < total) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(
      `${baseUrl}/rest/api/3/issue/${ticketKey}/changelog?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
      { headers: { Authorization: authHeader(), Accept: 'application/json' } },
    );

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await response.text();
      throw new Error(`Jira API ${response.status} fetching changelog for ${ticketKey}: ${body}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const page = await response.json();
    values.push(...page.values);
    total = page.total;
    startAt += page.values.length;
    if (page.values.length === 0) break; // guard against an infinite loop on an unexpected shape
  }

  return values;
}
