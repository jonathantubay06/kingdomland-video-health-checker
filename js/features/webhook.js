// Webhook Notification (fire-and-forget)
window.KL = window.KL || {};

KL.notifyWebhook = function() {
  var summary = {
    total: KL.state.results.length,
    passed: KL.state.passedCount,
    failed: KL.state.failedCount,
    timeouts: KL.state.timeoutCount,
    rate: KL.state.results.length > 0
      ? Math.round((KL.state.passedCount / KL.state.results.length) * 100)
      : 0,
    timestamp: new Date().toISOString(),
  };

  fetch('/api/webhook-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  }).catch(function() {});
};
