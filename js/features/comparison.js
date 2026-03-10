// Check Comparison View
window.KL = window.KL || {};

KL.loadComparisonData = async function() {
  try {
    var url = KL.isLocal ? '/api/history' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) return;
    KL.comparisonHistory = await res.json();
  } catch (e) { KL.comparisonHistory = []; }
};

KL.renderComparisonSection = function() {
  var section = document.getElementById('comparison-section');
  if (!section || KL.comparisonHistory.length < 2) {
    if (section) section.style.display = 'none';
    return;
  }

  var options = KL.comparisonHistory.map(function(h, i) {
    var date = new Date(h.timestamp);
    var label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return '<option value="' + i + '">' + label + ' (' + (h.passed || 0) + '/' + (h.total || 0) + ')</option>';
  }).join('');

  section.innerHTML =
    '<div class="comparison-header"><h3>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"></path><path d="M8 3H3v5"></path><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"></path><path d="m15 9 6-6"></path></svg> Compare Check Runs</h3>' +
      '<div class="comparison-selects">' +
        '<select id="comp-run-a">' + options + '</select>' +
        '<span style="font-size:0.85rem;color:var(--color-text-muted)">vs</span>' +
        '<select id="comp-run-b">' + options + '</select>' +
        '<button class="btn-outline" onclick="runComparison()" style="padding:6px 14px;font-size:0.82rem">Compare</button>' +
      '</div></div>' +
    '<div id="comparison-results"></div>';

  document.getElementById('comp-run-a').value = KL.comparisonHistory.length - 2;
  document.getElementById('comp-run-b').value = KL.comparisonHistory.length - 1;
  section.style.display = 'block';
};

window.runComparison = function() {
  var idxA = parseInt(document.getElementById('comp-run-a').value);
  var idxB = parseInt(document.getElementById('comp-run-b').value);
  var runA = KL.comparisonHistory[idxA];
  var runB = KL.comparisonHistory[idxB];
  var resultsEl = document.getElementById('comparison-results');

  if (!runA || !runB || !runA.videos || !runB.videos) {
    resultsEl.innerHTML = '<p style="color:var(--color-text-muted)">Selected runs don\'t have per-video data. Run a new check to populate this.</p>';
    return;
  }

  var dateA = new Date(runA.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  var dateB = new Date(runB.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  var mapA = {};
  for (var i = 0; i < runA.videos.length; i++) mapA[runA.videos[i].title] = runA.videos[i];
  var mapB = {};
  for (var j = 0; j < runB.videos.length; j++) mapB[runB.videos[j].title] = runB.videos[j];

  var allTitlesSet = {};
  Object.keys(mapA).forEach(function(t) { allTitlesSet[t] = true; });
  Object.keys(mapB).forEach(function(t) { allTitlesSet[t] = true; });
  var allTitles = Object.keys(allTitlesSet);

  var changes = [];
  for (var k = 0; k < allTitles.length; k++) {
    var title = allTitles[k];
    var a = mapA[title];
    var b = mapB[title];
    if (!a || !b) {
      changes.push({ title: title, statusA: a ? a.status : 'N/A', statusB: b ? b.status : 'N/A', changed: true });
    } else if (a.status !== b.status) {
      changes.push({ title: title, statusA: a.status, statusB: b.status, changed: true });
    }
  }

  if (changes.length === 0) {
    resultsEl.innerHTML = '<p style="color:var(--color-pass);margin-top:12px">No differences between these two runs.</p>';
    return;
  }

  var statusColor = function(s) {
    if (s === KL.STATUS.PASS) return 'var(--color-pass)';
    if (s === KL.STATUS.FAIL) return 'var(--color-fail)';
    if (s === KL.STATUS.TIMEOUT) return 'var(--color-timeout)';
    return 'var(--color-text-light)';
  };

  var rows = changes.map(function(c) {
    return '<tr class="' + (c.changed ? 'comp-changed' : '') + '">' +
      '<td>' + KL.escHtml(c.title) + '</td>' +
      '<td style="color:' + statusColor(c.statusA) + ';font-weight:600">' + c.statusA + '</td>' +
      '<td><span class="comp-arrow">&rarr;</span></td>' +
      '<td style="color:' + statusColor(c.statusB) + ';font-weight:600">' + c.statusB + '</td>' +
    '</tr>';
  }).join('');

  resultsEl.innerHTML =
    '<p style="font-size:0.85rem;color:var(--color-text-muted);margin:12px 0 8px">' + changes.length + ' difference' + (changes.length !== 1 ? 's' : '') + ' found</p>' +
    '<table class="comparison-table"><thead><tr><th>Video</th><th>' + dateA + '</th><th></th><th>' + dateB + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
};

window.closeComparisonModal = function() {
  document.getElementById('comparison-modal').style.display = 'none';
};
