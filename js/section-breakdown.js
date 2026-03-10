// Section breakdown rendering
window.KL = window.KL || {};

KL.updateSectionBreakdown = function() {
  const grid = document.getElementById('section-grid');
  grid.innerHTML = '';
  for (const [key, s] of Object.entries(KL.state.sectionMap)) {
    const rate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'section-card';
    card.innerHTML = `
      <div class="section-card-header">
        <span class="section-name">${KL.escHtml(s.section)}</span>
        <span class="section-page-badge badge-${s.page === 'STORY' ? 'story' : 'music'}">${s.page}</span>
      </div>
      <div class="section-bar-wrapper">
        <div class="section-bar-fill" style="width:${rate}%"></div>
      </div>
      <div class="section-stats">
        <span><span class="pass-count">${s.passed}</span> passed</span>
        <span><span class="fail-count">${s.failed + s.timeout}</span> failed</span>
        <span>${rate}%</span>
      </div>
    `;
    grid.appendChild(card);
  }
};
