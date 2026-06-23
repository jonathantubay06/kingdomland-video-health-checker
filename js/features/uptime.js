// Uptime Percentage Tracking
window.KL = window.KL || {};

KL.updateUptimeTracking = async function() {
  var section = document.getElementById('uptime-section');
  if (!section) return;

  try {
    var url = KL.isLocal ? '/api/history' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) { section.style.display = 'none'; return; }
    var history = await res.json();
    if (!Array.isArray(history) || history.length < 2) { section.style.display = 'none'; return; }

    var now = Date.now();
    var day7 = now - 7 * 24 * 60 * 60 * 1000;
    var day30 = now - 30 * 24 * 60 * 60 * 1000;

    var last7 = history.filter(function(h) { return new Date(h.timestamp).getTime() > day7; });
    var last30 = history.filter(function(h) { return new Date(h.timestamp).getTime() > day30; });

    var calcUptime = function(entries) {
      if (entries.length === 0) return null;
      var totalPassed = entries.reduce(function(s, h) { return s + (h.passed || 0); }, 0);
      var totalAll = entries.reduce(function(s, h) { return s + (h.total || 0); }, 0);
      return totalAll > 0 ? (totalPassed / totalAll * 100) : 100;
    };

    var allUptime = calcUptime(history);
    var uptime7 = calcUptime(last7);
    var uptime30 = calcUptime(last30);
    var totalChecks = history.length;

    // Identify full-outage runs (0 passed of many) — these are what pull uptime
    // below 100%. Name them so the dip is never a mystery, and make each one
    // CLICKABLE (opens its Run Investigation) — because the chart only shows the
    // last 20 runs, so an outage dragging the 30-day number may have scrolled off.
    var outageRuns = history.filter(function(h) { return (h.total || 0) > 20 && (h.passed || 0) === 0; });
    KL._uptimeOutageRuns = outageRuns; // stash for the click handler
    var outageNote = '';
    if (outageRuns.length > 0) {
      var dateLinks = outageRuns.slice(-5).map(function(h) {
        var idx = outageRuns.indexOf(h);
        var d = new Date(h.timestamp);
        var label = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return '<button class="uptime-outage-link" onclick="KL.investigateOutageRun(' + idx + ')">' + label + '</button>';
      }).join(' ');
      outageNote =
        '<div class="uptime-note">' +
          'ⓘ The dip is from <strong>' + outageRuns.length + ' full-outage run' + (outageRuns.length === 1 ? '' : 's') + '</strong>, ' +
          'where every video failed at once. Click to investigate each: ' + dateLinks + ' — ' +
          'some may be checker rate-limiting (not real downtime) rather than a true outage.' +
        '</div>';
    }

    var uptimeClass = function(val) {
      if (val === null) return '';
      if (val >= 99) return 'uptime-good';
      if (val >= 90) return 'uptime-warn';
      return 'uptime-bad';
    };

    var formatUptime = function(val) { return val !== null ? val.toFixed(1) + '%' : 'N/A'; };

    // Per-window "imperfect" runs (any run that wasn't 100%) — what makes a card
    // orange. Stashed so clicking a card can show exactly what dragged it down.
    var imperfect = function(entries) {
      return entries.filter(function(h) { return (h.total || 0) > 20 && (h.passed || 0) < (h.total || 0); })
        .sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    };
    KL._uptimeWindows = { '7': imperfect(last7), '30': imperfect(last30), 'all': imperfect(history) };

    // Build a card; if its window has imperfect runs and it's < 100, make it clickable.
    var card = function(label, val, subText, windowKey) {
      var issues = KL._uptimeWindows[windowKey] || [];
      var clickable = val !== null && val < 100 && issues.length > 0;
      var cls = 'uptime-card' + (clickable ? ' uptime-card-clickable' : '');
      var attr = clickable ? ' onclick="KL.investigateWindow(\'' + windowKey + '\')" title="Click to see what dragged this down"' : '';
      var hint = clickable ? '<div class="uptime-card-hint">ⓘ ' + issues.length + ' run' + (issues.length === 1 ? '' : 's') + ' below 100% — click to investigate</div>' : '';
      return '<div class="' + cls + '"' + attr + '>' +
        '<div class="uptime-card-label">' + label + '</div>' +
        '<div class="uptime-card-value ' + uptimeClass(val) + '">' + formatUptime(val) + '</div>' +
        '<div class="uptime-card-sub">' + subText + '</div>' + hint +
      '</div>';
    };

    section.innerHTML =
      '<div class="uptime-header">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg> Uptime Tracking</div>' +
      '<div class="uptime-cards">' +
        card('7-Day Uptime', uptime7, last7.length + ' checks', '7') +
        card('30-Day Uptime', uptime30, last30.length + ' checks', '30') +
        card('All-Time Uptime', allUptime, totalChecks + ' total checks', 'all') +
      '</div>' +
      outageNote;
    section.style.display = 'block';
  } catch (e) {
    section.style.display = 'none';
  }
};

// Open the Run Investigation modal for an outage run named in the uptime note.
// Works even if that run's bar has scrolled off the Check History chart.
KL.investigateOutageRun = function(idx) {
  var runs = KL._uptimeOutageRuns || [];
  var run = runs[idx];
  if (run && window.openRunInvestigation) window.openRunInvestigation(run);
};

// Clicking an orange uptime card: show what dragged THAT window down.
// 1 imperfect run → open it directly; multiple → list them (each clickable).
KL.investigateWindow = function(windowKey) {
  var runs = (KL._uptimeWindows && KL._uptimeWindows[windowKey]) || [];
  if (runs.length === 0) return;
  if (runs.length === 1) { if (window.openRunInvestigation) window.openRunInvestigation(runs[0]); return; }

  // Multiple imperfect runs — render a chooser in the run-investigation modal.
  var modal = document.getElementById('run-investigation-modal');
  var body = document.getElementById('run-investigation-body');
  var title = document.getElementById('run-investigation-title');
  if (!modal || !body) { if (window.openRunInvestigation) window.openRunInvestigation(runs[0]); return; }

  var label = windowKey === '7' ? '7-day' : windowKey === '30' ? '30-day' : 'all-time';
  title.textContent = 'What dragged ' + label + ' uptime down';
  KL._windowChooserRuns = runs;
  var rows = runs.map(function(r, i) {
    var d = new Date(r.timestamp);
    var when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    var failed = (r.failed || 0) + (r.timeouts || 0);
    var isOutage = (r.passed || 0) === 0;
    return '<button class="ri-window-row" onclick="KL._openWindowRun(' + i + ')">' +
      '<span class="ri-window-when">' + when + '</span>' +
      '<span class="ri-window-stat">' + (r.passed || 0) + '/' + (r.total || 0) + ' passed</span>' +
      '<span class="ri-window-tag' + (isOutage ? ' ri-window-outage' : '') + '">' + (isOutage ? 'full outage' : failed + ' failed') + '</span>' +
    '</button>';
  }).join('');
  body.innerHTML = '<p class="ri-summary">' + runs.length + ' run' + (runs.length === 1 ? '' : 's') +
    ' in this window were below 100%. Click any to see its full breakdown:</p>' +
    '<div class="ri-window-list">' + rows + '</div>';
  modal.style.display = 'flex';
};

KL._openWindowRun = function(i) {
  var run = (KL._windowChooserRuns || [])[i];
  if (run && window.openRunInvestigation) window.openRunInvestigation(run);
};
