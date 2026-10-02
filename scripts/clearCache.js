// Deletes the local GitHub/Jira working cache (data/cache/github, data/cache/jira).
// Review logs (data/cache/review-logs.json) are kept. Use after changing
// GITHUB_REPOS, GITHUB_LOOKBACK_DAYS or the AI-contribution parsing settings so
// PR records are rebuilt with the new rules.
import { clearWorkingCache } from '../src/cache/store.js';

const removed = clearWorkingCache();
console.log(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Cache already empty.');
