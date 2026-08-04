import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// timeSeries.js is deliberately plain JS (no import/export) so it can be
// inlined verbatim into the dashboard's <script> tag. This wrapper executes
// that exact same file's text to expose its function declarations to Node,
// for tests — same vm.runInThisContext pattern as deliveryMathNode.js (NOT
// vm.createContext/runInContext, which creates a separate JS realm and breaks
// assert.deepStrictEqual on returned arrays).
const filePath = path.join(__dirname, 'timeSeries.js');
const source = fs.readFileSync(filePath, 'utf8');
vm.runInThisContext(source, { filename: filePath });

export const bucketByDay = globalThis.bucketByDay;
export const cumulativeSeries = globalThis.cumulativeSeries;
export const computeMean = globalThis.computeMean;
export const computeMedian = globalThis.computeMedian;
export const computeHistogramBuckets = globalThis.computeHistogramBuckets;
export const buildReleaseProgressSeries = globalThis.buildReleaseProgressSeries;
export const buildEngineeringActivityTrend = globalThis.buildEngineeringActivityTrend;
export const buildPrActivityTrend = globalThis.buildPrActivityTrend;
export const buildDeveloperActivityTimeline = globalThis.buildDeveloperActivityTimeline;
export const buildCycleTimeDistribution = globalThis.buildCycleTimeDistribution;
