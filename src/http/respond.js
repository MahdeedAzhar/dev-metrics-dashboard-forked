const NO_STORE = 'private, no-store';

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': NO_STORE });
  res.end(JSON.stringify(payload));
}

export function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': NO_STORE });
  res.end(html);
}

export function sendMethodNotAllowed(res, allow) {
  res.writeHead(405, { Allow: allow });
  res.end();
}

/** Applies a handler result `{ status, json }` or `{ status, html }` to the response. */
export function sendResult(res, result) {
  if (result.html !== undefined) return sendHtml(res, result.status, result.html);
  return sendJson(res, result.status, result.json);
}
