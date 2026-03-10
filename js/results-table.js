// Results table — row creation, detail toggling
window.KL = window.KL || {};

KL.appendResultRow = function(r) {
  const tbody = document.getElementById('results-tbody');
  if (!KL.matchesFilters(r)) return;
  const tr = KL.createResultRow(r);
  tbody.appendChild(tr);
  KL.updateSectionFilterOptions();
  KL.updateResultCount();
};

KL.createResultRow = function(r) {
  const tr = document.createElement('tr');
  tr.dataset.num = r.number;
  tr.onclick = function(e) {
    if (e.target.classList.contains('star-btn') || e.target.classList.contains('video-title-link')) return;
    KL.toggleDetail(r.number);
  };
  const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
  const errorText = r.error ? (r.error.length > 40 ? r.error.substring(0, 40) + '...' : r.error) : '-';

  let loadTimeClass = '';
  if (r.loadTimeMs) {
    if (r.loadTimeMs < 3000) loadTimeClass = 'load-fast';
    else if (r.loadTimeMs < 8000) loadTimeClass = 'load-medium';
    else loadTimeClass = 'load-slow';
  }

  const watchlist = KL.getWatchlist();
  const isStarred = watchlist.includes(r.title);
  const starClass = isStarred ? 'star-btn starred' : 'star-btn';
  const starChar = isStarred ? '\u2605' : '\u2606';

  const screenshotIcon = r.screenshot
    ? '<span class="screenshot-indicator" title="Has screenshot">&#128247;</span>'
    : '';

  tr.innerHTML = `
    <td><button class="${starClass}" data-title="${KL.escHtml(r.title)}" onclick="event.stopPropagation();toggleWatchlist('${KL.escHtml(r.title).replace(/'/g, "\\'")}')">${starChar}</button></td>
    <td>${r.number}</td>
    <td><strong><span class="video-title-link" onclick="event.stopPropagation();showVideoDetail('${KL.escHtml(r.title).replace(/'/g, "\\'")}')">${KL.escHtml(r.title)}</span></strong> ${screenshotIcon}</td>
    <td>${KL.escHtml(r.section || '')}</td>
    <td>${r.page || ''}</td>
    <td><span class="status-badge status-${r.status}">${r.status}</span></td>
    <td>${r.duration || '-'}</td>
    <td><span class="${loadTimeClass}">${loadTime}</span></td>
    <td style="color:var(--color-text-muted);font-size:0.82rem">${KL.escHtml(errorText)}</td>
  `;
  return tr;
};

KL.toggleDetail = function(num) {
  const existing = document.getElementById('detail-' + num);
  if (existing) { existing.remove(); return; }
  const r = KL.state.results.find(function(r) { return r.number === num; });
  if (!r) return;

  const screenshotHtml = r.screenshot
    ? '<div style="margin-top:8px"><strong>Screenshot:</strong><br><img src="' + KL.escHtml(r.screenshot) + '" class="screenshot-thumb" alt="Failure screenshot" onclick="window.open(this.src,\'_blank\')"></div>'
    : '';

  const detailRow = document.createElement('tr');
  detailRow.id = 'detail-' + num;
  detailRow.className = 'detail-row';
  detailRow.innerHTML = `
    <td colspan="10">
      <div class="detail-content">
        <div><strong>URL:</strong> <a href="${KL.escHtml(r.url || '')}" target="_blank">${KL.escHtml(r.url || 'N/A')}</a></div>
        <div><strong>HLS Source:</strong> ${KL.escHtml(r.hlsSrc || 'N/A')}</div>
        <div><strong>Resolution:</strong> ${r.resolution || 'N/A'}</div>
        ${r.error ? '<div><strong>Error:</strong> ' + KL.escHtml(r.error) + '</div>' : ''}
        ${r.duration ? '<div><strong>Duration:</strong> ' + r.duration + '</div>' : ''}
        <div><strong>Load Time:</strong> ${r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : 'N/A'}</div>
        ${screenshotHtml}
      </div>
    </td>
  `;
  const rows = document.getElementById('results-tbody').querySelectorAll('tr');
  for (const row of rows) {
    if (row.dataset.num == num) {
      row.after(detailRow);
      break;
    }
  }
};
