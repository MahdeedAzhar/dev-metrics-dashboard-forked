import { repos, lookbackDays, reportingWindowDays, jiraTtlDays } from '../config/config.js';
import {
  fetchNewOrUpdatedPullRequests,
  fetchPullRequestActivity,
  deriveReviewTimestamps,
} from './fetch/github.js';
import { fetchIssuesByKeys } from './fetch/jira.js';
import { extractTicketId } from './parse/ticketId.js';
import { parseAiChecklist, combineAiSignals } from './parse/aiChecklist.js';
import { parseStoryPoints } from './parse/storyPoints.js';
import { computeCommitAiPercent } from './parse/commitCoAuthorship.js';
import { joinPrWithJira } from './merge/join.js';
import { buildDeveloperAggregates } from './aggregate/developerAggregate.js';
import { renderDashboard } from './dashboard/render.js';
import {
  readGithubCache,
  writeGithubCache,
  readWatermark,
  writeWatermark,
  readJiraCache,
  writeJiraCache,
  writeOutput,
} from './cache/store.js';
import { log, warn } from './utils/logger.js';

function parseArgs(argv) {
  const args = { since: null, refreshJira: false, release: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--since') args.since = argv[i + 1];
    if (argv[i] === '--refresh-jira') args.refreshJira = true;
    if (argv[i] === '--release') args.release = argv[i + 1];
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
    author: rawPr.user?.login ?? null,
    author_type: rawPr.user?.type === 'Bot' ? 'bot' : 'user',
    state: rawPr.merged_at ? 'merged' : rawPr.state,
    created_at: rawPr.created_at,
    updated_at: rawPr.updated_at,
    closed_at: rawPr.closed_at,
    merged_at: rawPr.merged_at,
    ...deriveReviewTimestamps(rawPr.user?.login, activity),
    linked_ticket_id: ticketId,
    ticket_source: source,
    ...parseStoryPoints(rawPr.body),
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
  const changedTicketIds = new Set();

  for (let i = 0; i < newRawPrs.length; i += 1) {
    const rawPr = newRawPrs[i];
    // eslint-disable-next-line no-await-in-loop
    const activity = await fetchPullRequestActivity(repo, rawPr.number);
    const record = buildPrRecord(repo, rawPr, activity);
    cache[rawPr.number] = record;
    if (record.linked_ticket_id) changedTicketIds.add(record.linked_ticket_id);
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

  return { prs: Object.values(cache), changedTicketIds };
}

async function refreshJiraCache(ticketIds, changedTicketIds, { refreshJira }) {
  const jiraCache = readJiraCache();
  const now = Date.now();
  const ttlMs = jiraTtlDays * 24 * 60 * 60 * 1000;

  const toFetch = [...ticketIds].filter((ticketId) => {
    if (refreshJira || changedTicketIds.has(ticketId)) return true;
    const cached = jiraCache[ticketId];
    if (!cached) return true;
    return now - new Date(cached.fetched_at).getTime() > ttlMs;
  });

  if (toFetch.length > 0) {
    log(`Fetching ${toFetch.length} Jira issue(s): ${toFetch.join(', ')}`);
    const fetchedAt = new Date().toISOString();
    let fetched = {};
    try {
      fetched = await fetchIssuesByKeys(toFetch);
    } catch (error) {
      warn(`Jira fetch failed, continuing with cached data only: ${error.message}`);
    }
    for (const [key, issue] of Object.entries(fetched)) {
      jiraCache[key] = { ...issue, fetched_at: fetchedAt };
    }
    writeJiraCache(jiraCache);
  }

  return jiraCache;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildDailyPrCounts(prs, windowStart, windowEnd) {
  const counts = {};
  let cursor = new Date(isoDate(new Date(windowStart)));
  const end = new Date(isoDate(new Date(windowEnd)));
  while (cursor <= end) {
    counts[isoDate(cursor)] = 0;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  for (const pr of prs) {
    const day = pr.created_at.slice(0, 10);
    if (day in counts) counts[day] += 1;
  }
  return Object.entries(counts).map(([date, opened]) => ({ date, opened }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = args.since
    ? new Date(args.since).toISOString()
    : new Date(now.getTime() - reportingWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const lookbackStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const allPrRecords = [];
  const allChangedTicketIds = new Set();

  for (const repo of repos) {
    // eslint-disable-next-line no-await-in-loop
    const { prs, changedTicketIds } = await syncRepo(repo, lookbackStart);
    allPrRecords.push(...prs);
    for (const id of changedTicketIds) allChangedTicketIds.add(id);
  }

  const workingSet = allPrRecords.filter((pr) => pr.created_at >= lookbackStart);
  const ticketIds = new Set(workingSet.map((pr) => pr.linked_ticket_id).filter(Boolean));
  const jiraCache = await refreshJiraCache(ticketIds, allChangedTicketIds, {
    refreshJira: args.refreshJira,
  });

  const joinedRecords = workingSet.map((pr) => joinPrWithJira(pr, jiraCache));

  // Release-scoped runs consider every PR linked to that fixVersion regardless of
  // when it landed within the lookback window, rather than a fixed calendar range.
  const releaseFiltered = args.release
    ? joinedRecords.filter((pr) => pr.jira?.fix_versions?.includes(args.release))
    : joinedRecords;
  const effectiveWindowStart = args.release ? lookbackStart : windowStart;

  const developers = buildDeveloperAggregates(releaseFiltered, {
    windowStart: effectiveWindowStart,
    windowEnd,
    now,
  });
  const dailyPrCounts = buildDailyPrCounts(releaseFiltered, effectiveWindowStart, windowEnd);

  if (args.release) {
    log(`Release "${args.release}": ${releaseFiltered.length} PR(s) matched`);
  }

  const aggregated = {
    generated_at: now.toISOString(),
    window: { start: effectiveWindowStart, end: windowEnd },
    release: args.release,
    repos,
    developers,
    daily_pr_counts: dailyPrCounts,
  };

  writeOutput('aggregated.json', aggregated);
  const dashboardPath = writeOutput('dashboard.html', renderDashboard(aggregated));

  log(`Wrote ${dashboardPath}`);
}

main().catch((error) => {
  warn(error.stack ?? error.message);
  process.exitCode = 1;
});
