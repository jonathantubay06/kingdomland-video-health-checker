// Video Diagnosis — explains WHY a video is slow or failed by analyzing
// its current result against patterns (duration, resolution, history, peers,
// error grouping). Used in the video detail modal and chart-bar investigation.
window.KL = window.KL || {};

/**
 * Decode common HTML5 MediaError codes into human-readable explanations.
 */
KL.explainMediaError = function(errorText) {
  if (!errorText) return null;
  const e = String(errorText);
  if (/SRC_NOT_SUPPORTED/i.test(e)) {
    return 'The browser could not decode the video stream. This usually means the CDN served a corrupt or wrong-format manifest (HTML error page instead of .m3u8), or the codec is incompatible. When this affects ALL videos at once, it is almost always a CDN/streaming-server outage.';
  }
  if (/NETWORK/i.test(e)) {
    return 'Network error while fetching the video — connection dropped, CDN returned a 5xx, or DNS issue. If many videos share this error, the CDN is having problems.';
  }
  if (/DECODE/i.test(e)) {
    return 'The browser received the video but could not decode it. Likely the file is corrupted or uses an unsupported codec variant.';
  }
  if (/ABORTED/i.test(e)) {
    return 'Loading was aborted before the video could play. Possibly a navigation race or the player gave up.';
  }
  if (/No <video> element found/i.test(e)) {
    return 'The watch page loaded but never rendered a video player. The page likely showed an error state or the player JS failed to initialize.';
  }
  if (/Card click did not navigate/i.test(e)) {
    return 'Clicking the card on the homepage didn\'t navigate to the watch page. The card might have a broken onClick handler (often caused by missing video metadata like durationSeconds=0).';
  }
  if (/Execution context was destroyed/i.test(e)) {
    return 'The page was navigating away while we tried to inspect it — typically a redirect race. Usually a transient one-off.';
  }
  if (/timeout|Did not load in/i.test(e)) {
    return 'The video player rendered but never reached a playable state within the time limit. Could be slow CDN, large file, or buffering issue.';
  }
  return null;
};

/**
 * Analyze a slow video and return diagnostic bullets.
 * @param {Object} result    - the video result from current run (has loadTimeMs, duration, resolution, section, hlsSrc)
 * @param {Array}  history   - array of per-video history entries
 *                             [{ timestamp, status, loadTimeMs, error }]
 * @param {Array}  allResults- all videos from the current run (used for peer-section comparison)
 * @returns {{severity:'red'|'orange'|'yellow'|'green', findings: string[], reasons: Array<{icon,text}>}}
 */
KL.diagnoseSlowVideo = function(result, history, allResults) {
  history = history || [];
  allResults = allResults || [];
  const reasons = [];

  const lt = result.loadTimeMs || 0;
  const status = result.status || '';
  const isError = status === 'FAIL' || status === 'TIMEOUT';

  // Determine severity. Errors take priority over slowness.
  let severity = 'green';
  if (isError)               severity = 'error';
  else if (lt >= 20000)      severity = 'red';
  else if (lt >= 12000)      severity = 'orange';
  else if (lt >= 6000)       severity = 'yellow';

  // ============================================================
  // ERROR DIAGNOSIS (FAIL or TIMEOUT)
  // ============================================================
  if (isError) {
    // 1. Show the technical error itself first
    if (result.error) {
      reasons.push({ icon: '🔍', text: 'Technical error: ' + result.error });
    }

    // 2. Decode common errors into plain-English
    const explanation = KL.explainMediaError(result.error);
    if (explanation) {
      reasons.push({ icon: '💡', text: explanation });
    }

    // 3. OUTAGE DETECTION — are MANY videos in this same run failing with the same error?
    if (result.error && allResults.length > 0) {
      const sameError = allResults.filter(r => (r.status === 'FAIL' || r.status === 'TIMEOUT') && r.error === result.error);
      const totalRun = allResults.length;
      const pct = totalRun > 0 ? Math.round(sameError.length / totalRun * 100) : 0;

      if (sameError.length >= totalRun * 0.5 && totalRun >= 10) {
        reasons.push({
          icon: '🚨',
          text: 'PROBABLE OUTAGE: ' + sameError.length + ' of ' + totalRun + ' videos (' + pct + '%) failed with this exact same error. This is almost certainly a CDN/streaming-server incident, not individual video problems.',
        });
      } else if (sameError.length >= 5) {
        reasons.push({
          icon: '🌐',
          text: sameError.length + ' other videos in this run had the same error. Likely a CDN edge issue or shared dependency problem.',
        });
      } else if (sameError.length === 1) {
        reasons.push({ icon: '🎯', text: 'Only this video failed with this error — likely specific to this video, not a platform-wide issue.' });
      }
    }

    // 4. Historical failure pattern
    const ownHistory = history.filter(h => h.status);
    if (ownHistory.length >= 3) {
      const failed = ownHistory.filter(h => h.status === 'FAIL' || h.status === 'TIMEOUT');
      const lastPass = [...ownHistory].reverse().find(h => h.status === 'PASS');
      if (failed.length === ownHistory.length) {
        reasons.push({ icon: '❌', text: 'NEVER passed — failed on all ' + ownHistory.length + ' recorded runs. This video may have permanent issues.' });
      } else if (failed.length / ownHistory.length >= 0.5) {
        reasons.push({ icon: '⚠', text: 'Frequently failing — ' + failed.length + ' of ' + ownHistory.length + ' past runs failed.' });
      } else if (lastPass) {
        reasons.push({ icon: '✅', text: 'Last passed: ' + new Date(lastPass.timestamp).toLocaleString() + '. Was working recently — likely transient.' });
      }
    } else if (ownHistory.length === 0) {
      reasons.push({ icon: '🆕', text: 'No prior runs to compare against — first time being checked.' });
    }

    // 5. HLS source visibility
    if (result.hlsSrc) {
      reasons.push({ icon: '🔗', text: 'HLS source: ' + result.hlsSrc.substring(0, 80) + (result.hlsSrc.length > 80 ? '…' : '') });
    }

    return { severity, findings: reasons.map(r => r.icon + ' ' + r.text), reasons };
  }

  if (severity === 'green') {
    return { severity, findings: [], reasons: [] };
  }

  // ---- 1. Video duration analysis ----
  // Parse duration: "165s" → 165 seconds
  let durSec = 0;
  if (result.duration) {
    const m = String(result.duration).match(/(\d+)/);
    if (m) durSec = parseInt(m[1], 10);
  }
  if (durSec >= 300) {
    reasons.push({
      icon: '⏱',
      text: 'Long video (' + Math.floor(durSec / 60) + 'm ' + (durSec % 60) + 's) — more HLS segments to load means longer warmup.',
    });
  } else if (durSec >= 120) {
    reasons.push({
      icon: '⏱',
      text: 'Medium-length video (' + Math.floor(durSec / 60) + 'm ' + (durSec % 60) + 's) — moderate segment count.',
    });
  }

  // ---- 2. Resolution analysis ----
  if (result.resolution) {
    const parts = result.resolution.split('x');
    const height = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (height >= 1080) {
      reasons.push({ icon: '📺', text: 'High resolution (' + result.resolution + ') — larger file size = slower first byte.' });
    } else if (height >= 720) {
      reasons.push({ icon: '📺', text: 'HD resolution (' + result.resolution + ').' });
    }
  }

  // ---- 3. Historical pattern ----
  // Was this video ALWAYS slow, or is it slow now but was fast before?
  const ownHistory = history.filter(h => h.loadTimeMs && h.loadTimeMs > 0);
  if (ownHistory.length >= 3) {
    const avgLt = ownHistory.reduce((s, h) => s + h.loadTimeMs, 0) / ownHistory.length;
    const recentFast = ownHistory.slice(-5).filter(h => h.loadTimeMs < 6000).length;
    const olderSlow = ownHistory.slice(0, -5).filter(h => h.loadTimeMs >= 12000).length;

    if (avgLt < 6000 && lt >= 12000) {
      reasons.push({
        icon: '📉',
        text: 'Recently degraded: historically averaged ' + (avgLt / 1000).toFixed(1) + 's, now ' + (lt / 1000).toFixed(1) + 's. Likely temporary CDN issue or cold cache.',
      });
    } else if (avgLt >= 12000 && lt >= 12000) {
      reasons.push({
        icon: '📊',
        text: 'Persistently slow across ' + ownHistory.length + ' past runs (avg ' + (avgLt / 1000).toFixed(1) + 's). May need re-encoding.',
      });
    } else if (recentFast >= 3) {
      reasons.push({
        icon: '⚡',
        text: 'Usually fast (' + recentFast + ' of last 5 runs were <6s). This run is an outlier — likely a one-off network blip.',
      });
    }
  } else if (ownHistory.length === 0) {
    reasons.push({ icon: '🆕', text: 'No previous runs to compare against — first time being checked.' });
  }

  // ---- 4. Peer-section comparison ----
  // Are other videos in the same section also slow this run?
  if (result.section && allResults.length > 0) {
    const peers = allResults.filter(r => r.section === result.section && r.title !== result.title && r.loadTimeMs);
    if (peers.length >= 2) {
      const peerSlow = peers.filter(r => r.loadTimeMs >= 12000).length;
      const peerAvg = peers.reduce((s, r) => s + r.loadTimeMs, 0) / peers.length;
      if (peerSlow >= peers.length / 2) {
        reasons.push({
          icon: '👥',
          text: peerSlow + ' of ' + peers.length + ' other videos in "' + result.section + '" are also slow — likely a section-wide CDN issue, not this specific video.',
        });
      } else if (peerAvg < 6000) {
        reasons.push({
          icon: '🎯',
          text: 'Section "' + result.section + '" peers averaged ' + (peerAvg / 1000).toFixed(1) + 's — this video stands out as slow.',
        });
      }
    }
  }

  // ---- 5. CDN / HLS analysis ----
  if (result.hlsSrc) {
    // Check if HLS source is the master manifest (vs a variant)
    if (/master\.m3u8/i.test(result.hlsSrc)) {
      // master manifests don't fully explain slowness on their own
    }
  }

  // ---- 6. Generic note if nothing specific ----
  if (reasons.length === 0) {
    if (severity === 'red') {
      reasons.push({ icon: '🤔', text: 'Slow load time but no obvious pattern. Could be a transient network blip or CDN edge issue.' });
    } else {
      reasons.push({ icon: '🟡', text: 'Moderately slow — within tolerance but worth watching if it persists.' });
    }
  }

  return {
    severity,
    findings: reasons.map(r => r.icon + ' ' + r.text),
    reasons,
  };
};

/**
 * Render the diagnosis as an HTML block for the video detail modal.
 * Handles both slow (yellow/orange/red) and failed (error) videos.
 */
KL.renderSlowDiagnosis = function(diagnosis) {
  if (!diagnosis || diagnosis.severity === 'green') return '';

  const badgeClass = 'sd-badge sd-badge-' + diagnosis.severity;
  const badgeText = diagnosis.severity === 'error'  ? 'FAILED'
                  : diagnosis.severity === 'red'    ? 'VERY SLOW'
                  : diagnosis.severity === 'orange' ? 'SLOW'
                  : 'MEDIUM';
  const headerText = diagnosis.severity === 'error'
    ? 'What went wrong?'
    : 'Why is this slow?';
  const wrapperClass = diagnosis.severity === 'error' ? 'slow-diagnosis sd-error' : 'slow-diagnosis';

  const items = diagnosis.reasons.map(r =>
    '<li><span class="sd-icon">' + r.icon + '</span>' + KL.escHtml(r.text) + '</li>'
  ).join('');

  return '<div class="' + wrapperClass + '">' +
    '<div class="sd-header"><span class="' + badgeClass + '">' + badgeText + '</span>' +
    '<strong>' + headerText + '</strong></div>' +
    '<ul class="sd-list">' + items + '</ul>' +
  '</div>';
};

/**
 * Analyze an ENTIRE run (from history.json) and group failures by error.
 * Used by the chart-bar click-to-investigate feature.
 * @param {Object} historyEntry - { timestamp, total, passed, failed, timeouts, videos: [...] }
 * @returns {{summary:string, isOutage:boolean, errorGroups:Array, failedVideos:Array}}
 */
KL.diagnoseRun = function(historyEntry) {
  if (!historyEntry || !historyEntry.videos) {
    return { summary: 'No per-video data for this run.', isOutage: false, errorGroups: [], failedVideos: [] };
  }
  const failed = historyEntry.videos.filter(v => v.status === 'FAIL' || v.status === 'TIMEOUT');
  const total = historyEntry.videos.length;

  // Group by error message
  const byError = {};
  for (const v of failed) {
    const err = (v.error || '(no error message)').trim();
    if (!byError[err]) byError[err] = { error: err, count: 0, examples: [], httpDiagnosis: null, httpStatus: null };
    byError[err].count++;
    if (byError[err].examples.length < 5) byError[err].examples.push(v.title);
    // Capture the real HTTP diagnosis (definitive cause) from the first video that has one
    if (!byError[err].httpDiagnosis && v.failureDiagnosis) byError[err].httpDiagnosis = v.failureDiagnosis;
    if (byError[err].httpStatus == null && v.httpStatus != null) byError[err].httpStatus = v.httpStatus;
  }
  const errorGroups = Object.values(byError).sort((a, b) => b.count - a.count);

  // Outage detection: >50% of videos failed with the same top error
  const topGroup = errorGroups[0];
  const isOutage = !!(topGroup && total >= 10 && topGroup.count / total >= 0.5);

  let summary;
  if (failed.length === 0) {
    summary = 'All ' + total + ' videos passed in this run.';
  } else if (isOutage) {
    summary = '🚨 PROBABLE OUTAGE: ' + topGroup.count + '/' + total + ' videos failed with the same error — CDN/streaming-side incident.';
  } else {
    summary = failed.length + '/' + total + ' videos failed across ' + errorGroups.length + ' distinct error type' + (errorGroups.length === 1 ? '' : 's') + '.';
  }
  return { summary, isOutage, errorGroups, failedVideos: failed };
};

/**
 * Render a full run's investigation as HTML (for the chart-bar click modal).
 */
KL.renderRunInvestigation = function(historyEntry, diagnosis) {
  if (!historyEntry) return '<p>No data.</p>';

  const date = new Date(historyEntry.timestamp);
  const dateStr = date.toLocaleString();

  let html = '<div class="run-investigation">';
  html += '<div class="ri-header">';
  html += '<div><strong>Run at:</strong> ' + dateStr + '</div>';
  html += '<div><strong>Result:</strong> ' + (historyEntry.passed || 0) + ' passed / ' + (historyEntry.failed || 0) + ' failed / ' + (historyEntry.timeouts || 0) + ' timed out (' + (historyEntry.total || 0) + ' total)</div>';
  html += '</div>';

  if (diagnosis.isOutage) {
    html += '<div class="ri-outage-banner">🚨 ' + KL.escHtml(diagnosis.summary) + '</div>';
  } else {
    html += '<p class="ri-summary">' + KL.escHtml(diagnosis.summary) + '</p>';
  }

  if (diagnosis.errorGroups.length > 0) {
    html += '<h4 class="ri-section-title">Error breakdown</h4>';
    html += '<div class="ri-error-groups">';
    for (const g of diagnosis.errorGroups) {
      html += '<div class="ri-error-group">';
      html += '<div class="ri-error-header"><span class="ri-error-count">' + g.count + '</span><code>' + KL.escHtml(g.error) + '</code></div>';
      // Prefer the REAL HTTP diagnosis (definitive: rate-limit vs outage vs missing);
      // fall back to the generic media-error explanation for older reports.
      if (g.httpDiagnosis) {
        html += '<div class="ri-error-explanation ri-http-diagnosis">' + KL.escHtml(g.httpDiagnosis) + '</div>';
      } else {
        const explanation = KL.explainMediaError(g.error);
        if (explanation) {
          html += '<div class="ri-error-explanation">💡 ' + KL.escHtml(explanation) + '</div>';
        }
      }
      if (g.examples.length > 0) {
        html += '<div class="ri-error-examples"><strong>Sample videos:</strong> ' + g.examples.map(t => KL.escHtml(t)).join(', ');
        if (g.count > g.examples.length) html += ', <em>and ' + (g.count - g.examples.length) + ' more</em>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
};

/**
 * Open the Run Investigation modal for a specific history entry (clicked chart bar).
 */
window.openRunInvestigation = function(historyEntry) {
  const modal = document.getElementById('run-investigation-modal');
  const body = document.getElementById('run-investigation-body');
  const title = document.getElementById('run-investigation-title');
  if (!modal || !body) return;

  const diagnosis = KL.diagnoseRun(historyEntry);
  title.textContent = diagnosis.isOutage
    ? 'Run Investigation — 🚨 Outage detected'
    : (historyEntry.failed > 0 || historyEntry.timeouts > 0
        ? 'Run Investigation — ' + (historyEntry.failed + historyEntry.timeouts) + ' issues'
        : 'Run Investigation — all passed');
  body.innerHTML = KL.renderRunInvestigation(historyEntry, diagnosis);
  modal.style.display = 'flex';
};

window.closeRunInvestigation = function() {
  const modal = document.getElementById('run-investigation-modal');
  if (modal) modal.style.display = 'none';
};
