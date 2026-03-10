// Auto-Refresh Dashboard
window.KL = window.KL || {};

KL.autoRefreshTimer = null;
KL.autoRefreshEnabled = true;
KL.lastKnownTimestamp = null;

KL.startAutoRefresh = function() {
  if (KL.autoRefreshTimer) clearInterval(KL.autoRefreshTimer);
  KL.autoRefreshTimer = setInterval(KL.checkForNewResults, 5 * 60 * 1000);
  KL.updateAutoRefreshUI();
};

window.toggleAutoRefresh = function() {
  KL.autoRefreshEnabled = !KL.autoRefreshEnabled;
  if (KL.autoRefreshEnabled) {
    KL.startAutoRefresh();
  } else {
    if (KL.autoRefreshTimer) { clearInterval(KL.autoRefreshTimer); KL.autoRefreshTimer = null; }
  }
  KL.updateAutoRefreshUI();
};

KL.updateAutoRefreshUI = function() {
  var bar = document.getElementById('auto-refresh-bar');
  var text = document.getElementById('auto-refresh-text');
  if (!bar) return;
  if (KL.autoRefreshEnabled && KL.state.status !== 'running') {
    bar.style.display = 'flex';
    text.textContent = 'Auto-refresh active \u2014 checking for new results every 5 minutes';
  } else {
    bar.style.display = 'none';
  }
};

KL.checkForNewResults = async function() {
  if (KL.state.status === 'running' || !KL.autoRefreshEnabled) return;
  try {
    var res = await fetch('/api/report-timestamp');
    if (!res.ok) return;
    var data = await res.json();
    if (data.status === 'running') {
      KL.state.status = 'running';
      KL.updateRunButtons();
      KL.showProgress();
      if (KL.isLocal) KL.connectSSE(); else KL.startPolling();
      return;
    }
    if (data.timestamp && data.timestamp !== KL.lastKnownTimestamp) {
      if (KL.lastKnownTimestamp !== null) {
        if (KL.isLocal) await KL.loadPreviousReport(); else await KL.loadCloudReport();
      }
      KL.lastKnownTimestamp = data.timestamp;
    }
  } catch (e) {}
};
