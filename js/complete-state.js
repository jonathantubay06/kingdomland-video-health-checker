// Complete state — renderComplete, renderCompleteFromState, loadPreviousReport
window.KL = window.KL || {};

KL.renderComplete = function(summary, allResults) {
  KL.state.status = 'complete';
  KL.state.results = allResults;
  KL.state.totalDiscovered = summary.total;
  KL.state.checkedCount = summary.total;
  KL.state.passedCount = summary.passed;
  KL.state.failedCount = summary.failed;
  KL.state.timeoutCount = summary.timeouts;

  KL.updateRunButtons();
  KL.updateSummaryCards();
  KL.hideProgress();

  ['login', 'discovery', 'checking'].forEach(function(p) {
    var el = document.getElementById('phase-' + p);
    el.classList.remove('active');
    el.classList.add('done');
  });

  KL.state.sectionMap = {};
  for (var i = 0; i < allResults.length; i++) {
    var r = allResults[i];
    var secKey = r.page + ' - ' + (r.section || 'Unknown');
    if (!KL.state.sectionMap[secKey]) KL.state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
    KL.state.sectionMap[secKey].total++;
    if (r.status === KL.STATUS.PASS) KL.state.sectionMap[secKey].passed++;
    else if (r.status === KL.STATUS.FAIL) KL.state.sectionMap[secKey].failed++;
    else KL.state.sectionMap[secKey].timeout++;
  }

  KL.updateSectionBreakdown();
  KL.updateSectionFilterOptions();
  KL.renderResultsTable();

  document.getElementById('results-section').classList.add('visible');
  document.getElementById('section-breakdown').classList.add('visible');
  document.getElementById('download-section').classList.add('visible');
  document.getElementById('empty-state').style.display = 'none';

  KL.appendLog('Check complete! ' + summary.passed + '/' + summary.total + ' passed, ' + summary.failed + ' failed, ' + summary.timeouts + ' timed out.');

  // Features triggered on complete
  KL.updateHealthSummary();
  KL.updateLastChecked();
  KL.updateHealthBadge();
  KL.updateAvgResponseTime();
  KL.loadAndShowDiffReport();
  KL.loadAndShowTrendChart();

  KL.lastKnownTimestamp = KL.state.reportTimestamp || new Date().toISOString();
  KL.startAutoRefresh();

  KL.updateUptimeTracking();
  KL.renderWatchlist();

  var hasFailures = KL.state.failedCount > 0 || KL.state.timeoutCount > 0;
  KL.playNotificationSound(!hasFailures);

  KL.updateSectionRecheckDropdown();
  KL.loadComparisonData().then(function() { KL.renderComparisonSection(); });
  KL.renderHeatmap();
  KL.notifyWebhook();
};

KL.renderCompleteFromState = function() {
  var summary = {
    total: KL.state.results.length,
    passed: KL.state.passedCount,
    failed: KL.state.failedCount,
    timeouts: KL.state.timeoutCount,
  };
  KL.renderComplete(summary, KL.state.results);
};

KL.loadPreviousReport = async function() {
  try {
    var res = await fetch('/api/report');
    if (!res.ok) return;
    var report = await res.json();
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
  } catch (e) {
    console.error('Failed to load report:', e);
  }
};
