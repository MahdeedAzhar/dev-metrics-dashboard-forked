const TITLE_TICKET_RE = /^\s*([A-Z][A-Z0-9]+-\d+)\s*:/;
const BODY_LINK_TICKET_RE = /^\s*\[([A-Z][A-Z0-9]+-\d+)]\(/m;

/**
 * Extracts the Jira ticket id linked to a PR. Title takes precedence (this org's
 * `<TICKET>: <description>` convention); falls back to the leading markdown link
 * in the PR body (`[XQ-1234](...)`). Returns { ticketId: null, source: 'none' }
 * rather than throwing when neither convention matches.
 */
export function extractTicketId(title, body) {
  const titleMatch = TITLE_TICKET_RE.exec(title ?? '');
  if (titleMatch) {
    return { ticketId: titleMatch[1], source: 'title' };
  }

  const bodyMatch = BODY_LINK_TICKET_RE.exec(body ?? '');
  if (bodyMatch) {
    return { ticketId: bodyMatch[1], source: 'body' };
  }

  return { ticketId: null, source: 'none' };
}
