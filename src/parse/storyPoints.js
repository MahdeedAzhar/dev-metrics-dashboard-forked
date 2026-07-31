const PLANNED_SP_RE = /\*\*Planned SP:?\*\*\s*(.+)/i;
const ACTUAL_SP_RE = /\*\*Actual SP:?\*\*\s*(.+)/i;
const FIRST_NUMBER_RE = /\d+(?:\.\d+)?/;

function parseField(regex, body) {
  const match = regex.exec(body ?? '');
  if (!match) return { raw: null, parsed_numeric: null };

  const raw = match[1].trim();
  const numberMatch = FIRST_NUMBER_RE.exec(raw);
  return {
    raw,
    parsed_numeric: numberMatch ? Number.parseFloat(numberMatch[0]) : null,
  };
}

/**
 * Parses Planned SP / Actual SP from a PR body. These are free-text manual fields
 * (e.g. "5", "~5", "5 SP", "TBD", or the unfilled template placeholder text) so this
 * only ever extracts the first numeric token found, defensively. Unparseable input
 * (including the template's own placeholder prose) yields `parsed_numeric: null`
 * while keeping `raw` for debugging/display.
 */
export function parseStoryPoints(body) {
  return {
    planned_sp: parseField(PLANNED_SP_RE, body),
    actual_sp: parseField(ACTUAL_SP_RE, body),
  };
}
