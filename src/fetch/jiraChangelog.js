import { getConfig } from '../config/index.js';
import { assertIssueKey, jiraRequest } from './jiraClient.js';

const PAGE_SIZE = 100;

/**
 * Fetches a single ticket's full change history. The bulk search endpoint
 * does not support changelog expansion, so this dedicated per-issue endpoint
 * (paginated via startAt) is the only way to get status transitions — which
 * is why changelogs are cached per ticket (see src/index.js syncChangelogs)
 * instead of refetched on every run like the ticket fields.
 */
export async function fetchTicketChangelog(ticketKey, config = getConfig()) {
  const key = assertIssueKey(ticketKey);
  const values = [];
  let startAt = 0;
  let total = Infinity;

  while (startAt < total) {
    const page = await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
      { action: `fetching changelog for ${key}`, config },
    );
    const pageValues = page?.values ?? [];
    values.push(...pageValues);
    total = page?.total ?? 0;
    startAt += pageValues.length;
    if (pageValues.length === 0) break; // guard against an infinite loop on an unexpected shape
  }

  return values;
}
