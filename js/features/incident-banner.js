// Incident Banner — surfaces outages and recoveries at the top of the
// dashboard (the notification channel for users without Slack/email).
// Outage takes priority; recovery is shown (dismissible) when the latest
// run is healthy but the previous one had failures.
window.KL = window.KL || {};

KL.renderIncidentBanner = function() {
  var container = document.getElementById('incident-banner-container');
  if (!container) return;
  container.innerHTML = '';

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

  // ---- 3. RECOVERY ----
  // Compare the latest two history entries: prev had issues, current is clean.
  KL._maybeShowRecoveryBanner(container);
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

    container.innerHTML =
      '<div class="incident-banner incident-recovery">' +
        '<div class="incident-icon">✅</div>' +
        '<div class="incident-body">' +
          '<div class="incident-title">Recovered — videos are back online</div>' +
          '<div class="incident-detail">' +
            'The previous check had ' + prevIssues + ' issue' + (prevIssues === 1 ? '' : 's') +
            '; this check is ' + (curr.passed || 0) + '/' + (curr.total || 0) + ' passing.' +
          '</div>' +
        '</div>' +
        '<button class="incident-dismiss" title="Dismiss" ' +
          'onclick="sessionStorage.setItem(\'' + dismissKey + '\',\'1\');this.closest(\'.incident-banner\').remove()">✕</button>' +
      '</div>';
  } catch (e) { /* non-critical */ }
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
