import { guarded } from '../_guard.js';
import { requireDashboardAuth } from '../_auth.js';
import { refreshDashboard } from '../../src/refreshDashboard.js';
import { readJsonBody } from '../../src/http/body.js';
import { sendMethodNotAllowed, sendResult } from '../../src/http/respond.js';
import { handleTicketUpdate } from '../../src/http/handlers.js';

export default guarded(async function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');

  const issueKeyParam = Array.isArray(req.query?.issueKey) ? req.query.issueKey[0] : req.query?.issueKey;
  const body = await readJsonBody(req);
  sendResult(
    res,
    await handleTicketUpdate({ issueKey: decodeURIComponent(issueKeyParam ?? ''), body, refresh: refreshDashboard }),
  );
});
