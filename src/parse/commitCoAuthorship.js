const DEFAULT_PATTERNS = ['claude'];

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds the trailer matcher once per pattern list. */
export function buildCoAuthorMatcher(patterns = DEFAULT_PATTERNS) {
  const alternatives = patterns.filter(Boolean).map(escapeRegex).join('|');
  // Match the tool name anywhere on the trailer line ("Co-authored-by: GitHub Copilot <...>").
  return new RegExp(`co-authored-by:[^\\n]*(?:${alternatives || 'claude'})`, 'i');
}

/**
 * Share of a PR's commits carrying a "Co-Authored-By: <AI tool> ..." trailer —
 * a structured, harder-to-game AI-involvement signal (written by the tool that
 * made the commit, not self-reported after the fact) to use alongside the PR
 * body's AI Contribution Checklist. Which tool names count is configured via
 * AI_COAUTHOR_PATTERNS. Returns null when there are no commits to examine
 * rather than 0, so it's never mistaken for "confirmed no AI use."
 */
export function computeCommitAiPercent(commits, patterns = DEFAULT_PATTERNS) {
  if (!commits || commits.length === 0) return null;
  const matcher = buildCoAuthorMatcher(patterns);
  const aiCommits = commits.filter((c) => matcher.test(c.commit?.message ?? '')).length;
  return (aiCommits / commits.length) * 100;
}
