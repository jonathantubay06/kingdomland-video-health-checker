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

    section.innerHTML =
      '<div class="uptime-header">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg> Uptime Tracking</div>' +
      '<div class="uptime-cards">' +
        '<div class="uptime-card"><div class="uptime-card-label">7-Day Uptime</div><div class="uptime-card-value ' + uptimeClass(uptime7) + '">' + formatUptime(uptime7) + '</div><div class="uptime-card-sub">' + last7.length + ' checks</div></div>' +
        '<div class="uptime-card"><div class="uptime-card-label">30-Day Uptime</div><div class="uptime-card-value ' + uptimeClass(uptime30) + '">' + formatUptime(uptime30) + '</div><div class="uptime-card-sub">' + last30.length + ' checks</div></div>' +
        '<div class="uptime-card"><div class="uptime-card-label">All-Time Uptime</div><div class="uptime-card-value ' + uptimeClass(allUptime) + '">' + formatUptime(allUptime) + '</div><div class="uptime-card-sub">' + totalChecks + ' total checks</div></div>' +
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
