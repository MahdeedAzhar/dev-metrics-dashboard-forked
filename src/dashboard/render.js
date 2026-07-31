import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readClientScript(name) {
  return fs.readFileSync(path.join(__dirname, 'client', name), 'utf8');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch],
  );
}

/**
 * Renders the Engineering Delivery & AI Insights Dashboard. Node does all
 * fetching/normalization (see src/index.js) but NO aggregation — aggregation
 * is relative to whatever release(s) are selected, which is a runtime browser
 * concern (dashboard/client/picker.js), recomputed on every selection change
 * via the shared dashboard/client/deliveryMath.js. This function's only job is
 * to embed the full {releases, tickets} dataset and inline those two client
 * scripts into a static HTML shell with four section containers.
 */
export function renderDashboard(bundle) {
  const { generated_at: generatedAt, releases, tickets } = bundle;
  const deliveryMathSource = readClientScript('deliveryMath.js');
  const pickerSource = readClientScript('picker.js');
  const dataJson = JSON.stringify({ releases, tickets }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Engineering Delivery &amp; AI Insights Dashboard</title>
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
    --border: rgba(11,11,11,0.10);
    --shadow: rgba(11,11,11,0.06);
    --series-1: #2a78d6;
    --series-1-track: #cde2fb;
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
      --border: rgba(255,255,255,0.10);
      --shadow: rgba(0,0,0,0.4);
      --series-1: #3987e5;
      --series-1-track: #184f95;
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
    --border: rgba(255,255,255,0.10);
    --shadow: rgba(0,0,0,0.4);
    --series-1: #3987e5;
    --series-1-track: #184f95;
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
  h2 { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
  h3 { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
  .meta { color: var(--text-secondary); font-size: 13px; margin-bottom: 20px; }
  .section { margin-bottom: 36px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 1px 2px var(--shadow);
  }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .kpi-tile .stat-label { display: block; color: var(--text-secondary); font-size: 12px; }
  .kpi-tile .stat-value { display: block; font-size: 26px; font-weight: 650; margin-top: 6px; letter-spacing: -0.01em; }
  .coverage-note { font-size: 11px; font-weight: 500; color: var(--text-muted); }

  .release-picker {
    display: flex; flex-wrap: wrap; gap: 10px; padding: 14px;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    margin-bottom: 20px;
  }
  .release-option { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .release-option input { width: 16px; height: 16px; cursor: pointer; }
  .released-tag { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }

  .dev-summary-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .dev-summary-stats .stat-label { display: block; color: var(--text-secondary); font-size: 11px; }
  .dev-summary-stats .stat-value { display: block; font-size: 18px; font-weight: 650; }

  .ticket-filters { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
  .filter-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  .filter-label select {
    font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary); min-width: 160px;
  }

  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .data-table th, .data-table td {
    text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--gridline);
    font-variant-numeric: tabular-nums;
  }
  .data-table th {
    color: var(--text-secondary); font-weight: 650; font-size: 11.5px;
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .data-table th.sortable { cursor: pointer; user-select: none; }
  .data-table th.sortable:hover { color: var(--text-primary); }
  .data-table tbody tr:hover { background: var(--surface-2); }
  #developer-delivery .dev-row { cursor: pointer; }
  .data-table a { color: var(--series-1); text-decoration: none; }
  .data-table a:hover { text-decoration: underline; }
  .empty-state { color: var(--text-muted); font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Engineering Delivery &amp; AI Insights Dashboard</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt.slice(0, 16)).replace('T', ' ')} UTC · Select release(s) below — everything recalculates instantly, nothing here is a performance score.</p>

  <div class="section">
    <div id="release-picker" class="release-picker"></div>
  </div>

  <div class="section">
    <h2>1. Release Summary</h2>
    <div id="release-summary"></div>
  </div>

  <div class="section">
    <h2>2. Developer Delivery</h2>
    <p class="meta" style="margin-top:-6px;">Click a row to see that developer's tickets below. Delivered AP is the primary delivery metric; Planned SP is workload context.</p>
    <div id="developer-delivery"></div>
  </div>

  <div class="section">
    <h2>3. Developer Details</h2>
    <div id="developer-details"></div>
  </div>

  <div class="section">
    <h2>4. All Release Tickets</h2>
    <div id="all-tickets"></div>
  </div>
</div>
<script>
  window.__DASHBOARD_DATA__ = ${dataJson};
</script>
<script>
${deliveryMathSource}
</script>
<script>
${pickerSource}
</script>
</body>
</html>`;
}
