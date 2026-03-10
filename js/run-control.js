// Run control — start, stop, credentials modal
window.KL = window.KL || {};

window.startRun = function() {
  KL.openCredentialsModal();
};

KL.openCredentialsModal = function() {
  var modal = document.getElementById('credentials-modal');
  modal.style.display = 'flex';

  if (KL.savedCredentials) {
    document.getElementById('cred-email').value = KL.savedCredentials.email;
    document.getElementById('cred-password').value = KL.savedCredentials.password;
  }

  var failedCount = KL.state.results.filter(function(r) {
    return r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT;
  }).length;
  var recheckBtn = document.getElementById('cred-recheck-btn');
  var recheckCount = document.getElementById('cred-recheck-count');
  if (failedCount > 0) {
    recheckBtn.style.display = 'inline-flex';
    recheckCount.textContent = failedCount;
  } else {
    recheckBtn.style.display = 'none';
  }

  setTimeout(function() {
    var emailInput = document.getElementById('cred-email');
    if (emailInput.value) document.getElementById('cred-password').focus();
    else emailInput.focus();
  }, 100);
};

window.closeCredentialsModal = function() {
  document.getElementById('credentials-modal').style.display = 'none';
};

window.togglePasswordVisibility = function() {
  var input = document.getElementById('cred-password');
  var icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    input.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
};

window.submitCredentials = function(e, failedOnly) {
  e.preventDefault();
  var email = document.getElementById('cred-email').value.trim();
  var password = document.getElementById('cred-password').value;
  var remember = document.getElementById('cred-remember').checked;

  if (!email || !password) {
    if (!email) document.getElementById('cred-email').reportValidity();
    else if (!password) document.getElementById('cred-password').reportValidity();
    return;
  }

  if (remember) {
    KL.savedCredentials = { email: email, password: password };
  }

  closeCredentialsModal();

  if (window._sectionRecheckTitles && window._sectionRecheckTitles.length > 0) {
    var titles = window._sectionRecheckTitles;
    window._sectionRecheckTitles = null;
    KL.recheckFailedWithCreds(email, password, titles);
  } else if (failedOnly) {
    KL.recheckFailedWithCreds(email, password);
  } else if (KL.isLocal) {
    KL.startRunLocal(email, password);
  } else {
    KL.startRunCloud(email, password);
  }
};

KL.startRunLocal = async function(email, password) {
  try {
    var res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: KL.state.mode, email: email, password: password }),
    });
    if (res.status === 409) {
      alert('A check is already running!');
      return;
    }
    KL.resetState();
    KL.updateRunButtons();
    KL.updateSummaryCards();
    KL.showProgress();
    KL.hideEmpty();
    KL.connectSSE();
  } catch (e) {
    alert('Failed to start: ' + e.message);
  }
};

KL.startRunCloud = async function(email, password) {
  try {
    var res = await fetch('/api/trigger-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: KL.state.mode, email: email, password: password }),
    });
    var data = await res.json();
    if (data.error) {
      alert('Failed to trigger: ' + data.error);
      return;
    }
    KL.ghRunId = data.runId;
    KL.resetState();
    KL.updateRunButtons();
    KL.hideEmpty();
    KL.showCloudProgress('Video check triggered! Starting on GitHub Actions...');
    KL.startPolling();
  } catch (e) {
    alert('Failed to trigger check: ' + e.message);
  }
};

KL.resetState = function() {
  KL.state.status = 'running';
  KL.state.phase = 'login';
  KL.state.results = [];
  KL.state.checkedCount = 0;
  KL.state.passedCount = 0;
  KL.state.failedCount = 0;
  KL.state.timeoutCount = 0;
  KL.state.totalDiscovered = 0;
  KL.state.checkStartTime = null;
  KL.state.sectionMap = {};
  document.getElementById('log-entries').innerHTML = '';
  document.getElementById('results-tbody').innerHTML = '';
  document.getElementById('section-grid').innerHTML = '';
  document.getElementById('filter-section').innerHTML = '<option value="all">All Sections</option>';
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
};

window.stopRun = async function() {
  if (KL.isLocal) {
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (e) {
      console.error('Stop failed:', e);
    }
  } else if (KL.ghRunId) {
    if (!confirm('Cancel the running video check?')) return;
    try {
      var res = await fetch('/api/cancel-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: KL.ghRunId }),
      });
      var data = await res.json();
      if (data.status === 'cancelled') {
        KL.state.status = 'idle';
        if (KL.pollTimer) { clearInterval(KL.pollTimer); KL.pollTimer = null; }
        if (KL.progressTimer) { clearInterval(KL.progressTimer); KL.progressTimer = null; }
        KL.updateRunButtons();
        document.getElementById('progress-section').classList.remove('visible');
        closeProgressModal();
        KL.appendLog('Check cancelled.');
      } else {
        alert('Failed to cancel: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Failed to cancel: ' + e.message);
    }
  }
};
