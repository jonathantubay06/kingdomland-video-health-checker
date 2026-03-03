// ============== State ==============
const state = {
  status: 'idle',
  mode: 'both',
  phase: '',
  totalDiscovered: 0,
  checkedCount: 0,
  passedCount: 0,
  failedCount: 0,
  timeoutCount: 0,
  results: [],
  checkStartTime: null,
  sectionMap: {},
};

let eventSource = null;
let sortColumn = 'number';
let sortDir = 'asc';
let isLocal = false;
let savedCredentials = null; // session-only credential cache
let currentPage = 1;
let pageSize = 25;
let lastFilteredResults = []; // cached for pagination
let ghRunId = null;
let pollTimer = null;
let progressTimer = null;

// ============== Init ==============
window.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });
  });

  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data && typeof data.status === 'string') {
      isLocal = true;
      if (data.status === 'running') {
        state.status = 'running';
        updateRunButtons();
        showProgress();
        connectSSE();
      } else if (data.hasPreviousReport) {
        loadPreviousReport();
      }
      return;
    }
  } catch {}

  isLocal = false;
  try {
    const statusRes = await fetch('/api/check-status');
    if (statusRes.ok) {
      const ghStatus = await statusRes.json();
      if (ghStatus.status === 'in_progress' || ghStatus.status === 'queued') {
        ghRunId = ghStatus.runId;
        state.status = 'running';
        updateRunButtons();
        showCloudProgress('Video check is running on GitHub Actions...', ghStatus.startedAt);
        startPolling();
      } else {
        await loadCloudReport();
      }
    }
  } catch {
    await loadCloudReport();
  }
});

// ============== Run Control ==============
function startRun() {
  // Always show credentials modal so user can pick "Check All" or "Check Failed Only"
  openCredentialsModal();
}

function openCredentialsModal() {
  const modal = document.getElementById('credentials-modal');
  modal.style.display = 'flex';

  // Pre-fill if we have saved credentials
  if (savedCredentials) {
    document.getElementById('cred-email').value = savedCredentials.email;
    document.getElementById('cred-password').value = savedCredentials.password;
  }

  // Show/hide the "Check Failed Only" button based on whether there are failures
  const failedCount = state.results.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT').length;
  const recheckBtn = document.getElementById('cred-recheck-btn');
  const recheckCount = document.getElementById('cred-recheck-count');
  if (failedCount > 0) {
    recheckBtn.style.display = 'inline-flex';
    recheckCount.textContent = failedCount;
  } else {
    recheckBtn.style.display = 'none';
  }

  // Focus the email field (or password if email is pre-filled)
  setTimeout(() => {
    const emailInput = document.getElementById('cred-email');
    if (emailInput.value) document.getElementById('cred-password').focus();
    else emailInput.focus();
  }, 100);
}

function closeCredentialsModal() {
  document.getElementById('credentials-modal').style.display = 'none';
}

function togglePasswordVisibility() {
  const input = document.getElementById('cred-password');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    input.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
}

function submitCredentials(e, failedOnly) {
  e.preventDefault();
  const email = document.getElementById('cred-email').value.trim();
  const password = document.getElementById('cred-password').value;
  const remember = document.getElementById('cred-remember').checked;

  if (!email || !password) {
    // If called from the "Check Failed Only" button, manually validate
    if (!email) document.getElementById('cred-email').reportValidity();
    else if (!password) document.getElementById('cred-password').reportValidity();
    return;
  }

  if (remember) {
    savedCredentials = { email, password };
  }

  closeCredentialsModal();

  if (failedOnly) {
    // Run re-check for failed videos only
    recheckFailedWithCreds(email, password);
  } else if (isLocal) {
    startRunLocal(email, password);
  } else {
    startRunCloud(email, password);
  }
}

async function startRunLocal(email, password) {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: state.mode, email, password }),
    });
    if (res.status === 409) {
      alert('A check is already running!');
      return;
    }
    resetState();
    updateRunButtons();
    updateSummaryCards();
    showProgress();
    hideEmpty();
    connectSSE();
  } catch (e) {
    alert('Failed to start: ' + e.message);
  }
}

async function startRunCloud(email, password) {
  try {
    const res = await fetch('/api/trigger-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: state.mode, email, password }),
    });
    const data = await res.json();
    if (data.error) {
      alert('Failed to trigger: ' + data.error);
      return;
    }
    ghRunId = data.runId;
    resetState();
    updateRunButtons();
    hideEmpty();
    showCloudProgress('Video check triggered! Starting on GitHub Actions...');
    startPolling();
  } catch (e) {
    alert('Failed to trigger check: ' + e.message);
  }
}

function resetState() {
  state.status = 'running';
  state.phase = 'login';
  state.results = [];
  state.checkedCount = 0;
  state.passedCount = 0;
  state.failedCount = 0;
  state.timeoutCount = 0;
  state.totalDiscovered = 0;
  state.checkStartTime = null;
  state.sectionMap = {};
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('results-tbody').innerHTML = '';
  document.getElementById('section-grid').innerHTML = '';
  document.getElementById('filter-section').innerHTML = '<option value="all">All Sections</option>';
  // Hide re-check button and new feature sections during a run
  document.getElementById('recheck-failed-btn').style.display = 'none';
  document.getElementById('health-summary').style.display = 'none';
  document.getElementById('last-checked').style.display = 'none';
  document.getElementById('health-badge').style.display = 'none';
  document.getElementById('trend-chart-container').style.display = 'none';
  document.getElementById('diff-report').style.display = 'none';
}

async function stopRun() {
  if (isLocal) {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (e) {
      console.error('Stop failed:', e);
    }
  } else if (ghRunId) {
    if (!confirm('Cancel the running video check?')) return;
    try {
      const res = await fetch('/api/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: ghRunId }),
      });
      const data = await res.json();
      if (data.status === 'cancelled') {
        state.status = 'idle';
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        updateRunButtons();
        document.getElementById('progress-section').classList.remove('visible');
        closeProgressModal();
        appendLog('Check cancelled.');
      } else {
        alert('Failed to cancel: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Failed to cancel: ' + e.message);
    }
  }
}

// ============== Cloud Mode ==============
function showCloudProgress(message, startedAt) {
  const section = document.getElementById('progress-section');
  section.classList.add('visible');
  document.getElementById('phase-login').classList.add('active');
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('progress-bar').style.animation = 'pulse 2s ease-in-out infinite';
  document.getElementById('progress-percent').textContent = '';
  document.getElementById('progress-text').textContent = message;
  document.getElementById('current-video').textContent = startedAt
    ? `Started at ${new Date(startedAt).toLocaleTimeString()}`
    : 'Waiting for GitHub Actions to pick up the job...';
  document.getElementById('view-progress-btn').style.display = 'inline-flex';
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollCloudStatus, 15000);
}

async function pollCloudStatus() {
  try {
    const url = ghRunId ? `/api/check-status?runId=${ghRunId}` : '/api/check-status';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'in_progress') {
      showCloudProgress('Video check is running on GitHub Actions...', data.startedAt);
      ['login', 'discovery', 'checking'].forEach(p => {
        document.getElementById('phase-' + p).classList.remove('active', 'done');
      });
      document.getElementById('phase-login').classList.add('done');
      document.getElementById('phase-discovery').classList.add('active');
    } else if (data.status === 'completed') {
      clearInterval(pollTimer);
      pollTimer = null;
      if (data.conclusion === 'success') {
        document.getElementById('progress-text').textContent = 'Check complete! Loading report...';
        await loadCloudReport();
      } else {
        state.status = 'idle';
        updateRunButtons();
        document.getElementById('progress-section').classList.remove('visible');
        alert(`Check finished with status: ${data.conclusion}. Check GitHub Actions for details.`);
      }
    }
  } catch (e) {
    console.error('Polling error:', e);
  }
}

async function loadCloudReport() {
  try {
    const res = await fetch('/api/get-report?file=video-report.json');
    if (!res.ok) return;
    const report = await res.json();
    state.results = report.allResults || [];
    if (report.summary) {
      state.passedCount = report.summary.passed || 0;
      state.failedCount = report.summary.failed || 0;
      state.timeoutCount = report.summary.timeouts || 0;
    } else {
      state.passedCount = state.results.filter(r => r.status === 'PASS').length;
      state.failedCount = state.results.filter(r => r.status === 'FAIL').length;
      state.timeoutCount = state.results.filter(r => r.status === 'TIMEOUT').length;
    }
    state.totalDiscovered = state.results.length;
    state.checkedCount = state.results.length;
    state.status = 'complete';

    // Store the timestamp from the report
    state.reportTimestamp = report.timestamp || null;

    state.sectionMap = {};
    for (const r of state.results) {
      const secKey = `${r.page} - ${r.section || 'Unknown'}`;
      if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      state.sectionMap[secKey].total++;
      if (r.status === 'PASS') state.sectionMap[secKey].passed++;
      else if (r.status === 'FAIL') state.sectionMap[secKey].failed++;
      else state.sectionMap[secKey].timeout++;
    }

    renderCompleteFromState();
  } catch (e) {
    console.error('Failed to load cloud report:', e);
  }
}

// ============== Progress Modal ==============
function openProgressModal() {
  if (!ghRunId) return;
  document.getElementById('progress-modal').classList.add('open');
  fetchProgress();
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(fetchProgress, 10000);
}

function closeProgressModal() {
  document.getElementById('progress-modal').classList.remove('open');
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

async function fetchProgress() {
  if (!ghRunId) return;
  try {
    const res = await fetch(`/api/get-progress?runId=${ghRunId}`);
    if (!res.ok) return;
    const data = await res.json();
    const stepsEl = document.getElementById('modal-steps');
    if (data.steps && data.steps.length > 0) {
      stepsEl.innerHTML = data.steps.map(s => {
        let icon = '\u23F3';
        if (s.status === 'completed' && s.conclusion === 'success') icon = '\u2705';
        else if (s.status === 'completed' && s.conclusion === 'failure') icon = '\u274C';
        else if (s.status === 'completed' && s.conclusion === 'skipped') icon = '\u23ED\uFE0F';
        else if (s.status === 'in_progress') icon = '\uD83D\uDD04';
        const activeClass = s.status === 'in_progress' ? ' active' : '';
        return `<div class="modal-step"><span class="step-icon">${icon}</span><span class="step-name${activeClass}">${escHtml(s.name)}</span></div>`;
      }).join('');
    }
    const logEl = document.getElementById('modal-log');
    if (data.log) {
      logEl.textContent = data.log;
      logEl.scrollTop = logEl.scrollHeight;
    } else if (data.status === 'waiting') {
      logEl.textContent = 'Waiting for GitHub Actions to start...';
    }
    if (data.status === 'completed') {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    }
  } catch (e) {
    console.error('Progress fetch error:', e);
  }
}

// ============== SSE ==============
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');
  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch {}
  };
  eventSource.onerror = () => {
    if (state.status === 'running') {
      setTimeout(() => { if (state.status === 'running') connectSSE(); }, 3000);
    }
  };
}

function handleEvent(event) {
  switch (event.type) {
    case 'connected':
      if (event.runStatus === 'running') {
        state.status = 'running';
        updateRunButtons();
        showProgress();
      }
      break;
    case 'status':
      appendLog(event.message);
      if (event.message.includes('Logging in')) setPhase('login');
      else if (event.message.includes('Discovering') || event.message.includes('Scanning carousel') || event.message.includes('Scanning tab') || event.message.includes('Scanning default')) setPhase('discovery');
      break;
    case 'discovery':
      setPhase('discovery');
      updateProgressText(`Discovering: ${event.section} (${event.count} in section, ${event.total} total)`);
      break;
    case 'discovery-complete':
      state.totalDiscovered += event.total;
      updateStat('stat-total', state.totalDiscovered);
      updateProgressText(`Discovery complete for ${event.page}: ${event.total} videos found`);
      break;
    case 'check':
      setPhase('checking');
      if (!state.checkStartTime) state.checkStartTime = Date.now();
      state.checkedCount++;
      const r = event.result;
      state.results.push(r);
      if (r.status === 'PASS') state.passedCount++;
      else if (r.status === 'FAIL') state.failedCount++;
      else if (r.status === 'TIMEOUT') state.timeoutCount++;
      const secKey = `${r.page} - ${r.section || 'Unknown'}`;
      if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      state.sectionMap[secKey].total++;
      if (r.status === 'PASS') state.sectionMap[secKey].passed++;
      else if (r.status === 'FAIL') state.sectionMap[secKey].failed++;
      else state.sectionMap[secKey].timeout++;
      updateSummaryCards();
      updateCheckProgress(r);
      appendResultRow(r);
      updateSectionBreakdown();
      break;
    case 'complete':
      state.status = 'complete';
      state.results = event.allResults;
      state.passedCount = event.summary.passed;
      state.failedCount = event.summary.failed;
      state.timeoutCount = event.summary.timeouts;
      if (eventSource) eventSource.close();
      renderComplete(event.summary, event.allResults);
      break;
    case 'stopped':
      state.status = 'idle';
      if (eventSource) eventSource.close();
      updateRunButtons();
      hideProgress();
      appendLog('Check cancelled by user.');
      break;
    case 'process-exit':
      if (state.status !== 'complete') {
        state.status = 'complete';
        renderCompleteFromState();
      }
      if (eventSource) eventSource.close();
      break;
    case 'error':
      appendLog('[ERROR] ' + event.message, true);
      break;
  }
}

// ============== Previous Report ==============
async function loadPreviousReport() {
  try {
    const res = await fetch('/api/report');
    if (!res.ok) return;
    const report = await res.json();
    state.results = report.allResults || [];
    if (report.summary) {
      state.passedCount = report.summary.passed || 0;
      state.failedCount = report.summary.failed || 0;
      state.timeoutCount = report.summary.timeouts || 0;
    } else {
      state.passedCount = state.results.filter(r => r.status === 'PASS').length;
      state.failedCount = state.results.filter(r => r.status === 'FAIL').length;
      state.timeoutCount = state.results.filter(r => r.status === 'TIMEOUT').length;
    }
    state.totalDiscovered = state.results.length;
    state.checkedCount = state.results.length;
    state.status = 'complete';

    // Store the timestamp from the report
    state.reportTimestamp = report.timestamp || null;

    state.sectionMap = {};
    for (const r of state.results) {
      const secKey = `${r.page} - ${r.section || 'Unknown'}`;
      if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      state.sectionMap[secKey].total++;
      if (r.status === 'PASS') state.sectionMap[secKey].passed++;
      else if (r.status === 'FAIL') state.sectionMap[secKey].failed++;
      else state.sectionMap[secKey].timeout++;
    }
    renderCompleteFromState();
  } catch (e) {
    console.error('Failed to load report:', e);
  }
}

// ============== UI Updates ==============
function updateRunButtons() {
  const runBtn = document.getElementById('run-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (state.status === 'running') {
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner"></span> Running...';
    stopBtn.style.display = 'inline-flex';
  } else {
    runBtn.disabled = false;
    runBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run Check';
    stopBtn.style.display = 'none';
  }
}

function updateStat(id, value) {
  document.getElementById(id).textContent = value;
}

function updateSummaryCards() {
  updateStat('stat-total', state.totalDiscovered || state.checkedCount || '--');
  updateStat('stat-passed', state.passedCount || 0);
  updateStat('stat-failed', state.failedCount || 0);
  updateStat('stat-timeout', state.timeoutCount || 0);
}

function showProgress() {
  document.getElementById('progress-section').classList.add('visible');
  document.getElementById('empty-state').style.display = 'none';
}
function hideProgress() {
  document.getElementById('progress-section').classList.remove('visible');
}
function hideEmpty() {
  document.getElementById('empty-state').style.display = 'none';
}

function setPhase(phase) {
  state.phase = phase;
  ['login', 'discovery', 'checking'].forEach(p => {
    const el = document.getElementById('phase-' + p);
    el.classList.remove('active', 'done');
  });
  if (phase === 'login') {
    document.getElementById('phase-login').classList.add('active');
  } else if (phase === 'discovery') {
    document.getElementById('phase-login').classList.add('done');
    document.getElementById('phase-discovery').classList.add('active');
  } else if (phase === 'checking') {
    document.getElementById('phase-login').classList.add('done');
    document.getElementById('phase-discovery').classList.add('done');
    document.getElementById('phase-checking').classList.add('active');
  }
}

function updateProgressText(text) {
  document.getElementById('progress-text').textContent = text;
}

function updateCheckProgress(result) {
  const total = state.totalDiscovered || state.checkedCount;
  const pct = total > 0 ? Math.round((state.checkedCount / total) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-percent').textContent = pct + '%';
  const elapsed = Date.now() - state.checkStartTime;
  const avgTime = elapsed / state.checkedCount;
  const remaining = (total - state.checkedCount) * avgTime;
  const etaMin = Math.floor(remaining / 60000);
  const etaSec = Math.floor((remaining % 60000) / 1000);
  const etaStr = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`;
  document.getElementById('progress-text').textContent =
    `${state.checkedCount}/${total} videos checked` +
    (state.checkedCount < total ? ` \u2022 ETA: ${etaStr}` : '');
  const icon = result.status === 'PASS' ? '\u2705' : result.status === 'FAIL' ? '\u274C' : '\u23F1\uFE0F';
  document.getElementById('current-video').textContent =
    `${icon} [${result.section || ''}] ${result.title}`;
  document.getElementById('results-section').classList.add('visible');
  document.getElementById('section-breakdown').classList.add('visible');
}

// ============== Activity Log ==============
function toggleLog() {
  const body = document.getElementById('log-body');
  const toggle = document.getElementById('log-toggle');
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

function appendLog(message, isError = false) {
  const entries = document.getElementById('log-entries');
  const div = document.createElement('div');
  div.className = 'log-entry' + (isError ? ' error' : '');
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${message}`;
  entries.appendChild(div);
  const body = document.getElementById('log-body');
  body.scrollTop = body.scrollHeight;
  while (entries.children.length > 200) {
    entries.removeChild(entries.firstChild);
  }
}

// ============== Section Breakdown ==============
function updateSectionBreakdown() {
  const grid = document.getElementById('section-grid');
  grid.innerHTML = '';
  for (const [key, s] of Object.entries(state.sectionMap)) {
    const rate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'section-card';
    card.innerHTML = `
      <div class="section-card-header">
        <span class="section-name">${escHtml(s.section)}</span>
        <span class="section-page-badge badge-${s.page === 'STORY' ? 'story' : 'music'}">${s.page}</span>
      </div>
      <div class="section-bar-wrapper">
        <div class="section-bar-fill" style="width:${rate}%"></div>
      </div>
      <div class="section-stats">
        <span><span class="pass-count">${s.passed}</span> passed</span>
        <span><span class="fail-count">${s.failed + s.timeout}</span> failed</span>
        <span>${rate}%</span>
      </div>
    `;
    grid.appendChild(card);
  }
}

// ============== Results Table ==============
function appendResultRow(r) {
  const tbody = document.getElementById('results-tbody');
  if (!matchesFilters(r)) return;
  const tr = createResultRow(r);
  tbody.appendChild(tr);
  updateSectionFilterOptions();
  updateResultCount();
}

function createResultRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.num = r.number;
  tr.onclick = () => toggleDetail(r.number);
  const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
  const errorText = r.error ? (r.error.length > 40 ? r.error.substring(0, 40) + '...' : r.error) : '-';

  // Response time color class
  let loadTimeClass = '';
  if (r.loadTimeMs) {
    if (r.loadTimeMs < 3000) loadTimeClass = 'load-fast';
    else if (r.loadTimeMs < 8000) loadTimeClass = 'load-medium';
    else loadTimeClass = 'load-slow';
  }

  tr.innerHTML = `
    <td>${r.number}</td>
    <td><strong>${escHtml(r.title)}</strong></td>
    <td>${escHtml(r.section || '')}</td>
    <td>${r.page || ''}</td>
    <td><span class="status-badge status-${r.status}">${r.status}</span></td>
    <td>${r.duration || '-'}</td>
    <td><span class="${loadTimeClass}">${loadTime}</span></td>
    <td style="color:var(--color-text-muted);font-size:0.82rem">${escHtml(errorText)}</td>
  `;
  return tr;
}

function toggleDetail(num) {
  const existing = document.getElementById('detail-' + num);
  if (existing) { existing.remove(); return; }
  const r = state.results.find(r => r.number === num);
  if (!r) return;

  const screenshotHtml = r.screenshot
    ? `<div style="margin-top:8px"><strong>Screenshot:</strong><br><img src="${escHtml(r.screenshot)}" class="screenshot-thumb" alt="Failure screenshot" onclick="window.open(this.src,'_blank')"></div>`
    : '';

  const detailRow = document.createElement('tr');
  detailRow.id = 'detail-' + num;
  detailRow.className = 'detail-row';
  detailRow.innerHTML = `
    <td colspan="8">
      <div class="detail-content">
        <div><strong>URL:</strong> <a href="${escHtml(r.url || '')}" target="_blank">${escHtml(r.url || 'N/A')}</a></div>
        <div><strong>HLS Source:</strong> ${escHtml(r.hlsSrc || 'N/A')}</div>
        <div><strong>Resolution:</strong> ${r.resolution || 'N/A'}</div>
        ${r.error ? `<div><strong>Error:</strong> ${escHtml(r.error)}</div>` : ''}
        ${r.duration ? `<div><strong>Duration:</strong> ${r.duration}</div>` : ''}
        <div><strong>Load Time:</strong> ${r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : 'N/A'}</div>
        ${screenshotHtml}
      </div>
    </td>
  `;
  const rows = document.getElementById('results-tbody').querySelectorAll('tr');
  for (const row of rows) {
    if (row.dataset.num == num) {
      row.after(detailRow);
      break;
    }
  }
}

// ============== Filtering & Sorting ==============
function matchesFilters(r) {
  const statusFilter = document.getElementById('filter-status').value;
  const sectionFilter = document.getElementById('filter-section').value;
  const searchTerm = document.getElementById('filter-search').value.toLowerCase();
  if (statusFilter !== 'all' && r.status !== statusFilter) return false;
  if (sectionFilter !== 'all' && `${r.page} - ${r.section}` !== sectionFilter) return false;
  if (searchTerm && !r.title.toLowerCase().includes(searchTerm)) return false;
  return true;
}

function applyFilters() {
  currentPage = 1;
  renderResultsTable();
}

function sortBy(column) {
  if (sortColumn === column) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDir = 'asc';
  }
  updateSortArrows();
  renderResultsTable();
}

function updateSortArrows() {
  document.querySelectorAll('thead th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.col === sortColumn) {
      arrow.textContent = sortDir === 'asc' ? '\u25B2' : '\u25BC';
    } else {
      arrow.textContent = '';
    }
  });
}

function renderResultsTable() {
  let filtered = state.results.filter(r => matchesFilters(r));
  filtered.sort((a, b) => {
    let va = a[sortColumn];
    let vb = b[sortColumn];
    if (sortColumn === 'duration') {
      va = parseInt(va) || 0;
      vb = parseInt(vb) || 0;
    } else if (sortColumn === 'loadTimeMs') {
      va = va || 0;
      vb = vb || 0;
    } else if (typeof va === 'string') {
      va = va.toLowerCase();
      vb = (vb || '').toLowerCase();
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  lastFilteredResults = filtered;

  // Pagination
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize;
  const end = pageSize === 'all' ? filtered.length : start + pageSize;
  const pageResults = filtered.slice(start, end);

  const tbody = document.getElementById('results-tbody');
  tbody.innerHTML = '';
  for (const r of pageResults) {
    tbody.appendChild(createResultRow(r));
  }
  updateResultCount(filtered.length, start + 1, Math.min(end, filtered.length));
  renderPagination(totalPages);
}

function updateSectionFilterOptions() {
  const select = document.getElementById('filter-section');
  const currentVal = select.value;
  const sections = [...new Set(state.results.map(r => `${r.page} - ${r.section}`))];
  const existingOptions = new Set(Array.from(select.options).map(o => o.value));
  for (const sec of sections) {
    if (!existingOptions.has(sec)) {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      select.appendChild(opt);
    }
  }
  select.value = currentVal;
}

function updateResultCount(filteredTotal, rangeStart, rangeEnd) {
  const total = state.results.length;
  const el = document.getElementById('result-count');
  if (filteredTotal === undefined) {
    el.textContent = `${total} results`;
    return;
  }
  if (pageSize === 'all' || filteredTotal <= pageSize) {
    el.textContent = filteredTotal === total ? `${total} results` : `${filteredTotal} of ${total}`;
  } else {
    el.textContent = `${rangeStart}-${rangeEnd} of ${filteredTotal}${filteredTotal !== total ? ` (filtered from ${total})` : ''}`;
  }
}

function renderPagination(totalPages) {
  const paginationEl = document.getElementById('pagination');
  const prevBtn = document.getElementById('page-prev');
  const nextBtn = document.getElementById('page-next');
  const pagesContainer = document.getElementById('pagination-pages');

  // Hide pagination if only 1 page or showing all
  if (totalPages <= 1) {
    paginationEl.style.display = pageSize === 'all' ? 'none' : 'flex';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    pagesContainer.innerHTML = pageSize !== 'all'
      ? '<button class="active">1</button>'
      : '';
    return;
  }

  paginationEl.style.display = 'flex';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;

  // Build page buttons with ellipsis
  pagesContainer.innerHTML = '';
  const pages = buildPageNumbers(currentPage, totalPages);
  for (const p of pages) {
    if (p === '...') {
      const span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '...';
      pagesContainer.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.textContent = p;
      if (p === currentPage) btn.classList.add('active');
      btn.onclick = () => goToPage(p);
      pagesContainer.appendChild(btn);
    }
  }
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function changePage(delta) {
  currentPage += delta;
  renderResultsTable();
  // Scroll to top of results table
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goToPage(page) {
  currentPage = page;
  renderResultsTable();
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changePageSize() {
  const val = document.getElementById('page-size').value;
  pageSize = val === 'all' ? 'all' : parseInt(val);
  currentPage = 1;
  renderResultsTable();
}

// ============== Complete State ==============
function renderComplete(summary, allResults) {
  state.status = 'complete';
  state.results = allResults;
  state.totalDiscovered = summary.total;
  state.checkedCount = summary.total;
  state.passedCount = summary.passed;
  state.failedCount = summary.failed;
  state.timeoutCount = summary.timeouts;

  updateRunButtons();
  updateSummaryCards();
  hideProgress();

  ['login', 'discovery', 'checking'].forEach(p => {
    const el = document.getElementById('phase-' + p);
    el.classList.remove('active');
    el.classList.add('done');
  });

  state.sectionMap = {};
  for (const r of allResults) {
    const secKey = `${r.page} - ${r.section || 'Unknown'}`;
    if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
    state.sectionMap[secKey].total++;
    if (r.status === 'PASS') state.sectionMap[secKey].passed++;
    else if (r.status === 'FAIL') state.sectionMap[secKey].failed++;
    else state.sectionMap[secKey].timeout++;
  }

  updateSectionBreakdown();
  updateSectionFilterOptions();
  renderResultsTable();

  document.getElementById('results-section').classList.add('visible');
  document.getElementById('section-breakdown').classList.add('visible');
  document.getElementById('download-section').classList.add('visible');
  document.getElementById('empty-state').style.display = 'none';

  appendLog(`Check complete! ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.timeouts} timed out.`);

  // NEW: Update health summary, last checked, diff report, trend chart, badge, response times, webhook
  updateHealthSummary();
  updateLastChecked();
  updateHealthBadge();
  updateAvgResponseTime();
  loadAndShowDiffReport();
  loadAndShowTrendChart();
  notifyWebhook();
}

function renderCompleteFromState() {
  const summary = {
    total: state.results.length,
    passed: state.passedCount,
    failed: state.failedCount,
    timeouts: state.timeoutCount,
  };
  renderComplete(summary, state.results);
}

// ============== Downloads ==============
function downloadFile(format) {
  if (isLocal) {
    window.location.href = '/api/download/' + format;
  } else {
    const fileMap = { csv: 'video-report.csv', json: 'video-report.json', txt: 'failed-videos.txt' };
    const file = fileMap[format];
    if (file) window.location.href = '/api/get-report?file=' + file;
  }
}

// ============== Print Report ==============
function printReport() {
  const results = state.results;
  if (!results.length) { alert('No results to print.'); return; }
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const timeouts = results.filter(r => r.status === 'TIMEOUT').length;
  const rate = total > 0 ? (passed / total * 100).toFixed(1) : 0;
  const sections = {};
  for (const r of results) {
    const key = `${r.page} - ${r.section || 'Unknown'}`;
    if (!sections[key]) sections[key] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0 };
    sections[key].total++;
    if (r.status === 'PASS') sections[key].passed++;
    else sections[key].failed++;
  }
  const sectionRows = Object.values(sections).map(s =>
    `<tr><td>${escHtml(s.section)}</td><td>${s.page}</td><td>${s.total}</td><td>${s.passed}</td><td>${s.failed}</td><td>${s.total > 0 ? Math.round(s.passed / s.total * 100) : 0}%</td></tr>`
  ).join('');
  const resultRows = results.map(r =>
    `<tr class="${r.status === 'FAIL' ? 'print-fail' : r.status === 'TIMEOUT' ? 'print-timeout' : ''}"><td>${r.number}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.section || '')}</td><td>${r.page || ''}</td><td>${r.status}</td><td>${r.duration || '-'}</td><td>${r.error ? escHtml(r.error) : '-'}</td></tr>`
  ).join('');
  document.getElementById('print-report').innerHTML = `
    <div class="print-header"><h1>Kingdomland Video Checker Report</h1><p>go.kingdomlandkids.com</p><p>Generated: ${new Date().toLocaleString()}</p></div>
    <p class="print-section-title">Summary</p>
    <table class="print-table"><tr><td><strong>Total Videos</strong></td><td>${total}</td></tr><tr><td><strong>Passed</strong></td><td style="color:green">${passed}</td></tr><tr><td><strong>Failed</strong></td><td style="color:red">${failed}</td></tr><tr><td><strong>Timed Out</strong></td><td style="color:orange">${timeouts}</td></tr><tr><td><strong>Pass Rate</strong></td><td>${rate}%</td></tr></table>
    <p class="print-section-title">Section Breakdown</p>
    <table class="print-table"><thead><tr><th>Section</th><th>Page</th><th>Total</th><th>Passed</th><th>Failed</th><th>Rate</th></tr></thead><tbody>${sectionRows}</tbody></table>
    <p class="print-section-title">Detailed Results</p>
    <table class="print-table"><thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody>${resultRows}</tbody></table>
  `;
  document.getElementById('print-report').style.display = 'block';
  window.print();
  setTimeout(() => { document.getElementById('print-report').style.display = 'none'; }, 1000);
}

// ============== Helpers ==============
function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ====================================================================
// NEW FEATURES
// ====================================================================

// ============== 1. Health Summary Banner ==============
function updateHealthSummary() {
  const el = document.getElementById('health-summary');
  if (!el) return;

  const total = state.results.length;
  const passed = state.passedCount;
  const failed = state.failedCount;
  const timeouts = state.timeoutCount;
  const rate = total > 0 ? (passed / total) * 100 : 0;

  let message = '';
  let level = 'green';

  if (rate === 100) {
    message = `All ${total} videos are working perfectly!`;
    level = 'green';
  } else if (rate > 95) {
    level = 'yellow';
    const notWorking = failed + timeouts;
    if (notWorking === 1) {
      // Find the single failing video's section
      const failedResult = state.results.find(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
      const section = failedResult ? failedResult.section || 'Unknown' : 'Unknown';
      const failType = failedResult && failedResult.status === 'TIMEOUT' ? 'timed out' : 'failed to load';
      message = `${passed} of ${total} videos are working. 1 video in the ${section} section ${failType}.`;
    } else {
      const parts = [];
      if (failed > 0) parts.push(`${failed} failed`);
      if (timeouts > 0) parts.push(`${timeouts} timed out`);
      message = `${passed} of ${total} videos are working. ${notWorking} videos have issues: ${parts.join(', ')}.`;
    }
  } else {
    level = 'red';
    const notWorking = failed + timeouts;
    const parts = [];
    if (failed > 0) parts.push(`${failed} failed`);
    if (timeouts > 0) parts.push(`${timeouts} timed out`);
    message = `Warning: ${notWorking} videos are not working. ${parts.join(', ')}.`;
  }

  el.className = 'health-summary health-' + level;
  el.textContent = message;
  el.style.display = 'block';
}

// ============== 2. Last Checked Timestamp ==============
function timeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
}

function updateLastChecked() {
  const el = document.getElementById('last-checked');
  if (!el) return;

  let timestamp = state.reportTimestamp;
  if (!timestamp) {
    // Fall back to current time if no timestamp stored
    timestamp = new Date().toISOString();
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    el.textContent = '';
    return;
  }

  const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const absolute = date.toLocaleDateString(undefined, options);
  const relative = timeAgo(date);

  el.textContent = `Last checked: ${absolute} (${relative})`;
  el.style.display = 'block';
}

// ============== 3. Re-check Failed Only ==============
function recheckFailed() {
  // The standalone re-check button just opens the credentials modal
  openCredentialsModal();
}

async function recheckFailedWithCreds(email, password) {
  const failedResults = state.results.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
  if (failedResults.length === 0) {
    alert('No failed videos to re-check.');
    return;
  }

  const titles = failedResults.map(r => r.title);

  if (isLocal) {
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: state.mode, failedOnly: true, titles, email, password }),
      });
      if (res.status === 409) {
        alert('A check is already running!');
        return;
      }
      resetState();
      updateRunButtons();
      updateSummaryCards();
      showProgress();
      hideEmpty();
      connectSSE();
    } catch (e) {
      alert('Failed to start re-check: ' + e.message);
    }
  } else {
    try {
      const res = await fetch('/api/trigger-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: state.mode, failedOnly: true, titles, email, password }),
      });
      const data = await res.json();
      if (data.error) {
        alert('Failed to trigger re-check: ' + data.error);
        return;
      }
      ghRunId = data.runId;
      resetState();
      updateRunButtons();
      hideEmpty();
      showCloudProgress('Re-checking failed videos on GitHub Actions...');
      startPolling();
    } catch (e) {
      alert('Failed to trigger re-check: ' + e.message);
    }
  }
}

function updateRecheckButton() {
  const btn = document.getElementById('recheck-failed-btn');
  if (!btn) return;
  const failedCount = state.results.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT').length;
  if (failedCount > 0 && state.status === 'complete') {
    btn.style.display = 'inline-flex';
    btn.textContent = `Re-check ${failedCount} Failed`;
  } else {
    btn.style.display = 'none';
  }
}

// ============== 4. Health Badge ==============
function updateHealthBadge() {
  const el = document.getElementById('health-badge');
  if (!el) return;

  const total = state.results.length;
  const passed = state.passedCount;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  // Determine badge color
  let badgeColor = '#4c1'; // green
  if (rate < 100 && rate > 95) badgeColor = '#dfb317'; // yellow
  if (rate <= 95) badgeColor = '#e05d44'; // red

  const labelText = 'Video Health';
  const valueText = rate + '%';

  // Measure approximate text widths
  const labelWidth = labelText.length * 6.5 + 10;
  const valueWidth = valueText.length * 6.5 + 10;
  const totalWidth = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${labelText}: ${valueText}">
  <title>${labelText}: ${valueText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${labelText}</text>
    <text x="${labelWidth / 2}" y="14" fill="#fff">${labelText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${valueText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14" fill="#fff">${valueText}</text>
  </g>
</svg>`;

  const badgeUrl = window.location.origin + '/api/health-badge';

  el.innerHTML = `
    <div class="health-badge-preview">${svg}</div>
    <div class="health-badge-url">
      <span>Badge URL:</span>
      <input type="text" value="${escHtml(badgeUrl)}" readonly onclick="this.select()" style="font-size:0.8rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-secondary);color:var(--color-text);width:300px;">
    </div>
  `;
  el.style.display = 'block';

  // Also update the re-check button visibility
  updateRecheckButton();
}

// ============== 5. Historical Trend Chart ==============
async function loadAndShowTrendChart() {
  const container = document.getElementById('trend-chart-container');
  if (!container) return;

  try {
    let url = '/api/get-report?file=history.json';
    if (isLocal) {
      url = '/api/report?file=history.json';
    }
    const res = await fetch(url);
    if (!res.ok) {
      container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
      container.style.display = 'block';
      return;
    }
    let history = await res.json();
    if (!Array.isArray(history) || history.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
      container.style.display = 'block';
      return;
    }

    // Limit to last 20 data points
    if (history.length > 20) {
      history = history.slice(history.length - 20);
    }

    // Chart dimensions
    const chartWidth = 600;
    const chartHeight = 200;
    const padding = { top: 20, right: 20, bottom: 50, left: 45 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    // Find max value for Y axis
    const maxVal = Math.max(...history.map(h => (h.total || 0)), 1);

    // Bar width with gap
    const barGroupWidth = innerWidth / history.length;
    const barWidth = Math.max(barGroupWidth * 0.35, 2);
    const barGap = Math.max(barGroupWidth * 0.05, 1);

    let bars = '';
    let labels = '';
    let yAxisLines = '';

    // Y axis grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (innerHeight * (1 - i / 4));
      const val = Math.round(maxVal * i / 4);
      yAxisLines += `<line x1="${padding.left}" y1="${y}" x2="${chartWidth - padding.right}" y2="${y}" stroke="var(--color-border)" stroke-width="0.5" stroke-dasharray="3,3"/>`;
      yAxisLines += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--color-text-muted)">${val}</text>`;
    }

    history.forEach((h, i) => {
      const x = padding.left + i * barGroupWidth + barGroupWidth / 2;

      // Passed bar (green)
      const passedHeight = maxVal > 0 ? ((h.passed || 0) / maxVal) * innerHeight : 0;
      const passedY = padding.top + innerHeight - passedHeight;
      bars += `<rect x="${x - barWidth - barGap / 2}" y="${passedY}" width="${barWidth}" height="${passedHeight}" fill="#22c55e" rx="1" opacity="0.85">
        <title>Passed: ${h.passed || 0}</title>
      </rect>`;

      // Failed bar (red) - stacked: failed + timeouts
      const failedTotal = (h.failed || 0) + (h.timeouts || 0);
      const failedHeight = maxVal > 0 ? (failedTotal / maxVal) * innerHeight : 0;
      const failedY = padding.top + innerHeight - failedHeight;
      bars += `<rect x="${x + barGap / 2}" y="${failedY}" width="${barWidth}" height="${failedHeight}" fill="#ef4444" rx="1" opacity="0.85">
        <title>Failed: ${h.failed || 0}, Timeout: ${h.timeouts || 0}</title>
      </rect>`;

      // X axis label (date)
      const date = new Date(h.timestamp);
      const dateStr = (date.getMonth() + 1) + '/' + date.getDate();
      labels += `<text x="${x}" y="${chartHeight - padding.bottom + 15}" text-anchor="middle" font-size="9" fill="var(--color-text-muted)" transform="rotate(-30, ${x}, ${chartHeight - padding.bottom + 15})">${dateStr}</text>`;
    });

    // Legend
    const legend = `
      <g transform="translate(${padding.left}, ${chartHeight - 10})">
        <rect x="0" y="-8" width="10" height="10" fill="#22c55e" rx="2"/>
        <text x="14" y="0" font-size="10" fill="var(--color-text-muted)">Passed</text>
        <rect x="60" y="-8" width="10" height="10" fill="#ef4444" rx="2"/>
        <text x="74" y="0" font-size="10" fill="var(--color-text-muted)">Failed</text>
      </g>
    `;

    const svg = `<svg width="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" xmlns="http://www.w3.org/2000/svg" style="max-width:${chartWidth}px;">
      ${yAxisLines}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" stroke="var(--color-border)" stroke-width="1"/>
      <line x1="${padding.left}" y1="${padding.top + innerHeight}" x2="${chartWidth - padding.right}" y2="${padding.top + innerHeight}" stroke="var(--color-border)" stroke-width="1"/>
      ${bars}
      ${labels}
      ${legend}
    </svg>`;

    container.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:0.95rem;color:var(--color-text);">Check History</h3>${svg}`;
    container.style.display = 'block';
  } catch (e) {
    console.error('Failed to load trend chart:', e);
    container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
    container.style.display = 'block';
  }
}

// ============== 6. Average Response Time ==============
function updateAvgResponseTime() {
  const el = document.getElementById('health-summary');
  if (!el) return;

  const timings = state.results
    .filter(r => r.loadTimeMs && r.loadTimeMs > 0)
    .map(r => r.loadTimeMs);

  if (timings.length === 0) return;

  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  const min = Math.min(...timings);
  const max = Math.max(...timings);

  const formatTime = (ms) => {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  };

  // Append response time info to the health summary
  const responseInfo = document.createElement('div');
  responseInfo.className = 'response-time-info';
  responseInfo.style.cssText = 'font-size:0.85rem;margin-top:4px;opacity:0.85;';
  responseInfo.textContent = `Avg load: ${formatTime(Math.round(avg))} | Min: ${formatTime(min)} | Max: ${formatTime(max)}`;

  // Check if we already appended this info, replace if so
  const existing = el.querySelector('.response-time-info');
  if (existing) {
    existing.replaceWith(responseInfo);
  } else {
    el.appendChild(responseInfo);
  }
}

// ============== 7. Diff Report ==============
async function loadAndShowDiffReport() {
  const container = document.getElementById('diff-report');
  if (!container) return;

  try {
    let url = '/api/get-report?file=previous-report.json';
    if (isLocal) {
      url = '/api/report?file=previous-report.json';
    }
    const res = await fetch(url);
    if (!res.ok) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
      container.classList.add('visible');
      return;
    }

    const previousReport = await res.json();
    const previousResults = previousReport.allResults || previousReport || [];

    if (!Array.isArray(previousResults) || previousResults.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
      container.classList.add('visible');
      return;
    }

    // Build lookup maps by title (since title is the most stable identifier)
    const prevMap = {};
    for (const r of previousResults) {
      prevMap[r.title] = r.status;
    }
    const currentMap = {};
    for (const r of state.results) {
      currentMap[r.title] = r.status;
    }

    const newFailures = []; // Were PASS before, now FAIL or TIMEOUT
    const fixed = [];       // Were FAIL/TIMEOUT before, now PASS
    const stillFailing = []; // FAIL/TIMEOUT in both

    for (const r of state.results) {
      const prevStatus = prevMap[r.title];
      if (!prevStatus) continue; // New video, skip

      if ((r.status === 'FAIL' || r.status === 'TIMEOUT') && prevStatus === 'PASS') {
        newFailures.push(r);
      } else if (r.status === 'PASS' && (prevStatus === 'FAIL' || prevStatus === 'TIMEOUT')) {
        fixed.push(r);
      } else if ((r.status === 'FAIL' || r.status === 'TIMEOUT') && (prevStatus === 'FAIL' || prevStatus === 'TIMEOUT')) {
        stillFailing.push(r);
      }
    }

    if (newFailures.length === 0 && fixed.length === 0 && stillFailing.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">No changes from previous run.</p>';
      container.classList.add('visible');
      return;
    }

    let html = '<h3 style="margin:0 0 12px 0;font-size:0.95rem;">Changes Since Last Run</h3>';

    if (newFailures.length > 0) {
      html += `<div class="diff-group diff-new-failures">
        <h4 style="color:#ef4444;margin:0 0 6px 0;font-size:0.88rem;">New Failures (${newFailures.length})</h4>
        <ul style="margin:0;padding-left:20px;">
          ${newFailures.map(r => `<li style="color:#ef4444;margin-bottom:2px;">${escHtml(r.title)} <span style="opacity:0.7">[${escHtml(r.section || '')}]</span> - ${r.status}</li>`).join('')}
        </ul>
      </div>`;
    }

    if (fixed.length > 0) {
      html += `<div class="diff-group diff-fixed" style="margin-top:10px;">
        <h4 style="color:#22c55e;margin:0 0 6px 0;font-size:0.88rem;">Fixed (${fixed.length})</h4>
        <ul style="margin:0;padding-left:20px;">
          ${fixed.map(r => `<li style="color:#22c55e;margin-bottom:2px;">${escHtml(r.title)} <span style="opacity:0.7">[${escHtml(r.section || '')}]</span></li>`).join('')}
        </ul>
      </div>`;
    }

    if (stillFailing.length > 0) {
      html += `<div class="diff-group diff-still-failing" style="margin-top:10px;">
        <h4 style="color:#f59e0b;margin:0 0 6px 0;font-size:0.88rem;">Still Failing (${stillFailing.length})</h4>
        <ul style="margin:0;padding-left:20px;">
          ${stillFailing.map(r => `<li style="color:#f59e0b;margin-bottom:2px;">${escHtml(r.title)} <span style="opacity:0.7">[${escHtml(r.section || '')}]</span> - ${r.status}</li>`).join('')}
        </ul>
      </div>`;
    }

    container.innerHTML = html;
    container.classList.add('visible');
  } catch (e) {
    console.error('Failed to load diff report:', e);
    container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
    container.classList.add('visible');
  }
}

// ============== 8. Webhook Notification (fire-and-forget) ==============
function notifyWebhook() {
  const summary = {
    total: state.results.length,
    passed: state.passedCount,
    failed: state.failedCount,
    timeouts: state.timeoutCount,
    rate: state.results.length > 0
      ? Math.round((state.passedCount / state.results.length) * 100)
      : 0,
    timestamp: new Date().toISOString(),
  };

  // Fire and forget - don't await, don't care if it fails
  fetch('/api/webhook-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  }).catch(() => {
    // Silently ignore - endpoint may not exist
  });
}

