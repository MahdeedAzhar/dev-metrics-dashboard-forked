import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the working cache and generated output live.
 *  - DATA_DIR, when set (tests, containers)
 *  - /tmp on Vercel — the deployment filesystem is read-only; /tmp lasts for
 *    the lifetime of a warm function instance and is a best-effort cache only
 *  - ./data in the repository otherwise
 */
export function runtimeRoot(config = getConfig()) {
  if (config.server.dataDir) return path.resolve(config.server.dataDir);
  if (config.server.isVercel) return path.join('/tmp', 'dev-metrics-dashboard');
  return path.join(__dirname, '..', '..', 'data');
}

const cacheRoot = () => path.join(runtimeRoot(), 'cache');
const outputRoot = () => path.join(runtimeRoot(), 'output');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    // A half-written cache file must never take the whole run down.
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function repoSlug(repo) {
  return repo.replace('/', '__');
}

export function githubCachePath(repo) {
  return path.join(cacheRoot(), 'github', `${repoSlug(repo)}.json`);
}

export function githubWatermarkPath(repo) {
  return path.join(cacheRoot(), 'github', `${repoSlug(repo)}.watermark.json`);
}

export function jiraTicketsCachePath() {
  return path.join(cacheRoot(), 'jira', 'tickets.json');
}

export function jiraChangelogsCachePath() {
  return path.join(cacheRoot(), 'jira', 'changelogs.json');
}

export function readGithubCache(repo) {
  return readJson(githubCachePath(repo), {});
}

export function writeGithubCache(repo, prsByNumber) {
  writeJson(githubCachePath(repo), prsByNumber);
}

export function readWatermark(repo) {
  return readJson(githubWatermarkPath(repo), { lastUpdatedAtSeen: null, lastRunAt: null });
}

export function writeWatermark(repo, watermark) {
  writeJson(githubWatermarkPath(repo), watermark);
}

export function readJiraTicketsCache() {
  return readJson(jiraTicketsCachePath(), {});
}

export function writeJiraTicketsCache(ticketsByKey) {
  writeJson(jiraTicketsCachePath(), ticketsByKey);
}

/**
 * Changelog is expensive (1 API call per ticket, unlike the cheap single-call
 * bulk fields fetch), so unlike tickets.json this is cached per-ticket rather
 * than always refetched — see src/index.js for the `updated`-timestamp-keyed
 * invalidation this cache is designed around.
 */
export function readJiraChangelogsCache() {
  return readJson(jiraChangelogsCachePath(), {});
}

export function writeJiraChangelogsCache(changelogsByKey) {
  writeJson(jiraChangelogsCachePath(), changelogsByKey);
}

export function writeOutput(name, data) {
  ensureDir(outputRoot());
  const filePath = path.join(outputRoot(), name);
  if (typeof data === 'string') {
    fs.writeFileSync(filePath, data);
  } else {
    writeJson(filePath, data);
  }
  return filePath;
}

export function outputPath(name) {
  return path.join(outputRoot(), name);
}

/** Deletes the GitHub/Jira working cache (not review logs). Returns removed paths. */
export function clearWorkingCache() {
  const removed = [];
  for (const dir of ['github', 'jira']) {
    const target = path.join(cacheRoot(), dir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    }
  }
  return removed;
}
