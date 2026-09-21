import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJiraFieldUpdatePayload,
  buildJiraCommentAdf,
  buildReleaseJql,
  ticketSearchFields,
  updateJiraIssueField,
  postJiraComment,
  fetchTicketsByFixVersions,
} from '../../src/fetch/jira.js';
import { assertIssueKey } from '../../src/fetch/jiraClient.js';
import { testConfig, mockFetch } from '../helpers/config.js';

const CONFIG = testConfig();

test('buildJiraFieldUpdatePayload wraps plain text fields for Jira', () => {
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('summary', 'Ship it', CONFIG), { fields: { summary: 'Ship it' } });
});

test('buildJiraFieldUpdatePayload maps assignee values to Jira accountId shape', () => {
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('assignee', 'user-123', CONFIG), {
    fields: { assignee: { accountId: 'user-123' } },
  });
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('assignee', '', CONFIG), { fields: { assignee: null } });
});

test('buildJiraFieldUpdatePayload uses the configured custom field ids and scale', () => {
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('sp', '5', CONFIG), { fields: { customfield_10010: 5 } });
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('actual_points', 3, CONFIG), { fields: { customfield_10833: 3 } });
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('ai_contribution_percent', 40, CONFIG), {
    fields: { customfield_11729: 0.4 },
  });

  const percent = testConfig({ JIRA_AI_CONTRIBUTION_SCALE: 'percent' });
  assert.deepStrictEqual(buildJiraFieldUpdatePayload('ai_contribution_percent', 40, percent), {
    fields: { customfield_11729: 40 },
  });
});

test('buildJiraFieldUpdatePayload refuses arbitrary or unconfigured fields', () => {
  assert.throws(() => buildJiraFieldUpdatePayload('description', 'x', CONFIG), /cannot be edited/);
  assert.throws(() => buildJiraFieldUpdatePayload('customfield_99999', 'x', CONFIG), /cannot be edited/);
  assert.throws(() => buildJiraFieldUpdatePayload('sp', 'five', CONFIG), /numeric/);
  assert.throws(() => buildJiraFieldUpdatePayload('ai_contribution_percent', 150, CONFIG), /between 0 and 100/);
  const noAp = testConfig({ JIRA_ACTUAL_POINTS_FIELD: '' });
  assert.throws(() => buildJiraFieldUpdatePayload('ap', 3, noAp), /not configured/);
  const readOnly = testConfig({ JIRA_EDITING_ENABLED: 'false' });
  assert.throws(() => buildJiraFieldUpdatePayload('sp', 3, readOnly), /disabled/);
});

test('buildJiraCommentAdf wraps plain text in Atlassian Document Format', () => {
  assert.deepStrictEqual(buildJiraCommentAdf('  Alice spent 2h on code review '), {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice spent 2h on code review' }] }],
  });
});

test('assertIssueKey accepts project keys and rejects injection attempts', () => {
  assert.equal(assertIssueKey(' acme-12 '), 'ACME-12');
  assert.throws(() => assertIssueKey('ACME-12 OR 1=1'), /not a valid Jira issue key/);
  assert.throws(() => assertIssueKey('../secret'), /not a valid Jira issue key/);
  assert.throws(() => assertIssueKey(''), /not a valid Jira issue key/);
});

test('buildReleaseJql scopes to the project and escapes quotes', () => {
  assert.equal(
    buildReleaseJql(['1.0', 'Sprint "A"'], CONFIG),
    'project = "ACME" AND fixVersion in ("1.0", "Sprint \\"A\\"") ORDER BY key',
  );
  const typed = testConfig({ JIRA_ISSUE_TYPES: 'Story,Bug' });
  assert.match(buildReleaseJql(['1.0'], typed), /issuetype in \("Story", "Bug"\)/);
});

test('ticketSearchFields only requests configured custom fields', () => {
  const minimal = testConfig({ JIRA_ACTUAL_POINTS_FIELD: '', JIRA_AI_CONTRIBUTION_FIELD: '' });
  assert.ok(ticketSearchFields(minimal).includes('customfield_10010'));
  assert.ok(!ticketSearchFields(minimal).includes('customfield_10833'));
});

test('updateJiraIssueField PUTs the payload and surfaces Jira errors verbatim', async () => {
  const restore = mockFetch([
    [/\/issue\/ACME-1$/, { status: 204, text: '' }],
    [/\/issue\/ACME-2$/, { status: 400, json: { errorMessages: ["Field 'customfield_10010' cannot be set."] } }],
  ]);
  try {
    const result = await updateJiraIssueField('ACME-1', 'sp', 8, CONFIG);
    assert.deepEqual(result, { key: 'ACME-1', field: 'sp', value: 8 });
    assert.equal(restore.calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(restore.calls[0].init.body), { fields: { customfield_10010: 8 } });
    assert.match(restore.calls[0].init.headers.Authorization, /^Basic /);

    await assert.rejects(
      updateJiraIssueField('ACME-2', 'sp', 8, CONFIG),
      /Jira API 400 updating sp on ACME-2: .*cannot be set/,
    );
  } finally {
    restore();
  }
});

test('updateJiraIssueField changes status through an available transition only', async () => {
  const restore = mockFetch([
    [
      /\/transitions$/,
      (url, init) =>
        init.method === 'POST'
          ? { status: 204, text: '' }
          : { json: { transitions: [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] } },
    ],
  ]);
  try {
    await updateJiraIssueField('ACME-1', 'status', 'in progress', CONFIG);
    const post = restore.calls.find((c) => c.init.method === 'POST');
    assert.deepEqual(JSON.parse(post.init.body), { transition: { id: '31' } });
    await assert.rejects(
      updateJiraIssueField('ACME-1', 'status', 'Done', CONFIG),
      /No Jira transition to "Done".*available: In Progress/,
    );
  } finally {
    restore();
  }
});

test('postJiraComment rejects empty bodies before any network call', async () => {
  const restore = mockFetch([]);
  try {
    await assert.rejects(postJiraComment('ACME-1', '   ', CONFIG), /must not be empty/);
    assert.equal(restore.calls.length, 0);
  } finally {
    restore();
  }
});

test('fetchTicketsByFixVersions follows nextPageToken pagination', async () => {
  const restore = mockFetch([
    [
      '/rest/api/3/search/jql',
      (url, init) => {
        const body = JSON.parse(init.body);
        return body.nextPageToken
          ? { json: { issues: [{ key: 'ACME-2', fields: {} }], isLast: true } }
          : { json: { issues: [{ key: 'ACME-1', fields: {} }], isLast: false, nextPageToken: 'p2' } };
      },
    ],
  ]);
  try {
    const issues = await fetchTicketsByFixVersions(['1.0'], CONFIG);
    assert.deepEqual(
      issues.map((i) => i.key),
      ['ACME-1', 'ACME-2'],
    );
    assert.equal(restore.calls.length, 2);
    assert.match(JSON.parse(restore.calls[0].init.body).jql, /^project = "ACME"/);
  } finally {
    restore();
  }
});
