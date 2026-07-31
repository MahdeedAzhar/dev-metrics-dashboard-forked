import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheRoot = path.join(__dirname, '..', '..', 'data', 'cache');
const outputRoot = path.join(__dirname, '..', '..', 'data', 'output');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function repoSlug(repo) {
  return repo.replace('/', '__');
}

export function githubCachePath(repo) {
  return path.join(cacheRoot, 'github', `${repoSlug(repo)}.json`);
}

export function githubWatermarkPath(repo) {
  return path.join(cacheRoot, 'github', `${repoSlug(repo)}.watermark.json`);
}

export function jiraTicketsCachePath() {
  return path.join(cacheRoot, 'jira', 'tickets.json');
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

export function writeOutput(name, data) {
  ensureDir(outputRoot);
  const filePath = path.join(outputRoot, name);
  if (typeof data === 'string') {
    fs.writeFileSync(filePath, data);
  } else {
    writeJson(filePath, data);
  }
  return filePath;
}
