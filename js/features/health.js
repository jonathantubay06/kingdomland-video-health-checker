// Health Summary, Last Checked, Health Badge, Avg Response Time
window.KL = window.KL || {};

KL.updateHealthSummary = function() {
  var el = document.getElementById('health-summary');
  if (!el) return;

  var total = KL.state.results.length;
  var passed = KL.state.passedCount;
  var failed = KL.state.failedCount;
  var timeouts = KL.state.timeoutCount;
  var rate = total > 0 ? (passed / total) * 100 : 0;

  var message = '';
  var detail = '';
  var level = 'green';
  var icon = '';

  if (rate === 100) {
    message = 'All ' + total + ' videos are working perfectly!';
    detail = '100% pass rate';
    level = 'green';
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else if (rate > 95) {
    level = 'yellow';
    var notWorking = failed + timeouts;
    var parts = [];
    if (failed > 0) parts.push(failed + ' failed');
    if (timeouts > 0) parts.push(timeouts + ' timed out');
    message = passed + ' of ' + total + ' videos working';
    detail = notWorking + ' video' + (notWorking !== 1 ? 's' : '') + ' with issues: ' + parts.join(', ');
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  } else {
    level = 'red';
    var notWorking = failed + timeouts;
    var parts = [];
    if (failed > 0) parts.push(failed + ' failed');
    if (timeouts > 0) parts.push(timeouts + ' timed out');
    message = notWorking + ' videos are not working';
    detail = parts.join(', ');
    icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  }

  el.className = 'health-banner health-' + level;
  el.innerHTML =
    '<div class="health-banner-icon">' + icon + '</div>' +
    '<div class="health-banner-body">' +
      '<div class="health-banner-text">' +
        '<div class="health-message">' + KL.escHtml(message) + '</div>' +
        (detail ? '<div class="health-detail">' + KL.escHtml(detail) + '</div>' : '') +
      '</div>' +
      '<div class="health-banner-metrics" id="health-metrics"></div>' +
    '</div>';
  el.style.display = 'flex';
};

KL.updateLastChecked = function() {
  var el = document.getElementById('last-checked');
  if (!el) return;

  var timestamp = KL.state.reportTimestamp;
  if (!timestamp) timestamp = new Date().toISOString();

  var date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    el.textContent = '';
    return;
  }

  var options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  var absolute = date.toLocaleDateString(undefined, options);
  var relative = KL.timeAgo(date);

  el.innerHTML =
    '<div class="last-checked-label">' +
      '<span class="check-icon">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
      '</span>' +
      '<span>Last checked: <span class="last-checked-datetime">' + KL.escHtml(absolute) + '</span></span>' +
      '<span class="last-checked-relative">' + KL.escHtml(relative) + '</span>' +
    '</div>';
  el.style.display = 'flex';

  if (window._lastCheckedInterval) clearInterval(window._lastCheckedInterval);
  window._lastCheckedInterval = setInterval(function() {
    var relEl = el.querySelector('.last-checked-relative');
    if (relEl) relEl.textContent = KL.timeAgo(date);
  }, 60000);
};

KL.updateHealthBadge = function() {
  var el = document.getElementById('health-badge');
  if (!el) return;

  var total = KL.state.results.length;
  var passed = KL.state.passedCount;
  var rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  var badgeColor = '#4c1';
  if (rate < 100 && rate > 95) badgeColor = '#dfb317';
  if (rate <= 95) badgeColor = '#e05d44';

  var labelText = 'Video Health';
  var valueText = rate + '%';
  var labelWidth = labelText.length * 6.5 + 10;
  var valueWidth = valueText.length * 6.5 + 10;
  var totalWidth = labelWidth + valueWidth;

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalWidth + '" height="20" role="img" aria-label="' + labelText + ': ' + valueText + '">' +
    '<title>' + labelText + ': ' + valueText + '</title>' +
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>' +
    '<clipPath id="r"><rect width="' + totalWidth + '" height="20" rx="3" fill="#fff"/></clipPath>' +
    '<g clip-path="url(#r)">' +
      '<rect width="' + labelWidth + '" height="20" fill="#555"/>' +
      '<rect x="' + labelWidth + '" width="' + valueWidth + '" height="20" fill="' + badgeColor + '"/>' +
      '<rect width="' + totalWidth + '" height="20" fill="url(#s)"/>' +
    '</g>' +
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">' +
      '<text x="' + (labelWidth / 2) + '" y="15" fill="#010101" fill-opacity=".3">' + labelText + '</text>' +
      '<text x="' + (labelWidth / 2) + '" y="14" fill="#fff">' + labelText + '</text>' +
      '<text x="' + (labelWidth + valueWidth / 2) + '" y="15" fill="#010101" fill-opacity=".3">' + valueText + '</text>' +
      '<text x="' + (labelWidth + valueWidth / 2) + '" y="14" fill="#fff">' + valueText + '</text>' +
    '</g></svg>';

  var badgeUrl = window.location.origin + '/api/health-badge';

  el.innerHTML =
    '<div class="health-badge-preview">' + svg + '</div>' +
    '<div class="health-badge-url">' +
      '<span>Badge URL:</span>' +
      '<input type="text" value="' + KL.escHtml(badgeUrl) + '" readonly onclick="this.select()" style="font-size:0.8rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg-secondary);color:var(--color-text);width:300px;">' +
    '</div>';
  el.style.display = 'block';

  KL.updateRecheckButton();
};

KL.updateAvgResponseTime = function() {
  var metricsEl = document.getElementById('health-metrics');
  if (!metricsEl) return;

  var timings = KL.state.results
    .filter(function(r) { return r.loadTimeMs && r.loadTimeMs > 0; })
    .map(function(r) { return r.loadTimeMs; });

  if (timings.length === 0) return;

  var avg = timings.reduce(function(a, b) { return a + b; }, 0) / timings.length;
  var min = Math.min.apply(null, timings);
  var max = Math.max.apply(null, timings);

  var formatTime = function(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  };

  var clockSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

  metricsEl.innerHTML =
    '<span class="health-metric-pill">' + clockSvg + ' Avg: <span class="metric-value">' + formatTime(Math.round(avg)) + '</span></span>' +
    '<span class="health-metric-pill">Min: <span class="metric-value">' + formatTime(min) + '</span></span>' +
    '<span class="health-metric-pill">Max: <span class="metric-value">' + formatTime(max) + '</span></span>';
};
