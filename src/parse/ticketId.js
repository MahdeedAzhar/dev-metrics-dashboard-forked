const KEY = '([A-Z][A-Z0-9_]*-\\d+)';
// Title conventions, in priority order: "ABC-123: ...", "[ABC-123] ...", "ABC-123 - ...", "feat(ABC-123): ..."
const TITLE_PATTERNS = [
  new RegExp(`^\\s*${KEY}\\s*[:\\-–—]`),
  new RegExp(`^\\s*\\[${KEY}\\]`),
  new RegExp(`^\\s*\\w+(?:\\([^)]*\\))?:\\s*${KEY}\\b`),
  new RegExp(`^\\s*\\w+\\(${KEY}\\)`),
];
// Body conventions: a leading markdown link "[ABC-123](...)" or a "Jira: ABC-123" / "Ticket: ABC-123" line.
const BODY_PATTERNS = [
  new RegExp(`^\\s*\\[${KEY}\\]\\(`, 'm'),
  new RegExp(`^\\s*(?:jira|ticket|issue)\\s*:?\\s*(?:\\[)?${KEY}`, 'im'),
];

/**
 * Extracts the Jira ticket key linked to a PR. The title takes precedence over
 * the body. When `projectKey` is given, only keys from that project count — a
 * PR titled "OTHER-1: ..." in a shared repo is treated as unlinked rather than
 * attached to a ticket the dashboard will never fetch. Returns
 * { ticketId: null, source: 'none' } rather than throwing when nothing matches.
 */
export function extractTicketId(title, body, { projectKey = null } = {}) {
  const accept = (key) => !projectKey || key.split('-')[0] === projectKey;

  for (const pattern of TITLE_PATTERNS) {
    const match = pattern.exec(title ?? '');
    if (match && accept(match[1])) return { ticketId: match[1], source: 'title' };
  }
  for (const pattern of BODY_PATTERNS) {
    const match = pattern.exec(body ?? '');
    if (match && accept(match[1])) return { ticketId: match[1], source: 'body' };
  }
  return { ticketId: null, source: 'none' };
}
