// Central, tunable knobs for the dashboard. Nothing here should require a code
// change to adjust — retune these constants instead.

export const repos = [
  'bvs-xiangqi/xiangqi-client',
  'bvs-xiangqi/xiangqi-server',
];

// GitHub logins to exclude from the auto-detected developer roster (bots, service accounts).
export const excludedAuthors = ['dependabot[bot]', 'renovate[bot]'];

// How far back to keep PRs in the local cache / consider for aggregation.
export const lookbackDays = 90;

// Default reporting window for the dashboard's charts, when not overridden via CLI.
export const reportingWindowDays = 14;

// A developer with no PR opened in this many days gets gap-checked.
export const gapThresholdDays = 5;

// A developer whose PRs-opened count falls below this fraction of the team's
// median for the window gets flagged LOW_VOLUME on their scorecard.
export const lowVolumeRatioThreshold = 0.5;

// SP -> expected calendar days to complete a PR, per the team's own heuristic.
// Values outside this table fall back to the linear approximation below.
export const spExpectedDaysTable = {
  1: 0.5,
  2: 1,
  3: 2,
  5: 3,
  8: 5,
};

// Linear fallback for SP values not in the table above (e.g. 13, 20, custom points).
export const spLinearFactor = 0.625; // expected_days ~= spLinearFactor * SP
export const spMinDays = 0.5;

// A PR open this many times longer than its SP-implied duration gets flagged stale.
export const staleRatioThreshold = 1.5;

// Composite score weights. Must sum to 1.
export const scoringWeights = {
  speed: 0.4,
  quality: 0.3,
  aiLeverage: 0.3,
};

// Composite score -> color band cutoffs (inclusive lower bound).
export const colorThresholds = {
  green: 80,
  yellow: 60,
};

// Calendar days vs business days for all "days open" / "gap" math.
export const businessDaysOnly = false;

// How long a Jira ticket's cached data is trusted before a background TTL refresh,
// for tickets whose linked PR hasn't changed (e.g. SP edited post-merge).
export const jiraTtlDays = 7;

// Custom field ID for "Story Points" on this Jira instance (arbisoft.atlassian.net,
// project XQ) — confirmed live against XQ-5043 via the Jira API, not guessed.
// Custom field IDs are global per Jira site, so this should hold across projects
// on the same instance; re-verify if pointing this at a different Jira site.
export const jiraStoryPointsFieldId = 'customfield_10010';
