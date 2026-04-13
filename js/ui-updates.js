// UI update functions — buttons, summary cards, progress, activity log
window.KL = window.KL || {};

KL.updateRunButtons = function() {
  const runBtn = document.getElementById('run-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (KL.state.status === 'running') {
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner"></span> Running...';
    stopBtn.style.display = 'inline-flex';
  } else {
    runBtn.disabled = false;
    runBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run Check';
    stopBtn.style.display = 'none';
  }
};

KL.updateStat = function(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const num = parseInt(value, 10);
  if (!isNaN(num) && KL.state.status === 'complete') {
    // Roll-up counter animation
    const start = parseInt(el.textContent, 10) || 0;
    const diff = num - start;
    if (diff !== 0) {
      const duration = Math.min(600, Math.abs(diff) * 18);
      const startTime = performance.now();
      el.classList.remove('counting');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('counting');
      const tick = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(start + diff * ease);
        if (t < 1) requestAnimationFrame(tick);
        else { el.textContent = num; el.classList.remove('counting'); }
      };
      requestAnimationFrame(tick);
    } else {
      el.textContent = num;
    }
  } else {
    el.textContent = value;
  }
};

KL.updateSummaryCards = function() {
  KL.updateStat('stat-total', KL.state.totalDiscovered || KL.state.checkedCount || '--');
  KL.updateStat('stat-passed', KL.state.passedCount || 0);
  KL.updateStat('stat-failed', KL.state.failedCount || 0);
  KL.updateStat('stat-timeout', KL.state.timeoutCount || 0);

  const total = KL.state.totalDiscovered || KL.state.checkedCount || 0;
  const passed = KL.state.passedCount || 0;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const passRateBar = document.getElementById('pass-rate-bar');
  const passRateFill = document.getElementById('pass-rate-fill');
  const passRateValue = document.getElementById('pass-rate-value');
  const passRateSubtitle = document.getElementById('stat-pass-rate');

  if (total > 0) {
    passRateBar.style.display = 'flex';
    passRateFill.style.width = rate + '%';
    if (rate < 90) {
      passRateFill.style.background = 'var(--color-fail)';
      passRateValue.style.color = 'var(--color-fail)';
    } else if (rate < 100) {
      passRateFill.style.background = 'var(--color-timeout)';
      passRateValue.style.color = 'var(--color-timeout)';
    } else {
      passRateFill.style.background = 'var(--color-pass)';
      passRateValue.style.color = 'var(--color-pass)';
    }
    passRateValue.textContent = rate + '%';
    if (passRateSubtitle) passRateSubtitle.textContent = `${rate}% of total`;

    // PASSED card celebration shimmer — glowing shimmer when every video passes
    var passCard = document.querySelector('.stat-card.card-pass');
    if (passCard) {
      if (KL.state.failedCount === 0 && KL.state.timeoutCount === 0 && total > 0) {
        passCard.classList.add('celebrate');
      } else {
        passCard.classList.remove('celebrate');
      }
    }

    // Slow videos pill — shows ⚠ N slow when videos exceed the Very Slow heatmap threshold (>20s Playwright)
    const slowPill = document.getElementById('slow-videos-pill');
    if (slowPill) {
      const slowCount = KL.state.results.filter(function(r) { return r.loadTimeMs && r.loadTimeMs > 50000; }).length;
      if (slowCount > 0) {
        slowPill.textContent = '⚠ ' + slowCount + ' slow';
        slowPill.style.display = 'inline-flex';
        slowPill.title = slowCount + ' video' + (slowCount > 1 ? 's' : '') + ' took >50s (Playwright) — likely >17s for real users. See heatmap below.';
      } else {
        slowPill.style.display = 'none';
      }
    }
  } else {
    passRateBar.style.display = 'none';
    if (passRateSubtitle) passRateSubtitle.textContent = '';
  }
};

KL.showProgress = function() {
  document.getElementById('progress-section').classList.add('visible');
  document.getElementById('empty-state').style.display = 'none';
};

KL.hideProgress = function() {
  document.getElementById('progress-section').classList.remove('visible');
};

KL.hideEmpty = function() {
  document.getElementById('empty-state').style.display = 'none';
};

KL.setPhase = function(phase) {
  KL.state.phase = phase;
  ['login', 'discovery', 'checking'].forEach(function(p) {
    var el = document.getElementById('phase-' + p);
    el.classList.remove('active', 'done');
  });
  if (phase === 'login') {
    document.getElementById('phase-login').classList.add('active');
  } else if (phase === 'discovery') {
    document.getElementById('phase-login').classList.add('done');
    document.getElementById('phase-discovery').classList.add('active');
  } else if (phase === 'checking') {
    document.getElementById('phase-login').classList.add('done');
    document.getElementById('phase-discovery').classList.add('done');
    document.getElementById('phase-checking').classList.add('active');
  }
};

KL.updateProgressText = function(text) {
  document.getElementById('progress-text').textContent = text;
};

KL.updateCheckProgress = function(result) {
  const total = KL.state.totalDiscovered || KL.state.checkedCount;
  const pct = total > 0 ? Math.round((KL.state.checkedCount / total) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-percent').textContent = pct + '%';
  const elapsed = Date.now() - KL.state.checkStartTime;
  const avgTime = elapsed / KL.state.checkedCount;
  const remaining = (total - KL.state.checkedCount) * avgTime;
  const etaMin = Math.floor(remaining / 60000);
  const etaSec = Math.floor((remaining % 60000) / 1000);
  const etaStr = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`;
  document.getElementById('progress-text').textContent =
    `${KL.state.checkedCount}/${total} videos checked` +
    (KL.state.checkedCount < total ? ` \u2022 ETA: ${etaStr}` : '');
  const icon = result.status === KL.STATUS.PASS ? '\u2705' : result.status === KL.STATUS.FAIL ? '\u274C' : '\u23F1\uFE0F';
  document.getElementById('current-video').textContent =
    `${icon} [${result.section || ''}] ${result.title}`;
  document.getElementById('results-section').classList.add('visible');
  document.getElementById('section-breakdown').classList.add('visible');
};

// Activity Log
window.toggleLog = function() {
  const body = document.getElementById('log-body');
  const toggle = document.getElementById('log-toggle');
  body.classList.toggle('open');
  toggle.classList.toggle('open');
};

KL.appendLog = function(message, isError) {
  if (isError === undefined) isError = false;
  const entries = document.getElementById('log-entries');
  const div = document.createElement('div');
  const isComplete = message.includes('Check complete');
  div.className = 'log-entry' + (isError ? ' error' : '') + (isComplete ? ' success' : '');
  const time = new Date().toLocaleTimeString();
  div.innerHTML = '<span class="log-time">' + time + '</span><span class="log-msg">' + KL.escHtml(message) + '</span>';
  entries.appendChild(div);
  const body = document.getElementById('log-body');
  body.scrollTop = body.scrollHeight;
  while (entries.children.length > 200) {
    entries.removeChild(entries.firstChild);
  }
  const countBadge = document.getElementById('log-count');
  if (countBadge) countBadge.textContent = entries.children.length;
};
