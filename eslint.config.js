import js from '@eslint/js';
import globals from 'globals';

// The files under src/dashboard/client are plain scripts inlined into the
// generated HTML: they share one global scope in the browser and reference
// each other's top-level function declarations, so they are linted as scripts
// with those names declared as globals.
const clientGlobals = {
  filterTicketsBySelectedReleases: 'readonly',
  computeReleaseSummary: 'readonly',
  computeReleasePointComparison: 'readonly',
  computeDeveloperDelivery: 'readonly',
  computeTicketStatusBreakdown: 'readonly',
  computeIssueTypeBreakdown: 'readonly',
  bucketByDay: 'readonly',
  cumulativeSeries: 'readonly',
  computeMean: 'readonly',
  computeMedian: 'readonly',
  computeHistogramBuckets: 'readonly',
  buildReleaseProgressSeries: 'readonly',
  buildEngineeringActivityTrend: 'readonly',
  buildPrActivityTrend: 'readonly',
  buildDeveloperActivityTimeline: 'readonly',
  buildCycleTimeDistribution: 'readonly',
  buildLineChart: 'readonly',
  buildReleasePointComparisonChart: 'readonly',
  buildStatusStackedBar: 'readonly',
  buildHistogramBars: 'readonly',
  renderAssistantChart: 'readonly',
  initChartActions: 'readonly',
  openChartFullscreen: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'data/**', '.vercel/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-await-in-loop': 'off',
    },
  },
  {
    files: ['src/dashboard/client/*.js'],
    ignores: ['src/dashboard/client/*Node.js'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { ...globals.browser, ...clientGlobals } },
    rules: { 'no-unused-vars': 'off', 'no-redeclare': 'off' },
  },
];
