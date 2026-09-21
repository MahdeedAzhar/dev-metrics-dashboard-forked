import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNewOrUpdatedPullRequests,
  fetchPullRequestActivity,
  parseNextLink,
  splitRepo,
} from '../../src/fetch/github.js';
import { testConfig, mockFetch } from '../helpers/config.js';

const CONFIG = testConfig();

test('parseNextLink extracts the rel="next" URL', () => {
  assert.equal(
    parseNextLink('<https://x/p?page=2>; rel="next", <https://x/p?page=5>; rel="last"'),
    'https://x/p?page=2',
  );
  assert.equal(parseNextLink('<https://x/p?page=5>; rel="last"'), null);
  assert.equal(parseNextLink(null), null);
});

test('splitRepo validates owner/name', () => {
  assert.deepEqual(splitRepo('acme/app'), { owner: 'acme', name: 'app' });
  assert.throws(() => splitRepo('acme'), /owner\/name/);
});

test('fetchNewOrUpdatedPullRequests stops at the watermark and honours the base-branch filter', async () => {
  const page = [
    { number: 3, updated_at: '2026-09-03T00:00:00Z' },
    { number: 2, updated_at: '2026-09-02T00:00:00Z' },
    { number: 1, updated_at: '2026-09-01T00:00:00Z' },
  ];
  const restore = mockFetch([['/pulls?', { json: page }]]);
  try {
    const prs = await fetchNewOrUpdatedPullRequests('acme/acme-client', '2026-09-02T00:00:00Z', CONFIG);
    assert.deepEqual(
      prs.map((p) => p.number),
      [3],
    );
    assert.ok(!restore.calls[0].url.includes('base='));

    const branchConfig = testConfig({ GITHUB_BASE_BRANCH: 'develop' });
    await fetchNewOrUpdatedPullRequests('acme/acme-client', null, branchConfig);
    assert.ok(restore.calls[1].url.includes('&base=develop'));
    assert.equal(restore.calls[1].init.headers.Authorization, 'Bearer ghp_test');
  } finally {
    restore();
  }
});

test('fetchNewOrUpdatedPullRequests surfaces auth failures with the GitHub message', async () => {
  const restore = mockFetch([['/pulls?', { status: 401, json: { message: 'Bad credentials' } }]]);
  try {
    await assert.rejects(
      fetchNewOrUpdatedPullRequests('acme/acme-client', null, CONFIG),
      /GitHub API 401 .*Bad credentials/,
    );
  } finally {
    restore();
  }
});

test('fetchPullRequestActivity degrades to empty lists when a sub-request fails', async () => {
  const restore = mockFetch([
    [/\/commits/, { json: [{ sha: 'a' }] }],
    [/\/reviews/, { status: 500, text: 'boom' }],
    [/\/comments/, { json: [] }],
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const activity = await fetchPullRequestActivity('acme/acme-client', 1, CONFIG);
    assert.deepEqual(activity, { commits: [], reviews: [], comments: [] });
  } finally {
    console.warn = originalWarn;
    restore();
  }
});
