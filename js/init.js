// Init — DOMContentLoaded handler
window.KL = window.KL || {};

window.addEventListener('DOMContentLoaded', async function() {
  // Mode selector buttons
  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      KL.state.mode = btn.dataset.mode;
    });
  });

  // Initialize sound UI
  KL.updateSoundUI();

  // Try local mode first
  try {
    var res = await fetch('/api/status');
    var data = await res.json();
    if (data && typeof data.status === 'string') {
      KL.isLocal = true;
      if (data.status === 'running') {
        KL.state.status = 'running';
        KL.updateRunButtons();
        KL.showProgress();
        KL.connectSSE();
      } else if (data.hasPreviousReport) {
        KL.loadPreviousReport();
      }
      return;
    }
  } catch (e) {}

  // Cloud mode
  KL.isLocal = false;
  try {
    var statusRes = await fetch('/api/check-status');
    if (statusRes.ok) {
      var ghStatus = await statusRes.json();
      if (ghStatus.status === 'in_progress' || ghStatus.status === 'queued') {
        KL.ghRunId = ghStatus.runId;
        KL.state.status = 'running';
        KL.updateRunButtons();
        KL.showCloudProgress('Video check is running on GitHub Actions...', ghStatus.startedAt);
        KL.startPolling();
      } else {
        await KL.loadCloudReport();
      }
    }
  } catch (e) {
    await KL.loadCloudReport();
  }
});
