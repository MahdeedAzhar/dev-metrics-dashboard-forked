import { scoringWeights, colorThresholds } from '../../config/config.js';
import { clamp, hoursBetween, mean } from '../utils/dateMath.js';
import { expectedDaysForSp, resolvePrSp } from './staleDetection.js';

/**
 * Per-PR speed score: 100 if merged at or faster than its SP-implied expected
 * duration (capped, not rewarded beyond), degrading linearly as it runs over.
 * Returns null when there's no SP to anchor against — such PRs are excluded from
 * the average rather than penalized or assumed average.
 */
export function computeSpeedScoreForPr(pr) {
  if (!pr.merged_at) return null;
  const sp = resolvePrSp(pr);
  if (sp === null) return null;

  const expectedHours = expectedDaysForSp(sp) * 24;
  const actualHours = hoursBetween(pr.created_at, pr.merged_at);
  if (actualHours === null || !expectedHours) return null;

  const ratio = actualHours / expectedHours;
  return ratio <= 1 ? 100 : clamp(100 - (ratio - 1) * 100, 0, 100);
}

/** First-pass-approval rate (no CHANGES_REQUESTED before approval) as a 0-100 quality proxy. */
export function computeQualityScore(mergedPrs) {
  if (mergedPrs.length === 0) return null;
  const firstPass = mergedPrs.filter((pr) => pr.review_cycle_count === 0).length;
  return (firstPass / mergedPrs.length) * 100;
}

/**
 * Average AI Contribution Score over PRs where the checklist was actually usable,
 * paired with a coverage percentage so a high score from a tiny sample isn't
 * over-read on the scorecard.
 */
export function computeAiLeverageScore(prs) {
  const withChecklist = prs.filter((pr) => pr.ai_contribution?.available);
  const coveragePercent = prs.length === 0 ? null : (withChecklist.length / prs.length) * 100;
  if (withChecklist.length === 0) return { score: null, coveragePercent };
  return {
    score: mean(withChecklist.map((pr) => pr.ai_contribution.overall_score_percent)),
    coveragePercent,
  };
}

/**
 * Breaks the blended AI-leverage figure back out by source — the self-reported
 * PR-body checklist vs. the structured commit co-author trailer signal — so the
 * scorecard can show *where* the number came from instead of one opaque percent.
 */
export function computeAiSourceBreakdown(prs) {
  const checklistValues = prs
    .map((pr) => pr.ai_contribution?.checklist_score_percent)
    .filter((v) => typeof v === 'number');
  const commitValues = prs
    .map((pr) => pr.ai_contribution?.commit_ai_percent)
    .filter((v) => typeof v === 'number');

  return {
    checklist_avg_percent: checklistValues.length ? mean(checklistValues) : null,
    checklist_coverage_percent: prs.length ? (checklistValues.length / prs.length) * 100 : null,
    commit_avg_percent: commitValues.length ? mean(commitValues) : null,
    commit_coverage_percent: prs.length ? (commitValues.length / prs.length) * 100 : null,
  };
}

/**
 * Weighted composite of whichever sub-scores are actually available, renormalized
 * over their weights (e.g. if AI-leverage has no data this window, Speed/Quality
 * absorb its share rather than the composite being penalized for missing data).
 *
 * Each sub-score's contribution is additionally scaled by its own data coverage
 * (0-100, defaults to 100 for scores that don't track coverage, like Quality) —
 * a Speed score built from 2 of 10 PRs pulls far less weight than one built from
 * 9 of 10, instead of counting identically just because both are non-null. This
 * is what stops a small, favorable sample from dominating the composite.
 */
export function computeCompositeScore({
  speedScore,
  speedCoveragePercent = 100,
  qualityScore,
  qualityCoveragePercent = 100,
  aiLeverageScore,
  aiCoveragePercent = 100,
}) {
  const parts = [
    { value: speedScore, weight: scoringWeights.speed, coverage: speedCoveragePercent },
    { value: qualityScore, weight: scoringWeights.quality, coverage: qualityCoveragePercent },
    { value: aiLeverageScore, weight: scoringWeights.aiLeverage, coverage: aiCoveragePercent },
  ]
    .filter((p) => typeof p.value === 'number')
    .map((p) => ({ ...p, confidence: clamp((p.coverage ?? 0) / 100, 0, 1) }))
    .filter((p) => p.confidence > 0);

  if (parts.length === 0) return null;
  const effectiveWeightSum = parts.reduce((sum, p) => sum + p.weight * p.confidence, 0);
  if (effectiveWeightSum === 0) return null;
  const weighted = parts.reduce((sum, p) => sum + p.value * p.weight * p.confidence, 0);
  return weighted / effectiveWeightSum;
}

export function colorBandFor(compositeScore) {
  if (typeof compositeScore !== 'number') return null;
  if (compositeScore >= colorThresholds.green) return 'green';
  if (compositeScore >= colorThresholds.yellow) return 'yellow';
  return 'red';
}
