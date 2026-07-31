import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSpeedScoreForPr,
  computeQualityScore,
  computeAiLeverageScore,
  computeCompositeScore,
  colorBandFor,
} from '../../src/aggregate/scoring.js';

test('computeSpeedScoreForPr caps at 100 for a PR merged faster than its SP-implied duration', () => {
  const pr = {
    created_at: '2026-07-20T00:00:00Z',
    merged_at: '2026-07-20T12:00:00Z', // 12h, expected 3 SP -> 3 days = 72h
    planned_sp: { parsed_numeric: 3 },
    actual_sp: { parsed_numeric: null },
  };
  assert.equal(computeSpeedScoreForPr(pr), 100);
});

test('computeSpeedScoreForPr degrades linearly when merged later than expected', () => {
  const pr = {
    created_at: '2026-07-20T00:00:00Z',
    merged_at: '2026-07-22T00:00:00Z', // 48h, expected 1 SP -> 0.5 day = 12h -> ratio 4
    planned_sp: { parsed_numeric: 1 },
    actual_sp: { parsed_numeric: null },
  };
  // ratio = 4 -> score = clamp(100 - (4-1)*100, 0, 100) = 0
  assert.equal(computeSpeedScoreForPr(pr), 0);
});

test('computeSpeedScoreForPr returns null when there is no SP to anchor against', () => {
  const pr = {
    created_at: '2026-07-20T00:00:00Z',
    merged_at: '2026-07-21T00:00:00Z',
    planned_sp: { parsed_numeric: null },
    actual_sp: { parsed_numeric: null },
  };
  assert.equal(computeSpeedScoreForPr(pr), null);
});

test('computeSpeedScoreForPr returns null for a PR that has not merged', () => {
  const pr = {
    created_at: '2026-07-20T00:00:00Z',
    merged_at: null,
    planned_sp: { parsed_numeric: 3 },
    actual_sp: { parsed_numeric: null },
  };
  assert.equal(computeSpeedScoreForPr(pr), null);
});

test('computeQualityScore is the first-pass-approval rate', () => {
  const mergedPrs = [
    { review_cycle_count: 0 },
    { review_cycle_count: 0 },
    { review_cycle_count: 1 },
    { review_cycle_count: 2 },
  ];
  assert.equal(computeQualityScore(mergedPrs), 50);
});

test('computeQualityScore is null with no merged PRs', () => {
  assert.equal(computeQualityScore([]), null);
});

test('computeAiLeverageScore averages only PRs with an available checklist and reports coverage', () => {
  const prs = [
    { ai_contribution: { available: true, overall_score_percent: 80 } },
    { ai_contribution: { available: true, overall_score_percent: 60 } },
    { ai_contribution: { available: false, overall_score_percent: null } },
  ];
  const { score, coveragePercent } = computeAiLeverageScore(prs);
  assert.equal(score, 70);
  assert.equal(coveragePercent, (2 / 3) * 100);
});

test('computeAiLeverageScore returns null score with 0 coverage when nothing is available', () => {
  const prs = [{ ai_contribution: { available: false, overall_score_percent: null } }];
  const { score, coveragePercent } = computeAiLeverageScore(prs);
  assert.equal(score, null);
  assert.equal(coveragePercent, 0);
});

test('computeCompositeScore renormalizes weights when a sub-score is missing', () => {
  // Only quality (0.3) and ai (0.3) present -> equal weight -> simple average.
  const composite = computeCompositeScore({ speedScore: null, qualityScore: 80, aiLeverageScore: 60 });
  assert.equal(composite, 70);
});

test('computeCompositeScore returns null when no sub-scores are available', () => {
  assert.equal(computeCompositeScore({ speedScore: null, qualityScore: null, aiLeverageScore: null }), null);
});

test('computeCompositeScore scales a sub-score\'s influence down when its coverage is low', () => {
  // Speed=100 at only 20% coverage should pull far less than the same 100 at full coverage.
  const lowCoverage = computeCompositeScore({
    speedScore: 100,
    speedCoveragePercent: 20,
    qualityScore: 50,
    aiLeverageScore: 50,
  });
  const fullCoverage = computeCompositeScore({
    speedScore: 100,
    speedCoveragePercent: 100,
    qualityScore: 50,
    aiLeverageScore: 50,
  });
  assert.ok(lowCoverage < fullCoverage);
  // Effective weights: speed 0.4*0.2=0.08, quality 0.3, ai 0.3 -> sum 0.68
  const expected = (100 * 0.4 * 0.2 + 50 * 0.3 + 50 * 0.3) / (0.4 * 0.2 + 0.3 + 0.3);
  assert.equal(lowCoverage, expected);
});

test('computeCompositeScore excludes a sub-score entirely at 0% coverage', () => {
  const composite = computeCompositeScore({
    speedScore: 100,
    speedCoveragePercent: 0,
    qualityScore: 80,
    aiLeverageScore: 60,
  });
  // Same as if speed were never provided at all.
  assert.equal(composite, computeCompositeScore({ speedScore: null, qualityScore: 80, aiLeverageScore: 60 }));
});

test('colorBandFor buckets composite scores into green/yellow/red', () => {
  assert.equal(colorBandFor(85), 'green');
  assert.equal(colorBandFor(80), 'green');
  assert.equal(colorBandFor(65), 'yellow');
  assert.equal(colorBandFor(60), 'yellow');
  assert.equal(colorBandFor(59.9), 'red');
  assert.equal(colorBandFor(null), null);
});
