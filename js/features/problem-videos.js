// Problem Videos Panel — surfaces the specific videos worth the content team's
// attention: ones that fail repeatedly, or that reliably pass but load slowly.
// Built from history.json (the ~12-day full-detail window) since this is about
// recent/ongoing behavior, not long-term archaeology.
window.KL = window.KL || {};

KL.renderProblemVideos = async function() {
  var section = document.getElementById('problem-videos-section');
  if (!section) return;

  try {
    var url = KL.isLocal ? '/api/history' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) { section.style.display = 'none'; return; }
    var history = await res.json();
    if (!Array.isArray(history) || history.length === 0) { section.style.display = 'none'; return; }

    // Aggregate per-title stats across all recent runs.
    var stats = {};
    history.forEach(function(entry) {
      if (!Array.isArray(entry.videos)) return;
      entry.videos.forEach(function(v) {
        if (!v.title) return;
        // Exclude outage-skipped entries — a global outage isn't this video's fault,
        // and counting it would unfairly flag every video during an incident.
        if (typeof v.error === 'string' && v.error.indexOf('Skipped — outage detected') === 0) return;

        var s = stats[v.title];
        if (!s) s = stats[v.title] = { title: v.title, section: v.section || '', runs: 0, fails: 0, passTimes: [] };
        s.runs++;
        if (!s.section && v.section) s.section = v.section;
        if (v.status === 'FAIL' || v.status === 'TIMEOUT') s.fails++;
        else if (v.status === 'PASS' && v.loadTimeMs > 0) s.passTimes.push(v.loadTimeMs);
      });
    });

    var median = function(arr) {
      var sorted = arr.slice().sort(function(a, b) { return a - b; });
      var mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    var SLOW_MEDIAN_MS = 6000; // matches the heatmap's "Medium or worse" band

    var failing = [];
    var slow = [];
    Object.keys(stats).forEach(function(title) {
      var s = stats[title];
      // Frequently failing: needs a real sample size, not a one-off.
      if (s.fails >= 2 && s.runs >= 3) {
        failing.push({ title: s.title, section: s.section, runs: s.runs, fails: s.fails });
        return;
      }
      // Consistently slow (only considered if it isn't already a frequent failure).
      if (s.passTimes.length >= 3) {
        var med = median(s.passTimes);
        if (med >= SLOW_MEDIAN_MS) {
          slow.push({ title: s.title, section: s.section, runs: s.passTimes.length, medianMs: med });
        }
      }
    });

    failing.sort(function(a, b) { return b.fails - a.fails || b.runs - a.runs; });
    slow.sort(function(a, b) { return b.medianMs - a.medianMs; });

    // Failures are worse than slowness — rank them first.
    var problems = failing.concat(slow).slice(0, 5);
    if (problems.length === 0) { section.style.display = 'none'; return; }

    var approxDays = Math.max(1, Math.round(history.length / 4));

    var rows = problems.map(function(p) {
      var isFail = p.fails !== undefined;
      var tag = isFail
        ? '<span class="pv-tag pv-tag-fail">' + p.fails + ' of ' + p.runs + ' runs failed</span>'
        : '<span class="pv-tag pv-tag-slow">~' + (p.medianMs / 1000).toFixed(1) + 's median over ' + p.runs + ' runs</span>';
      var escTitle = KL.escHtml(p.title).replace(/'/g, "\\'");
      return '<button class="pv-row" onclick="showVideoDetail(\'' + escTitle + '\')">' +
        '<span class="pv-title">' + KL.escHtml(p.title) + '</span>' +
        (p.section ? '<span class="pv-section">' + KL.escHtml(p.section) + '</span>' : '') +
        tag +
      '</button>';
    }).join('');

    section.innerHTML =
      '<div class="pv-header">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>' +
        ' Problem Videos' +
      '</div>' +
      '<p class="pv-subtitle">Videos worth a look, based on the last ' + history.length + ' checks (~' + approxDays + ' day' + (approxDays === 1 ? '' : 's') + '):</p>' +
      '<div class="pv-list">' + rows + '</div>';
    section.style.display = 'block';
  } catch (e) {
    section.style.display = 'none';
  }
};
