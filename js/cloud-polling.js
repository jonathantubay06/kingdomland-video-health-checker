// Cloud mode — polling, progress modal, cloud report loading
window.KL = window.KL || {};

KL.showCloudProgress = function(message, startedAt) {
  var section = document.getElementById('progress-section');
  section.classList.add('visible');
  document.getElementById('phase-login').classList.add('active');
  document.getElementById('progress-bar').style.width = '100%';
  document.getElementById('progress-bar').style.animation = 'pulse 2s ease-in-out infinite';
  document.getElementById('progress-percent').textContent = '';
  document.getElementById('progress-text').textContent = message;
  document.getElementById('current-video').textContent = startedAt
    ? 'Started at ' + new Date(startedAt).toLocaleTimeString()
    : 'Waiting for GitHub Actions to pick up the job...';
  document.getElementById('view-progress-btn').style.display = 'inline-flex';
};

KL.startPolling = function() {
  if (KL.pollTimer) clearInterval(KL.pollTimer);
  KL.pollTimer = setInterval(KL.pollCloudStatus, 15000);
};

KL.pollCloudStatus = async function() {
  try {
    var url = KL.ghRunId ? '/api/check-status?runId=' + KL.ghRunId : '/api/check-status';
    var res = await KL.apiFetch(url);
    if (!res.ok) return;
    var data = await res.json();
    if (data.status === 'in_progress') {
      KL.showCloudProgress('Video check is running on GitHub Actions...', data.startedAt);
      ['login', 'discovery', 'checking'].forEach(function(p) {
        document.getElementById('phase-' + p).classList.remove('active', 'done');
      });
      document.getElementById('phase-login').classList.add('done');
      document.getElementById('phase-discovery').classList.add('active');
    } else if (data.status === 'completed') {
      clearInterval(KL.pollTimer);
      KL.pollTimer = null;
      if (data.conclusion === 'success') {
        document.getElementById('progress-text').textContent = 'Check complete! Loading report...';
        await KL.loadCloudReport();
      } else {
        KL.state.status = 'idle';
        KL.updateRunButtons();
        document.getElementById('progress-section').classList.remove('visible');
        alert('Check finished with status: ' + data.conclusion + '. Check GitHub Actions for details.');
      }
      // Resume watching for the next run
      KL.restartRunWatcherAfterRun && KL.restartRunWatcherAfterRun();
    }
  } catch (e) {
    console.error('Polling error:', e);
  }
};

// localStorage cache keys — 5-min TTL so repeat page loads feel instant
var KL_CACHE_KEY = 'kl_report_cache';
var KL_CACHE_TTL = 5 * 60 * 1000;

KL._saveReportCache = function(report) {
  try { localStorage.setItem(KL_CACHE_KEY, JSON.stringify({ data: report, ts: Date.now() })); } catch(e) {}
};

KL._loadReportCache = function() {
  try {
    var raw = localStorage.getItem(KL_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > KL_CACHE_TTL) { localStorage.removeItem(KL_CACHE_KEY); return null; }
    return parsed.data;
  } catch(e) { return null; }
};

KL._clearReportCache = function() {
  try { localStorage.removeItem(KL_CACHE_KEY); } catch(e) {}
};

KL.loadCloudReport = async function() {
  // Show skeleton loaders on summary cards while fetching
  ['stat-total', 'stat-passed', 'stat-failed', 'stat-timeout'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('skeleton');
  });

  var report = null;

  // 1. Try localStorage cache first — instant load on repeat page visits
  var cached = KL._loadReportCache();
  if (cached && cached.allResults && cached.allResults.length > 0) {
    report = cached;
  } else {
    // 2. Fetch from Netlify; fall back to previous-report.json if current is empty
    var filesToTry = ['video-report.json', 'previous-report.json'];
    for (var fi = 0; fi < filesToTry.length; fi++) {
      try {
        var res = await KL.apiFetch('/api/get-report?file=' + filesToTry[fi]);
        if (!res.ok) continue;
        var text = await res.text();
        if (!text || !text.trim()) continue;
        var parsed = JSON.parse(text);
        if (parsed && parsed.allResults && parsed.allResults.length > 0) {
          report = parsed;
          if (filesToTry[fi] === 'previous-report.json') report._stale = true;
          // Cache fresh (non-stale) reports for next visit
          if (!report._stale) KL._saveReportCache(report);
          break;
        }
      } catch(e) {}
    }
  }

  // Remove skeletons regardless of outcome
  ['stat-total', 'stat-passed', 'stat-failed', 'stat-timeout'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('skeleton');
  });

  if (!report) return;

  KL.state.reportStale = report._stale || false;
  KL.state.results = report.allResults || [];
  if (report.summary) {
    KL.state.passedCount = report.summary.passed || 0;
    KL.state.failedCount = report.summary.failed || 0;
    KL.state.timeoutCount = report.summary.timeouts || 0;
  } else {
    KL.state.passedCount = KL.state.results.filter(function(r) { return r.status === KL.STATUS.PASS; }).length;
    KL.state.failedCount = KL.state.results.filter(function(r) { return r.status === KL.STATUS.FAIL; }).length;
    KL.state.timeoutCount = KL.state.results.filter(function(r) { return r.status === KL.STATUS.TIMEOUT; }).length;
  }
  KL.state.totalDiscovered = KL.state.results.length;
  KL.state.checkedCount = KL.state.results.length;
  KL.state.status = 'complete';
  KL.state.reportTimestamp = report.timestamp || null;

  KL.state.sectionMap = {};
  for (var i = 0; i < KL.state.results.length; i++) {
    var r = KL.state.results[i];
    var secKey = r.page + ' - ' + (r.section || 'Unknown');
    if (!KL.state.sectionMap[secKey]) KL.state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
    KL.state.sectionMap[secKey].total++;
    if (r.status === KL.STATUS.PASS) KL.state.sectionMap[secKey].passed++;
    else if (r.status === KL.STATUS.FAIL) KL.state.sectionMap[secKey].failed++;
    else KL.state.sectionMap[secKey].timeout++;
  }

  KL.renderCompleteFromState();
};

window.openProgressModal = function() {
  if (!KL.ghRunId) return;
  document.getElementById('progress-modal').classList.add('open');
  KL.fetchProgress();
  if (KL.progressTimer) clearInterval(KL.progressTimer);
  KL.progressTimer = setInterval(KL.fetchProgress, 10000);
};

window.closeProgressModal = function() {
  document.getElementById('progress-modal').classList.remove('open');
  if (KL.progressTimer) { clearInterval(KL.progressTimer); KL.progressTimer = null; }
};

KL.fetchProgress = async function() {
  if (!KL.ghRunId) return;
  try {
    var res = await KL.apiFetch('/api/get-progress?runId=' + KL.ghRunId);
    if (!res.ok) return;
    var data = await res.json();
    var stepsEl = document.getElementById('modal-steps');
    if (data.steps && data.steps.length > 0) {
      stepsEl.innerHTML = data.steps.map(function(s) {
        var icon = '\u23F3';
        if (s.status === 'completed' && s.conclusion === 'success') icon = '\u2705';
        else if (s.status === 'completed' && s.conclusion === 'failure') icon = '\u274C';
        else if (s.status === 'completed' && s.conclusion === 'skipped') icon = '\u23ED\uFE0F';
        else if (s.status === 'in_progress') icon = '\uD83D\uDD04';
        var activeClass = s.status === 'in_progress' ? ' active' : '';
        return '<div class="modal-step"><span class="step-icon">' + icon + '</span><span class="step-name' + activeClass + '">' + KL.escHtml(s.name) + '</span></div>';
      }).join('');
    }
    var logEl = document.getElementById('modal-log');
    if (data.log) {
      logEl.textContent = data.log;
      logEl.scrollTop = logEl.scrollHeight;
    } else if (data.status === 'waiting') {
      logEl.textContent = 'Waiting for GitHub Actions to start...';
    }
    if (data.status === 'completed') {
      if (KL.progressTimer) { clearInterval(KL.progressTimer); KL.progressTimer = null; }
    }
  } catch (e) {
    console.error('Progress fetch error:', e);
  }
};
