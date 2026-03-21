// Init — DOMContentLoaded handler
window.KL = window.KL || {};

// Entry point — runs on every page load.
// Detects local vs cloud mode by probing /api/status (only exists on local server.js).
// Local mode: connects to server.js via SSE (/api/events) for live progress.
// Cloud mode: uses Netlify Functions (/api/*) and polls GitHub Actions for run status.
window.addEventListener('DOMContentLoaded', async function() {
  // Mode selector buttons (Both / Story / Music)
  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      KL.state.mode = btn.dataset.mode;
    });
  });

  // Initialize sound UI
  KL.updateSoundUI();

  // Initialize schedule settings UI (read-only cron info panel)
  if (KL.initScheduleUI) KL.initScheduleUI();

  // Initialize push notifications UI ("not available" state — VAPID keys not configured)
  if (KL.initPushUI) KL.initPushUI();

  // Try local mode first — /api/status only exists when running server.js locally
  try {
    var res = await fetch('/api/status');
    var data = await res.json();
    if (data && typeof data.status === 'string') {
      KL.isLocal = true;
      if (data.status === 'running') {
        // A check is already running — connect to its live SSE stream
        KL.state.status = 'running';
        KL.updateRunButtons();
        KL.showProgress();
        KL.connectSSE();
      } else if (data.hasPreviousReport) {
        // Load the last saved report from disk
        KL.loadPreviousReport();
      }
      return;
    }
  } catch (e) {}

  // Cloud mode — running on Netlify, checks triggered via GitHub Actions
  KL.isLocal = false;
  try {
    // Check if a GitHub Actions run is currently in progress
    var statusRes = await KL.apiFetch('/api/check-status');
    if (statusRes.ok) {
      var ghStatus = await statusRes.json();
      if (ghStatus.status === 'in_progress' || ghStatus.status === 'queued') {
        // Poll GitHub Actions API until the run completes
        KL.ghRunId = ghStatus.runId;
        KL.state.status = 'running';
        KL.updateRunButtons();
        KL.showCloudProgress('Video check is running on GitHub Actions...', ghStatus.startedAt);
        KL.startPolling();
      } else {
        // No active run — load latest report from the data branch
        await KL.loadCloudReport();
      }
    }
  } catch (e) {
    await KL.loadCloudReport();
  }
});
