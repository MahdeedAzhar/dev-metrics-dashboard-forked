import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommitAiPercent } from '../../src/parse/commitCoAuthorship.js';

test('computes the share of commits carrying a Claude co-author trailer', () => {
  const commits = [
    { commit: { message: 'Fix thing\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>' } },
    { commit: { message: 'Manual tweak, no AI involved' } },
    { commit: { message: 'Another fix\n\nCo-authored-by: Claude Sonnet 5 <noreply@anthropic.com>' } },
    { commit: { message: 'Unrelated co-author\n\nCo-Authored-By: Jane Doe <jane@example.com>' } },
  ];
  assert.equal(computeCommitAiPercent(commits), 50);
});

test('returns null (not 0) when there are no commits to examine', () => {
  assert.equal(computeCommitAiPercent([]), null);
  assert.equal(computeCommitAiPercent(undefined), null);
});

test('returns 0 when commits exist but none are AI co-authored', () => {
  const commits = [{ commit: { message: 'Just a manual fix' } }];
  assert.equal(computeCommitAiPercent(commits), 0);
});

test('recognises any configured AI co-author pattern, escaping regex characters', () => {
  const commits = [
    { commit: { message: 'feat: x\n\nCo-authored-by: GitHub Copilot <copilot@github.com>' } },
    { commit: { message: 'fix: y\n\nCo-Authored-By: Cursor (bot)' } },
    { commit: { message: 'chore: z' } },
  ];
  assert.equal(computeCommitAiPercent(commits, ['claude']), 0);
  assert.equal(computeCommitAiPercent(commits, ['copilot', 'cursor (bot)']), (2 / 3) * 100);
});
