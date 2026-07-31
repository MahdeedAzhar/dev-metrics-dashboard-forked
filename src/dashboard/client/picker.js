// Browser-only state/rendering. Plain JS, no import/export, wrapped in an IIFE
// so its own helpers stay off the global scope — but it freely calls the
// un-wrapped global functions from deliveryMath.js (inlined in the <script>
// tag just before this one in dashboard/render.js's output).
(function () {
  var DATA = window.__DASHBOARD_DATA__;

  var state = {
    selectedReleases: new Set(DATA.releases.map(function (r) { return r.name; })),
    selectedDeveloper: null,
    ticketFilters: { status: '', issueType: '', developer: '' },
    sortState: { column: null, direction: 'desc' },
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtNum(value, digits) {
    if (typeof value !== 'number' || isNaN(value)) return '—';
    return value.toLocaleString(undefined, { maximumFractionDigits: digits || 0 });
  }

  function fmtPercent(value) {
    return typeof value === 'number' && !isNaN(value) ? Math.round(value) + '%' : '—';
  }

  function getVisibleTickets() {
    return filterTicketsBySelectedReleases(DATA.tickets, Array.from(state.selectedReleases));
  }

  function getFilteredSortedTickets() {
    var tickets = getVisibleTickets().slice();
    var f = state.ticketFilters;
    if (f.status) tickets = tickets.filter(function (t) { return t.status === f.status; });
    if (f.issueType) tickets = tickets.filter(function (t) { return t.issue_type === f.issueType; });
    if (f.developer) tickets = tickets.filter(function (t) { return t.assignee_account_id === f.developer; });

    var sort = state.sortState;
    if (sort.column) {
      tickets.sort(function (a, b) {
        var av = a[sort.column];
        var bv = b[sort.column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return sort.direction === 'asc' ? -1 : 1;
        if (av > bv) return sort.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return tickets;
  }

  function kpiTile(label, value) {
    return (
      '<div class="card kpi-tile"><span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-value">' +
      value +
      '</span></div>'
    );
  }

  function statPair(label, value) {
    return (
      '<div><span class="stat-label">' +
      escapeHtml(label) +
      '</span><span class="stat-value">' +
      value +
      '</span></div>'
    );
  }

  function prLinksHtml(ticket) {
    if (!ticket.linked_prs || ticket.linked_prs.length === 0) {
      return '<span class="empty-state">No linked PR found</span>';
    }
    return ticket.linked_prs
      .map(function (pr) {
        return (
          '<a href="' +
          escapeHtml(pr.pr_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(pr.repo.split('/')[1]) +
          ' #' +
          pr.pr_number +
          '</a> (' +
          escapeHtml(pr.pr_state) +
          ')'
        );
      })
      .join('<br>');
  }

  function renderReleasePicker() {
    var el = document.getElementById('release-picker');
    el.innerHTML = DATA.releases
      .map(function (r) {
        var checked = state.selectedReleases.has(r.name) ? 'checked' : '';
        var id = 'release-cb-' + r.name.replace(/[^a-zA-Z0-9]/g, '-');
        return (
          '<label class="release-option" for="' +
          id +
          '"><input type="checkbox" id="' +
          id +
          '" data-release="' +
          escapeHtml(r.name) +
          '" ' +
          checked +
          ' /><span>' +
          escapeHtml(r.name) +
          (r.released ? ' <span class="released-tag">released</span>' : '') +
          '</span></label>'
        );
      })
      .join('');

    Array.prototype.forEach.call(el.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () {
        var name = cb.getAttribute('data-release');
        if (cb.checked) state.selectedReleases.add(name);
        else state.selectedReleases.delete(name);
        renderAll();
      });
    });
  }

  function renderReleaseSummary() {
    var el = document.getElementById('release-summary');
    var summary = computeReleaseSummary(getVisibleTickets());
    var aiValue =
      fmtPercent(summary.team_ai_contribution_percent) +
      (summary.total_tickets > 0
        ? ' <span class="coverage-note">(' + summary.team_ai_contribution_coverage + '/' + summary.total_tickets + ' tickets)</span>'
        : '');

    el.innerHTML =
      '<div class="kpi-row">' +
      kpiTile('Total tickets', fmtNum(summary.total_tickets)) +
      kpiTile('Completed', fmtNum(summary.completed_tickets)) +
      kpiTile('Remaining', fmtNum(summary.remaining_tickets)) +
      kpiTile('Planned SP', fmtNum(summary.total_planned_sp)) +
      kpiTile('Delivered AP', fmtNum(summary.total_delivered_ap)) +
      kpiTile('Team AI contribution', aiValue) +
      '</div>';
  }

  function renderDeveloperDelivery() {
    var el = document.getElementById('developer-delivery');
    var rows = computeDeveloperDelivery(getVisibleTickets()).sort(function (a, b) {
      return b.delivered_ap - a.delivered_ap;
    });

    var body = rows
      .map(function (r) {
        return (
          '<tr class="dev-row" data-dev-id="' +
          escapeHtml(r.assignee_account_id) +
          '"><td>' +
          escapeHtml(r.assignee_display_name) +
          '</td><td>' +
          r.ticket_count +
          '</td><td>' +
          fmtNum(r.planned_sp) +
          '</td><td>' +
          fmtNum(r.delivered_ap) +
          '</td><td>' +
          (r.percent_of_highest_ap == null ? '—' : fmtPercent(r.percent_of_highest_ap)) +
          '</td><td>' +
          (r.percent_of_team_ap == null ? '—' : fmtPercent(r.percent_of_team_ap)) +
          '</td><td>' +
          (r.ai_contribution_percent == null
            ? '—'
            : fmtPercent(r.ai_contribution_percent) +
              ' <span class="coverage-note">(' +
              r.ai_contribution_coverage +
              '/' +
              r.ticket_count +
              ')</span>') +
          '</td></tr>'
        );
      })
      .join('');

    el.innerHTML =
      '<table class="data-table" id="developer-delivery-table"><thead><tr>' +
      '<th>Developer</th><th>Tickets</th><th>Planned SP</th><th>Delivered AP</th>' +
      '<th>% of Highest AP</th><th>% of Team AP</th><th>AI Contribution</th>' +
      '</tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="empty-state">No tickets in the selected release(s).</td></tr>') +
      '</tbody></table>';

    Array.prototype.forEach.call(el.querySelectorAll('.dev-row'), function (row) {
      row.addEventListener('click', function () {
        var devId = row.getAttribute('data-dev-id');
        state.selectedDeveloper = devId;
        state.ticketFilters.developer = devId;
        renderDeveloperDetails();
        renderAllTickets();
        var details = document.getElementById('developer-details');
        if (details.scrollIntoView) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderDeveloperDetails() {
    var el = document.getElementById('developer-details');
    if (!state.selectedDeveloper) {
      el.innerHTML = '<p class="empty-state">Click a developer in the table above to see their tickets.</p>';
      return;
    }

    var visible = getVisibleTickets();
    var tickets = visible.filter(function (t) { return t.assignee_account_id === state.selectedDeveloper; });
    if (tickets.length === 0) {
      el.innerHTML = '<p class="empty-state">No tickets found for this developer in the selected release(s).</p>';
      return;
    }

    var devRow = computeDeveloperDelivery(visible).find(function (r) {
      return r.assignee_account_id === state.selectedDeveloper;
    });

    var summaryHtml =
      '<div class="dev-summary-stats">' +
      statPair('Tickets', devRow.ticket_count) +
      statPair('Planned SP', fmtNum(devRow.planned_sp)) +
      statPair('Delivered AP', fmtNum(devRow.delivered_ap)) +
      statPair('% of Highest AP', devRow.percent_of_highest_ap == null ? '—' : fmtPercent(devRow.percent_of_highest_ap)) +
      statPair('% of Team AP', devRow.percent_of_team_ap == null ? '—' : fmtPercent(devRow.percent_of_team_ap)) +
      statPair('AI Contribution', devRow.ai_contribution_percent == null ? '—' : fmtPercent(devRow.ai_contribution_percent)) +
      '</div>';

    var ticketRows = tickets
      .map(function (t) {
        return (
          '<tr><td><a href="' +
          escapeHtml(t.jira_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(t.key) +
          '</a></td><td>' +
          escapeHtml(t.summary) +
          '</td><td>' +
          escapeHtml(t.status) +
          '</td><td>' +
          (t.sp == null ? '—' : t.sp) +
          '</td><td>' +
          (t.ap == null ? '—' : t.ap) +
          '</td><td>' +
          (t.ai_contribution_percent == null ? '—' : fmtPercent(t.ai_contribution_percent)) +
          '</td><td>' +
          prLinksHtml(t) +
          '</td></tr>'
        );
      })
      .join('');

    el.innerHTML =
      '<h3>' +
      escapeHtml(devRow.assignee_display_name) +
      '</h3>' +
      summaryHtml +
      '<table class="data-table"><thead><tr><th>Jira</th><th>Summary</th><th>Status</th><th>SP</th><th>AP</th><th>AI Contribution</th><th>PR(s)</th></tr></thead><tbody>' +
      ticketRows +
      '</tbody></table>';
  }

  function uniqueValues(tickets, field) {
    var set = new Set();
    tickets.forEach(function (t) {
      if (t[field]) set.add(t[field]);
    });
    return Array.from(set).sort();
  }

  function uniqueDevelopers(tickets) {
    var map = new Map();
    tickets.forEach(function (t) {
      if (t.assignee_account_id) map.set(t.assignee_account_id, t.assignee_display_name);
    });
    return Array.from(map.entries()).sort(function (a, b) {
      return a[1].localeCompare(b[1]);
    });
  }

  function optionsHtml(values, current, allLabel) {
    var options =
      '<option value="">' +
      escapeHtml(allLabel) +
      '</option>' +
      values
        .map(function (v) {
          return '<option value="' + escapeHtml(v) + '"' + (v === current ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
        })
        .join('');
    return options;
  }

  function renderAllTickets() {
    var el = document.getElementById('all-tickets');
    var visible = getVisibleTickets();
    var statuses = uniqueValues(visible, 'status');
    var issueTypes = uniqueValues(visible, 'issue_type');
    var developers = uniqueDevelopers(visible);
    var tickets = getFilteredSortedTickets();

    var developerOptions =
      '<option value="">All developers</option>' +
      developers
        .map(function (pair) {
          return '<option value="' + escapeHtml(pair[0]) + '"' + (pair[0] === state.ticketFilters.developer ? ' selected' : '') + '>' + escapeHtml(pair[1]) + '</option>';
        })
        .join('');

    var filtersHtml =
      '<div class="ticket-filters">' +
      '<label class="filter-label">Status<select id="filter-status">' +
      optionsHtml(statuses, state.ticketFilters.status, 'All statuses') +
      '</select></label>' +
      '<label class="filter-label">Issue type<select id="filter-issue-type">' +
      optionsHtml(issueTypes, state.ticketFilters.issueType, 'All issue types') +
      '</select></label>' +
      '<label class="filter-label">Developer<select id="filter-developer">' +
      developerOptions +
      '</select></label>' +
      '</div>';

    function sortHeader(col, label) {
      var arrow = state.sortState.column === col ? (state.sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
      return '<th class="sortable" data-sort-col="' + col + '">' + escapeHtml(label) + arrow + '</th>';
    }

    var head =
      '<tr><th>Jira</th><th>Issue Type</th><th>Summary</th><th>Assignee</th><th>Status</th>' +
      sortHeader('sp', 'SP') +
      sortHeader('ap', 'AP') +
      sortHeader('ai_contribution_percent', 'AI Contribution') +
      '<th>PR(s)</th></tr>';

    var body = tickets
      .map(function (t) {
        return (
          '<tr><td><a href="' +
          escapeHtml(t.jira_url) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(t.key) +
          '</a></td><td>' +
          escapeHtml(t.issue_type) +
          '</td><td>' +
          escapeHtml(t.summary) +
          '</td><td>' +
          escapeHtml(t.assignee_display_name || 'Unassigned') +
          '</td><td>' +
          escapeHtml(t.status) +
          '</td><td>' +
          (t.sp == null ? '—' : t.sp) +
          '</td><td>' +
          (t.ap == null ? '—' : t.ap) +
          '</td><td>' +
          (t.ai_contribution_percent == null ? '—' : fmtPercent(t.ai_contribution_percent)) +
          '</td><td>' +
          prLinksHtml(t) +
          '</td></tr>'
        );
      })
      .join('');

    el.innerHTML =
      filtersHtml +
      '<table class="data-table" id="all-tickets-table"><thead>' +
      head +
      '</thead><tbody>' +
      (body || '<tr><td colspan="9" class="empty-state">No tickets match the current filters.</td></tr>') +
      '</tbody></table>';

    el.querySelector('#filter-status').addEventListener('change', function (e) {
      state.ticketFilters.status = e.target.value;
      renderAllTickets();
    });
    el.querySelector('#filter-issue-type').addEventListener('change', function (e) {
      state.ticketFilters.issueType = e.target.value;
      renderAllTickets();
    });
    el.querySelector('#filter-developer').addEventListener('change', function (e) {
      state.ticketFilters.developer = e.target.value;
      state.selectedDeveloper = e.target.value || null;
      renderAllTickets();
      renderDeveloperDetails();
    });
    Array.prototype.forEach.call(el.querySelectorAll('th.sortable'), function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort-col');
        if (state.sortState.column === col) {
          state.sortState.direction = state.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortState.column = col;
          state.sortState.direction = 'desc';
        }
        renderAllTickets();
      });
    });
  }

  function renderAll() {
    renderReleaseSummary();
    renderDeveloperDelivery();
    renderDeveloperDetails();
    renderAllTickets();
  }

  renderReleasePicker();
  renderAll();
})();
