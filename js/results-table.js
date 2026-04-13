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
  if (KL.isFalsePositive && KL.isFalsePositive(r.title)) tr.classList.add('false-positive');
  // Subtle row tinting to make failures/timeouts easier to spot while scanning
  if (r.status === KL.STATUS.FAIL) tr.classList.add('row-fail');
  else if (r.status === KL.STATUS.TIMEOUT) tr.classList.add('row-timeout');
  tr.onclick = function(e) {
    if (e.target.classList.contains('star-btn') || e.target.classList.contains('video-title-link') || e.target.classList.contains('row-checkbox')) return;
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

  const isSelected = KL.state.selectedTitles && KL.state.selectedTitles.indexOf(r.title) !== -1;

  const thumbHtml = r.thumbnailUrl
    ? `<img class="result-thumb" src="${KL.escHtml(r.thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="result-thumb-placeholder"></div>`;

  tr.innerHTML = `
    <td><input type="checkbox" class="row-checkbox" data-title="${KL.escHtml(r.title)}" onclick="event.stopPropagation();KL.toggleBulkSelect(this)" ${isSelected ? 'checked' : ''}></td>
    <td><button class="${starClass}" data-title="${KL.escHtml(r.title)}" onclick="event.stopPropagation();toggleWatchlist('${KL.escHtml(r.title).replace(/'/g, "\\'")}')">${starChar}</button></td>
    <td>${r.number}</td>
    <td>
      <div class="result-title-cell">
        ${thumbHtml}
        <strong><span class="video-title-link" onclick="event.stopPropagation();showVideoDetail('${KL.escHtml(r.title).replace(/'/g, "\\'")}')">${KL.escHtml(r.title)}</span></strong> ${screenshotIcon}
      </div>
    </td>
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

  // "Open Video Page" button — direct link to the actual page on go.kingdomlandkids.com
  const openPageBtn = r.url
    ? '<a href="' + KL.escHtml(r.url) + '" target="_blank" rel="noopener" class="btn-open-page">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>' +
        ' Open Video Page</a>'
    : '';

  const detailRow = document.createElement('tr');
  detailRow.id = 'detail-' + num;
  detailRow.className = 'detail-row';
  detailRow.innerHTML = `
    <td colspan="11">
      <div class="detail-content">
        <div><strong>URL:</strong> <a href="${KL.escHtml(r.url || '')}" target="_blank">${KL.escHtml(r.url || 'N/A')}</a></div>
        <div><strong>HLS Source:</strong> ${KL.escHtml(r.hlsSrc || 'N/A')}</div>
        <div><strong>Resolution:</strong> ${r.resolution || 'N/A'}</div>
        ${r.error ? '<div><strong>Error:</strong> ' + KL.escHtml(r.error) + '</div>' : ''}
        ${r.duration ? '<div><strong>Duration:</strong> ' + r.duration + '</div>' : ''}
        <div><strong>Load Time:</strong> ${r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : 'N/A'}</div>
        ${screenshotHtml}
        ${openPageBtn}
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
