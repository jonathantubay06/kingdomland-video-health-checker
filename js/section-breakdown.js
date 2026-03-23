// Section breakdown rendering
window.KL = window.KL || {};

KL.updateSectionBreakdown = function() {
  const grid = document.getElementById('section-grid');
  grid.innerHTML = '';
  const entries = Object.entries(KL.state.sectionMap);
  entries.forEach(function([key, s]) {
    const rate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'section-card';
    // Store rate for bar animation — triggered by IntersectionObserver, not immediately
    card.dataset.rate = rate;
    card.innerHTML = `
      <div class="section-card-header">
        <span class="section-name">${KL.escHtml(s.section)}</span>
        <span class="section-page-badge badge-${s.page === 'STORY' ? 'story' : 'music'}">${s.page}</span>
      </div>
      <div class="section-bar-wrapper">
        <div class="section-bar-fill" style="width:0%"></div>
      </div>
      <div class="section-stats">
        <span><span class="pass-count">${s.passed}</span> passed</span>
        <span><span class="fail-count">${s.failed + s.timeout}</span> failed</span>
        <span>${rate}%</span>
      </div>
    `;
    // Click card → filter results table to that section and scroll to it
    (function(page, section) {
      card.style.cursor = 'pointer';
      card.title = 'Click to filter results by ' + section;
      card.addEventListener('click', function() {
        var filterEl = document.getElementById('filter-section');
        if (filterEl) {
          filterEl.value = page + ' - ' + section;
          if (window.applyFilters) applyFilters();
          var resultsEl = document.getElementById('results-section');
          if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    })(s.page, s.section);

    grid.appendChild(card);
  });

  // Animate cards + bars only when the grid scrolls into the viewport
  KL.onEnterViewport(grid, function() {
    var cards = grid.querySelectorAll('.section-card');
    cards.forEach(function(card, i) {
      setTimeout(function() {
        card.classList.add('in-view');
        var fill = card.querySelector('.section-bar-fill');
        var targetRate = parseInt(card.dataset.rate || 0);
        if (fill) setTimeout(function() { fill.style.width = targetRate + '%'; }, 420);
      }, i * 50);
    });
  });
};
