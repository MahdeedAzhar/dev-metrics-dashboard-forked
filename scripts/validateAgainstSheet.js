// Diffs the manually-maintained Google Sheet (exported as CSV) against the
// tool's own Jira-fetched data for a release, as the trust gate before treating
// the automated dashboard as a replacement for the sheet.
//
// Usage: node --env-file=.env scripts/validateAgainstSheet.js --csv <path> --release "8.6.0" [--json]
//
// Runs the *same* fetch/jira.js + normalize/ticketRecord.js + deliveryMath code
// path the dashboard itself uses (not a reimplementation) — a mismatch here
// means real data disagreement, not two independently-buggy implementations
// happening to agree.
import fs from 'node:fs';
import { fetchTicketsByFixVersions } from '../src/fetch/jira.js';
import { normalizeJiraIssue } from '../src/normalize/ticketRecord.js';
import { computeDeveloperDelivery } from '../src/dashboard/client/deliveryMathNode.js';
import { log, warn } from '../src/utils/logger.js';

function parseArgs(argv) {
  const args = { csv: null, release: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--csv') args.csv = argv[i + 1];
    if (argv[i] === '--release') args.release = argv[i + 1];
    if (argv[i] === '--json') args.json = true;
  }
  return args;
}

/** Minimal RFC4180-ish CSV parser: handles quoted fields (with embedded commas
 * and escaped "" quotes) since Google Sheets exports quote any field
 * containing a comma — ticket summaries reliably will. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCsvRecords(text) {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = (row[idx] ?? '').trim();
    });
    return record;
  });
}

function findField(record, candidates) {
  const keys = Object.keys(record);
  for (const candidate of candidates) {
    const key = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (key) return record[key];
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value.trim() === '') return null;
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

function toSheetRow(record) {
  const key = (findField(record, ['Jira Key', 'Key']) ?? '').trim();
  return {
    key,
    issueType: findField(record, ['Issue Type']) ?? '',
    summary: findField(record, ['Summary']) ?? '',
    assignee: findField(record, ['Assignee']) ?? '',
    sp: toNumber(findField(record, ['SP', 'Story Points', 'Story Points (SP)'])),
    ap: toNumber(findField(record, ['AP', 'Actual Points', 'Actual Points (AP)'])),
    aiPercent: toNumber(findField(record, ['AI Contribution Percentage', 'AI Contribution', 'AI Contribution %'])),
    fixVersions: (findField(record, ['Fix Version(s)', 'Fix Version', 'Fix Versions']) ?? '')
      .split(/[,;]/)
      .map((v) => v.trim())
      .filter(Boolean),
  };
}

function normName(name) {
  return (name ?? '').trim().toLowerCase();
}

function compareTicketCount(sheetByKey, toolByKey) {
  const onlyInSheet = [...sheetByKey.keys()].filter((k) => !toolByKey.has(k));
  const onlyInTool = [...toolByKey.keys()].filter((k) => !sheetByKey.has(k));
  return {
    status: onlyInSheet.length === 0 && onlyInTool.length === 0 ? 'PASS' : 'FAIL',
    sheet_count: sheetByKey.size,
    tool_count: toolByKey.size,
    only_in_sheet: onlyInSheet,
    only_in_tool: onlyInTool,
  };
}

function compareAssignees(sheetByKey, toolByKey) {
  const mismatches = [];
  for (const [key, sheetRow] of sheetByKey) {
    const tool = toolByKey.get(key);
    if (!tool) continue;
    if (normName(sheetRow.assignee) !== normName(tool.assignee_display_name)) {
      mismatches.push({ key, sheet: sheetRow.assignee, tool: tool.assignee_display_name });
    }
  }
  return { status: mismatches.length === 0 ? 'PASS' : 'FAIL', mismatches };
}

function compareTotals(sheetByKey, toolByKey, field) {
  const sheetTotal = [...sheetByKey.values()].reduce((sum, r) => sum + (r[field] ?? 0), 0);
  const toolTotal = [...toolByKey.values()].reduce((sum, t) => sum + (t[field] ?? 0), 0);
  const perTicketMismatches = [];
  for (const [key, sheetRow] of sheetByKey) {
    const tool = toolByKey.get(key);
    if (!tool) continue;
    const sheetVal = sheetRow[field] ?? null;
    const toolVal = tool[field] ?? null;
    if (sheetVal !== toolVal) perTicketMismatches.push({ key, sheet: sheetVal, tool: toolVal });
  }
  return {
    status: sheetTotal === toolTotal && perTicketMismatches.length === 0 ? 'PASS' : 'FAIL',
    sheet_total: sheetTotal,
    tool_total: toolTotal,
    delta: toolTotal - sheetTotal,
    per_ticket_mismatches: perTicketMismatches,
  };
}

function compareAiContribution(sheetByKey, toolByKey) {
  const sheetValues = [...sheetByKey.values()].map((r) => r.aiPercent).filter((v) => v !== null);
  // Same class of bug already caught once on the Jira field itself (0-1 vs 0-100)
  // — warn rather than silently comparing mismatched scales.
  const suspectFraction =
    sheetValues.length > 0 && sheetValues.every((v) => v <= 1) && sheetValues.some((v) => v > 0 && v < 1);

  const mismatches = [];
  for (const [key, sheetRow] of sheetByKey) {
    const tool = toolByKey.get(key);
    if (!tool || sheetRow.aiPercent === null || tool.ai_contribution_percent === null) continue;
    if (Math.abs(sheetRow.aiPercent - tool.ai_contribution_percent) > 1) {
      mismatches.push({ key, sheet: sheetRow.aiPercent, tool: tool.ai_contribution_percent });
    }
  }
  return {
    status: mismatches.length === 0 ? 'PASS' : 'FAIL',
    unit_warning: suspectFraction
      ? 'Sheet AI Contribution values all look like a 0-1 fraction, not a 0-100 percent — verify units before trusting this diff.'
      : null,
    mismatches,
  };
}

function toPseudoTicket(sheetRow) {
  return {
    assignee_account_id: normName(sheetRow.assignee) || 'unassigned',
    assignee_display_name: sheetRow.assignee || 'Unassigned',
    sp: sheetRow.sp,
    ap: sheetRow.ap,
    ai_contribution_percent: sheetRow.aiPercent,
  };
}

function compareDeveloperTotals(sheetRows, toolTickets) {
  const sheetDev = computeDeveloperDelivery(sheetRows.map(toPseudoTicket));
  const toolDev = computeDeveloperDelivery(toolTickets);
  const sheetByName = new Map(sheetDev.map((d) => [normName(d.assignee_display_name), d]));
  const toolByName = new Map(toolDev.map((d) => [normName(d.assignee_display_name), d]));
  const allNames = new Set([...sheetByName.keys(), ...toolByName.keys()]);

  const rows = [...allNames].map((name) => ({
    developer: name,
    sheet_sp: sheetByName.get(name)?.planned_sp ?? null,
    tool_sp: toolByName.get(name)?.planned_sp ?? null,
    sheet_ap: sheetByName.get(name)?.delivered_ap ?? null,
    tool_ap: toolByName.get(name)?.delivered_ap ?? null,
  }));
  const mismatches = rows.filter((r) => r.sheet_sp !== r.tool_sp || r.sheet_ap !== r.tool_ap);
  return { status: mismatches.length === 0 ? 'PASS' : 'FAIL', rows, mismatches };
}

function compareReleaseMembership(sheetRows, toolTickets, release) {
  const toolMismatches = toolTickets
    .filter((t) => !t.fix_versions.some((v) => v.name === release))
    .map((t) => t.key);
  const sheetMismatches = sheetRows.filter((r) => !r.fixVersions.includes(release)).map((r) => r.key);
  return {
    status: toolMismatches.length === 0 && sheetMismatches.length === 0 ? 'PASS' : 'FAIL',
    tool_tickets_missing_release_tag: toolMismatches,
    sheet_rows_missing_release_tag: sheetMismatches,
  };
}

function printReport(report) {
  log('=== Validation report ===');
  for (const [name, result] of Object.entries(report)) {
    log(`${result.status === 'PASS' ? '✔' : '✖'} ${name}: ${result.status}`);
    if (result.status === 'FAIL' || result.unit_warning) {
      log(JSON.stringify(result, null, 2));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv || !args.release) {
    warn('Usage: node --env-file=.env scripts/validateAgainstSheet.js --csv <path> --release "<name>" [--json]');
    process.exitCode = 1;
    return;
  }

  const csvText = fs.readFileSync(args.csv, 'utf8');
  const sheetRows = parseCsvRecords(csvText)
    .map(toSheetRow)
    .filter((row) => row.key && row.fixVersions.includes(args.release));

  log(`Fetching Jira tickets for release "${args.release}" via the tool's own pipeline...`);
  const rawIssues = await fetchTicketsByFixVersions([args.release]);
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const toolTickets = rawIssues.map((issue) => normalizeJiraIssue(issue, new Map(), jiraBaseUrl));

  const sheetByKey = new Map(sheetRows.map((r) => [r.key, r]));
  const toolByKey = new Map(toolTickets.map((t) => [t.key, t]));

  const report = {
    ticket_count: compareTicketCount(sheetByKey, toolByKey),
    assignees: compareAssignees(sheetByKey, toolByKey),
    sp_totals: compareTotals(sheetByKey, toolByKey, 'sp'),
    ap_totals: compareTotals(sheetByKey, toolByKey, 'ap'),
    ai_contribution: compareAiContribution(sheetByKey, toolByKey),
    developer_sp_ap: compareDeveloperTotals(sheetRows, toolTickets),
    release_membership: compareReleaseMembership(sheetRows, toolTickets, args.release),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  process.exitCode = Object.values(report).some((r) => r.status === 'FAIL') ? 1 : 0;
}

main().catch((error) => {
  warn(error.stack ?? error.message);
  process.exitCode = 1;
});
