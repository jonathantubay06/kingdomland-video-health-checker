// Video Detail Pages (History per Video)
window.KL = window.KL || {};

window.showVideoDetail = async function(title) {
  var modal = document.getElementById('video-detail-modal');
  var titleEl = document.getElementById('video-detail-title');
  var body = document.getElementById('video-detail-body');
  if (!modal || !body) return;

  titleEl.textContent = title;
  body.innerHTML = '<p style="color:var(--color-text-muted)">Loading history...</p>';
  modal.style.display = 'flex';

  try {
    var url = KL.isLocal ? '/api/history' : '/api/get-report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) { body.innerHTML = '<p>No history available.</p>'; return; }
    var history = await res.json();

    var videoHistory = [];
    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (entry.videos) {
        var match = entry.videos.find(function(v) { return v.title === title; });
        if (match) {
          videoHistory.push({
            timestamp: entry.timestamp,
            status: match.status,
            loadTimeMs: match.loadTimeMs || 0,
            error: match.error || '',
          });
        }
      }
    }

    if (videoHistory.length === 0) {
      body.innerHTML = '<p style="color:var(--color-text-muted)">No historical data for this video yet. History is recorded after each check run.</p>';
      return;
    }

    var totalChecks = videoHistory.length;
    var passedChecks = videoHistory.filter(function(v) { return v.status === KL.STATUS.PASS; }).length;
    var uptime = totalChecks > 0 ? (passedChecks / totalChecks * 100).toFixed(1) : 'N/A';

    var timelineWidth = 600;
    var cellWidth = Math.min(Math.floor(timelineWidth / videoHistory.length), 20);
    var timelineSvg = videoHistory.map(function(v, idx) {
      var color = v.status === KL.STATUS.PASS ? 'var(--color-pass)' : v.status === KL.STATUS.FAIL ? 'var(--color-fail)' : 'var(--color-timeout)';
      return '<rect x="' + (idx * cellWidth) + '" y="0" width="' + Math.max(cellWidth - 1, 2) + '" height="20" rx="2" fill="' + color + '" opacity="0.85"><title>' + new Date(v.timestamp).toLocaleDateString() + ' - ' + v.status + '</title></rect>';
    }).join('');

    var listHtml = videoHistory.slice().reverse().map(function(v) {
      var date = new Date(v.timestamp);
      var dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      var timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      var loadTime = v.loadTimeMs ? (v.loadTimeMs / 1000).toFixed(1) + 's' : '-';
      return '<li>' +
        '<span class="vh-date">' + dateStr + ' ' + timeStr + '</span>' +
        '<span class="vh-status status-' + v.status + '">' + v.status + '</span>' +
        '<span class="vh-load">' + loadTime + '</span>' +
        (v.error ? '<span style="color:var(--color-text-light);font-size:0.75rem">' + KL.escHtml(v.error).substring(0, 60) + '</span>' : '') +
        '</li>';
    }).join('');

    body.innerHTML =
      '<div style="margin-bottom:16px;display:flex;gap:20px;font-size:0.85rem">' +
        '<div><strong>Total checks:</strong> ' + totalChecks + '</div>' +
        '<div><strong>Uptime:</strong> ' + uptime + '%</div>' +
        '<div><strong>Passed:</strong> ' + passedChecks + '/' + totalChecks + '</div>' +
      '</div>' +
      '<div class="video-history-chart" style="overflow-x:auto">' +
        '<svg width="' + (videoHistory.length * cellWidth) + '" height="20" viewBox="0 0 ' + (videoHistory.length * cellWidth) + ' 20">' + timelineSvg + '</svg>' +
      '</div>' +
      '<h4 style="font-size:0.88rem;margin-bottom:8px">Check History</h4>' +
      '<ul class="video-history-list">' + listHtml + '</ul>';
  } catch (e) {
    body.innerHTML = '<p style="color:var(--color-fail)">Failed to load history.</p>';
  }
};

window.closeVideoDetail = function() {
  document.getElementById('video-detail-modal').style.display = 'none';
};
