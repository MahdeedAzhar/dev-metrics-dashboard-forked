import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, publicConfig } from '../../src/config/index.js';
import { TEST_ENV, testConfig } from '../helpers/config.js';

test('loads a complete configuration with defaults applied', () => {
  const config = testConfig();
  assert.equal(config.project.name, 'Acme Platform');
  assert.equal(config.jira.projectKey, 'ACME');
  assert.deepEqual([...config.jira.statuses.inProgress], ['In Progress']);
  assert.deepEqual([...config.jira.statuses.codeReview], ['Code Review']);
  assert.equal(config.jira.releases.lookbackMonths, 6);
  assert.equal(config.github.lookbackDays, 90);
  assert.equal(config.github.stalePrAfterDays, 14);
  assert.deepEqual([...config.github.repos], ['acme/acme-client', 'acme/acme-server']);
  assert.equal(config.aiContribution.checklistHeading, 'AI Contribution Checklist');
  assert.equal(config.assistant.enabled, false);
  assert.equal(config.features.actualPoints, true);
  assert.equal(config.features.github, true);
});

test('reports every missing required variable in one error', () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.ok(error instanceof ConfigError);
      for (const key of [
        'JIRA_BASE_URL',
        'JIRA_EMAIL',
        'JIRA_API_TOKEN',
        'JIRA_PROJECT_KEY',
        'JIRA_STORY_POINTS_FIELD',
      ]) {
        assert.ok(
          error.problems.some((p) => p.startsWith(key)),
          `expected a problem for ${key}`,
        );
      }
      return true;
    },
  );
});

test('GitHub is optional: no repos disables the feature without an error', () => {
  const config = testConfig({ GITHUB_REPOS: '', GITHUB_TOKEN: '' });
  assert.equal(config.features.github, false);
  assert.deepEqual([...config.github.repos], []);
});

test('GITHUB_TOKEN is required once repos are configured', () => {
  assert.throws(() => testConfig({ GITHUB_TOKEN: '' }), /GITHUB_TOKEN is required/);
});

test('rejects malformed repositories, field ids, project keys and scale', () => {
  assert.throws(() => testConfig({ GITHUB_REPOS: 'not-a-repo' }), /owner\/name/);
  assert.throws(() => testConfig({ JIRA_STORY_POINTS_FIELD: 'story points' }), /customfield_12345/);
  assert.throws(() => testConfig({ JIRA_ACTUAL_POINTS_FIELD: 'ap' }), /JIRA_ACTUAL_POINTS_FIELD/);
  assert.throws(() => testConfig({ JIRA_PROJECT_KEY: '1abc' }), /JIRA_PROJECT_KEY/);
  assert.throws(() => testConfig({ JIRA_AI_CONTRIBUTION_SCALE: 'ratio' }), /fraction/);
  assert.throws(() => testConfig({ JIRA_BASE_URL: 'acme.atlassian.net' }), /https:\/\//);
});

test('optional Jira fields toggle their features', () => {
  const config = testConfig({ JIRA_ACTUAL_POINTS_FIELD: '', JIRA_AI_CONTRIBUTION_FIELD: '' });
  assert.equal(config.jira.fields.actualPoints, null);
  assert.equal(config.features.actualPoints, false);
  assert.equal(config.features.aiContribution, true); // PR signals still work
  assert.equal(config.features.jiraAiField, false);

  const disabled = testConfig({ AI_CONTRIBUTION_ENABLED: 'false' });
  assert.equal(disabled.features.aiContribution, false);
});

test('parses lists, trailing slashes and boolean flags', () => {
  const config = testConfig({
    JIRA_BASE_URL: 'https://acme.atlassian.net/',
    JIRA_IN_PROGRESS_STATUSES: ' In Progress , Development ',
    JIRA_RELEASES: 'v1, v2',
    JIRA_EDITING_ENABLED: 'no',
    AI_API_KEY: 'sk-test',
  });
  assert.equal(config.jira.baseUrl, 'https://acme.atlassian.net');
  assert.deepEqual([...config.jira.statuses.inProgress], ['In Progress', 'Development']);
  assert.deepEqual([...config.jira.releases.explicit], ['v1', 'v2']);
  assert.equal(config.features.jiraEditing, false);
  assert.equal(config.features.assistant, true);
});

test('review comment template must contain both placeholders', () => {
  assert.throws(() => testConfig({ REVIEW_COMMENT_TEMPLATE: 'reviewed by {reviewer}' }), /\{time\}/);
});

test('dashboard credentials must be set together', () => {
  assert.throws(() => testConfig({ DASHBOARD_USERNAME: 'admin' }), /must be set together/);
});

test('publicConfig never exposes secrets', () => {
  const json = JSON.stringify(
    publicConfig(testConfig({ AI_API_KEY: 'sk-secret', BLOB_READ_WRITE_TOKEN: 'blob-secret' })),
  );
  assert.ok(!json.includes('test-token'));
  assert.ok(!json.includes('ghp_test'));
  assert.ok(!json.includes('sk-secret'));
  assert.ok(!json.includes('blob-secret'));
  assert.ok(!json.includes(TEST_ENV.JIRA_EMAIL));
  assert.ok(json.includes('"project_key":"ACME"'));
});
