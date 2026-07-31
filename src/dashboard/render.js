const STATUS_META = {
  green: { label: 'On track', icon: '●' },
  yellow: { label: 'Watch', icon: '▲' },
  red: { label: 'At risk', icon: '■' },
  OK: { label: 'OK', icon: '●' },
  JUSTIFIED_BY_SP: { label: 'Justified by SP', icon: '●' },
  FLAGGED_STALE_PR: { label: 'Stale PR', icon: '▲' },
  FLAGGED_UNEXPLAINED: { label: 'Unexplained gap', icon: '■' },
  LOW_VOLUME: { label: 'Low volume', icon: '▲' },
  NO_DATA: { label: 'No data', icon: '○' },
};

const STATUS_CLASS = {
  green: 'status-good',
  OK: 'status-good',
  JUSTIFIED_BY_SP: 'status-good',
  yellow: 'status-warning',
  LOW_VOLUME: 'status-warning',
  FLAGGED_STALE_PR: 'status-critical',
  red: 'status-critical',
  FLAGGED_UNEXPLAINED: 'status-critical',
  NO_DATA: 'status-neutral',
};

const LOW_COVERAGE_THRESHOLD = 50;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function fmtNum(value, digits = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPercent(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? `${Math.round(value)}%` : '—';
}

function fmtHours(hours) {
  if (typeof hours !== 'number' || Number.isNaN(hours)) return '—';
  if (hours < 48) return `${fmtNum(hours, 1)}h`;
  return `${fmtNum(hours / 24, 1)}d`;
}

function fmtDays(days) {
  return typeof days === 'number' && !Number.isNaN(days) ? `${fmtNum(days, 1)}d` : '—';
}

function statusChip(key, extraLabel) {
  const meta = STATUS_META[key] ?? { label: key ?? 'Unknown', icon: '○' };
  const cls = STATUS_CLASS[key] ?? 'status-neutral';
  const label = extraLabel ?? meta.label;
  return `<span class="chip ${cls}"><span class="chip-icon" aria-hidden="true">${meta.icon}</span>${escapeHtml(label)}</span>`;
}

/** A meter whose track visibly fades and gains a caveat once the backing sample is thin. */
function meter(value, label, coveragePercent) {
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
  const lowConfidence = typeof coveragePercent === 'number' && coveragePercent < LOW_COVERAGE_THRESHOLD;
  const coverageNote =
    typeof coveragePercent === 'number'
      ? `<span class="${lowConfidence ? 'meter-caveat status-warning' : 'meter-caveat'}">${
          lowConfidence ? '▲ ' : ''
        }${fmtPercent(coveragePercent)} of PRs have data</span>`
      : '';
  return `
    <div class="meter">
      <div class="meter-head">
        <span>${escapeHtml(label)}</span>
        <span class="meter-value">${pct === null ? '—' : fmtPercent(pct)}</span>
      </div>
      <div class="meter-track"><div class="meter-fill${lowConfidence ? ' meter-fill-low' : ''}" style="width:${pct ?? 0}%"></div></div>
      ${coverageNote}
    </div>`;
}

/** Vertical column chart: single hue, magnitude only — no per-column identity to encode. */
function columnChart(points, { height = 140, barWidth = 18, gap = 6 } = {}) {
  if (points.length === 0) return '<p class="empty-state">No data in this window.</p>';
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = points.length * (barWidth + gap) + gap;
  const plotHeight = height - 24; // leave room for x-axis labels

  const bars = points
    .map((p, i) => {
      const barHeight = Math.max(1, (p.value / max) * plotHeight);
      const x = gap + i * (barWidth + gap);
      const y = plotHeight - barHeight;
      const showLabel = p.value === max || i === points.length - 1;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" ry="4" class="bar-fill">
            <title>${escapeHtml(p.label)}: ${fmtNum(p.value)} PR(s)</title>
          </rect>
          ${showLabel ? `<text x="${x + barWidth / 2}" y="${y - 4}" class="bar-value" text-anchor="middle">${fmtNum(p.value)}</text>` : ''}
          <text x="${x + barWidth / 2}" y="${plotHeight + 16}" class="axis-label" text-anchor="middle">${escapeHtml(p.label)}</text>
        </g>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="PRs opened per day">
      <line x1="0" y1="${plotHeight}" x2="${width}" y2="${plotHeight}" class="baseline" />
      ${bars}
    </svg>`;
}

/**
 * Horizontal ranking bar: labels carry developer identity, so one hue is correct
 * (see dataviz series-count rule — magnitude comparison, not identity, past ~7
 * classes). A dashed reference line marks the team median so a 28-vs-5 gap reads
 * at a glance instead of requiring the reader to compare bar lengths by eye.
 */
function rankingBarChart(points, teamMedian, { barHeight = 22, gap = 10, labelWidth = 130 } = {}) {
  if (points.length === 0) return '<p class="empty-state">No data in this window.</p>';
  const max = Math.max(1, ...points.map((p) => p.value), teamMedian ?? 0);
  const plotWidth = 260;
  const rowHeight = barHeight + gap;
  const height = points.length * rowHeight + gap;
  const medianX = typeof teamMedian === 'number' ? labelWidth + (teamMedian / max) * plotWidth : null;

  const rows = points
    .map((p, i) => {
      const y = gap + i * rowHeight;
      const w = Math.max(2, (p.value / max) * plotWidth);
      const low = p.flag === 'LOW_VOLUME';
      return `
        <g>
          <text x="0" y="${y + barHeight / 2 + 4}" class="axis-label" text-anchor="start">${escapeHtml(p.label)}</text>
          <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="4" ry="4" class="${low ? 'bar-fill-warning' : 'bar-fill'}">
            <title>${escapeHtml(p.label)}: ${fmtNum(p.value)} PR(s) opened${low ? ' — below half the team median' : ''}</title>
          </rect>
          <text x="${labelWidth + w + 6}" y="${y + barHeight / 2 + 4}" class="bar-value" text-anchor="start">${fmtNum(p.value)}${low ? ' ▲' : ''}</text>
        </g>`;
    })
    .join('');

  const medianLine =
    medianX !== null
      ? `<line x1="${medianX}" y1="0" x2="${medianX}" y2="${height}" class="reference-line" />
         <text x="${medianX}" y="${height + 14}" class="axis-label" text-anchor="middle">median ${fmtNum(teamMedian, 1)}</text>`
      : '';

  return `
    <svg viewBox="0 0 ${labelWidth + plotWidth + 60} ${height + (medianLine ? 26 : 0)}" width="100%" height="${height + (medianLine ? 26 : 0)}" role="img" aria-label="PRs opened per developer, with team median">
      ${rows}
      ${medianLine}
    </svg>`;
}

function aiBreakdownLine(dev) {
  const parts = [];
  if (typeof dev.ai_checklist_avg_percent === 'number') {
    parts.push(
      `checklist ${fmtPercent(dev.ai_checklist_avg_percent)} (${fmtPercent(dev.ai_checklist_coverage_percent)} of PRs)`,
    );
  }
  if (typeof dev.ai_commit_avg_percent === 'number') {
    parts.push(
      `commits ${fmtPercent(dev.ai_commit_avg_percent)} (${fmtPercent(dev.ai_commit_coverage_percent)} of PRs)`,
    );
  }
  return parts.length ? `<p class="ai-source-line">Sources: ${parts.join(' · ')}</p>` : '';
}

function developerCard(dev) {
  const band = dev.color_band ?? 'red';
  const openPrRows = dev.currently_open_prs
    .map(
      (pr) => `
        <tr>
          <td>${escapeHtml(pr.pr_id)}</td>
          <td>${fmtDays(pr.days_open)}</td>
          <td>${pr.planned_sp ?? '—'}</td>
          <td>${pr.expected_days === null ? '—' : fmtDays(pr.expected_days)}</td>
          <td>${statusChip(pr.flag_status)}</td>
        </tr>`,
    )
    .join('');

  return `
    <article class="card dev-card">
      <header class="dev-card-head">
        <div class="dev-card-name">
          <h3>${escapeHtml(dev.developer)}</h3>
          ${dev.volume_flag === 'LOW_VOLUME' ? statusChip('LOW_VOLUME') : ''}
        </div>
        <div class="dev-card-score ${STATUS_CLASS[band] ?? 'status-neutral'}">
          <span class="hero-figure">${dev.composite_score === null ? '—' : fmtNum(dev.composite_score, 0)}</span>
          <span class="hero-suffix">/100</span>
        </div>
      </header>
      <p class="rating-line">${statusChip(band)}</p>

      <div class="dev-card-stats">
        <div><span class="stat-label">PRs opened</span><span class="stat-value">${dev.prs_opened_count}${dev.team_median_prs_opened ? ` <span class="stat-sub">(team median ${fmtNum(dev.team_median_prs_opened, 1)})</span>` : ''}</span></div>
        <div><span class="stat-label">PRs merged</span><span class="stat-value">${dev.prs_merged_count}</span></div>
        <div><span class="stat-label">Median time-to-merge</span><span class="stat-value">${fmtHours(dev.median_time_to_merge_hours)}</span></div>
        <div><span class="stat-label">Median time-to-review</span><span class="stat-value">${fmtHours(dev.median_time_to_review_hours)}</span></div>
      </div>

      ${meter(dev.speed_score, 'Speed vs. SP-implied duration', dev.speed_score_data_coverage_percent)}
      ${meter(dev.quality_score, 'Quality (first-pass approval rate)', 100)}
      ${meter(dev.ai_leverage_score, 'AI leverage (blended)', dev.ai_contribution_data_coverage_percent)}
      ${aiBreakdownLine(dev)}

      <div class="dev-card-gap">
        <div>
          <span class="stat-label">Days since last PR opened</span>
          <span class="stat-value">${dev.days_since_last_pr_opened === null ? '—' : fmtDays(dev.days_since_last_pr_opened)}</span>
        </div>
        ${statusChip(dev.gap_status)}
      </div>

      ${
        dev.currently_open_prs.length > 0
          ? `<table class="mini-table">
              <thead><tr><th>Open PR</th><th>Days open</th><th>Planned SP</th><th>Expected</th><th>Status</th></tr></thead>
              <tbody>${openPrRows}</tbody>
            </table>`
          : ''
      }
    </article>`;
}

function flaggedTable(developers) {
  const rows = [];
  for (const dev of developers) {
    for (const pr of dev.currently_open_prs) {
      if (pr.flag_status === 'FLAGGED_STALE_PR') {
        rows.push({ developer: dev.developer, ...pr });
      }
    }
  }
  if (rows.length === 0) {
    return '<p class="empty-state">No stale open PRs in this window.</p>';
  }
  rows.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const body = rows
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.developer)}</td>
          <td>${escapeHtml(r.pr_id)}</td>
          <td>${fmtDays(r.days_open)}</td>
          <td>${r.planned_sp ?? '—'}</td>
          <td>${fmtDays(r.expected_days)}</td>
          <td>${r.ratio === null ? '—' : `${fmtNum(r.ratio, 1)}×`}</td>
        </tr>`,
    )
    .join('');
  return `
    <table class="data-table">
      <thead><tr><th>Developer</th><th>PR</th><th>Days open</th><th>Planned SP</th><th>Expected days</th><th>Ratio</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function fullMetricsTable(developers) {
  const rows = developers
    .slice()
    .sort((a, b) => (b.composite_score ?? -1) - (a.composite_score ?? -1))
    .map(
      (dev) => `
        <tr>
          <td>${escapeHtml(dev.developer)}</td>
          <td>${dev.prs_opened_count}</td>
          <td>${dev.prs_merged_count}</td>
          <td>${fmtHours(dev.median_time_to_review_hours)}</td>
          <td>${fmtHours(dev.median_time_to_merge_hours)}</td>
          <td>${dev.ai_contribution_avg_percent === null ? '—' : fmtPercent(dev.ai_contribution_avg_percent)}</td>
          <td>${dev.ai_contribution_data_coverage_percent === null ? '—' : fmtPercent(dev.ai_contribution_data_coverage_percent)}</td>
          <td>${dev.composite_score === null ? '—' : fmtNum(dev.composite_score, 0)}</td>
          <td>${statusChip(dev.color_band ?? 'red')}</td>
          <td>${statusChip(dev.gap_status)}</td>
          <td>${dev.volume_flag === 'LOW_VOLUME' ? statusChip('LOW_VOLUME') : statusChip('OK', 'OK')}</td>
        </tr>`,
    )
    .join('');

  return `
    <table class="data-table" id="full-metrics-table">
      <thead>
        <tr>
          <th>Developer</th><th>Opened</th><th>Merged</th><th>Median review</th><th>Median merge</th>
          <th>AI avg</th><th>AI coverage</th><th>Composite</th><th>Rating</th><th>Gap status</th><th>Volume</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function legend() {
  return `
    <div class="legend">
      <span class="legend-item">${statusChip('green', 'On track')}</span>
      <span class="legend-item">${statusChip('yellow', 'Watch')}</span>
      <span class="legend-item">${statusChip('red', 'At risk')}</span>
      <span class="legend-item">${statusChip('LOW_VOLUME')}</span>
      <span class="legend-item">${statusChip('FLAGGED_STALE_PR')}</span>
      <span class="legend-item">${statusChip('FLAGGED_UNEXPLAINED')}</span>
    </div>`;
}

export function renderDashboard(data) {
  const {
    generated_at: generatedAt,
    window: win,
    release,
    repos,
    developers,
    daily_pr_counts: dailyCounts,
  } = data;

  const totalOpened = developers.reduce((sum, d) => sum + d.prs_opened_count, 0);
  const totalMerged = developers.reduce((sum, d) => sum + d.prs_merged_count, 0);
  const teamAiScores = developers.map((d) => d.ai_contribution_avg_percent).filter((v) => typeof v === 'number');
  const teamAiAvg = teamAiScores.length
    ? teamAiScores.reduce((s, v) => s + v, 0) / teamAiScores.length
    : null;
  const flaggedCount = developers.reduce(
    (sum, d) => sum + d.currently_open_prs.filter((p) => p.flag_status === 'FLAGGED_STALE_PR').length,
    0,
  );
  const gapFlaggedCount = developers.filter((d) => d.gap_status.startsWith('FLAGGED')).length;
  const lowVolumeCount = developers.filter((d) => d.volume_flag === 'LOW_VOLUME').length;
  const teamMedianOpened = developers.find((d) => typeof d.team_median_prs_opened === 'number')
    ?.team_median_prs_opened;

  const rankingPoints = developers
    .slice()
    .sort((a, b) => b.prs_opened_count - a.prs_opened_count)
    .map((d) => ({ label: d.developer, value: d.prs_opened_count, flag: d.volume_flag }));

  const dailyPoints = (dailyCounts ?? []).map((d) => ({ label: d.date.slice(5), value: d.opened }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dev PR Velocity &amp; AI-Contribution Dashboard</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --surface-2: #f3f2ef;
    --page-plane: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --shadow: rgba(11,11,11,0.06);
    --series-1: #2a78d6;
    --series-1-track: #cde2fb;
    --status-good: #0ca30c;
    --status-warning: #b5790a;
    --status-critical: #d03b3b;
    --status-neutral: #898781;
    --status-good-bg: rgba(12,163,12,0.10);
    --status-warning-bg: rgba(250,178,25,0.16);
    --status-critical-bg: rgba(208,59,59,0.10);
    --status-neutral-bg: rgba(137,135,129,0.12);
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --surface-2: #232322;
      --page-plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --shadow: rgba(0,0,0,0.4);
      --series-1: #3987e5;
      --series-1-track: #184f95;
      --status-good: #0ca30c;
      --status-warning: #fab219;
      --status-critical: #e66767;
      --status-good-bg: rgba(12,163,12,0.16);
      --status-warning-bg: rgba(250,178,25,0.14);
      --status-critical-bg: rgba(230,103,103,0.14);
      --status-neutral-bg: rgba(137,135,129,0.16);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --surface-2: #232322;
    --page-plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --shadow: rgba(0,0,0,0.4);
    --series-1: #3987e5;
    --series-1-track: #184f95;
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-critical: #e66767;
    --status-good-bg: rgba(12,163,12,0.16);
    --status-warning-bg: rgba(250,178,25,0.14);
    --status-critical-bg: rgba(230,103,103,0.14);
    --status-neutral-bg: rgba(137,135,129,0.16);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page-plane);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 24px 64px;
  }
  .wrap { max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 650; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 16px; font-weight: 650; margin: 0 0 4px; color: var(--text-primary); }
  h3 { font-size: 16px; font-weight: 650; margin: 0; }
  .section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
  .section-count { color: var(--text-muted); font-size: 12px; }
  .meta { color: var(--text-secondary); font-size: 13px; margin-bottom: 6px; }
  .release-badge {
    display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650;
    padding: 3px 10px; border-radius: 999px; background: var(--series-1-track); color: var(--series-1);
    margin-left: 8px;
  }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 14px 0 28px; font-size: 12px; }
  .section { margin-bottom: 36px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
    box-shadow: 0 1px 2px var(--shadow);
  }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .kpi-tile .stat-label { display: block; color: var(--text-secondary); font-size: 12px; }
  .kpi-tile .stat-value { display: block; font-size: 30px; font-weight: 650; margin-top: 6px; letter-spacing: -0.01em; }
  .dev-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
  .dev-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dev-card-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .dev-card-score { display: flex; align-items: baseline; gap: 2px; flex-shrink: 0; }
  .hero-figure { font-size: 32px; font-weight: 650; letter-spacing: -0.02em; line-height: 1; }
  .hero-suffix { font-size: 13px; color: var(--text-muted); }
  .rating-line { margin: 6px 0 14px; }
  .dev-card-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--gridline); }
  .dev-card-stats .stat-label { display: block; color: var(--text-secondary); font-size: 11px; }
  .dev-card-stats .stat-value { display: block; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .stat-sub { font-size: 11px; font-weight: 500; color: var(--text-muted); }
  .dev-card-gap { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--gridline); }
  .dev-card-gap .stat-value { font-weight: 650; }
  .meter { margin: 12px 0; }
  .meter-head { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-secondary); margin-bottom: 5px; }
  .meter-value { color: var(--text-primary); font-weight: 650; font-variant-numeric: tabular-nums; }
  .meter-track { height: 6px; border-radius: 3px; background: var(--series-1-track); overflow: hidden; }
  .meter-fill { height: 100%; background: var(--series-1); border-radius: 3px; }
  .meter-fill-low { background: var(--status-warning); opacity: 0.75; }
  .meter-caveat { display: block; font-size: 11px; color: var(--text-muted); margin-top: 3px; }
  .ai-source-line { font-size: 11.5px; color: var(--text-muted); margin: -6px 0 12px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 650;
    padding: 3px 9px; border-radius: 999px;
  }
  .chip-icon { font-size: 9px; }
  .status-good { color: var(--status-good); background: var(--status-good-bg); }
  .status-warning { color: var(--status-warning); background: var(--status-warning-bg); }
  .status-critical { color: var(--status-critical); background: var(--status-critical-bg); }
  .status-neutral { color: var(--text-muted); background: var(--status-neutral-bg); }
  .dev-card-score.status-good .hero-figure, .dev-card-score.status-good .hero-suffix { color: var(--status-good); }
  .dev-card-score.status-warning .hero-figure, .dev-card-score.status-warning .hero-suffix { color: var(--status-warning); }
  .dev-card-score.status-critical .hero-figure, .dev-card-score.status-critical .hero-suffix { color: var(--status-critical); }
  .data-table, .mini-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  .data-table th, .data-table td, .mini-table th, .mini-table td {
    text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--gridline);
    font-variant-numeric: tabular-nums;
  }
  .data-table th, .mini-table th { color: var(--text-secondary); font-weight: 650; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.02em; }
  .data-table tbody tr:hover, .mini-table tbody tr:hover { background: var(--surface-2); }
  .bar-fill { fill: var(--series-1); }
  .bar-fill-warning { fill: var(--status-warning); }
  .bar-value { fill: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
  .axis-label { fill: var(--text-muted); font-size: 11px; }
  .baseline { stroke: var(--baseline); stroke-width: 1; }
  .reference-line { stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .empty-state { color: var(--text-muted); font-size: 13px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }
  .caveat { color: var(--text-muted); font-size: 12.5px; margin: -4px 0 16px; max-width: 76ch; line-height: 1.5; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Dev PR Velocity &amp; AI-Contribution Dashboard${release ? `<span class="release-badge">Release ${escapeHtml(release)}</span>` : ''}</h1>
  <p class="meta">
    ${release ? `All PRs linked to release ${escapeHtml(release)}` : `Window: ${escapeHtml(win.start.slice(0, 10))} → ${escapeHtml(win.end.slice(0, 10))}`}
    · Repos: ${repos.map(escapeHtml).join(', ')} · Generated ${escapeHtml(generatedAt.slice(0, 16)).replace('T', ' ')} UTC
  </p>
  ${legend()}

  <div class="kpi-row">
    <div class="card kpi-tile"><span class="stat-label">PRs opened</span><span class="stat-value">${fmtNum(totalOpened)}</span></div>
    <div class="card kpi-tile"><span class="stat-label">PRs merged</span><span class="stat-value">${fmtNum(totalMerged)}</span></div>
    <div class="card kpi-tile"><span class="stat-label">Team AI leverage avg</span><span class="stat-value">${teamAiAvg === null ? '—' : fmtPercent(teamAiAvg)}</span></div>
    <div class="card kpi-tile"><span class="stat-label">Stale open PRs</span><span class="stat-value">${flaggedCount}</span></div>
    <div class="card kpi-tile"><span class="stat-label">Low-volume devs</span><span class="stat-value">${lowVolumeCount}</span></div>
    <div class="card kpi-tile"><span class="stat-label">Devs with a flagged gap</span><span class="stat-value">${gapFlaggedCount}</span></div>
  </div>

  <div class="section two-col">
    <div class="card">
      <h2>PRs opened per day (team)</h2>
      ${columnChart(dailyPoints)}
    </div>
    <div class="card">
      <h2>PRs opened per developer</h2>
      <p class="caveat">Dashed line marks the team median. Anyone below half that median is flagged Low volume.</p>
      ${rankingBarChart(rankingPoints, teamMedianOpened)}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Developer scorecards</h2>
      <span class="section-count">${developers.length} developer(s)</span>
    </div>
    <p class="caveat">
      Composite = 40% Speed + 30% Quality (first-pass approval rate) + 30% AI leverage — but each sub-score's
      weight is scaled down by its own data coverage, so a score built from 2 of 10 PRs pulls far less than one
      built from 9 of 10 instead of counting the same as a full sample. AI leverage blends the PR-body checklist
      (self-reported) with the share of a PR's commits carrying a "Co-Authored-By: Claude" trailer (structured,
      harder to game) — see the source line on each card.
    </p>
    <div class="dev-grid">
      ${developers
        .slice()
        .sort((a, b) => (b.composite_score ?? -1) - (a.composite_score ?? -1))
        .map(developerCard)
        .join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Flagged: open PRs beyond their SP-implied duration</h2>
    </div>
    ${flaggedTable(developers)}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Full metrics (table view)</h2>
      <span class="section-count">sorted by composite score</span>
    </div>
    ${fullMetricsTable(developers)}
  </div>
</div>
</body>
</html>`;
}
