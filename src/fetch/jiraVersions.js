import { getConfig } from '../config/index.js';
import { jiraRequest } from './jiraClient.js';

// Release (fixVersion) discovery. Releases are read from the Jira project's
// versions rather than maintained as a list in code: a new release appears on
// the dashboard as soon as someone creates the version in Jira.

/** GET /rest/api/3/project/{key}/versions — every version on the project. */
export async function fetchProjectVersions(config = getConfig()) {
  const key = encodeURIComponent(config.jira.projectKey);
  const data = await jiraRequest(`/rest/api/3/project/${key}/versions`, {
    action: `fetching versions for project ${config.jira.projectKey}`,
    config,
  });
  // The plural endpoint returns a bare array; the paginated singular one wraps it.
  return Array.isArray(data) ? data : (data?.values ?? []);
}

/**
 * Shapes a raw Jira version into the release record the bundle carries.
 * `state` is a UI grouping, not a metric:
 *   released  — Jira says it shipped
 *   active    — unreleased and its start date has passed (or it has no dates)
 *   upcoming  — unreleased with a start date still in the future
 */
export function toReleaseRecord(version, now = new Date()) {
  const released = Boolean(version.released);
  const startDate = version.startDate ?? null;
  const releaseDate = version.releaseDate ?? null;
  let state = 'released';
  if (!released) {
    state = startDate && new Date(startDate) > now ? 'upcoming' : 'active';
  }
  return {
    id: version.id ?? null,
    name: version.name,
    released,
    archived: Boolean(version.archived),
    start_date: startDate,
    release_date: releaseDate,
    state,
  };
}

/**
 * Which versions the dashboard tracks by default: everything unreleased, plus
 * anything released within the lookback window (or released with no date).
 * Archived versions are always excluded. Pure — takes `now` for testability.
 */
export function selectTrackedReleases(versions, { lookbackMonths, now = new Date() }) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - lookbackMonths);

  return versions
    .filter((v) => !v.archived)
    .filter((v) => {
      if (!v.released) return true;
      if (!v.releaseDate) return true;
      return new Date(v.releaseDate) >= cutoff;
    })
    .map((v) => toReleaseRecord(v, now))
    .sort(compareReleases);
}

/**
 * Picker order: work in progress first, then upcoming (soonest first), then
 * released (most recent first, undated last).
 */
export function compareReleases(a, b) {
  const rank = { active: 0, upcoming: 1, unknown: 2, released: 3 };
  if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
  const aDate = a.release_date ?? a.start_date ?? '';
  const bDate = b.release_date ?? b.start_date ?? '';
  if (aDate !== bDate) {
    if (a.state === 'released') return aDate < bDate ? 1 : -1; // newest released first
    if (!aDate) return 1; // undated unreleased after dated
    if (!bDate) return -1;
    return aDate < bDate ? -1 : 1; // soonest unreleased first
  }
  return b.name.localeCompare(a.name, undefined, { numeric: true });
}

/**
 * Resolves the release set for a dashboard run.
 *  - `override`: an explicit list (CLI --releases or ?releases=) wins.
 *  - `JIRA_RELEASES`: an explicit configured allowlist.
 *  - otherwise: auto-discovery from the project's versions.
 * Always returns full release records so the UI can show dates/state; names
 * that don't exist as versions (typos, other projects) are still listed so the
 * picker makes the mistake visible instead of silently dropping it.
 */
export async function resolveReleases({ override = null, config = getConfig(), now = new Date() } = {}) {
  const versions = await fetchProjectVersions(config);
  const byName = new Map(versions.map((v) => [v.name, toReleaseRecord(v, now)]));

  const explicit = override ?? config.jira.releases.explicit;
  if (explicit) {
    return explicit.map(
      (name) =>
        byName.get(name) ?? {
          id: null,
          name,
          released: null,
          archived: false,
          start_date: null,
          release_date: null,
          state: 'unknown',
        },
    );
  }
  return selectTrackedReleases(versions, { lookbackMonths: config.jira.releases.lookbackMonths, now });
}
