// Incident Banner — surfaces outages and recoveries at the top of the
// dashboard (the notification channel for users without Slack/email).
// Outage takes priority; recovery is shown (dismissible) when the latest
// run is healthy but the previous one had failures.
window.KL = window.KL || {};

KL.renderIncidentBanner = function() {
  var container = document.getElementById('incident-banner-container');
  if (!container) return;
  container.innerHTML = '';

  // ---- -1. FATAL ERROR (highest priority — checker crashed before checking anything) ----
  if (KL.state.fatalError) {
    container.innerHTML =
      '<div class="incident-banner incident-outage">' +
        '<div class="incident-icon">🚨</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Checker crashed — no videos were checked</div>' +
          '<div class="incident-detail">' +
            'The checker hit a fatal error before it could check any videos. ' +
            'This run did not update your data — the numbers below are from the last successful check, ' +
            '<strong>not</strong> this run.' +
          '</div>' +
          '<div class="incident-error"><code>' + KL.escHtml(KL.state.fatalError.message || 'Unknown error') + '</code></div>' +
        '</div>' +
      '</div>';
    return;
  }

  // ---- 0. DISCOVERY FAILURE (top priority — checker itself couldn't find videos) ----
  if (KL.state.discoveryFailure) {
    var exp = KL.state.discoveryFailure.expected;
    container.innerHTML =
      '<div class="incident-banner incident-outage">' +
        '<div class="incident-icon">🚨</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Discovery failed — checker found 0 videos</div>' +
          '<div class="incident-detail">' +
            'The checker logged in but found no videos on Home' + (exp ? ' (expected ~' + exp + ')' : '') + '. ' +
            'This is a login or site-structure problem, <strong>not</strong> a video-playback outage — the checker likely needs its selectors updated. The numbers below are not reliable.' +
          '</div>' +
        '</div>' +
      '</div>';
    return;
  }

  // ---- 1. OUTAGE (highest priority) ----
  // Prefer the explicit flag from the report; fall back to a heuristic
  // (most videos failed with the same dominant error).
  var outage = KL.state.outage || KL.detectOutageHeuristic();
  if (outage) {
    container.innerHTML =
      '<div class="incident-banner incident-outage">' +
        '<div class="incident-icon">🚨</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Outage detected — videos are down</div>' +
          '<div class="incident-detail">' +
            (outage.checkedBeforeAbort
              ? 'All ' + outage.checkedBeforeAbort + ' videos checked failed with the same error. '
              : 'A large number of videos failed with the same error. ') +
            'This is almost certainly a CDN / streaming-server issue, not individual videos.' +
          '</div>' +
          '<div class="incident-error"><code>' + KL.escHtml(outage.error || 'Unknown error') + '</code></div>' +
          (outage.diagnosis ? '<div class="incident-diagnosis">' + KL.escHtml(outage.diagnosis) + '</div>' : '') +
        '</div>' +
        '<button class="incident-investigate" onclick="KL.investigateLatestRun()">Investigate →</button>' +
      '</div>';
    return; // don't also show recovery
  }

  // ---- 2. STALE DATA (dead-man's switch, made visible) ----
  // If the newest report is older than the threshold, the scheduled checker
  // may have stopped running. Max normal gap between runs is 8h, so 12h = stale.
  var STALE_HOURS = 12;
  var ts = KL.state.reportTimestamp;
  if (ts) {
    var ageHrs = (Date.now() - new Date(ts).getTime()) / 3600000;
    if (!isNaN(ageHrs) && ageHrs > STALE_HOURS) {
      var ageLabel = ageHrs >= 48 ? Math.round(ageHrs / 24) + ' days'
                   : Math.round(ageHrs) + ' hours';
      container.innerHTML =
        '<div class="incident-banner incident-stale">' +
          '<div class="incident-icon">⚠️</div>' +
          '<div class="incident-body">' +
            '<div class="incident-title">Stale data — checker may have stopped</div>' +
            '<div class="incident-detail">' +
              'The last successful check was <strong>' + ageLabel + ' ago</strong>. ' +
              'Checks normally run every few hours (4× daily). If this keeps growing, ' +
              'the scheduled GitHub Actions job may be broken — the numbers below could be out of date.' +
            '</div>' +
          '</div>' +
        '</div>';
      return; // stale takes priority over recovery
    }
  }

  // ---- 3. PARTIAL DISCOVERY (#3) ----
  if (KL.state.discoveryWarning) {
    var dw = KL.state.discoveryWarning;
    container.innerHTML =
      '<div class="incident-banner incident-stale">' +
        '<div class="incident-icon">⚠️</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Partial discovery — fewer videos than expected</div>' +
          '<div class="incident-detail">' +
            'Found <strong>' + dw.found + '</strong> videos but the previous run had <strong>' + dw.expected + '</strong>. ' +
            'Could be a lazy-load/scroll hiccup or a site change. The results below may be incomplete.' +
          '</div>' +
        '</div>' +
      '</div>';
    return;
  }

  // ---- 4. PERFORMANCE REGRESSIONS (#4) ----
  if (KL.state.regressions && KL.state.regressions.length) {
    var regs = KL.state.regressions;
    var top = regs.slice(0, 3).map(function(r) {
      return '<li>' + KL.escHtml(r.title) + ' — now ' + (r.nowMs / 1000).toFixed(1) + 's vs usual ' + (r.medianMs / 1000).toFixed(1) + 's (' + r.ratio + '×)</li>';
    }).join('');
    container.innerHTML =
      '<div class="incident-banner incident-perf">' +
        '<div class="incident-icon">⏳</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">' + regs.length + ' video' + (regs.length === 1 ? '' : 's') + ' slower than usual</div>' +
          '<div class="incident-detail">These pass, but load much slower than their historical average — worth watching:' +
            '<ul style="margin:4px 0 0 16px">' + top + (regs.length > 3 ? '<li><em>…and ' + (regs.length - 3) + ' more</em></li>' : '') + '</ul>' +
          '</div>' +
        '</div>' +
        '<button class="incident-dismiss" title="Dismiss" onclick="this.closest(\'.incident-banner\').remove()">✕</button>' +
      '</div>';
    // don't return — recovery can still show below if relevant (different container slot)
  }

  // ---- 5. RECOVERY ----
  // Compare the latest two history entries: prev had issues, current is clean.
  if (!container.innerHTML) KL._maybeShowRecoveryBanner(container);
};

// Heuristic outage detection from the loaded results (for reports that
// predate the report.outage flag, or partial data).
KL.detectOutageHeuristic = function() {
  var results = KL.state.results || [];
  if (results.length < 15) return null;
  var failed = results.filter(function(r) { return r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT; });
  // Require the vast majority to be failing
  if (failed.length < results.length * 0.8) return null;
  // Require a single dominant error
  var byError = {};
  failed.forEach(function(r) {
    var e = (r.error || '').replace(/^Skipped — outage detected \((.*)\)$/, '$1').trim() || '(no error)';
    byError[e] = (byError[e] || 0) + 1;
  });
  var top = Object.keys(byError).sort(function(a, b) { return byError[b] - byError[a]; })[0];
  if (top && byError[top] >= failed.length * 0.8) {
    return { error: top, checkedBeforeAbort: null };
  }
  return null;
};

KL._maybeShowRecoveryBanner = async function(container) {
  try {
    var url = KL.isLocal ? '/api/report?file=history.json' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) return;
    var history = await res.json();
    if (!Array.isArray(history) || history.length < 2) return;

    var curr = history[history.length - 1];
    var prev = history[history.length - 2];
    var currIssues = (curr.failed || 0) + (curr.timeouts || 0);
    var prevIssues = (prev.failed || 0) + (prev.timeouts || 0);

    // Recovery = current clean, previous had issues
    if (currIssues !== 0 || prevIssues === 0) return;

    // Don't nag — once dismissed for this run, stay hidden this session
    var dismissKey = 'kl_recovery_dismissed_' + (curr.timestamp || '');
    if (sessionStorage.getItem(dismissKey)) return;

    // When did the failure happen? (the previous run's timestamp)
    var prevDate = new Date(prev.timestamp);
    var whenStr = isNaN(prevDate) ? '' :
      prevDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' +
      prevDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    // Stash the failed run so the Investigate button can open its breakdown.
    KL._recoveryPrevRun = prev;
    var canInvestigate = Array.isArray(prev.videos) && prev.videos.length > 0;

    container.innerHTML =
      '<div class="incident-banner incident-recovery">' +
        '<div class="incident-icon">✅</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Recovered — videos are back online</div>' +
          '<div class="incident-detail">' +
            'The previous check' + (whenStr ? ' (<strong>' + whenStr + '</strong>)' : '') + ' had ' +
            prevIssues + ' issue' + (prevIssues === 1 ? '' : 's') +
            '; this check is ' + (curr.passed || 0) + '/' + (curr.total || 0) + ' passing.' +
          '</div>' +
        '</div>' +
        (canInvestigate ? '<button class="incident-investigate incident-investigate-ok" onclick="KL.investigateRecoveryRun()">View what failed →</button>' : '') +
        '<button class="incident-dismiss" title="Dismiss" ' +
          'onclick="sessionStorage.setItem(\'' + dismissKey + '\',\'1\');this.closest(\'.incident-banner\').remove()">✕</button>' +
      '</div>';
  } catch (e) { /* non-critical */ }
};

// Open the Run Investigation modal for the failed run referenced by the recovery banner.
KL.investigateRecoveryRun = function() {
  if (KL._recoveryPrevRun && window.openRunInvestigation) window.openRunInvestigation(KL._recoveryPrevRun);
};

// Open the Run Investigation modal for the most recent run (from the outage banner).
KL.investigateLatestRun = async function() {
  try {
    var url = KL.isLocal ? '/api/report?file=history.json' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) return;
    var history = await res.json();
    if (Array.isArray(history) && history.length && window.openRunInvestigation) {
      window.openRunInvestigation(history[history.length - 1]);
    }
  } catch (e) { /* ignore */ }
};
