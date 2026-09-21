const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Reads and parses a JSON request body. Works for both Node's raw `http`
 * server and Vercel functions (which may have already parsed `req.body`).
 * Rejects bodies over `maxBytes` before buffering them.
 */
export function readJsonBody(req, { maxBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string') {
    return Promise.resolve(req.body ? JSON.parse(req.body) : {});
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        return resolve(JSON.parse(body));
      } catch {
        return reject(new Error('Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** `?releases=a,b&releases=c` → ['a', 'b', 'c'] */
export function parseReleasesQuery(url) {
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams
    .getAll('releases')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}
