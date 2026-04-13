// Response Time Heatmap
window.KL = window.KL || {};

KL.renderHeatmap = function() {
  var section = document.getElementById('heatmap-section');
  if (!section || KL.state.results.length === 0) {
    if (section) section.style.display = 'none';
    return;
  }

  var results = KL.state.results.filter(function(r) { return r.loadTimeMs && r.loadTimeMs > 0; });
  if (results.length === 0) { section.style.display = 'none'; return; }

  // Playwright measures ~3× slower than a real browser for HLS video streaming.
  // Thresholds are based on estimated real-user time (Playwright ÷ 3):
  //   Fast   <15s Playwright  ≈ <5s real   — great
  //   Medium  15–30s          ≈ 5–10s real — acceptable
  //   Slow    30–50s          ≈ 10–17s real — noticeable
  //   Very Slow >50s          ≈ >17s real  — needs attention
  var getColor = function(ms) {
    if (ms < 15000) return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }; // green
    if (ms < 30000) return { bg: '#fef9c3', text: '#854d0e', border: '#fef08a' }; // yellow
    if (ms < 50000) return { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' }; // orange
    return { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' };                 // red
  };

  var getDarkColor = function(ms) {
    if (ms < 15000) return { bg: '#14532d', text: '#86efac', border: '#166534' };
    if (ms < 30000) return { bg: '#422006', text: '#fde047', border: '#854d0e' };
    if (ms < 50000) return { bg: '#431407', text: '#fb923c', border: '#9a3412' };
    return { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' };
  };

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  var cells = results.map(function(r) {
    var colors = isDark ? getDarkColor(r.loadTimeMs) : getColor(r.loadTimeMs);
    var loadTime = (r.loadTimeMs / 1000).toFixed(1) + 's';
    var realSec = Math.round(r.loadTimeMs / 3000);
    var realTime = '~' + realSec + 's real';
    var titleShort = r.title.length > 18 ? r.title.substring(0, 16) + '...' : r.title;
    // Add speed class so CSS can pulse slow/very-slow cells independently
    var speedClass = r.loadTimeMs >= 50000 ? ' heatmap-very-slow' : r.loadTimeMs >= 30000 ? ' heatmap-slow' : '';
    return '<div class="heatmap-cell' + speedClass + '" style="background:' + colors.bg + ';color:' + colors.text + ';border:1px solid ' + colors.border + '"' +
      ' onclick="showVideoDetail(\'' + KL.escHtml(r.title).replace(/'/g, "\\'") + '\')" title="' + KL.escHtml(r.title) + ' — ' + loadTime + ' Playwright / ' + realTime + '">' +
      '<div class="heatmap-cell-title">' + KL.escHtml(titleShort) + '</div>' +
      '<div class="heatmap-cell-time">' + loadTime + '</div>' +
      '<div class="heatmap-cell-real">' + realTime + '</div></div>';
  }).join('');

  section.innerHTML =
    '<div class="heatmap-header">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> Response Time Heatmap</div>' +
    '<div class="heatmap-grid" id="heatmap-grid">' + cells + '</div>' +
    '<div class="heatmap-legend">' +
      '<span class="heatmap-legend-playwright-note">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
        ' Playwright times are ~3× slower than a real browser for HLS video. Each cell shows estimated real-user time below.' +
      '</span>' +
      '<div class="heatmap-legend-items">' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#22c55e"></span><span><strong>Fast</strong> &lt;15s <span class="heatmap-legend-real">&lt;5s real</span></span></span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#eab308"></span><span><strong>Medium</strong> 15–30s <span class="heatmap-legend-real">5–10s real</span></span></span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#f97316"></span><span><strong>Slow</strong> 30–50s <span class="heatmap-legend-real">10–17s real</span></span></span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#ef4444"></span><span><strong>Very Slow</strong> &gt;50s <span class="heatmap-legend-real">&gt;17s real</span></span></span>' +
      '</div>' +
    '</div>';
  section.style.display = 'block';

  // Stagger cells in only when the heatmap scrolls into view — not on DOM insertion.
  // This way the wave animation plays as the user reaches the section.
  KL.onEnterViewport(section, function() {
    var cellEls = section.querySelectorAll('.heatmap-cell');
    cellEls.forEach(function(cell, i) {
      setTimeout(function() { cell.classList.add('visible'); }, Math.min(i * 12, 1500));
    });
  });
};
