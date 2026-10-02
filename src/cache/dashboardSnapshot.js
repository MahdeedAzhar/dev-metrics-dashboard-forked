import { get, put } from '@vercel/blob';
import { getConfig } from '../config/index.js';

// The durable, last-known-good dashboard bundle for the Vercel deployment.
// Page loads serve this immediately; the cron and the Refresh button replace it.
const SNAPSHOT_PATH = 'dev-metrics-dashboard/dashboard-bundle.json';

function assertBlobConfigured(config) {
  if (!config.server.blobToken) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set. Connect a private Vercel Blob store to this project.');
  }
}

export async function readDashboardSnapshot(config = getConfig()) {
  assertBlobConfigured(config);
  const result = await get(SNAPSHOT_PATH, { access: 'private', useCache: false });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

export async function writeDashboardSnapshot(bundle, config = getConfig()) {
  assertBlobConfigured(config);
  await put(SNAPSHOT_PATH, JSON.stringify(bundle), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8',
  });
}
