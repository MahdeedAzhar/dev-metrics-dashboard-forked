import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJiraIssue } from '../../src/normalize/ticketRecord.js';

const BASE_URL = 'https://arbisoft.atlassian.net';

// Field shapes below are modeled on real tickets confirmed live against Jira
// (XQ-4821, XQ-5065) during this project's build, including the exact
// customfield IDs and the AI Contribution field's 0-1 fraction storage.
const DONE_TICKET = {
  key: 'XQ-4821',
  fields: {
    summary: 'Enhance Leaderboard Fairness by Filtering Inactive Accounts',
    issuetype: { name: 'Task' },
    status: { name: 'Done', statusCategory: { key: 'done' } },
    assignee: { displayName: 'Bilal Ahmad', accountId: '712020:d5a5a149-9c25-42d0-a552-6f37c9cd72bd' },
    customfield_10010: 2,
    customfield_10833: 3,
    customfield_11729: 0.87,
    fixVersions: [{ id: '16212', name: '8.5.0', released: true, releaseDate: '2026-07-16' }],
    resolutiondate: '2026-07-15T10:00:00.000+0500',
  },
};

const IN_PROGRESS_TICKET_NO_AP_YET = {
  key: 'XQ-5065',
  fields: {
    summary: 'Integration with BE of Daily Quota and Reward Ads',
    issuetype: { name: 'Task' },
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Asad Hassan Farooqi', accountId: '5e8f0892e8b3c50b7c000095' },
    customfield_10010: 5,
    customfield_10833: null,
    customfield_11729: 0,
    fixVersions: [{ id: '16312', name: '8.5.1 (Subscription)', released: false, releaseDate: null }],
    resolutiondate: null,
  },
};

test('normalizeJiraIssue converts the AI Contribution fraction to a 0-100 percent', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), BASE_URL);
  assert.equal(record.ai_contribution_percent, 87);
});

test('normalizeJiraIssue extracts SP/AP correctly and derives status_category from statusCategory.key', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), BASE_URL);
  assert.equal(record.sp, 2);
  assert.equal(record.ap, 3);
  assert.equal(record.status, 'Done');
  assert.equal(record.status_category, 'done');
  assert.equal(record.assignee_display_name, 'Bilal Ahmad');
});

test('normalizeJiraIssue keeps a null AP as null, never coerced to 0', () => {
  const record = normalizeJiraIssue(IN_PROGRESS_TICKET_NO_AP_YET, new Map(), BASE_URL);
  assert.equal(record.ap, null);
});

test('normalizeJiraIssue keeps a genuine 0% AI contribution as 0, not null', () => {
  const record = normalizeJiraIssue(IN_PROGRESS_TICKET_NO_AP_YET, new Map(), BASE_URL);
  assert.equal(record.ai_contribution_percent, 0);
});

test('normalizeJiraIssue treats a missing AI Contribution field as null, not 0', () => {
  const ticket = {
    key: 'XQ-9999',
    fields: { ...DONE_TICKET.fields, customfield_11729: null },
  };
  const record = normalizeJiraIssue(ticket, new Map(), BASE_URL);
  assert.equal(record.ai_contribution_percent, null);
});

test('normalizeJiraIssue handles an unassigned ticket without throwing', () => {
  const ticket = { key: 'XQ-1111', fields: { ...DONE_TICKET.fields, assignee: null } };
  const record = normalizeJiraIssue(ticket, new Map(), BASE_URL);
  assert.equal(record.assignee_display_name, null);
  assert.equal(record.assignee_account_id, null);
});

test('normalizeJiraIssue preserves multiple fix versions', () => {
  const ticket = {
    key: 'XQ-2222',
    fields: {
      ...DONE_TICKET.fields,
      fixVersions: [
        { id: '16212', name: '8.5.0', released: true, releaseDate: '2026-07-16' },
        { id: '16278', name: '8.6.0', released: false, releaseDate: null },
      ],
    },
  };
  const record = normalizeJiraIssue(ticket, new Map(), BASE_URL);
  assert.equal(record.fix_versions.length, 2);
  assert.deepEqual(
    record.fix_versions.map((v) => v.name),
    ['8.5.0', '8.6.0'],
  );
});

test('normalizeJiraIssue builds the Jira URL and defaults to an empty PR evidence list', () => {
  const record = normalizeJiraIssue(DONE_TICKET, new Map(), BASE_URL);
  assert.equal(record.jira_url, 'https://arbisoft.atlassian.net/browse/XQ-4821');
  assert.deepEqual(record.linked_prs, []);
});

test('normalizeJiraIssue attaches PR evidence from the index when present', () => {
  const evidence = [{ repo: 'bvs-xiangqi/xiangqi-client', pr_number: 4001, pr_state: 'merged' }];
  const prIndex = new Map([['XQ-4821', evidence]]);
  const record = normalizeJiraIssue(DONE_TICKET, prIndex, BASE_URL);
  assert.deepEqual(record.linked_prs, evidence);
});
