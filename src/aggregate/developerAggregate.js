import { excludedAuthors, lowVolumeRatioThreshold } from '../../config/config.js';
import { hoursBetween, mean, median, daysSince } from '../utils/dateMath.js';
import { checkOpenPrStaleness, computeGapStatus, resolvePrSp } from './staleDetection.js';
import {
  computeSpeedScoreForPr,
  computeQualityScore,
  computeAiLeverageScore,
  computeAiSourceBreakdown,
  computeCompositeScore,
  colorBandFor,
} from './scoring.js';

function isInWindow(pr, windowStart, windowEnd) {
  return pr.created_at >= windowStart && pr.created_at <= windowEnd;
}

/**
 * Rolls normalized PR records into one aggregate per developer. Velocity/speed/
 * quality/AI metrics are scoped to [windowStart, windowEnd], but open-PR staleness
 * and "days since last PR" look at each developer's full PR history (`allPrRecords`)
 * — a currently-open PR opened before the window still needs to be seen.
 */
export function buildDeveloperAggregates(allPrRecords, { windowStart, windowEnd, now = new Date() }) {
  const roster = [
    ...new Set(
      allPrRecords
        .filter((pr) => pr.author_type !== 'bot' && pr.author && !excludedAuthors.includes(pr.author))
        .map((pr) => pr.author),
    ),
  ];

  // Only PRs that actually carry an SP estimate count as "typical estimated work" —
  // pooling in every trivial one-line/config PR would drag this toward near-zero
  // and make the fallback useless (every open PR without an SP would look wildly
  // stale against a ~2-hour "typical duration").
  const teamMergeDurationsDays = allPrRecords
    .filter((pr) => pr.merged_at && resolvePrSp(pr) !== null)
    .map((pr) => hoursBetween(pr.created_at, pr.merged_at) / 24);
  const teamMedianDays = median(teamMergeDurationsDays);

  const teamMedianPrsOpened = median(
    roster.map(
      (developer) =>
        allPrRecords.filter((pr) => pr.author === developer && isInWindow(pr, windowStart, windowEnd))
          .length,
    ),
  );

  return roster.map((developer) => {
    const devPrs = allPrRecords.filter((pr) => pr.author === developer);
    const devPrsInWindow = devPrs.filter((pr) => isInWindow(pr, windowStart, windowEnd));
    const mergedInWindow = devPrsInWindow.filter((pr) => pr.merged_at);

    const timeToReviewHours = devPrsInWindow
      .map((pr) => hoursBetween(pr.created_at, pr.first_review_at))
      .filter((h) => h !== null);
    const timeToMergeHours = mergedInWindow
      .map((pr) => hoursBetween(pr.created_at, pr.merged_at))
      .filter((h) => h !== null);

    const speedScores = mergedInWindow.map(computeSpeedScoreForPr).filter((s) => s !== null);
    const speedScore = speedScores.length ? mean(speedScores) : null;
    const speedScoreDataCoveragePercent = mergedInWindow.length
      ? (speedScores.length / mergedInWindow.length) * 100
      : null;

    const qualityScore = computeQualityScore(mergedInWindow);
    const { score: aiLeverageScore, coveragePercent: aiContributionDataCoveragePercent } =
      computeAiLeverageScore(devPrsInWindow);
    const aiSourceBreakdown = computeAiSourceBreakdown(devPrsInWindow);

    const compositeScore = computeCompositeScore({
      speedScore,
      speedCoveragePercent: speedScoreDataCoveragePercent,
      qualityScore,
      aiLeverageScore,
      aiCoveragePercent: aiContributionDataCoveragePercent,
    });

    const openPrs = devPrs.filter((pr) => pr.state === 'open');
    const currentlyOpenPrs = openPrs.map((pr) =>
      checkOpenPrStaleness(pr, now, { teamMedianDays }),
    );

    const lastOpenedAt = devPrs.map((pr) => pr.created_at).sort().at(-1) ?? null;
    const daysSinceLastPrOpened = lastOpenedAt ? daysSince(lastOpenedAt, now) : null;
    const gapStatus = computeGapStatus(daysSinceLastPrOpened, currentlyOpenPrs);

    const volumeRatioVsTeamMedian =
      typeof teamMedianPrsOpened === 'number' && teamMedianPrsOpened > 0
        ? devPrsInWindow.length / teamMedianPrsOpened
        : null;
    const volumeFlag =
      volumeRatioVsTeamMedian === null
        ? 'NO_DATA'
        : volumeRatioVsTeamMedian < lowVolumeRatioThreshold
          ? 'LOW_VOLUME'
          : 'OK';

    return {
      developer,
      window_start: windowStart,
      window_end: windowEnd,
      prs_opened_count: devPrsInWindow.length,
      prs_merged_count: mergedInWindow.length,
      avg_time_to_review_hours: mean(timeToReviewHours),
      median_time_to_review_hours: median(timeToReviewHours),
      avg_time_to_merge_hours: mean(timeToMergeHours),
      median_time_to_merge_hours: median(timeToMergeHours),
      ai_contribution_avg_percent: aiLeverageScore,
      ai_contribution_data_coverage_percent: aiContributionDataCoveragePercent,
      ai_checklist_avg_percent: aiSourceBreakdown.checklist_avg_percent,
      ai_checklist_coverage_percent: aiSourceBreakdown.checklist_coverage_percent,
      ai_commit_avg_percent: aiSourceBreakdown.commit_avg_percent,
      ai_commit_coverage_percent: aiSourceBreakdown.commit_coverage_percent,
      first_pass_approval_rate: qualityScore === null ? null : qualityScore / 100,
      speed_score: speedScore,
      speed_score_data_coverage_percent: speedScoreDataCoveragePercent,
      quality_score: qualityScore,
      ai_leverage_score: aiLeverageScore,
      composite_score: compositeScore,
      color_band: colorBandFor(compositeScore),
      currently_open_prs: currentlyOpenPrs,
      days_since_last_pr_opened: daysSinceLastPrOpened,
      gap_status: gapStatus,
      team_median_prs_opened: teamMedianPrsOpened,
      volume_ratio_vs_team_median: volumeRatioVsTeamMedian,
      volume_flag: volumeFlag,
    };
  });
}
