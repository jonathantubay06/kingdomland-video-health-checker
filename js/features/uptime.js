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
      '</div>';
    section.style.display = 'block';
  } catch (e) {
    section.style.display = 'none';
  }
};
