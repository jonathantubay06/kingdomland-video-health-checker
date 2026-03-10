// Filtering, sorting, pagination
window.KL = window.KL || {};

KL.matchesFilters = function(r) {
  const statusFilter = document.getElementById('filter-status').value;
  const sectionFilter = document.getElementById('filter-section').value;
  const searchTerm = document.getElementById('filter-search').value.toLowerCase();
  if (statusFilter !== 'all' && r.status !== statusFilter) return false;
  if (sectionFilter !== 'all' && (r.page + ' - ' + r.section) !== sectionFilter) return false;
  if (searchTerm && !r.title.toLowerCase().includes(searchTerm)) return false;
  return true;
};

window.applyFilters = function() {
  KL.currentPage = 1;
  KL.renderResultsTable();
};

window.sortBy = function(column) {
  if (KL.sortColumn === column) {
    KL.sortDir = KL.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    KL.sortColumn = column;
    KL.sortDir = 'asc';
  }
  KL.updateSortArrows();
  KL.renderResultsTable();
};

KL.updateSortArrows = function() {
  document.querySelectorAll('thead th').forEach(function(th) {
    var arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.col === KL.sortColumn) {
      arrow.textContent = KL.sortDir === 'asc' ? '\u25B2' : '\u25BC';
    } else {
      arrow.textContent = '';
    }
  });
};

KL.renderResultsTable = function() {
  var filtered = KL.state.results.filter(function(r) { return KL.matchesFilters(r); });
  filtered.sort(function(a, b) {
    var va = a[KL.sortColumn];
    var vb = b[KL.sortColumn];
    if (KL.sortColumn === 'duration') {
      va = parseInt(va) || 0;
      vb = parseInt(vb) || 0;
    } else if (KL.sortColumn === 'loadTimeMs') {
      va = va || 0;
      vb = vb || 0;
    } else if (typeof va === 'string') {
      va = va.toLowerCase();
      vb = (vb || '').toLowerCase();
    }
    if (va < vb) return KL.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return KL.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  KL.lastFilteredResults = filtered;

  var totalPages = KL.pageSize === 'all' ? 1 : Math.ceil(filtered.length / KL.pageSize) || 1;
  if (KL.currentPage > totalPages) KL.currentPage = totalPages;

  var start = KL.pageSize === 'all' ? 0 : (KL.currentPage - 1) * KL.pageSize;
  var end = KL.pageSize === 'all' ? filtered.length : start + KL.pageSize;
  var pageResults = filtered.slice(start, end);

  var tbody = document.getElementById('results-tbody');
  tbody.innerHTML = '';
  for (var i = 0; i < pageResults.length; i++) {
    tbody.appendChild(KL.createResultRow(pageResults[i]));
  }
  KL.updateResultCount(filtered.length, start + 1, Math.min(end, filtered.length));
  KL.renderPagination(totalPages);
};

KL.updateSectionFilterOptions = function() {
  var select = document.getElementById('filter-section');
  var currentVal = select.value;
  var sections = [...new Set(KL.state.results.map(function(r) { return r.page + ' - ' + r.section; }))];
  var existingOptions = new Set(Array.from(select.options).map(function(o) { return o.value; }));
  for (var i = 0; i < sections.length; i++) {
    if (!existingOptions.has(sections[i])) {
      var opt = document.createElement('option');
      opt.value = sections[i];
      opt.textContent = sections[i];
      select.appendChild(opt);
    }
  }
  select.value = currentVal;
};

KL.updateResultCount = function(filteredTotal, rangeStart, rangeEnd) {
  var total = KL.state.results.length;
  var el = document.getElementById('result-count');
  if (filteredTotal === undefined) {
    el.textContent = total + ' results';
    return;
  }
  if (KL.pageSize === 'all' || filteredTotal <= KL.pageSize) {
    el.textContent = filteredTotal === total ? total + ' results' : filteredTotal + ' of ' + total;
  } else {
    el.textContent = rangeStart + '-' + rangeEnd + ' of ' + filteredTotal + (filteredTotal !== total ? ' (filtered from ' + total + ')' : '');
  }
};

KL.renderPagination = function(totalPages) {
  var paginationEl = document.getElementById('pagination');
  var prevBtn = document.getElementById('page-prev');
  var nextBtn = document.getElementById('page-next');
  var pagesContainer = document.getElementById('pagination-pages');

  if (totalPages <= 1) {
    paginationEl.style.display = KL.pageSize === 'all' ? 'none' : 'flex';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    pagesContainer.innerHTML = KL.pageSize !== 'all' ? '<button class="active">1</button>' : '';
    return;
  }

  paginationEl.style.display = 'flex';
  prevBtn.disabled = KL.currentPage <= 1;
  nextBtn.disabled = KL.currentPage >= totalPages;

  pagesContainer.innerHTML = '';
  var pages = KL.buildPageNumbers(KL.currentPage, totalPages);
  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    if (p === '...') {
      var span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '...';
      pagesContainer.appendChild(span);
    } else {
      var btn = document.createElement('button');
      btn.textContent = p;
      if (p === KL.currentPage) btn.classList.add('active');
      btn.onclick = (function(page) { return function() { window.goToPage(page); }; })(p);
      pagesContainer.appendChild(btn);
    }
  }
};

KL.buildPageNumbers = function(current, total) {
  if (total <= 7) return Array.from({ length: total }, function(_, i) { return i + 1; });
  var pages = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  var start = Math.max(2, current - 1);
  var end = Math.min(total - 1, current + 1);
  for (var i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
};

window.changePage = function(delta) {
  KL.currentPage += delta;
  KL.renderResultsTable();
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.goToPage = function(page) {
  KL.currentPage = page;
  KL.renderResultsTable();
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.changePageSize = function() {
  var val = document.getElementById('page-size').value;
  KL.pageSize = val === 'all' ? 'all' : parseInt(val);
  KL.currentPage = 1;
  KL.renderResultsTable();
};
