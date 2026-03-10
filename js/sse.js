// Server-Sent Events — connectSSE, handleEvent
window.KL = window.KL || {};

KL.connectSSE = function() {
  if (KL.eventSource) KL.eventSource.close();
  KL.eventSource = new EventSource('/api/events');
  KL.eventSource.onmessage = function(e) {
    try {
      var event = JSON.parse(e.data);
      KL.handleEvent(event);
    } catch (err) {}
  };
  KL.eventSource.onerror = function() {
    if (KL.state.status === 'running') {
      setTimeout(function() { if (KL.state.status === 'running') KL.connectSSE(); }, 3000);
    }
  };
};

KL.handleEvent = function(event) {
  switch (event.type) {
    case 'connected':
      if (event.runStatus === 'running') {
        KL.state.status = 'running';
        KL.updateRunButtons();
        KL.showProgress();
      }
      break;
    case 'status':
      KL.appendLog(event.message);
      if (event.message.includes('Logging in')) KL.setPhase('login');
      else if (event.message.includes('Discovering') || event.message.includes('Scanning carousel') || event.message.includes('Scanning tab') || event.message.includes('Scanning default')) KL.setPhase('discovery');
      break;
    case 'discovery':
      KL.setPhase('discovery');
      KL.updateProgressText('Discovering: ' + event.section + ' (' + event.count + ' in section, ' + event.total + ' total)');
      break;
    case 'discovery-complete':
      KL.state.totalDiscovered += event.total;
      KL.updateStat('stat-total', KL.state.totalDiscovered);
      KL.updateProgressText('Discovery complete for ' + event.page + ': ' + event.total + ' videos found');
      break;
    case 'check':
      KL.setPhase('checking');
      if (!KL.state.checkStartTime) KL.state.checkStartTime = Date.now();
      KL.state.checkedCount++;
      var r = event.result;
      KL.state.results.push(r);
      if (r.status === KL.STATUS.PASS) KL.state.passedCount++;
      else if (r.status === KL.STATUS.FAIL) KL.state.failedCount++;
      else if (r.status === KL.STATUS.TIMEOUT) KL.state.timeoutCount++;
      var secKey = r.page + ' - ' + (r.section || 'Unknown');
      if (!KL.state.sectionMap[secKey]) KL.state.sectionMap[secKey] = { page: r.page, section: r.section || 'Unknown', total: 0, passed: 0, failed: 0, timeout: 0 };
      KL.state.sectionMap[secKey].total++;
      if (r.status === KL.STATUS.PASS) KL.state.sectionMap[secKey].passed++;
      else if (r.status === KL.STATUS.FAIL) KL.state.sectionMap[secKey].failed++;
      else KL.state.sectionMap[secKey].timeout++;
      KL.updateSummaryCards();
      KL.updateCheckProgress(r);
      KL.appendResultRow(r);
      KL.updateSectionBreakdown();
      break;
    case 'complete':
      KL.state.status = 'complete';
      KL.state.results = event.allResults;
      KL.state.passedCount = event.summary.passed;
      KL.state.failedCount = event.summary.failed;
      KL.state.timeoutCount = event.summary.timeouts;
      if (KL.eventSource) KL.eventSource.close();
      KL.renderComplete(event.summary, event.allResults);
      break;
    case 'stopped':
      KL.state.status = 'idle';
      if (KL.eventSource) KL.eventSource.close();
      KL.updateRunButtons();
      KL.hideProgress();
      KL.appendLog('Check cancelled by user.');
      break;
    case 'process-exit':
      if (KL.state.status !== 'complete') {
        KL.state.status = 'complete';
        KL.renderCompleteFromState();
      }
      if (KL.eventSource) KL.eventSource.close();
      break;
    case 'error':
      KL.appendLog('[ERROR] ' + event.message, true);
      break;
  }
};
