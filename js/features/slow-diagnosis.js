// Slow Video Diagnosis — explains WHY a video is slow by analyzing
// its current result against patterns (duration, resolution, history, peers).
// Used in the video detail modal and the results table expanded row.
window.KL = window.KL || {};

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

  // Determine severity based on current thresholds
  let severity = 'green';
  if (lt >= 20000)      severity = 'red';
  else if (lt >= 12000) severity = 'orange';
  else if (lt >= 6000)  severity = 'yellow';

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
 */
KL.renderSlowDiagnosis = function(diagnosis) {
  if (!diagnosis || diagnosis.severity === 'green') return '';
  const badgeClass = 'sd-badge sd-badge-' + diagnosis.severity;
  const badgeText = diagnosis.severity === 'red' ? 'VERY SLOW'
                  : diagnosis.severity === 'orange' ? 'SLOW'
                  : 'MEDIUM';
  const items = diagnosis.reasons.map(r =>
    '<li><span class="sd-icon">' + r.icon + '</span>' + KL.escHtml(r.text) + '</li>'
  ).join('');

  return '<div class="slow-diagnosis">' +
    '<div class="sd-header"><span class="' + badgeClass + '">' + badgeText + '</span>' +
    '<strong>Why is this slow?</strong></div>' +
    '<ul class="sd-list">' + items + '</ul>' +
  '</div>';
};
