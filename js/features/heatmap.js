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

  var getColor = function(ms) {
    if (ms < 2000) return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' };
    if (ms < 4000) return { bg: '#fef9c3', text: '#854d0e', border: '#fef08a' };
    if (ms < 8000) return { bg: '#fed7aa', text: '#9a3412', border: '#fdba74' };
    return { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' };
  };

  var getDarkColor = function(ms) {
    if (ms < 2000) return { bg: '#14532d', text: '#86efac', border: '#166534' };
    if (ms < 4000) return { bg: '#422006', text: '#fde047', border: '#854d0e' };
    if (ms < 8000) return { bg: '#431407', text: '#fb923c', border: '#9a3412' };
    return { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' };
  };

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  var cells = results.map(function(r) {
    var colors = isDark ? getDarkColor(r.loadTimeMs) : getColor(r.loadTimeMs);
    var loadTime = (r.loadTimeMs / 1000).toFixed(1) + 's';
    var titleShort = r.title.length > 18 ? r.title.substring(0, 16) + '...' : r.title;
    return '<div class="heatmap-cell" style="background:' + colors.bg + ';color:' + colors.text + ';border:1px solid ' + colors.border + '"' +
      ' onclick="showVideoDetail(\'' + KL.escHtml(r.title).replace(/'/g, "\\'") + '\')" title="' + KL.escHtml(r.title) + ' - ' + loadTime + '">' +
      '<div class="heatmap-cell-title">' + KL.escHtml(titleShort) + '</div>' +
      '<div class="heatmap-cell-time">' + loadTime + '</div></div>';
  }).join('');

  section.innerHTML =
    '<div class="heatmap-header">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> Response Time Heatmap</div>' +
    '<div class="heatmap-grid">' + cells + '</div>' +
    '<div class="heatmap-legend">' +
      '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#22c55e"></span> Fast (&lt;2s)</span>' +
      '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#eab308"></span> Medium (2-4s)</span>' +
      '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#f97316"></span> Slow (4-8s)</span>' +
      '<span class="heatmap-legend-item"><span class="heatmap-legend-dot" style="background:#ef4444"></span> Very Slow (&gt;8s)</span>' +
    '</div>';
  section.style.display = 'block';
};
