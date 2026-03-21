// Push notifications — shows a "not available" state when VAPID keys are not configured.
// To enable: generate VAPID keys (`npx web-push generate-vapid-keys`) and set
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in Netlify environment variables.
window.KL = window.KL || {};

KL.initPushUI = function() {
  var section = document.getElementById('push-notifications-section');
  if (!section) return;
  section.style.display = 'block';

  // Bell icon SVG
  var bellSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.4"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

  section.innerHTML =
    '<h3>Push Notifications</h3>' +
    '<div class="push-unavailable">' +
      bellSvg +
      '<span>Not available &mdash; VAPID keys not configured</span>' +
    '</div>';
};
