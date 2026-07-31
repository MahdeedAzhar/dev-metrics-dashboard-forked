const SECTION_HEADING_RE = /####\s*AI Contribution Checklist/i;
const NEXT_HEADING_RE = /\n####\s/;
const STATED_SCORE_RE = /\*\*AI Contribution Score:?\*\*\s*:?\s*([\d]+(?:\.\d+)?)\s*%/i;

const BLANK_CELL_VALUES = new Set(['', '-', '_', 'n/a', 'na', 'tbd']);

function stripMarkup(cell) {
  return cell.replace(/\*\*/g, '').replace(/^_+|_+$/g, '').trim();
}

function parseNumericCell(rawCell) {
  const cleaned = stripMarkup(rawCell).replace(/%/g, '').trim();
  if (BLANK_CELL_VALUES.has(cleaned.toLowerCase())) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isNaN(value) ? null : value;
}

function extractSection(body) {
  const headingMatch = SECTION_HEADING_RE.exec(body ?? '');
  if (!headingMatch) return null;
  const rest = body.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = NEXT_HEADING_RE.exec(rest);
  return nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;
}

function parseActivityRows(section) {
  if (!section) return [];
  const rows = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));

  const activities = [];
  for (const row of rows) {
    const cells = row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;

    const name = stripMarkup(cells[0]);
    if (!name || name.toLowerCase() === 'activity') continue; // header row
    if (/^-+$/.test(cells[0].replace(/\s/g, ''))) continue; // separator row
    if (name.toLowerCase() === 'total') continue; // summary row, not an activity

    const weight = parseNumericCell(cells[1]);
    const aiPercent = parseNumericCell(cells[2]);
    const score = parseNumericCell(cells[3]);
    activities.push({ name, weight, ai_percent: aiPercent, score });
  }
  return activities;
}

/**
 * Parses the AI Contribution Checklist embedded in a PR body. Tolerates a missing
 * table, missing individual fields, and blank rows (activity not performed) without
 * throwing — those cases surface as `available: false` or `ai_percent: null`,
 * never coerced to 0. The explicit stated score line is trusted over recomputing
 * from the table, even if the two don't reconcile mathematically (they aren't
 * required to — activities can be added to the table without updating the line,
 * or vice versa).
 */
export function parseAiChecklist(body) {
  const section = extractSection(body);
  const activities = parseActivityRows(section);

  const statedMatch = STATED_SCORE_RE.exec(body ?? '');
  if (statedMatch) {
    return {
      available: true,
      overall_score_percent: Number.parseFloat(statedMatch[1]),
      source: 'stated_line',
      activities,
    };
  }

  const filledActivities = activities.filter(
    (a) => a.weight !== null && a.score !== null,
  );
  const weightSum = filledActivities.reduce((sum, a) => sum + a.weight, 0);
  if (filledActivities.length > 0 && weightSum > 0) {
    const scoreSum = filledActivities.reduce((sum, a) => sum + a.score, 0);
    return {
      available: true,
      overall_score_percent: (scoreSum / weightSum) * 100,
      source: 'computed_fallback',
      activities,
    };
  }

  return {
    available: false,
    overall_score_percent: null,
    source: 'unavailable',
    activities,
  };
}

/**
 * Blends the PR-body checklist (self-reported, can be skipped or under/over-filled)
 * with the commit co-authorship signal (structured, present on nearly every PR,
 * harder to game) into one effective AI-contribution figure. When both are
 * present they're averaged; when only one exists, that one is used as-is; when
 * neither exists, `available` stays false rather than assuming 0.
 */
export function combineAiSignals(checklistResult, commitAiPercent) {
  const checklistScore = checklistResult.available ? checklistResult.overall_score_percent : null;

  if (checklistScore !== null && commitAiPercent !== null) {
    return {
      ...checklistResult,
      available: true,
      overall_score_percent: (checklistScore + commitAiPercent) / 2,
      source: 'blended',
      checklist_score_percent: checklistScore,
      commit_ai_percent: commitAiPercent,
    };
  }

  if (checklistScore !== null) {
    return { ...checklistResult, checklist_score_percent: checklistScore, commit_ai_percent: null };
  }

  if (commitAiPercent !== null) {
    return {
      available: true,
      overall_score_percent: commitAiPercent,
      source: 'commit_trailers',
      activities: checklistResult.activities,
      checklist_score_percent: null,
      commit_ai_percent: commitAiPercent,
    };
  }

  return { ...checklistResult, checklist_score_percent: null, commit_ai_percent: null };
}
