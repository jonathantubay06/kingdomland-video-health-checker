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

  // Feature 6: Initialize sound UI
  updateSoundUI();

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
  const failedCount = state.results.filter(r => r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT).length;
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

  if (window._sectionRecheckTitles && window._sectionRecheckTitles.length > 0) {
    // Section-specific recheck (Feature 9)
    const titles = window._sectionRecheckTitles;
    window._sectionRecheckTitles = null;
    recheckFailedWithCreds(email, password, titles);
  } else if (failedOnly) {
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
  document.getElementById('recheck-actions').style.display = 'none';
  document.getElementById('health-summary').style.display = 'none';
  document.getElementById('last-checked').style.display = 'none';
  document.getElementById('health-badge').style.display = 'none';
  document.getElementById('trend-chart-container').style.display = 'none';
  document.getElementById('diff-report').style.display = 'none';
  document.getElementById('uptime-section').style.display = 'none';
  document.getElementById('watchlist-section').style.display = 'none';
  document.getElementById('heatmap-section').style.display = 'none';
  document.getElementById('comparison-section').style.display = 'none';
  document.getElementById('auto-refresh-bar').style.display = 'none';
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
  // Try video-report.json first; fall back to previous-report.json if empty/invalid
  let report = null;
  for (const file of ['video-report.json', 'previous-report.json']) {
    try {
      const res = await fetch(`/api/get-report?file=${file}`);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || !text.trim()) continue;
      const parsed = JSON.parse(text);
      if (parsed && (parsed.allResults?.length > 0)) {
        report = parsed;
        if (file === 'previous-report.json') {
          // Mark as stale so the UI knows this isn't the latest run
          report._stale = true;
        }
        break;
      }
    } catch {}
  }

  if (!report) return;

  try {
    state.results = report.allResults || [];
    if (report.summary) {
      state.passedCount = report.summary.passed || 0;
      state.failedCount = report.summary.failed || 0;
      state.timeoutCount = report.summary.timeouts || 0;
    } else {
      state.passedCount = state.results.filter(r => r.status === KL.STATUS.PASS).length;
      state.failedCount = state.results.filter(r => r.status === KL.STATUS.FAIL).length;
      state.timeoutCount = state.results.filter(r => r.status === KL.STATUS.TIMEOUT).length;
    }
    state.totalDiscovered = state.results.length;
    state.checkedCount = state.results.length;
    state.status = 'complete';

    // Store the timestamp from the report
    state.reportTimestamp = report.timestamp || null;
    state.reportStale = report._stale || false;

    state.sectionMap = {};
    for (const r of state.results) {
      const secKey = `${r.page} - ${r.section || 'Unknown'}`;
      if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      state.sectionMap[secKey].total++;
      if (r.status === KL.STATUS.PASS) state.sectionMap[secKey].passed++;
      else if (r.status === KL.STATUS.FAIL) state.sectionMap[secKey].failed++;
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
      if (r.status === KL.STATUS.PASS) state.passedCount++;
      else if (r.status === KL.STATUS.FAIL) state.failedCount++;
      else if (r.status === KL.STATUS.TIMEOUT) state.timeoutCount++;
      const secKey = `${r.page} - ${r.section || 'Unknown'}`;
      if (!state.sectionMap[secKey]) state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      state.sectionMap[secKey].total++;
      if (r.status === KL.STATUS.PASS) state.sectionMap[secKey].passed++;
      else if (r.status === KL.STATUS.FAIL) state.sectionMap[secKey].failed++;
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
      state.passedCount = state.results.filter(r => r.status === KL.STATUS.PASS).length;
      state.failedCount = state.results.filter(r => r.status === KL.STATUS.FAIL).length;
      state.timeoutCount = state.results.filter(r => r.status === KL.STATUS.TIMEOUT).length;
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
      if (r.status === KL.STATUS.PASS) state.sectionMap[secKey].passed++;
      else if (r.status === KL.STATUS.FAIL) state.sectionMap[secKey].failed++;
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

  // Update pass rate
  const total = state.totalDiscovered || state.checkedCount || 0;
  const passed = state.passedCount || 0;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const passRateBar = document.getElementById('pass-rate-bar');
  const passRateFill = document.getElementById('pass-rate-fill');
  const passRateValue = document.getElementById('pass-rate-value');
  const passRateSubtitle = document.getElementById('stat-pass-rate');

  if (total > 0) {
    passRateBar.style.display = 'flex';
    passRateFill.style.width = rate + '%';
    if (rate < 90) {
      passRateFill.style.background = 'var(--color-fail)';
      passRateValue.style.color = 'var(--color-fail)';
    } else if (rate < 100) {
      passRateFill.style.background = 'var(--color-timeout)';
      passRateValue.style.color = 'var(--color-timeout)';
    } else {
      passRateFill.style.background = 'var(--color-pass)';
      passRateValue.style.color = 'var(--color-pass)';
    }
    passRateValue.textContent = rate + '%';
    if (passRateSubtitle) passRateSubtitle.textContent = `${rate}% of total`;
  } else {
    passRateBar.style.display = 'none';
    if (passRateSubtitle) passRateSubtitle.textContent = '';
  }
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
  const icon = result.status === KL.STATUS.PASS ? '\u2705' : result.status === KL.STATUS.FAIL ? '\u274C' : '\u23F1\uFE0F';
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
  const isComplete = message.includes('Check complete');
  div.className = 'log-entry' + (isError ? ' error' : '') + (isComplete ? ' success' : '');
  const time = new Date().toLocaleTimeString();
  div.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${escHtml(message)}</span>`;
  entries.appendChild(div);
  const body = document.getElementById('log-body');
  body.scrollTop = body.scrollHeight;
  while (entries.children.length > 200) {
    entries.removeChild(entries.firstChild);
  }
  // Update count badge
  const countBadge = document.getElementById('log-count');
  if (countBadge) countBadge.textContent = entries.children.length;
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
  tr.onclick = (e) => {
    // Don't toggle detail when clicking star or title link
    if (e.target.classList.contains('star-btn') || e.target.classList.contains('video-title-link')) return;
    toggleDetail(r.number);
  };
  const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
  const errorText = r.error ? (r.error.length > 40 ? r.error.substring(0, 40) + '...' : r.error) : '-';

  // Response time color class
  let loadTimeClass = '';
  if (r.loadTimeMs) {
    if (r.loadTimeMs < 3000) loadTimeClass = 'load-fast';
    else if (r.loadTimeMs < 8000) loadTimeClass = 'load-medium';
    else loadTimeClass = 'load-slow';
  }

  // Star button for watchlist (Feature 5)
  const watchlist = getWatchlist();
  const isStarred = watchlist.includes(r.title);
  const starClass = isStarred ? 'star-btn starred' : 'star-btn';
  const starChar = isStarred ? '\u2605' : '\u2606';

  // Screenshot indicator (Feature 13)
  const screenshotIcon = r.screenshot
    ? '<span class="screenshot-indicator" title="Has screenshot">&#128247;</span>'
    : '';

  tr.innerHTML = `
    <td><button class="${starClass}" data-title="${escHtml(r.title)}" onclick="event.stopPropagation();toggleWatchlist('${escHtml(r.title).replace(/'/g, "\\'")}')">${starChar}</button></td>
    <td>${r.number}</td>
    <td><strong><span class="video-title-link" onclick="event.stopPropagation();showVideoDetail('${escHtml(r.title).replace(/'/g, "\\'")}')">${escHtml(r.title)}</span></strong> ${screenshotIcon}</td>
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
    <td colspan="10">
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
    if (r.status === KL.STATUS.PASS) state.sectionMap[secKey].passed++;
    else if (r.status === KL.STATUS.FAIL) state.sectionMap[secKey].failed++;
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

  // Feature 2: Auto-refresh - store timestamp and restart polling
  lastKnownTimestamp = state.reportTimestamp || new Date().toISOString();
  startAutoRefresh();

  // Feature 3: Uptime tracking
  updateUptimeTracking();

  // Feature 5: Watchlist
  renderWatchlist();

  // Feature 6: Sound notification
  const hasFailures = state.failedCount > 0 || state.timeoutCount > 0;
  playNotificationSound(!hasFailures);

  // Feature 9: Section recheck dropdown
  updateSectionRecheckDropdown();

  // Feature 10: Comparison view
  loadComparisonData().then(() => renderComparisonSection());

  // Feature 14: Heatmap
  renderHeatmap();

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
  const passed = results.filter(r => r.status === KL.STATUS.PASS).length;
  const failed = results.filter(r => r.status === KL.STATUS.FAIL).length;
  const timeouts = results.filter(r => r.status === KL.STATUS.TIMEOUT).length;
  const rate = total > 0 ? (passed / total * 100).toFixed(1) : 0;

  // Build sections map
  const sections = {};
  for (const r of results) {
    const key = `${r.page}::${r.section || 'Unknown'}`;
    if (!sections[key]) sections[key] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0 };
    sections[key].total++;
    if (r.status === KL.STATUS.PASS) sections[key].passed++;
    else sections[key].failed++;
  }

  // Section cards
  const sectionCards = Object.values(sections).map(s => {
    const pct = s.total > 0 ? Math.round(s.passed / s.total * 100) : 0;
    const tagClass = s.page === 'MUSIC' ? 'music' : 'story';
    const barClass = s.failed > 0 ? 'has-fail' : '';
    return `
      <div class="print-section-card">
        <div class="print-section-name">${escHtml(s.section)}</div>
        <span class="print-section-tag ${tagClass}">${s.page}</span>
        <div class="print-section-bar-bg"><div class="print-section-bar ${barClass}" style="width:${pct}%"></div></div>
        <div class="print-section-counts">
          <span class="green">${s.passed} passed</span>
          <span class="red">${s.failed > 0 ? s.failed + ' failed' : '0 failed'}</span>
          <span>${pct}%</span>
        </div>
      </div>`;
  }).join('');

  // Results table rows — only show failures + timeouts first, then all
  const failedResults = results.filter(r => r.status !== KL.STATUS.PASS);
  const resultRows = results.map((r, i) => {
    const statusClass = r.status === KL.STATUS.PASS ? 'print-status-pass' : r.status === KL.STATUS.FAIL ? 'print-status-fail' : 'print-status-timeout';
    const rowClass = r.status === KL.STATUS.FAIL ? 'print-fail' : r.status === KL.STATUS.TIMEOUT ? 'print-timeout' : '';
    return `<tr class="${rowClass}"><td>${i + 1}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.section || '')}</td><td>${r.page || ''}</td><td class="${statusClass}">${r.status}</td><td>${r.duration || '-'}</td>${r.error ? `<td style="color:#dc2626;font-size:0.68rem">${escHtml(r.error)}</td>` : '<td>-</td>'}</tr>`;
  }).join('');

  const overallBadge = failed === 0
    ? `<span class="print-badge pass">✓ All ${total} Videos OK</span>`
    : `<span class="print-badge fail">✗ ${failed} Failed</span>`;

  document.getElementById('print-report').innerHTML = `
    <div class="print-header">
      <div class="print-header-left">
        <h1>Kingdomland Video Check Report</h1>
        <p>go.kingdomlandkids.com &nbsp;·&nbsp; Generated: ${new Date().toLocaleString()}</p>
      </div>
      <div class="print-header-right">
        ${overallBadge}
        <div>Pass Rate: <strong>${rate}%</strong></div>
      </div>
    </div>

    <div class="print-stats">
      <div class="print-stat-card"><div class="print-stat-label">Total Videos</div><div class="print-stat-value">${total}</div></div>
      <div class="print-stat-card"><div class="print-stat-label">Passed</div><div class="print-stat-value green">${passed}</div></div>
      <div class="print-stat-card"><div class="print-stat-label">Failed</div><div class="print-stat-value red">${failed}</div></div>
      <div class="print-stat-card"><div class="print-stat-label">Timed Out</div><div class="print-stat-value">${timeouts}</div></div>
      <div class="print-stat-card"><div class="print-stat-label">Pass Rate</div><div class="print-stat-value">${rate}%</div></div>
    </div>

    <p class="print-section-title">Section Breakdown</p>
    <div class="print-section-grid">${sectionCards}</div>

    <p class="print-section-title">Detailed Results</p>
    <table class="print-table">
      <thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Load Time</th><th>Error</th></tr></thead>
      <tbody>${resultRows}</tbody>
    </table>
  `;
  document.getElementById('print-report').style.display = 'block';
  const origTitle = document.title;
  const dateStr = new Date().toISOString().slice(0, 10);
  document.title = `KDL-Video-Check-${dateStr}`;
  window.print();
  setTimeout(() => {
    document.getElementById('print-report').style.display = 'none';
    document.title = origTitle;
  }, 1000);
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
  let detail = '';
  let level = 'green';
  let icon = '';

  if (rate === 100) {
    message = `All ${total} videos are working perfectly!`;
    detail = '100% pass rate';
    level = 'green';
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else if (rate > 95) {
    level = 'yellow';
    const notWorking = failed + timeouts;
    const parts = [];
    if (failed > 0) parts.push(`${failed} failed`);
    if (timeouts > 0) parts.push(`${timeouts} timed out`);
    message = `${passed} of ${total} videos working`;
    detail = `${notWorking} video${notWorking !== 1 ? 's' : ''} with issues: ${parts.join(', ')}`;
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  } else {
    level = 'red';
    const notWorking = failed + timeouts;
    const parts = [];
    if (failed > 0) parts.push(`${failed} failed`);
    if (timeouts > 0) parts.push(`${timeouts} timed out`);
    message = `${notWorking} videos are not working`;
    detail = parts.join(', ');
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  }

  el.className = 'health-banner health-' + level;
  el.innerHTML = `
    <div class="health-banner-icon">${icon}</div>
    <div class="health-banner-body">
      <div class="health-banner-text">
        <div class="health-message">${escHtml(message)}</div>
        ${detail ? `<div class="health-detail">${escHtml(detail)}</div>` : ''}
      </div>
      <div class="health-banner-metrics" id="health-metrics"></div>
    </div>
  `;
  el.style.display = 'flex';
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

  const staleNote = state.reportStale
    ? ' <span class="stale-badge" title="Latest run had no results — showing previous report">(previous run)</span>'
    : '';
  el.innerHTML = `
    <div class="last-checked-label">
      <span class="check-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </span>
      <span>Last checked: <span class="last-checked-datetime">${escHtml(absolute)}</span>${staleNote}</span>
      <span class="last-checked-relative">${escHtml(relative)}</span>
    </div>
  `;
  el.style.display = 'flex';

  // Auto-update the relative time every minute
  if (window._lastCheckedInterval) clearInterval(window._lastCheckedInterval);
  window._lastCheckedInterval = setInterval(() => {
    const relEl = el.querySelector('.last-checked-relative');
    if (relEl) relEl.textContent = timeAgo(date);
  }, 60000);
}

// ============== 3. Re-check Failed Only ==============
function recheckFailed() {
  // The standalone re-check button just opens the credentials modal
  openCredentialsModal();
}

async function recheckFailedWithCreds(email, password, customTitles) {
  let titles;
  if (customTitles && customTitles.length > 0) {
    titles = customTitles;
  } else {
    const failedResults = state.results.filter(r => r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT);
    if (failedResults.length === 0) {
      alert('No failed videos to re-check.');
      return;
    }
    titles = failedResults.map(r => r.title);
  }

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
  const container = document.getElementById('recheck-actions');
  if (!container) return;
  const failedCount = state.results.filter(r => r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT).length;

  // Show container whenever we have results
  if (state.results.length > 0 && state.status === 'complete') {
    container.style.display = 'flex';
    // Only show the recheck-failed button if there are failures
    const recheckBtn = container.querySelector('.btn-recheck');
    if (recheckBtn) {
      recheckBtn.style.display = failedCount > 0 ? 'inline-flex' : 'none';
    }
    const countEl = document.getElementById('recheck-count');
    if (countEl) countEl.textContent = failedCount;
  } else {
    container.style.display = 'none';
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
    const chartWidth = 700;
    const chartHeight = 240;
    const padding = { top: 24, right: 24, bottom: 52, left: 50 };
    const innerWidth = chartWidth - padding.left - padding.right;
    const innerHeight = chartHeight - padding.top - padding.bottom;

    // Find max value for Y axis
    const maxVal = Math.max(...history.map(h => (h.total || 0)), 1);
    // Nice Y axis max (round up to next multiple of a sensible number)
    const niceMax = Math.ceil(maxVal / 10) * 10 || maxVal;

    // Bar width with gap
    const barGroupWidth = innerWidth / history.length;
    const barWidth = Math.min(Math.max(barGroupWidth * 0.32, 4), 24);
    const barGap = Math.max(barGroupWidth * 0.06, 2);

    let bars = '';
    let labels = '';
    let yAxisLines = '';
    let hoverAreas = '';

    // Y axis grid lines (5 lines)
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (innerHeight * (1 - i / gridCount));
      const val = Math.round(niceMax * i / gridCount);
      yAxisLines += `<line x1="${padding.left}" y1="${y}" x2="${chartWidth - padding.right}" y2="${y}" stroke="var(--color-border)" stroke-width="0.5" opacity="0.5"/>`;
      yAxisLines += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--color-text-light)" font-weight="500">${val}</text>`;
    }

    // Calculate pass rate trend line points
    let trendLinePoints = '';

    history.forEach((h, i) => {
      const x = padding.left + i * barGroupWidth + barGroupWidth / 2;

      // Stacked bar: passed (bottom, green) + failed (top, red)
      const passedVal = h.passed || 0;
      const failedTotal = (h.failed || 0) + (h.timeouts || 0);
      const totalVal = passedVal + failedTotal;

      const totalBarHeight = niceMax > 0 ? (totalVal / niceMax) * innerHeight : 0;
      const passedHeight = niceMax > 0 ? (passedVal / niceMax) * innerHeight : 0;
      const failedHeight = totalBarHeight - passedHeight;

      const barBaseY = padding.top + innerHeight;

      // Passed bar (bottom - green)
      if (passedHeight > 0) {
        bars += `<rect class="chart-bar" x="${x - barWidth / 2}" y="${barBaseY - passedHeight}" width="${barWidth}" height="${passedHeight}" fill="var(--color-pass)" rx="2" ry="2" opacity="0.85" data-idx="${i}"/>`;
      }

      // Failed bar (stacked on top - red)
      if (failedHeight > 0) {
        bars += `<rect class="chart-bar" x="${x - barWidth / 2}" y="${barBaseY - totalBarHeight}" width="${barWidth}" height="${failedHeight}" fill="var(--color-fail)" rx="2" ry="2" opacity="0.85" data-idx="${i}"/>`;
      }

      // Invisible hover area for the full column (for tooltip)
      hoverAreas += `<rect x="${x - barGroupWidth / 2}" y="${padding.top}" width="${barGroupWidth}" height="${innerHeight}" fill="transparent" class="chart-hover-area" data-idx="${i}"/>`;

      // Pass rate trend line point
      const passRate = totalVal > 0 ? passedVal / totalVal : 1;
      const trendY = padding.top + innerHeight - (passRate * innerHeight);
      trendLinePoints += (i === 0 ? 'M' : 'L') + `${x},${trendY}`;

      // X axis label (date + time)
      const date = new Date(h.timestamp);
      const dateStr = (date.getMonth() + 1) + '/' + date.getDate();
      const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      // Only show time if multiple entries on same date
      const prevDate = i > 0 ? new Date(history[i - 1].timestamp) : null;
      const sameDate = prevDate && prevDate.getDate() === date.getDate() && prevDate.getMonth() === date.getMonth();
      const labelStr = sameDate ? timeStr : dateStr;

      labels += `<text x="${x}" y="${chartHeight - padding.bottom + 16}" text-anchor="middle" font-size="9.5" fill="var(--color-text-light)" font-weight="500" transform="rotate(-30, ${x}, ${chartHeight - padding.bottom + 16})">${labelStr}</text>`;
    });

    // Pass rate trend line
    const trendLine = trendLinePoints
      ? `<path d="${trendLinePoints}" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5" stroke-dasharray="4,3"/>`
      : '';

    // Right Y axis label for pass rate
    const rateAxisLabel = `<text x="${chartWidth - padding.right + 8}" y="${padding.top + innerHeight / 2}" text-anchor="start" font-size="9" fill="var(--color-text-light)" transform="rotate(90, ${chartWidth - padding.right + 8}, ${padding.top + innerHeight / 2})">Pass Rate</text>`;

    const svg = `<svg width="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" xmlns="http://www.w3.org/2000/svg" style="max-width:${chartWidth}px;" id="trend-svg">
      <!-- Grid -->
      ${yAxisLines}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}" stroke="var(--color-border)" stroke-width="1"/>
      <line x1="${padding.left}" y1="${padding.top + innerHeight}" x2="${chartWidth - padding.right}" y2="${padding.top + innerHeight}" stroke="var(--color-border)" stroke-width="1"/>
      <!-- Bars -->
      ${bars}
      <!-- Trend line -->
      ${trendLine}
      <!-- X labels -->
      ${labels}
      <!-- Hover areas (on top) -->
      ${hoverAreas}
    </svg>`;

    // Summary stats
    const lastEntry = history[history.length - 1];
    const firstEntry = history[0];
    const totalChecks = history.length;
    const avgPassRate = history.reduce((sum, h) => {
      const t = (h.passed || 0) + (h.failed || 0) + (h.timeouts || 0);
      return sum + (t > 0 ? (h.passed || 0) / t * 100 : 100);
    }, 0) / history.length;

    container.innerHTML = `
      <div class="trend-chart-header">
        <h2>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          Check History
        </h2>
      </div>
      <div class="trend-chart-canvas" style="position:relative">
        ${svg}
        <div class="chart-tooltip" id="chart-tooltip"></div>
      </div>
      <div class="trend-chart-footer">
        <div class="trend-chart-legend">
          <span class="trend-legend-item"><span class="trend-legend-dot dot-pass"></span> Passed</span>
          <span class="trend-legend-item"><span class="trend-legend-dot dot-fail"></span> Failed</span>
          <span class="trend-legend-item" style="opacity:0.6"><span style="width:16px;height:2px;background:var(--color-primary);border-radius:1px;display:inline-block;vertical-align:middle;margin-right:2px"></span> Pass Rate</span>
        </div>
        <div class="trend-chart-summary">${totalChecks} checks &middot; Avg pass rate: ${avgPassRate.toFixed(1)}%</div>
      </div>
    `;

    // Attach tooltip listeners
    const tooltip = document.getElementById('chart-tooltip');
    const canvasEl = container.querySelector('.trend-chart-canvas');
    container.querySelectorAll('.chart-hover-area').forEach(area => {
      area.addEventListener('mouseenter', (e) => {
        const idx = parseInt(area.dataset.idx);
        const h = history[idx];
        if (!h) return;
        const date = new Date(h.timestamp);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        const total = (h.passed || 0) + (h.failed || 0) + (h.timeouts || 0);
        const rate = total > 0 ? Math.round((h.passed || 0) / total * 100) : 0;
        tooltip.innerHTML = `
          <div class="chart-tooltip-title">${dateStr} ${timeStr}</div>
          <div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-pass)"></span> Passed: <span class="chart-tooltip-value">${h.passed || 0}</span></div>
          <div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-fail)"></span> Failed: <span class="chart-tooltip-value">${h.failed || 0}</span></div>
          ${(h.timeouts || 0) > 0 ? `<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-timeout)"></span> Timeout: <span class="chart-tooltip-value">${h.timeouts}</span></div>` : ''}
          <div class="chart-tooltip-row" style="margin-top:4px;padding-top:4px;border-top:1px solid var(--color-border)">Pass rate: <span class="chart-tooltip-value">${rate}%</span></div>
        `;
        tooltip.classList.add('visible');
      });
      area.addEventListener('mousemove', (e) => {
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        tooltip.style.left = Math.min(x + 12, rect.width - tooltip.offsetWidth - 8) + 'px';
        tooltip.style.top = Math.max(y - tooltip.offsetHeight - 8, 4) + 'px';
      });
      area.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });
    });

    container.style.display = 'block';
  } catch (e) {
    console.error('Failed to load trend chart:', e);
    container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
    container.style.display = 'block';
  }
}

// ============== 6. Average Response Time ==============
function updateAvgResponseTime() {
  const metricsEl = document.getElementById('health-metrics');
  if (!metricsEl) return;

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

  const clockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

  metricsEl.innerHTML = `
    <span class="health-metric-pill">${clockSvg} Avg: <span class="metric-value">${formatTime(Math.round(avg))}</span></span>
    <span class="health-metric-pill">Min: <span class="metric-value">${formatTime(min)}</span></span>
    <span class="health-metric-pill">Max: <span class="metric-value">${formatTime(max)}</span></span>
  `;
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

      if ((r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT) && prevStatus === KL.STATUS.PASS) {
        newFailures.push(r);
      } else if (r.status === KL.STATUS.PASS && (prevStatus === KL.STATUS.FAIL || prevStatus === KL.STATUS.TIMEOUT)) {
        fixed.push(r);
      } else if ((r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT) && (prevStatus === KL.STATUS.FAIL || prevStatus === KL.STATUS.TIMEOUT)) {
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

// ====================================================================
// FEATURE 2: Auto-Refresh Dashboard
// ====================================================================
let autoRefreshTimer = null;
let autoRefreshEnabled = true;
let lastKnownTimestamp = null;

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(checkForNewResults, 5 * 60 * 1000); // every 5 minutes
  updateAutoRefreshUI();
}

function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  if (autoRefreshEnabled) {
    startAutoRefresh();
  } else {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  }
  updateAutoRefreshUI();
}

function updateAutoRefreshUI() {
  const bar = document.getElementById('auto-refresh-bar');
  const text = document.getElementById('auto-refresh-text');
  if (!bar) return;
  if (autoRefreshEnabled && state.status !== 'running') {
    bar.style.display = 'flex';
    text.textContent = 'Auto-refresh active — checking for new results every 5 minutes';
  } else {
    bar.style.display = 'none';
  }
}

async function checkForNewResults() {
  if (state.status === 'running' || !autoRefreshEnabled) return;
  try {
    const res = await fetch('/api/report-timestamp');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'running') {
      // A check just started, connect to it
      state.status = 'running';
      updateRunButtons();
      showProgress();
      if (isLocal) connectSSE(); else startPolling();
      return;
    }
    if (data.timestamp && data.timestamp !== lastKnownTimestamp) {
      if (lastKnownTimestamp !== null) {
        // New results are available! Reload them
        if (isLocal) await loadPreviousReport(); else await loadCloudReport();
      }
      lastKnownTimestamp = data.timestamp;
    }
  } catch {}
}

// ====================================================================
// FEATURE 3: Uptime Percentage Tracking
// ====================================================================
async function updateUptimeTracking() {
  const section = document.getElementById('uptime-section');
  if (!section) return;

  try {
    const url = isLocal ? '/api/history' : '/api/get-report?file=history.json';
    const res = await fetch(url);
    if (!res.ok) { section.style.display = 'none'; return; }
    const history = await res.json();
    if (!Array.isArray(history) || history.length < 2) { section.style.display = 'none'; return; }

    const now = Date.now();
    const day7 = now - 7 * 24 * 60 * 60 * 1000;
    const day30 = now - 30 * 24 * 60 * 60 * 1000;

    const last7 = history.filter(h => new Date(h.timestamp).getTime() > day7);
    const last30 = history.filter(h => new Date(h.timestamp).getTime() > day30);

    const calcUptime = (entries) => {
      if (entries.length === 0) return null;
      const totalPassed = entries.reduce((s, h) => s + (h.passed || 0), 0);
      const totalAll = entries.reduce((s, h) => s + (h.total || 0), 0);
      return totalAll > 0 ? (totalPassed / totalAll * 100) : 100;
    };

    const allUptime = calcUptime(history);
    const uptime7 = calcUptime(last7);
    const uptime30 = calcUptime(last30);
    const totalChecks = history.length;

    const uptimeClass = (val) => {
      if (val === null) return '';
      if (val >= 99) return 'uptime-good';
      if (val >= 90) return 'uptime-warn';
      return 'uptime-bad';
    };

    const formatUptime = (val) => val !== null ? val.toFixed(1) + '%' : 'N/A';

    section.innerHTML = `
      <div class="uptime-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
        Uptime Tracking
      </div>
      <div class="uptime-cards">
        <div class="uptime-card">
          <div class="uptime-card-label">7-Day Uptime</div>
          <div class="uptime-card-value ${uptimeClass(uptime7)}">${formatUptime(uptime7)}</div>
          <div class="uptime-card-sub">${last7.length} checks</div>
        </div>
        <div class="uptime-card">
          <div class="uptime-card-label">30-Day Uptime</div>
          <div class="uptime-card-value ${uptimeClass(uptime30)}">${formatUptime(uptime30)}</div>
          <div class="uptime-card-sub">${last30.length} checks</div>
        </div>
        <div class="uptime-card">
          <div class="uptime-card-label">All-Time Uptime</div>
          <div class="uptime-card-value ${uptimeClass(allUptime)}">${formatUptime(allUptime)}</div>
          <div class="uptime-card-sub">${totalChecks} total checks</div>
        </div>
      </div>
    `;
    section.style.display = 'block';
  } catch {
    section.style.display = 'none';
  }
}

// ====================================================================
// FEATURE 4: Video Detail Pages (History per Video)
// ====================================================================
async function showVideoDetail(title) {
  const modal = document.getElementById('video-detail-modal');
  const titleEl = document.getElementById('video-detail-title');
  const body = document.getElementById('video-detail-body');
  if (!modal || !body) return;

  titleEl.textContent = title;
  body.innerHTML = '<p style="color:var(--color-text-muted)">Loading history...</p>';
  modal.style.display = 'flex';

  try {
    const url = isLocal ? '/api/history' : '/api/get-report?file=history.json';
    const res = await fetch(url);
    if (!res.ok) { body.innerHTML = '<p>No history available.</p>'; return; }
    const history = await res.json();

    // Find this video across all history entries
    const videoHistory = [];
    for (const entry of history) {
      if (entry.videos) {
        const match = entry.videos.find(v => v.title === title);
        if (match) {
          videoHistory.push({
            timestamp: entry.timestamp,
            status: match.status,
            loadTimeMs: match.loadTimeMs || 0,
            error: match.error || '',
          });
        }
      }
    }

    if (videoHistory.length === 0) {
      body.innerHTML = '<p style="color:var(--color-text-muted)">No historical data for this video yet. History is recorded after each check run.</p>';
      return;
    }

    // Calculate uptime for this video
    const totalChecks = videoHistory.length;
    const passedChecks = videoHistory.filter(v => v.status === KL.STATUS.PASS).length;
    const uptime = totalChecks > 0 ? (passedChecks / totalChecks * 100).toFixed(1) : 'N/A';

    // Build a mini timeline SVG
    const timelineWidth = 600;
    const cellWidth = Math.min(Math.floor(timelineWidth / videoHistory.length), 20);
    const timelineSvg = videoHistory.map((v, i) => {
      const color = v.status === KL.STATUS.PASS ? 'var(--color-pass)' : v.status === KL.STATUS.FAIL ? 'var(--color-fail)' : 'var(--color-timeout)';
      return `<rect x="${i * cellWidth}" y="0" width="${Math.max(cellWidth - 1, 2)}" height="20" rx="2" fill="${color}" opacity="0.85"><title>${new Date(v.timestamp).toLocaleDateString()} - ${v.status}</title></rect>`;
    }).join('');

    const listHtml = videoHistory.slice().reverse().map(v => {
      const date = new Date(v.timestamp);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const loadTime = v.loadTimeMs ? (v.loadTimeMs / 1000).toFixed(1) + 's' : '-';
      return `<li>
        <span class="vh-date">${dateStr} ${timeStr}</span>
        <span class="vh-status status-${v.status}">${v.status}</span>
        <span class="vh-load">${loadTime}</span>
        ${v.error ? `<span style="color:var(--color-text-light);font-size:0.75rem">${escHtml(v.error).substring(0, 60)}</span>` : ''}
      </li>`;
    }).join('');

    body.innerHTML = `
      <div style="margin-bottom:16px;display:flex;gap:20px;font-size:0.85rem">
        <div><strong>Total checks:</strong> ${totalChecks}</div>
        <div><strong>Uptime:</strong> ${uptime}%</div>
        <div><strong>Passed:</strong> ${passedChecks}/${totalChecks}</div>
      </div>
      <div class="video-history-chart" style="overflow-x:auto">
        <svg width="${videoHistory.length * cellWidth}" height="20" viewBox="0 0 ${videoHistory.length * cellWidth} 20">${timelineSvg}</svg>
      </div>
      <h4 style="font-size:0.88rem;margin-bottom:8px">Check History</h4>
      <ul class="video-history-list">${listHtml}</ul>
    `;
  } catch {
    body.innerHTML = '<p style="color:var(--color-fail)">Failed to load history.</p>';
  }
}

function closeVideoDetail() {
  document.getElementById('video-detail-modal').style.display = 'none';
}

// ====================================================================
// FEATURE 5: Favorites / Watch List
// ====================================================================
const WATCHLIST_KEY = 'kl-watchlist';

function getWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
  } catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function toggleWatchlist(title) {
  let list = getWatchlist();
  if (list.includes(title)) {
    list = list.filter(t => t !== title);
  } else {
    list.push(title);
  }
  saveWatchlist(list);
  renderWatchlist();
  // Update star buttons in table
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.toggle('starred', list.includes(btn.dataset.title));
    btn.textContent = list.includes(btn.dataset.title) ? '\u2605' : '\u2606';
  });
}

function renderWatchlist() {
  const section = document.getElementById('watchlist-section');
  if (!section) return;
  const list = getWatchlist();

  if (list.length === 0 && state.results.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Show section if there are favorites or we have results
  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }

  const items = list.map(title => {
    const result = state.results.find(r => r.title === title);
    const status = result ? result.status : 'unknown';
    return `<div class="watchlist-item">
      <span class="wl-status status-${status}"></span>
      <span class="wl-title" onclick="showVideoDetail('${escHtml(title).replace(/'/g, "\\'")}')" style="cursor:pointer">${escHtml(title)}</span>
      <button class="wl-remove" onclick="event.stopPropagation();toggleWatchlist('${escHtml(title).replace(/'/g, "\\'")}')" title="Remove from watchlist">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>`;
  }).join('');

  section.innerHTML = `
    <div class="watchlist-header">
      <h3>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        Watchlist
      </h3>
    </div>
    <div class="watchlist-items">${items}</div>
  `;
  section.style.display = 'block';
}

// ====================================================================
// FEATURE 6: Sound Notification
// ====================================================================
const SOUND_KEY = 'kl-sound-enabled';
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false'; // default on

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled);
  updateSoundUI();
}

function updateSoundUI() {
  const btn = document.getElementById('sound-toggle');
  if (btn) {
    btn.classList.toggle('sound-enabled', soundEnabled);
    btn.title = soundEnabled ? 'Sound notifications: ON' : 'Sound notifications: OFF';
  }
}

function playNotificationSound(success) {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.15;

    if (success) {
      // Success: ascending two-tone chime
      osc.frequency.value = 523; // C5
      osc.type = 'sine';
      osc.start(ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15); // E5
      gain.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
    } else {
      // Failure: descending two-tone
      osc.frequency.value = 440; // A4
      osc.type = 'triangle';
      osc.start(ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.2); // E4
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.6);
    }
  } catch {}
}

// ====================================================================
// FEATURE 9: Bulk Recheck by Section
// ====================================================================
function updateSectionRecheckDropdown() {
  const select = document.getElementById('section-recheck-select');
  if (!select) return;

  const sections = Object.keys(state.sectionMap);
  if (sections.length === 0 || state.status !== 'complete') {
    select.style.display = 'none';
    return;
  }

  select.innerHTML = '<option value="">Re-check a section...</option>';

  // Failed sections first
  for (const key of sections) {
    const s = state.sectionMap[key];
    const failCount = (s.failed || 0) + (s.timeout || 0);
    if (failCount > 0) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${s.section} (${s.page}) — ${failCount} failed`;
      select.appendChild(opt);
    }
  }

  // Then all-passed sections
  for (const key of sections) {
    const s = state.sectionMap[key];
    const failCount = (s.failed || 0) + (s.timeout || 0);
    if (failCount === 0) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${s.section} (${s.page}) — ${s.total} videos`;
      select.appendChild(opt);
    }
  }

  select.style.display = 'inline-flex';
  select.onchange = () => {
    if (select.value) recheckSection(select.value);
    select.value = '';
  };
}

function recheckSection(sectionKey) {
  const sectionVideos = state.results.filter(r => `${r.page} - ${r.section}` === sectionKey);
  if (sectionVideos.length === 0) return;

  // Store section titles for recheck, then open credentials modal
  window._sectionRecheckTitles = sectionVideos.map(r => r.title);
  openCredentialsModal();
}

// ====================================================================
// FEATURE 10: Check Comparison View
// ====================================================================
let comparisonHistory = [];

async function loadComparisonData() {
  try {
    const url = isLocal ? '/api/history' : '/api/get-report?file=history.json';
    const res = await fetch(url);
    if (!res.ok) return;
    comparisonHistory = await res.json();
  } catch { comparisonHistory = []; }
}

function renderComparisonSection() {
  const section = document.getElementById('comparison-section');
  if (!section || comparisonHistory.length < 2) {
    if (section) section.style.display = 'none';
    return;
  }

  const options = comparisonHistory.map((h, i) => {
    const date = new Date(h.timestamp);
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `<option value="${i}">${label} (${h.passed || 0}/${h.total || 0})</option>`;
  }).join('');

  section.innerHTML = `
    <div class="comparison-header">
      <h3>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"></path><path d="M8 3H3v5"></path><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"></path><path d="m15 9 6-6"></path></svg>
        Compare Check Runs
      </h3>
      <div class="comparison-selects">
        <select id="comp-run-a">${options}</select>
        <span style="font-size:0.85rem;color:var(--color-text-muted)">vs</span>
        <select id="comp-run-b">${options}</select>
        <button class="btn-outline" onclick="runComparison()" style="padding:6px 14px;font-size:0.82rem">Compare</button>
      </div>
    </div>
    <div id="comparison-results"></div>
  `;

  // Default: compare last two
  document.getElementById('comp-run-a').value = comparisonHistory.length - 2;
  document.getElementById('comp-run-b').value = comparisonHistory.length - 1;

  section.style.display = 'block';
}

function runComparison() {
  const idxA = parseInt(document.getElementById('comp-run-a').value);
  const idxB = parseInt(document.getElementById('comp-run-b').value);
  const runA = comparisonHistory[idxA];
  const runB = comparisonHistory[idxB];
  const resultsEl = document.getElementById('comparison-results');

  if (!runA || !runB || !runA.videos || !runB.videos) {
    resultsEl.innerHTML = '<p style="color:var(--color-text-muted)">Selected runs don\'t have per-video data. Run a new check to populate this.</p>';
    return;
  }

  const dateA = new Date(runA.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const dateB = new Date(runB.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const mapA = {};
  for (const v of runA.videos) mapA[v.title] = v;
  const mapB = {};
  for (const v of runB.videos) mapB[v.title] = v;

  const allTitles = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])];
  const changes = [];
  for (const title of allTitles) {
    const a = mapA[title];
    const b = mapB[title];
    if (!a || !b) {
      changes.push({ title, statusA: a ? a.status : 'N/A', statusB: b ? b.status : 'N/A', changed: true });
    } else if (a.status !== b.status) {
      changes.push({ title, statusA: a.status, statusB: b.status, changed: true });
    }
  }

  if (changes.length === 0) {
    resultsEl.innerHTML = '<p style="color:var(--color-pass);margin-top:12px">No differences between these two runs.</p>';
    return;
  }

  const rows = changes.map(c => {
    const colorA = c.statusA === KL.STATUS.PASS ? 'var(--color-pass)' : c.statusA === KL.STATUS.FAIL ? 'var(--color-fail)' : c.statusA === KL.STATUS.TIMEOUT ? 'var(--color-timeout)' : 'var(--color-text-light)';
    const colorB = c.statusB === KL.STATUS.PASS ? 'var(--color-pass)' : c.statusB === KL.STATUS.FAIL ? 'var(--color-fail)' : c.statusB === KL.STATUS.TIMEOUT ? 'var(--color-timeout)' : 'var(--color-text-light)';
    return `<tr class="${c.changed ? 'comp-changed' : ''}">
      <td>${escHtml(c.title)}</td>
      <td style="color:${colorA};font-weight:600">${c.statusA}</td>
      <td><span class="comp-arrow">&rarr;</span></td>
      <td style="color:${colorB};font-weight:600">${c.statusB}</td>
    </tr>`;
  }).join('');

  resultsEl.innerHTML = `
    <p style="font-size:0.85rem;color:var(--color-text-muted);margin:12px 0 8px">${changes.length} difference${changes.length !== 1 ? 's' : ''} found</p>
    <table class="comparison-table">
      <thead><tr><th>Video</th><th>${dateA}</th><th></th><th>${dateB}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function closeComparisonModal() {
  document.getElementById('comparison-modal').style.display = 'none';
}

// ====================================================================
// FEATURE 11: Shareable HTML Report
// ====================================================================
function downloadShareableReport() {
  if (isLocal) {
    window.location.href = '/api/share-report';
  } else {
    // Generate client-side for cloud mode
    generateClientSideReport();
  }
}

function generateClientSideReport() {
  const results = state.results;
  if (!results.length) { alert('No results to share.'); return; }
  const total = results.length;
  const passed = state.passedCount;
  const failed = state.failedCount;
  const timeouts = state.timeoutCount;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const timestamp = new Date().toLocaleString();

  const rows = results.map(r => {
    const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
    const statusColor = r.status === KL.STATUS.PASS ? '#22c55e' : r.status === KL.STATUS.FAIL ? '#ef4444' : '#f59e0b';
    return `<tr><td>${r.number}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.section || '')}</td><td>${r.page || ''}</td><td style="color:${statusColor};font-weight:600">${r.status}</td><td>${loadTime}</td><td style="color:#888;font-size:0.85em">${escHtml(r.error || '-')}</td></tr>`;
  }).join('');

  const rateColor = rate >= 100 ? '#22c55e' : rate >= 90 ? '#f59e0b' : '#ef4444';

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingdomland Video Report</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f3fa;color:#080331;line-height:1.5;padding:24px}
.container{max-width:1200px;margin:0 auto}.header{background:linear-gradient(135deg,#4c6bcd,#080331);color:white;padding:24px 32px;border-radius:12px;margin-bottom:24px}
.header h1{font-size:1.4rem;margin-bottom:4px}.header p{opacity:0.8;font-size:0.9rem}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.card{background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.card-label{font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:#555;margin-bottom:4px}.card-value{font-size:1.8rem;font-weight:700}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
th{background:#f8f9fc;text-align:left;padding:10px 14px;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.03em;color:#555;border-bottom:1px solid #e2e6f8}
td{padding:10px 14px;border-bottom:1px solid #f0f2f8;font-size:0.88rem}tr:hover{background:#f8f9fc}
.footer{text-align:center;padding:20px;color:#888;font-size:0.8rem;margin-top:24px}
@media(max-width:768px){.cards{grid-template-columns:repeat(2,1fr)}}</style></head><body><div class="container">
<div class="header"><h1>Kingdomland Video Checker Report</h1><p>go.kingdomlandkids.com &middot; ${escHtml(timestamp)}</p></div>
<div class="cards">
<div class="card"><div class="card-label">Total</div><div class="card-value">${total}</div></div>
<div class="card"><div class="card-label">Passed</div><div class="card-value" style="color:#22c55e">${passed}</div></div>
<div class="card"><div class="card-label">Failed</div><div class="card-value" style="color:#ef4444">${failed}</div></div>
<div class="card"><div class="card-label">Timed Out</div><div class="card-value" style="color:#f59e0b">${timeouts}</div></div>
</div>
<div style="margin-bottom:24px"><div style="font-size:0.9rem;margin-bottom:6px">Pass Rate: <strong>${rate}%</strong></div>
<div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden"><div style="height:100%;width:${rate}%;background:${rateColor};border-radius:4px"></div></div></div>
<table><thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Load Time</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Generated by Kingdomland Video Checker</div></div></body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `video-report-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ====================================================================
// FEATURE 13: Video Thumbnail Previews (screenshot in table)
// ====================================================================
// Screenshots are already shown in the detail/expanded row.
// This adds a small camera icon to rows that have screenshots.
function getScreenshotForVideo(result) {
  if (result.screenshot) return result.screenshot;
  // Try to find a matching screenshot file
  const safeName = (result.title || '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  return null; // screenshots are set by check-videos.js, we just render them
}

// ====================================================================
// FEATURE 14: Response Time Heatmap
// ====================================================================
function renderHeatmap() {
  const section = document.getElementById('heatmap-section');
  if (!section || state.results.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  const results = state.results.filter(r => r.loadTimeMs && r.loadTimeMs > 0);
  if (results.length === 0) { section.style.display = 'none'; return; }

  // Color scale based on load time
  const getColor = (ms) => {
    if (ms < 2000) return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }; // fast green
    if (ms < 4000) return { bg: '#fef9c3', text: '#854d0e', border: '#fef08a' }; // medium yellow
    if (ms < 8000) return { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' }; // slow orange
    return { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' }; // very slow red
  };

  // Dark mode color scale
  const getDarkColor = (ms) => {
    if (ms < 2000) return { bg: '#14532d', text: '#86efac', border: '#166534' };
    if (ms < 4000) return { bg: '#422006', text: '#fde047', border: '#854d0e' };
    if (ms < 8000) return { bg: '#431407', text: '#fb923c', border: '#9a3412' };
    return { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' };
  };

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const cells = results.map(r => {
    const colors = isDark ? getDarkColor(r.loadTimeMs) : getColor(r.loadTimeMs);
    const loadTime = (r.loadTimeMs / 1000).toFixed(1) + 's';
    const titleShort = r.title.length > 18 ? r.title.substring(0, 16) + '...' : r.title;
    return `<div class="heatmap-cell" style="background:${colors.bg};color:${colors.text};border:1px solid ${colors.border}"
      onclick="showVideoDetail('${escHtml(r.title).replace(/'/g, "\\'")}')" title="${escHtml(r.title)} - ${loadTime}">
      <div class="heatmap-cell-title">${escHtml(titleShort)}</div>
      <div class="heatmap-cell-time">${loadTime}</div>
    </div>`;
  }).join('');

  section.innerHTML = `
    <div class="heatmap-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      Response Time Heatmap
    </div>
    <div class="heatmap-grid">${cells}</div>
    <div class="heatmap-legend">
      <span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#22c55e"></span> Fast (&lt;2s)</span>
      <span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#eab308"></span> Medium (2-4s)</span>
      <span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#f97316"></span> Slow (4-8s)</span>
      <span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#ef4444"></span> Very Slow (&gt;8s)</span>
    </div>
  `;
  section.style.display = 'block';
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

