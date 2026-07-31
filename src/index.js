import { repos, lookbackDays, releasesToTrack } from '../config/config.js';
import { fetchNewOrUpdatedPullRequests, fetchPullRequestActivity } from './fetch/github.js';
import { fetchTicketsByFixVersions } from './fetch/jira.js';
import { extractTicketId } from './parse/ticketId.js';
import { parseAiChecklist, combineAiSignals } from './parse/aiChecklist.js';
import { computeCommitAiPercent } from './parse/commitCoAuthorship.js';
import { buildTicketPrIndex } from './merge/ticketPrIndex.js';
import { normalizeJiraIssue } from './normalize/ticketRecord.js';
import { renderDashboard } from './dashboard/render.js';
import {
  readGithubCache,
  writeGithubCache,
  readWatermark,
  writeWatermark,
  writeJiraTicketsCache,
  writeOutput,
} from './cache/store.js';
import { log, warn } from './utils/logger.js';

function parseArgs(argv) {
  const args = { releases: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--releases') args.releases = argv[i + 1];
  }
  return args;
}

function buildPrRecord(repo, rawPr, activity) {
  const { ticketId, source } = extractTicketId(rawPr.title, rawPr.body);
  return {
    id: `${repo}#${rawPr.number}`,
    repo,
    number: rawPr.number,
    title: rawPr.title,
    state: rawPr.merged_at ? 'merged' : rawPr.state,
    created_at: rawPr.created_at,
    updated_at: rawPr.updated_at,
    linked_ticket_id: ticketId,
    ticket_source: source,
    ai_contribution: combineAiSignals(parseAiChecklist(rawPr.body), computeCommitAiPercent(activity.commits)),
    fetched_at: new Date().toISOString(),
  };
}

async function syncRepo(repo, lookbackCutoffIso) {
  const cache = readGithubCache(repo);
  const watermark = readWatermark(repo);
  const nowIso = new Date().toISOString();

  // On a cold start (no watermark yet) bound the fetch to the lookback window
  // instead of paging through the repo's entire PR history.
  const effectiveWatermark = watermark.lastUpdatedAtSeen ?? lookbackCutoffIso;

  const newRawPrs = await fetchNewOrUpdatedPullRequests(repo, effectiveWatermark);
  log(`${repo}: ${newRawPrs.length} new/updated PR(s) since ${effectiveWatermark}`);

  let maxUpdatedAt = watermark.lastUpdatedAtSeen;

  for (let i = 0; i < newRawPrs.length; i += 1) {
    const rawPr = newRawPrs[i];
    // eslint-disable-next-line no-await-in-loop
    const activity = await fetchPullRequestActivity(repo, rawPr.number);
    cache[rawPr.number] = buildPrRecord(repo, rawPr, activity);
    if (!maxUpdatedAt || new Date(rawPr.updated_at) > new Date(maxUpdatedAt)) {
      maxUpdatedAt = rawPr.updated_at;
    }

    // Persist incrementally so a long run's progress isn't all-or-nothing if
    // it's interrupted, and so the cache reflects partial progress on disk.
    writeGithubCache(repo, cache);
    writeWatermark(repo, { lastUpdatedAtSeen: maxUpdatedAt, lastRunAt: nowIso });
    if ((i + 1) % 10 === 0 || i === newRawPrs.length - 1) {
      log(`${repo}: processed ${i + 1}/${newRawPrs.length} PR(s)`);
    }
  }

  if (newRawPrs.length === 0) {
    writeWatermark(repo, { lastUpdatedAtSeen: maxUpdatedAt ?? effectiveWatermark, lastRunAt: nowIso });
  }

  return Object.values(cache);
}

/** First-seen fixVersion metadata for each configured release, plus any configured release with 0 matched tickets (still listed so the picker shows it). */
function buildReleaseMeta(ticketsByKey, releases) {
  const seen = new Map();
  for (const ticket of Object.values(ticketsByKey)) {
    for (const fv of ticket.fix_versions) {
      if (releases.includes(fv.name) && !seen.has(fv.name)) {
        seen.set(fv.name, { name: fv.name, released: fv.released, release_date: fv.release_date });
      }
    }
  }
  for (const name of releases) {
    if (!seen.has(name)) seen.set(name, { name, released: null, release_date: null });
  }
  return [...seen.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const releases = args.releases ? args.releases.split(',').map((r) => r.trim()) : releasesToTrack;

  const allPrRecords = [];
  for (const repo of repos) {
    // eslint-disable-next-line no-await-in-loop
    const prs = await syncRepo(repo, lookbackStart);
    allPrRecords.push(...prs);
  }

  log(`Fetching Jira tickets for release(s): ${releases.join(', ')}`);
  let rawIssues = [];
  try {
    rawIssues = await fetchTicketsByFixVersions(releases);
  } catch (error) {
    warn(`Jira fetch failed: ${error.message}`);
    throw error;
  }
  log(`Found ${rawIssues.length} ticket(s) across the configured release(s)`);

  const ticketPrIndex = buildTicketPrIndex(allPrRecords);
  const jiraBaseUrl = process.env.JIRA_BASE_URL;

  const ticketsByKey = {};
  for (const issue of rawIssues) {
    ticketsByKey[issue.key] = normalizeJiraIssue(issue, ticketPrIndex, jiraBaseUrl);
  }
  writeJiraTicketsCache(ticketsByKey);

  const bundle = {
    generated_at: now.toISOString(),
    releases: buildReleaseMeta(ticketsByKey, releases),
    tickets: ticketsByKey,
  };

  writeOutput('bundle.json', bundle);
  const dashboardPath = writeOutput('dashboard.html', renderDashboard(bundle));

  log(`Wrote ${dashboardPath}`);
}

main().catch((error) => {
  warn(error.stack ?? error.message);
  process.exitCode = 1;
});
