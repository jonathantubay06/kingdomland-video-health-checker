// Re-check Failed Only
window.KL = window.KL || {};

window.recheckFailed = function() {
  KL.openCredentialsModal();
};

KL.recheckFailedWithCreds = async function(email, password, customTitles) {
  var titles;
  if (customTitles && customTitles.length > 0) {
    titles = customTitles;
  } else {
    var failedResults = KL.state.results.filter(function(r) { return r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT; });
    if (failedResults.length === 0) {
      alert('No failed videos to re-check.');
      return;
    }
    titles = failedResults.map(function(r) { return r.title; });
  }

  if (KL.isLocal) {
    try {
      var res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: KL.state.mode, failedOnly: true, titles: titles, email: email, password: password }),
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
      alert('Failed to start re-check: ' + e.message);
    }
  } else {
    try {
      var res = await fetch('/api/trigger-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: KL.state.mode, failedOnly: true, titles: titles, email: email, password: password }),
      });
      var data = await res.json();
      if (data.error) {
        alert('Failed to trigger re-check: ' + data.error);
        return;
      }
      KL.ghRunId = data.runId;
      KL.resetState();
      KL.updateRunButtons();
      KL.hideEmpty();
      KL.showCloudProgress('Re-checking failed videos on GitHub Actions...');
      KL.startPolling();
    } catch (e) {
      alert('Failed to trigger re-check: ' + e.message);
    }
  }
};

KL.updateRecheckButton = function() {
  var container = document.getElementById('recheck-actions');
  if (!container) return;
  var failedCount = KL.state.results.filter(function(r) { return r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT; }).length;

  if (KL.state.results.length > 0 && KL.state.status === 'complete') {
    container.style.display = 'flex';
    var recheckBtn = container.querySelector('.btn-recheck');
    if (recheckBtn) {
      recheckBtn.style.display = failedCount > 0 ? 'inline-flex' : 'none';
    }
    var countEl = document.getElementById('recheck-count');
    if (countEl) countEl.textContent = failedCount;
  } else {
    container.style.display = 'none';
  }
};
