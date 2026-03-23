// Init — DOMContentLoaded handler
window.KL = window.KL || {};

// ============== Intro Overlay ==============
// Shows once per browser session. The inline <script> in index.html hides it
// immediately on repeat loads (no flash). Here we wire up dismiss logic.
(function() {
  var overlay = document.getElementById('intro-overlay');
  if (!overlay || overlay.style.display === 'none') return;

  function dismiss() {
    sessionStorage.setItem('kl-intro-seen', '1');
    if (countdownTimer) clearInterval(countdownTimer);
    overlay.classList.add('dismissing');
    overlay.addEventListener('animationend', function() {
      overlay.style.display = 'none';
    }, { once: true });
  }

  var enterBtn = document.getElementById('intro-enter-btn');
  if (enterBtn) enterBtn.addEventListener('click', dismiss);

  // Auto-dismiss with countdown
  var secs = 4;
  var countdownEl = document.getElementById('intro-countdown');
  var countdownTimer = setInterval(function() {
    secs--;
    if (countdownEl) countdownEl.textContent = secs;
    if (secs <= 0) { clearInterval(countdownTimer); dismiss(); }
  }, 1000);
})();

// ============== Keyboard Shortcuts ==============
// R = Run Check, / = focus search, Esc = close modals
document.addEventListener('keydown', function(e) {
  var tag = document.activeElement && document.activeElement.tagName;
  // When typing in an input, only handle Escape (to blur)
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (!e.ctrlKey && !e.metaKey && KL.state.status !== 'running') {
      e.preventDefault();
      if (window.startRun) startRun();
    }
  } else if (e.key === '/') {
    e.preventDefault();
    var search = document.getElementById('filter-search');
    if (search) { search.focus(); search.select(); }
  } else if (e.key === '?') {
    var sm = document.getElementById('shortcuts-modal');
    if (sm) { sm.style.display = sm.style.display === 'flex' ? 'none' : 'flex'; }
  } else if (e.key === 'Escape') {
    // Close any open modal
    ['progress-modal', 'credentials-modal', 'video-detail-modal', 'comparison-modal', 'shortcuts-modal'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && (el.classList.contains('open') || el.style.display === 'flex')) {
        el.classList.remove('open');
        el.style.display = 'none';
      }
    });
    var lb = document.getElementById('screenshot-lightbox');
    if (lb) lb.style.display = 'none';
  }
});

// Entry point — runs on every page load.
// Detects local vs cloud mode by probing /api/status (only exists on local server.js).
// Local mode: connects to server.js via SSE (/api/events) for live progress.
// Cloud mode: uses Netlify Functions (/api/*) and polls GitHub Actions for run status.
window.addEventListener('DOMContentLoaded', async function() {
  // ---- Scroll-triggered floating buttons ----
  window.addEventListener('scroll', function() {
    var scrolled = window.scrollY > 400;
    var backBtn = document.getElementById('back-to-top-btn');
    if (backBtn) backBtn.style.display = scrolled ? 'flex' : 'none';

    var jumpBtn = document.getElementById('jump-failures-btn');
    if (jumpBtn) {
      var hasFails = KL.state && (KL.state.failedCount > 0 || KL.state.timeoutCount > 0);
      jumpBtn.style.display = (hasFails && window.scrollY > 200) ? 'inline-flex' : 'none';
    }
  }, { passive: true });

  window.jumpToFirstFailure = function() {
    var first = document.querySelector('tbody tr.row-fail, tbody tr.row-timeout');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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
