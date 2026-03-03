// ============== Spreadsheet Cross-check Page ==============

let crosscheckData = null;

// ============== Init ==============
window.addEventListener('DOMContentLoaded', async () => {
  await loadWebsiteResults();
});

// ============== Spreadsheet URL Input ==============
function getSpreadsheetId() {
  const input = document.getElementById('spreadsheet-url');
  const val = (input ? input.value : '').trim();
  if (!val) return undefined; // use server default

  // Extract ID from full Google Sheets URL
  const urlMatch = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // If it looks like a raw ID (no slashes), return as-is
  if (/^[a-zA-Z0-9_-]+$/.test(val)) return val;

  return val;
}

function clearSpreadsheetInput() {
  const input = document.getElementById('spreadsheet-url');
  if (input) input.value = '';
}

// ============== Load Website Results ==============
async function loadWebsiteResults() {
  const statusEl = document.getElementById('source-website-status');

  try {
    const res = await fetch('/api/report');
    if (!res.ok) {
      statusEl.innerHTML = '<span class="status-dot status-warn"></span> No results yet — <a href="/">run a video check first</a>';
      document.getElementById('btn-run-crosscheck').disabled = true;
      return;
    }

    const report = await res.json();
    const results = report.allResults || [];

    if (results.length === 0) {
      statusEl.innerHTML = '<span class="status-dot status-warn"></span> No results yet — <a href="/">run a video check first</a>';
      document.getElementById('btn-run-crosscheck').disabled = true;
      return;
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const timeout = results.filter(r => r.status === 'TIMEOUT').length;

    let timeLabel = '';
    if (report.timestamp) {
      const d = new Date(report.timestamp);
      timeLabel = ` (${d.toLocaleDateString()} ${d.toLocaleTimeString()})`;
    }

    statusEl.innerHTML = `<span class="status-dot status-ok"></span>
      <strong>${results.length}</strong> videos — ${passed} passed, ${failed} failed, ${timeout} timeout${timeLabel}`;

  } catch {
    statusEl.innerHTML = '<span class="status-dot status-warn"></span> Could not load results — <a href="/">run a video check first</a>';
    document.getElementById('btn-run-crosscheck').disabled = true;
  }
}

// ============== Run Cross-check ==============
async function runCrosscheck() {
  const btn = document.getElementById('btn-run-crosscheck');
  const loading = document.getElementById('loading-bar');
  const errorEl = document.getElementById('error-message');
  const ssStatus = document.getElementById('source-ss-status');

  btn.disabled = true;
  loading.style.display = 'flex';
  errorEl.style.display = 'none';
  ssStatus.innerHTML = '<span class="status-dot status-loading"></span> Fetching...';

  try {
    const body = {};
    const ssId = getSpreadsheetId();
    if (ssId) body.spreadsheetId = ssId;

    const res = await fetch('/api/crosscheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Cross-check failed');
    }

    crosscheckData = await res.json();
    const s = crosscheckData.summary;

    ssStatus.innerHTML = `<span class="status-dot status-ok"></span> <strong>${s.totalSpreadsheet}</strong> entries loaded`;

    renderResults(crosscheckData);
    document.getElementById('step-results').style.display = 'block';
    document.getElementById('step-results').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    ssStatus.innerHTML = '<span class="status-dot status-error"></span> Failed to fetch';
    errorEl.innerHTML = `<strong>Error:</strong> ${escHtml(err.message)}`;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    loading.style.display = 'none';
  }
}

// ============== Render Results ==============
function renderResults(data) {
  const s = data.summary;

  // Summary cards
  document.getElementById('xc-summary').innerHTML = `
    <div class="summary-grid">
      <div class="sum-card sum-matched">
        <div class="sum-value">${s.matched}</div>
        <div class="sum-label">Matched</div>
      </div>
      <div class="sum-card sum-changes">
        <div class="sum-value">${s.changesNeeded}</div>
        <div class="sum-label">Changes Needed</div>
      </div>
      <div class="sum-card sum-to-prod">
        <div class="sum-value">${s.toProduction}</div>
        <div class="sum-label">Set to Production</div>
      </div>
      <div class="sum-card sum-to-ready">
        <div class="sum-value">${s.toReady}</div>
        <div class="sum-label">Revert to Ready</div>
      </div>
    </div>
    <div class="sum-totals">
      <span>Website: <strong>${s.totalWebsite}</strong> videos</span>
      <span class="sum-sep"></span>
      <span>Spreadsheet: <strong>${s.totalSpreadsheet}</strong> entries</span>
      <span class="sum-sep"></span>
      <span>Unmatched: <strong>${s.unmatchedWebsite + s.unmatchedSpreadsheet}</strong></span>
    </div>`;

  // Update badges
  document.getElementById('badge-changes').textContent = s.changesNeeded;
  document.getElementById('badge-matched').textContent = s.matched;
  document.getElementById('badge-unmatched-web').textContent = s.unmatchedWebsite;
  document.getElementById('badge-unmatched-ss').textContent = s.unmatchedSpreadsheet;

  // Render tab panels
  renderChangesPanel(data.changes);
  renderMatchedPanel(data.matched);
  renderUnmatchedWebPanel(data.unmatchedWebsite);
  renderUnmatchedSSPanel(data.unmatchedSpreadsheet);

  // Show apply button if there are changes
  if (data.changes.length > 0) {
    document.getElementById('apply-section').style.display = 'block';
    document.getElementById('apply-btn-text').textContent = `Apply ${data.changes.length} Changes to Spreadsheet`;
  }
}

function renderChangesPanel(changes) {
  const panel = document.getElementById('panel-changes');

  if (changes.length === 0) {
    panel.innerHTML = `<div class="empty-panel">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
      <span>Everything is in sync! No changes needed.</span>
    </div>`;
    return;
  }

  let html = '<div class="changes-table-wrapper"><table class="xc-table"><thead><tr>';
  html += '<th>#</th><th>Title</th><th>Category</th><th>Current Status</th><th></th><th>New Status</th>';
  html += '</tr></thead><tbody>';

  changes.forEach((c, i) => {
    const isRevert = c.action === 'revert_to_ready';
    const rowClass = isRevert ? 'row-revert' : 'row-promote';
    const arrowClass = isRevert ? 'arrow-down' : 'arrow-up';

    html += `<tr class="${rowClass}">
      <td class="col-num">${i + 1}</td>
      <td class="col-title">${escHtml(c.title)}</td>
      <td class="col-cat">${truncate(c.category)}</td>
      <td><span class="status-pill ${statusClass(c.currentStatus)}">${truncate(c.currentStatus, 30)}</span></td>
      <td class="col-arrow ${arrowClass}">&rarr;</td>
      <td><span class="status-pill ${statusClass(c.newStatus)}">${escHtml(c.newStatus)}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

function renderMatchedPanel(matched) {
  const panel = document.getElementById('panel-matched');

  if (matched.length === 0) {
    panel.innerHTML = '<div class="empty-panel">No matched videos.</div>';
    return;
  }

  let html = '<div class="changes-table-wrapper"><table class="xc-table"><thead><tr>';
  html += '<th>#</th><th>Title</th><th>Category / Section</th><th>Spreadsheet Status</th><th>Website Status</th>';
  html += '</tr></thead><tbody>';

  matched.forEach((m, i) => {
    html += `<tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-title">${escHtml(m.title)}</td>
      <td class="col-cat">${truncate(m.category || m.section || '')}</td>
      <td><span class="status-pill ${statusClass(m.spreadsheetStatus)}">${escHtml(m.spreadsheetStatus)}</span></td>
      <td><span class="status-pill ${webStatusClass(m.websiteStatus)}">${escHtml(m.websiteStatus)}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

function renderUnmatchedWebPanel(items) {
  const panel = document.getElementById('panel-unmatched-web');

  if (items.length === 0) {
    panel.innerHTML = '<div class="empty-panel">All website videos were found in the spreadsheet.</div>';
    return;
  }

  let html = '<p class="panel-note">These videos are on the website but have no matching entry in the spreadsheet.</p>';
  html += '<div class="changes-table-wrapper"><table class="xc-table"><thead><tr>';
  html += '<th>#</th><th>Title</th><th>Section</th><th>Website Status</th>';
  html += '</tr></thead><tbody>';

  items.forEach((v, i) => {
    html += `<tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-title">${escHtml(v.title)}</td>
      <td class="col-cat">${escHtml(v.section || '')}</td>
      <td><span class="status-pill ${webStatusClass(v.status)}">${escHtml(v.status || '')}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

function renderUnmatchedSSPanel(items) {
  const panel = document.getElementById('panel-unmatched-ss');

  if (items.length === 0) {
    panel.innerHTML = '<div class="empty-panel">All spreadsheet entries were found on the website.</div>';
    return;
  }

  let html = '<p class="panel-note">These spreadsheet entries have no matching video on the website.</p>';
  html += '<div class="changes-table-wrapper"><table class="xc-table"><thead><tr>';
  html += '<th>#</th><th>Title</th><th>Category</th><th>Spreadsheet Status</th>';
  html += '</tr></thead><tbody>';

  items.forEach((v, i) => {
    html += `<tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-title">${escHtml(v.title)}</td>
      <td class="col-cat">${truncate(v.category || '')}</td>
      <td><span class="status-pill ${statusClass(v.status)}">${truncate(v.status || '', 30)}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
}

// ============== Tab Switching ==============
function switchTab(tabName) {
  // Update active tab
  document.querySelectorAll('.xc-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.xc-tab[data-tab="${tabName}"]`).classList.add('active');

  // Show/hide panels
  document.querySelectorAll('.xc-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`panel-${tabName}`).style.display = 'block';
}

// ============== Apply Changes ==============
async function applyChanges() {
  if (!crosscheckData || !crosscheckData.changes.length) return;

  const btn = document.getElementById('btn-apply');
  const btnText = document.getElementById('apply-btn-text');
  const originalText = btnText.textContent;

  btn.disabled = true;
  btnText.textContent = 'Applying...';

  try {
    const res = await fetch('/api/crosscheck/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: crosscheckData.changes.map(c => ({
          rowIndex: c.rowIndex,
          newStatus: c.newStatus,
        })),
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to apply changes');
    }

    const result = await res.json();
    const count = result.updated || crosscheckData.changes.length;

    btn.classList.add('btn-applied');
    btnText.textContent = `${count} Changes Applied Successfully!`;

  } catch (err) {
    btn.disabled = false;
    btnText.textContent = originalText;
    alert('Failed to apply changes: ' + err.message + '\n\nMake sure you have deployed the Google Apps Script and set GSHEET_WEBAPP_URL in your .env file. See setup instructions at the bottom of this page.');
  }
}

// ============== Helpers ==============
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function truncate(str, max = 80) {
  if (!str || str.length <= max) return escHtml(str);
  return `<span title="${escHtml(str)}">${escHtml(str.slice(0, max))}...</span>`;
}

function statusClass(status) {
  const s = (status || '').toLowerCase().replace(/\s+/g, '-');
  if (s === 'in-production') return 'pill-production';
  if (s === 'ready-to-live') return 'pill-ready';
  if (s === 'incomplete') return 'pill-incomplete';
  return 'pill-default';
}

function webStatusClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'PASS') return 'pill-pass';
  if (s === 'FAIL') return 'pill-fail';
  if (s === 'TIMEOUT') return 'pill-timeout';
  return 'pill-default';
}
