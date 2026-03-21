// Schedule info — read-only display of the GitHub Actions cron schedule.
// The schedule is managed via .github/workflows/check-videos.yml (cron: '0 0,4,12 * * *')
// which runs at 00:00, 04:00, and 12:00 UTC = 8AM, 12PM, 8PM Philippine Time (UTC+8).
// There is no in-app schedule editor — changes require editing the workflow YAML.
window.KL = window.KL || {};

KL.initScheduleUI = function() {
  var section = document.getElementById('schedule-section');
  if (!section) return;
  section.style.display = 'block';

  // Clock icon SVG
  var clockSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';

  section.innerHTML =
    '<h3>Schedule</h3>' +
    '<div class="schedule-info-row">' +
      clockSvg +
      '<span>Runs automatically: <strong>8AM &middot; 12PM &middot; 8PM PH time</strong></span>' +
    '</div>' +
    '<p class="schedule-note"><small>Managed via GitHub Actions cron (<code>0 0,4,12 * * *</code> UTC). ' +
      'To change the schedule, edit <code>.github/workflows/check-videos.yml</code>.</small></p>';
};
