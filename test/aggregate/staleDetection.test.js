import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedDaysForSp,
  resolveExpectedDays,
  resolvePrSp,
  checkOpenPrStaleness,
  computeGapStatus,
} from '../../src/aggregate/staleDetection.js';

test('resolvePrSp prioritizes Jira Story Points over the self-reported PR-body SP', () => {
  const pr = {
    jira: { story_points: 8 },
    planned_sp: { parsed_numeric: 2 },
    actual_sp: { parsed_numeric: 2 },
  };
  assert.equal(resolvePrSp(pr), 8);
});

test('resolvePrSp falls back to Planned SP, then Actual SP, when Jira has no story points', () => {
  assert.equal(
    resolvePrSp({ jira: { story_points: null }, planned_sp: { parsed_numeric: 3 }, actual_sp: { parsed_numeric: 5 } }),
    3,
  );
  assert.equal(
    resolvePrSp({ jira: null, planned_sp: { parsed_numeric: null }, actual_sp: { parsed_numeric: 5 } }),
    5,
  );
  assert.equal(
    resolvePrSp({ jira: null, planned_sp: { parsed_numeric: null }, actual_sp: { parsed_numeric: null } }),
    null,
  );
});

test('expectedDaysForSp uses the team heuristic table for known SP values', () => {
  assert.equal(expectedDaysForSp(1), 0.5);
  assert.equal(expectedDaysForSp(2), 1);
  assert.equal(expectedDaysForSp(3), 2);
  assert.equal(expectedDaysForSp(5), 3);
  assert.equal(expectedDaysForSp(8), 5);
});

test('expectedDaysForSp linearly approximates SP values outside the table', () => {
  assert.equal(expectedDaysForSp(13), 13 * 0.625);
  assert.equal(expectedDaysForSp(0), 0.5); // floored to spMinDays
});

test('expectedDaysForSp returns null for non-numeric input', () => {
  assert.equal(expectedDaysForSp(null), null);
  assert.equal(expectedDaysForSp(undefined), null);
  assert.equal(expectedDaysForSp(NaN), null);
});

test('resolveExpectedDays prefers Planned SP, then Actual SP, then team median, then no-data', () => {
  const withPlanned = resolveExpectedDays({
    planned_sp: { parsed_numeric: 5 },
    actual_sp: { parsed_numeric: 8 },
  });
  assert.equal(withPlanned.confidence, 'sp');
  assert.equal(withPlanned.sp_used, 5);
  assert.equal(withPlanned.expected_days, 3);

  const withActualOnly = resolveExpectedDays({
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: 8 },
  });
  assert.equal(withActualOnly.sp_used, 8);
  assert.equal(withActualOnly.expected_days, 5);

  const withTeamMedian = resolveExpectedDays(
    { planned_sp: { parsed_numeric: null }, actual_sp: { parsed_numeric: null } },
    { teamMedianDays: 2.5 },
  );
  assert.equal(withTeamMedian.confidence, 'team_median');
  assert.equal(withTeamMedian.expected_days, 2.5);

  const noData = resolveExpectedDays({
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: null },
  });
  assert.equal(noData.confidence, 'no_data');
  assert.equal(noData.expected_days, null);
});

test('checkOpenPrStaleness flags a PR open well beyond its SP-implied duration', () => {
  const now = new Date('2026-07-30T00:00:00Z');
  const pr = {
    id: 'repo#1',
    created_at: '2026-07-20T00:00:00Z', // 10 days open
    planned_sp: { parsed_numeric: 2 }, // expected 1 day -> ratio 10, way over 1.5x
    actual_sp: { parsed_numeric: null },
  };
  const result = checkOpenPrStaleness(pr, now);
  assert.equal(result.flag_status, 'FLAGGED_STALE_PR');
  assert.equal(result.expected_days, 1);
  assert.ok(result.ratio > 1.5);
});

test('checkOpenPrStaleness does not flag a PR within its SP-implied duration', () => {
  const now = new Date('2026-07-22T00:00:00Z');
  const pr = {
    id: 'repo#2',
    created_at: '2026-07-20T00:00:00Z', // 2 days open
    planned_sp: { parsed_numeric: 5 }, // expected 3 days -> ratio 0.67
    actual_sp: { parsed_numeric: null },
  };
  const result = checkOpenPrStaleness(pr, now);
  assert.equal(result.flag_status, 'OK');
});

test('checkOpenPrStaleness returns NO_DATA when no SP or team median is available', () => {
  const now = new Date('2026-07-22T00:00:00Z');
  const pr = {
    id: 'repo#3',
    created_at: '2026-07-20T00:00:00Z',
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: null },
  };
  const result = checkOpenPrStaleness(pr, now);
  assert.equal(result.flag_status, 'NO_DATA');
  assert.equal(result.expected_days, null);
});

test('checkOpenPrStaleness never fabricates a ratio off the team-median fallback, even for a very small median', () => {
  const now = new Date('2026-07-22T00:00:00Z');
  // No SP anywhere, only a rough team-median fallback of a few hours (0.2 days) —
  // a real scenario once the median excludes only estimated PRs but a cluster of
  // quick merges still pulls it low. A 2-day-old PR here must not read as "10x stale".
  const shortOpenPr = {
    id: 'repo#4',
    created_at: '2026-07-20T00:00:00Z', // 2 days open
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: null },
  };
  const result = checkOpenPrStaleness(shortOpenPr, now, { teamMedianDays: 0.2 });
  assert.equal(result.confidence, 'team_median');
  assert.equal(result.ratio, null);
  assert.equal(result.flag_status, 'OK');
});

test('checkOpenPrStaleness still flags a genuinely long-open PR with no SP, via the absolute days-open threshold', () => {
  const now = new Date('2026-08-15T00:00:00Z');
  const longOpenPr = {
    id: 'repo#5',
    created_at: '2026-07-01T00:00:00Z', // 45 days open
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: null },
  };
  const result = checkOpenPrStaleness(longOpenPr, now, { teamMedianDays: 0.2 });
  assert.equal(result.confidence, 'team_median');
  assert.equal(result.ratio, null);
  assert.equal(result.flag_status, 'FLAGGED_STALE_PR');
});

test('computeGapStatus is OK when the gap is under the threshold', () => {
  assert.equal(computeGapStatus(3, []), 'OK');
});

test('computeGapStatus flags an unexplained gap with no open PRs', () => {
  assert.equal(computeGapStatus(7, []), 'FLAGGED_UNEXPLAINED');
});

test('computeGapStatus justifies a gap covered by an open PR\'s SP-implied duration', () => {
  const openPrs = [{ expected_days: 8, flag_status: 'OK' }];
  assert.equal(computeGapStatus(6, openPrs), 'JUSTIFIED_BY_SP');
});

test('computeGapStatus flags a gap where the open PR itself is stale', () => {
  const openPrs = [{ expected_days: 8, flag_status: 'FLAGGED_STALE_PR' }];
  assert.equal(computeGapStatus(6, openPrs), 'FLAGGED_STALE_PR');
});

test('computeGapStatus anchors on the open PR with the largest expected duration', () => {
  const openPrs = [
    { expected_days: 1, flag_status: 'OK' },
    { expected_days: 10, flag_status: 'OK' },
  ];
  assert.equal(computeGapStatus(6, openPrs), 'JUSTIFIED_BY_SP');
});

test('computeGapStatus is NO_DATA when the developer has never opened a PR', () => {
  assert.equal(computeGapStatus(null, []), 'NO_DATA');
});
