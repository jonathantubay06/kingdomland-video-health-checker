// Auto-Refresh Dashboard
window.KL = window.KL || {};

KL.autoRefreshTimer = null;
KL.autoRefreshEnabled = true;
KL.lastKnownTimestamp = null;

// ---- Run watcher: polls every 30s for active GH Actions runs ----
KL.runWatcherTimer = null;
KL.runWatcherLastChecked = null;
KL.runWatcherTickTimer = null;

KL.startRunWatcher = function() {
  if (KL.isLocal) return; // local mode uses SSE, no need
  if (KL.runWatcherTimer) clearInterval(KL.runWatcherTimer);
  KL.runWatcherTimer = setInterval(KL.runWatcherTick, 30 * 1000);
  KL.runWatcherTick(); // immediate first check
  KL._startWatcherClock();
};

KL.stopRunWatcher = function() {
  if (KL.runWatcherTimer) { clearInterval(KL.runWatcherTimer); KL.runWatcherTimer = null; }
  KL._stopWatcherClock();
};

KL.runWatcherTick = async function() {
  if (KL.state.status === 'running') return; // already tracking a run
  try {
    var res = await KL.apiFetch('/api/check-status');
    if (!res.ok) return;
    var data = await res.json();
    KL.runWatcherLastChecked = Date.now();
    KL._updateWatcherBar();

    if (data.status === 'in_progress' || data.status === 'queued') {
      // A run just started \u2014 switch to running state automatically
      KL.ghRunId = data.runId;
      KL.state.status = 'running';
      KL.updateRunButtons();
      KL.showCloudProgress('Video check is running on GitHub Actions...', data.startedAt);
      KL.stopRunWatcher(); // hand off to pollCloudStatus
      KL.startPolling();
    } else if (data.status === 'completed') {
      // Run finished since last visit \u2014 reload report if timestamp changed
      if (data.completedAt && data.completedAt !== KL.lastKnownTimestamp) {
        if (KL.lastKnownTimestamp !== null) {
          KL._clearReportCache && KL._clearReportCache();
          await KL.loadCloudReport();
        }
        KL.lastKnownTimestamp = data.completedAt;
      }
    }
  } catch (e) {}
};

// Restart watcher after a polling run completes
KL.restartRunWatcherAfterRun = function() {
  if (KL.isLocal) return;
  KL.runWatcherLastChecked = Date.now();
  KL.startRunWatcher();
};

// Live "last checked Xs ago" clock in the bar
KL._startWatcherClock = function() {
  if (KL.runWatcherTickTimer) clearInterval(KL.runWatcherTickTimer);
  KL.runWatcherTickTimer = setInterval(KL._updateWatcherBar, 10 * 1000);
};
KL._stopWatcherClock = function() {
  if (KL.runWatcherTickTimer) { clearInterval(KL.runWatcherTickTimer); KL.runWatcherTickTimer = null; }
};
KL._updateWatcherBar = function() {
  var text = document.getElementById('auto-refresh-text');
  if (!text) return;
  var bar = document.getElementById('auto-refresh-bar');
  if (!bar || bar.style.display === 'none') return;
  if (!KL.runWatcherLastChecked) {
    text.innerHTML = '<span class="watcher-dot"></span> Watching for new runs\u2026';
    return;
  }
  var secAgo = Math.round((Date.now() - KL.runWatcherLastChecked) / 1000);
  var agoStr = secAgo < 60 ? secAgo + 's ago' : Math.round(secAgo / 60) + 'm ago';
  text.innerHTML = '<span class="watcher-dot"></span> Watching for new runs \u00b7 checked ' + agoStr;
};

// ---- Existing 5-min report refresh ----

KL.startAutoRefresh = function() {
  if (KL.autoRefreshTimer) clearInterval(KL.autoRefreshTimer);
  KL.autoRefreshTimer = setInterval(KL.checkForNewResults, 5 * 60 * 1000);
  KL.updateAutoRefreshUI();
};

window.toggleAutoRefresh = function() {
  KL.autoRefreshEnabled = !KL.autoRefreshEnabled;
  if (KL.autoRefreshEnabled) {
    KL.startAutoRefresh();
    KL.startRunWatcher();
  } else {
    if (KL.autoRefreshTimer) { clearInterval(KL.autoRefreshTimer); KL.autoRefreshTimer = null; }
    KL.stopRunWatcher();
  }
  KL.updateAutoRefreshUI();
};

KL.updateAutoRefreshUI = function() {
  var bar = document.getElementById('auto-refresh-bar');
  if (!bar) return;
  if (KL.autoRefreshEnabled && KL.state.status !== 'running') {
    bar.style.display = 'flex';
    KL._updateWatcherBar();
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
