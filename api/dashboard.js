import { guarded } from './_guard.js';
import { requireDashboardAuth } from './_auth.js';
import { generateDashboard } from '../src/index.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';
import { parseReleasesQuery } from '../src/http/body.js';
import { sendMethodNotAllowed, sendResult } from '../src/http/respond.js';
import { handleDashboardPage } from '../src/http/handlers.js';

export default guarded(async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');

  const releases = parseReleasesQuery(req.url);
  const getBundle = releases.length ? () => generateDashboard({ releases, writeOutput: false }) : getLatestDashboard;
  sendResult(res, await handleDashboardPage({ getBundle }));
});
