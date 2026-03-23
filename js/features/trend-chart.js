// Historical Trend Chart
window.KL = window.KL || {};

KL.loadAndShowTrendChart = async function() {
  var container = document.getElementById('trend-chart-container');
  if (!container) return;

  try {
    var url = '/api/get-report?file=history.json';
    if (KL.isLocal) url = '/api/report?file=history.json';
    var res = await fetch(url);
    if (!res.ok) {
      container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
      container.style.display = 'block';
      return;
    }
    var history = await res.json();
    if (!Array.isArray(history) || history.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
      container.style.display = 'block';
      return;
    }

    if (history.length > 20) history = history.slice(history.length - 20);

    var chartWidth = 700;
    var chartHeight = 240;
    var padding = { top: 24, right: 24, bottom: 52, left: 50 };
    var innerWidth = chartWidth - padding.left - padding.right;
    var innerHeight = chartHeight - padding.top - padding.bottom;

    var maxVal = Math.max.apply(null, history.map(function(h) { return h.total || 0; }).concat([1]));
    var niceMax = Math.ceil(maxVal / 10) * 10 || maxVal;

    var barGroupWidth = innerWidth / history.length;
    var barWidth = Math.min(Math.max(barGroupWidth * 0.32, 4), 24);

    var bars = '';
    var labels = '';
    var yAxisLines = '';
    var hoverAreas = '';

    var gridCount = 4;
    for (var gi = 0; gi <= gridCount; gi++) {
      var gy = padding.top + (innerHeight * (1 - gi / gridCount));
      var gval = Math.round(niceMax * gi / gridCount);
      yAxisLines += '<line x1="' + padding.left + '" y1="' + gy + '" x2="' + (chartWidth - padding.right) + '" y2="' + gy + '" stroke="var(--color-border)" stroke-width="0.5" opacity="0.5"/>';
      yAxisLines += '<text x="' + (padding.left - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="var(--color-text-light)" font-weight="500">' + gval + '</text>';
    }

    var trendLinePoints = '';

    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var x = padding.left + i * barGroupWidth + barGroupWidth / 2;

      var passedVal = h.passed || 0;
      var failedTotal = (h.failed || 0) + (h.timeouts || 0);
      var totalVal = passedVal + failedTotal;

      var totalBarHeight = niceMax > 0 ? (totalVal / niceMax) * innerHeight : 0;
      var passedHeight = niceMax > 0 ? (passedVal / niceMax) * innerHeight : 0;
      var failedHeight = totalBarHeight - passedHeight;
      var barBaseY = padding.top + innerHeight;

      if (passedHeight > 0) {
        bars += '<rect class="chart-bar" x="' + (x - barWidth / 2) + '" y="' + (barBaseY - passedHeight) + '" width="' + barWidth + '" height="' + passedHeight + '" fill="var(--color-pass)" rx="2" ry="2" opacity="0.85" data-idx="' + i + '"/>';
      }
      if (failedHeight > 0) {
        bars += '<rect class="chart-bar" x="' + (x - barWidth / 2) + '" y="' + (barBaseY - totalBarHeight) + '" width="' + barWidth + '" height="' + failedHeight + '" fill="var(--color-fail)" rx="2" ry="2" opacity="0.85" data-idx="' + i + '"/>';
      }

      hoverAreas += '<rect x="' + (x - barGroupWidth / 2) + '" y="' + padding.top + '" width="' + barGroupWidth + '" height="' + innerHeight + '" fill="transparent" class="chart-hover-area" data-idx="' + i + '"/>';

      var passRate = totalVal > 0 ? passedVal / totalVal : 1;
      var trendY = padding.top + innerHeight - (passRate * innerHeight);
      trendLinePoints += (i === 0 ? 'M' : 'L') + x + ',' + trendY;

      var date = new Date(h.timestamp);
      var dateStr = (date.getMonth() + 1) + '/' + date.getDate();
      var timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      var prevDate = i > 0 ? new Date(history[i - 1].timestamp) : null;
      var sameDate = prevDate && prevDate.getDate() === date.getDate() && prevDate.getMonth() === date.getMonth();
      var labelStr = sameDate ? timeStr : dateStr;

      labels += '<text x="' + x + '" y="' + (chartHeight - padding.bottom + 16) + '" text-anchor="middle" font-size="9.5" fill="var(--color-text-light)" font-weight="500" transform="rotate(-30, ' + x + ', ' + (chartHeight - padding.bottom + 16) + ')">' + labelStr + '</text>';
    }

    var trendLine = trendLinePoints
      ? '<path d="' + trendLinePoints + '" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5" stroke-dasharray="4,3"/>'
      : '';

    var svg = '<svg width="100%" viewBox="0 0 ' + chartWidth + ' ' + chartHeight + '" xmlns="http://www.w3.org/2000/svg" style="max-width:' + chartWidth + 'px;" id="trend-svg">' +
      yAxisLines +
      '<line x1="' + padding.left + '" y1="' + padding.top + '" x2="' + padding.left + '" y2="' + (padding.top + innerHeight) + '" stroke="var(--color-border)" stroke-width="1"/>' +
      '<line x1="' + padding.left + '" y1="' + (padding.top + innerHeight) + '" x2="' + (chartWidth - padding.right) + '" y2="' + (padding.top + innerHeight) + '" stroke="var(--color-border)" stroke-width="1"/>' +
      bars + trendLine + labels + hoverAreas +
      '</svg>';

    var lastEntry = history[history.length - 1];
    var totalChecks = history.length;
    var avgPassRate = history.reduce(function(sum, h) {
      var t = (h.passed || 0) + (h.failed || 0) + (h.timeouts || 0);
      return sum + (t > 0 ? (h.passed || 0) / t * 100 : 100);
    }, 0) / history.length;

    container.innerHTML =
      '<div class="trend-chart-header"><h2>' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Check History</h2></div>' +
      '<div class="trend-chart-canvas" style="position:relative">' + svg + '<div class="chart-tooltip" id="chart-tooltip"></div></div>' +
      '<div class="trend-chart-footer">' +
        '<div class="trend-chart-legend">' +
          '<span class="trend-legend-item"><span class="trend-legend-dot dot-pass"></span> Passed</span>' +
          '<span class="trend-legend-item"><span class="trend-legend-dot dot-fail"></span> Failed</span>' +
          '<span class="trend-legend-item" style="opacity:0.6"><span style="width:16px;height:2px;background:var(--color-primary);border-radius:1px;display:inline-block;vertical-align:middle;margin-right:2px"></span> Pass Rate</span>' +
        '</div>' +
        '<div class="trend-chart-summary">' + totalChecks + ' checks &middot; Avg pass rate: ' + avgPassRate.toFixed(1) + '%</div>' +
      '</div>';

    // Trigger bar-grow animation when chart scrolls into view
    container.style.display = 'block';
    KL.onEnterViewport(container, function() {
      var bars = container.querySelectorAll('.chart-bar');
      bars.forEach(function(bar, i) {
        bar.style.animationDelay = (i * 45) + 'ms';
      });
      container.classList.add('trend-chart-ready');
    });

    // Attach tooltip listeners
    var tooltip = document.getElementById('chart-tooltip');
    var canvasEl = container.querySelector('.trend-chart-canvas');
    container.querySelectorAll('.chart-hover-area').forEach(function(area) {
      area.addEventListener('mouseenter', function() {
        var idx = parseInt(area.dataset.idx);
        var h = history[idx];
        if (!h) return;
        var date = new Date(h.timestamp);
        var dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        var timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        var total = (h.passed || 0) + (h.failed || 0) + (h.timeouts || 0);
        var rate = total > 0 ? Math.round((h.passed || 0) / total * 100) : 0;
        tooltip.innerHTML =
          '<div class="chart-tooltip-title">' + dateStr + ' ' + timeStr + '</div>' +
          '<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-pass)"></span> Passed: <span class="chart-tooltip-value">' + (h.passed || 0) + '</span></div>' +
          '<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-fail)"></span> Failed: <span class="chart-tooltip-value">' + (h.failed || 0) + '</span></div>' +
          ((h.timeouts || 0) > 0 ? '<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:var(--color-timeout)"></span> Timeout: <span class="chart-tooltip-value">' + h.timeouts + '</span></div>' : '') +
          '<div class="chart-tooltip-row" style="margin-top:4px;padding-top:4px;border-top:1px solid var(--color-border)">Pass rate: <span class="chart-tooltip-value">' + rate + '%</span></div>';
        tooltip.classList.add('visible');
      });
      area.addEventListener('mousemove', function(e) {
        var rect = canvasEl.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        tooltip.style.left = Math.min(x + 12, rect.width - tooltip.offsetWidth - 8) + 'px';
        tooltip.style.top = Math.max(y - tooltip.offsetHeight - 8, 4) + 'px';
      });
      area.addEventListener('mouseleave', function() {
        tooltip.classList.remove('visible');
      });
    });

    container.style.display = 'block';
  } catch (e) {
    console.error('Failed to load trend chart:', e);
    container.innerHTML = '<p style="color:var(--color-text-muted);text-align:center;padding:20px;">Run multiple checks to see trends.</p>';
    container.style.display = 'block';
  }
};
