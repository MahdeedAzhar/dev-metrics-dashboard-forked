import { guarded } from './_guard.js';
import { requireDashboardAuth } from './_auth.js';
import { sendJson } from '../src/http/respond.js';

export default guarded(function handler(req, res) {
  if (!requireDashboardAuth(req, res)) return;
  sendJson(res, 200, { ok: true });
});
