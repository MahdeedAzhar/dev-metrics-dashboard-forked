/**
 * Attaches the linked Jira issue (if any) to a normalized PR record. A PR with no
 * resolvable ticket (no ticket id parsed, or the ticket id didn't resolve via the
 * Jira API) gets `jira: null` — it still counts toward PR-velocity metrics, just
 * not toward SP-dependent ones (stale-PR detection, gap justification).
 */
export function joinPrWithJira(prRecord, jiraIssuesByKey) {
  const jira = prRecord.linked_ticket_id ? jiraIssuesByKey[prRecord.linked_ticket_id] ?? null : null;
  return { ...prRecord, jira };
}
