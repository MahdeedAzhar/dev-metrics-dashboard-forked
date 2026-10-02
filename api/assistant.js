import { guarded } from './_guard.js';
import { requireDashboardAuth } from './_auth.js';
import { getLatestDashboard, refreshDashboard } from '../src/refreshDashboard.js';
import { readJsonBody } from '../src/http/body.js';
import { sendMethodNotAllowed, sendResult } from '../src/http/respond.js';
import { handleAssistant } from '../src/http/handlers.js';

export default guarded(async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  const body = await readJsonBody(req);
  sendResult(res, await handleAssistant({ body, getBundle: getLatestDashboard, refresh: refreshDashboard }));
});
