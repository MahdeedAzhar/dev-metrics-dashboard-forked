const CLAUDE_TRAILER_RE = /co-authored-by:\s*claude/i;

/**
 * Share of a PR's commits carrying a "Co-Authored-By: Claude ..." trailer — a
 * structured, harder-to-game AI-involvement signal (it's written by the tool that
 * made the commit, not self-reported after the fact) to use alongside the PR
 * body's AI Contribution Checklist. Returns null when there are no commits to
 * examine rather than 0, so it's never mistaken for "confirmed no AI use."
 */
export function computeCommitAiPercent(commits) {
  if (!commits || commits.length === 0) return null;
  const aiCommits = commits.filter((c) => CLAUDE_TRAILER_RE.test(c.commit?.message ?? '')).length;
  return (aiCommits / commits.length) * 100;
}
