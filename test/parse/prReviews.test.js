import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePrReviews } from '../../src/parse/prReviews.js';

const PR = { user: { login: 'author' }, created_at: '2026-09-01T00:00:00Z', merged_at: '2026-09-03T00:00:00Z' };

test('computes reviewers and review timings from formal reviews and comments', () => {
  const reviews = [
    { user: { login: 'author' }, state: 'COMMENTED', submitted_at: '2026-09-01T01:00:00Z' },
    { user: { login: 'bob' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-09-01T12:00:00Z' },
    { user: { login: 'alice' }, state: 'APPROVED', submitted_at: '2026-09-02T00:00:00Z' },
    { user: { login: 'dependabot[bot]' }, state: 'COMMENTED', submitted_at: '2026-09-01T00:30:00Z' },
  ];
  const comments = [{ user: { login: 'carol' }, created_at: '2026-09-01T06:00:00Z' }];
  const summary = summarizePrReviews(PR, reviews, comments);
  assert.deepEqual(summary.reviewers, ['alice', 'bob']);
  assert.equal(summary.review_count, 2);
  assert.equal(summary.time_to_first_review_hours, 6); // carol's comment
  assert.equal(summary.time_to_approval_hours, 24);
  assert.equal(summary.review_completion_time_hours, 42); // 06:00 day 1 → 00:00 day 3
  assert.equal(summary.author_login, 'author');
});

test('returns nulls (never 0) when a PR has no review activity', () => {
  const summary = summarizePrReviews({ ...PR, merged_at: null }, [], []);
  assert.deepEqual(summary.reviewers, []);
  assert.equal(summary.time_to_first_review_hours, null);
  assert.equal(summary.time_to_approval_hours, null);
  assert.equal(summary.review_completion_time_hours, null);
});

test('review completion is null for unmerged PRs even when reviewed', () => {
  const summary = summarizePrReviews(
    { ...PR, merged_at: null },
    [{ user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-09-02T00:00:00Z' }],
    [],
  );
  assert.equal(summary.time_to_approval_hours, 24);
  assert.equal(summary.review_completion_time_hours, null);
});
