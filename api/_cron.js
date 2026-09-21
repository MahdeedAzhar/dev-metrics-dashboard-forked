import { timingSafeEqual } from 'node:crypto';
import { getConfig } from '../src/config/index.js';

export function isCronAuthorized(req) {
  const secret = getConfig().server.cronSecret;
  if (!secret) return false;

  const supplied = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
