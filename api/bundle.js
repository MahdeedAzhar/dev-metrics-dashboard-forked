import { guarded } from './_guard.js';
import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';
import { sendJson, sendMethodNotAllowed } from '../src/http/respond.js';

export default guarded(async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
  sendJson(res, 200, await getLatestDashboard());
});
