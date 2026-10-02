import { guarded } from './_guard.js';
import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard } from '../src/refreshDashboard.js';
import { readJsonBody } from '../src/http/body.js';
import { sendMethodNotAllowed, sendResult } from '../src/http/respond.js';
import { handleReviews } from '../src/http/handlers.js';

export default guarded(async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  const body = req.method === 'POST' ? await readJsonBody(req) : {};
  const result = await handleReviews({ method: req.method, body, getBundle: getLatestDashboard });
  if (result.status === 405) return sendMethodNotAllowed(res, result.allow);
  sendResult(res, result);
});
