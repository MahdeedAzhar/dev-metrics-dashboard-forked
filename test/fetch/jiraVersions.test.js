import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTrackedReleases, toReleaseRecord, resolveReleases } from '../../src/fetch/jiraVersions.js';
import { testConfig, mockFetch } from '../helpers/config.js';

const NOW = new Date('2026-09-21T00:00:00Z');
const VERSIONS = [
  { id: '1', name: '1.0.0', released: true, archived: false, releaseDate: '2026-01-10' },
  { id: '2', name: '1.1.0', released: true, archived: false, releaseDate: '2026-08-01' },
  { id: '3', name: '1.2.0', released: false, archived: false, startDate: '2026-08-15', releaseDate: '2026-10-01' },
  { id: '4', name: '2.0.0', released: false, archived: false, startDate: '2026-11-01' },
  { id: '5', name: '0.9.0', released: true, archived: true, releaseDate: '2025-01-01' },
  { id: '6', name: 'Undated', released: true, archived: false },
];

test('selectTrackedReleases keeps unreleased, recent and undated releases; drops old and archived', () => {
  const names = selectTrackedReleases(VERSIONS, { lookbackMonths: 6, now: NOW }).map((r) => r.name);
  assert.deepEqual(names, ['1.2.0', '2.0.0', '1.1.0', 'Undated']);
});

test('toReleaseRecord classifies released / active / upcoming', () => {
  assert.equal(toReleaseRecord(VERSIONS[1], NOW).state, 'released');
  assert.equal(toReleaseRecord(VERSIONS[2], NOW).state, 'active');
  assert.equal(toReleaseRecord(VERSIONS[3], NOW).state, 'upcoming');
  assert.equal(toReleaseRecord({ name: 'x', released: false }, NOW).state, 'active');
});

test('resolveReleases honours an explicit override and flags unknown names', async () => {
  const restore = mockFetch([['/rest/api/3/project/ACME/versions', { json: VERSIONS }]]);
  try {
    const releases = await resolveReleases({ override: ['1.1.0', 'typo'], config: testConfig(), now: NOW });
    assert.deepEqual(
      releases.map((r) => [r.name, r.state]),
      [
        ['1.1.0', 'released'],
        ['typo', 'unknown'],
      ],
    );
  } finally {
    restore();
  }
});

test('resolveReleases uses JIRA_RELEASES when configured and discovery otherwise', async () => {
  const restore = mockFetch([['/versions', { json: VERSIONS }]]);
  try {
    const explicit = await resolveReleases({ config: testConfig({ JIRA_RELEASES: '1.0.0' }), now: NOW });
    assert.deepEqual(
      explicit.map((r) => r.name),
      ['1.0.0'],
    );
    const discovered = await resolveReleases({ config: testConfig({ JIRA_RELEASE_LOOKBACK_MONTHS: '12' }), now: NOW });
    assert.deepEqual(
      discovered.map((r) => r.name),
      ['1.2.0', '2.0.0', '1.1.0', '1.0.0', 'Undated'],
    );
  } finally {
    restore();
  }
});

test('resolveReleases fails loudly when Jira rejects the request', async () => {
  const restore = mockFetch([['/versions', { status: 404, text: 'No project could be found with key ACME' }]]);
  try {
    await assert.rejects(
      resolveReleases({ config: testConfig(), now: NOW }),
      /Jira API 404 fetching versions for project ACME/,
    );
  } finally {
    restore();
  }
});
