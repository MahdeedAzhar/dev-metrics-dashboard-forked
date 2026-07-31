import {
  spExpectedDaysTable,
  spLinearFactor,
  spMinDays,
  staleRatioThreshold,
  gapThresholdDays,
} from '../../config/config.js';
import { daysSince } from '../utils/dateMath.js';

/**
 * SP -> expected calendar days, per the team's own heuristic table. Values not in
 * the table (13, 20, custom points) fall back to a linear approximation fitted to
 * that table, floored so a 0/near-0 SP still gets a minimum expected duration.
 */
export function expectedDaysForSp(sp) {
  if (typeof sp !== 'number' || Number.isNaN(sp)) return null;
  if (Object.prototype.hasOwnProperty.call(spExpectedDaysTable, sp)) {
    return spExpectedDaysTable[sp];
  }
  return Math.max(sp * spLinearFactor, spMinDays);
}

/**
 * Resolves the SP to use for a PR. Jira's own Story Points field is authoritative
 * (set at planning time, not self-reported per-PR) and takes priority over the PR
 * body's free-text Planned SP / Actual SP fields, which anyone can fill in with
 * whatever number makes their own speed score look good.
 */
export function resolvePrSp(pr) {
  return pr.jira?.story_points ?? pr.planned_sp?.parsed_numeric ?? pr.actual_sp?.parsed_numeric ?? null;
}

/**
 * Resolves the expected duration for a PR: Jira Story Points first, then the PR
 * body's self-reported Planned/Actual SP, then (if supplied) the team's rolling
 * median PR duration as a low-confidence fallback. Never silently guesses when no
 * signal is available at all.
 */
export function resolveExpectedDays(pr, { teamMedianDays = null } = {}) {
  const spUsed = resolvePrSp(pr);
  if (spUsed !== null) {
    return { expected_days: expectedDaysForSp(spUsed), confidence: 'sp', sp_used: spUsed };
  }
  if (typeof teamMedianDays === 'number') {
    return { expected_days: teamMedianDays, confidence: 'team_median', sp_used: null };
  }
  return { expected_days: null, confidence: 'no_data', sp_used: null };
}

/**
 * Flags a still-open PR as stale once it's been open more than `staleRatioThreshold`
 * times its SP-implied expected duration. When there's no SP anywhere for the PR
 * (confidence 'team_median'), a ratio against that rough team-wide proxy is too
 * fragile to base a verdict on — a handful of quick 1-point merges can drag the
 * proxy down to a few hours, turning a perfectly normal 2-day-old PR into a
 * fabricated "11x stale". Those PRs get a simple absolute days-open threshold
 * instead (reusing `gapThresholdDays`), with no invented ratio.
 */
export function checkOpenPrStaleness(pr, now, { teamMedianDays = null } = {}) {
  const daysOpen = daysSince(pr.created_at, now);
  const { expected_days, confidence, sp_used } = resolveExpectedDays(pr, { teamMedianDays });

  if (confidence === 'no_data') {
    return {
      pr_id: pr.id,
      days_open: daysOpen,
      planned_sp: sp_used,
      expected_days: null,
      ratio: null,
      confidence,
      flag_status: 'NO_DATA',
    };
  }

  if (confidence === 'team_median') {
    return {
      pr_id: pr.id,
      days_open: daysOpen,
      planned_sp: sp_used,
      expected_days,
      ratio: null,
      confidence,
      flag_status: daysOpen > gapThresholdDays ? 'FLAGGED_STALE_PR' : 'OK',
    };
  }

  const ratio = daysOpen / expected_days;
  return {
    pr_id: pr.id,
    days_open: daysOpen,
    planned_sp: sp_used,
    expected_days,
    ratio,
    confidence,
    flag_status: ratio > staleRatioThreshold ? 'FLAGGED_STALE_PR' : 'OK',
  };
}

/**
 * Determines whether a developer's gap since their last opened PR is explained by
 * an SP-justified PR still in progress. With multiple concurrently-open PRs, this
 * anchors on the single one with the largest expected duration (documented
 * limitation — it does not sum or otherwise combine concurrent PRs).
 */
export function computeGapStatus(daysSinceLastPrOpened, openPrStaleness, threshold = gapThresholdDays) {
  if (daysSinceLastPrOpened === null) return 'NO_DATA';
  if (daysSinceLastPrOpened < threshold) return 'OK';

  const withExpectedDays = openPrStaleness.filter((p) => p.expected_days !== null);
  if (withExpectedDays.length === 0) return 'FLAGGED_UNEXPLAINED';

  const anchor = withExpectedDays.slice().sort((a, b) => b.expected_days - a.expected_days)[0];
  if (anchor.flag_status === 'FLAGGED_STALE_PR') return 'FLAGGED_STALE_PR';
  return anchor.expected_days >= daysSinceLastPrOpened ? 'JUSTIFIED_BY_SP' : 'FLAGGED_UNEXPLAINED';
}
