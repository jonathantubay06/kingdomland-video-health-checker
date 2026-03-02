// Forwards check results to a configured webhook URL
// Env vars needed: WEBHOOK_URL (optional — Slack, Discord, or any URL)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped', reason: 'No WEBHOOK_URL configured' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const summary = payload.summary;
  if (!summary) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing summary' }) };
  }

  // Build a human-readable message
  const rate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const icon = rate >= 99 ? '✅' : rate >= 90 ? '⚠️' : '🚨';
  const text = `${icon} *Kingdomland Video Check Complete*\n` +
    `Pass rate: *${rate}%* (${summary.passed}/${summary.total})\n` +
    (summary.failed > 0 ? `Failed: *${summary.failed}*\n` : '') +
    (summary.timeouts > 0 ? `Timed out: *${summary.timeouts}*\n` : '') +
    `_${new Date().toISOString()}_`;

  try {
    // Try Slack-style payload first, then fallback to generic
    const isSlack = webhookUrl.includes('hooks.slack.com');
    const body = isSlack
      ? JSON.stringify({ text })
      : JSON.stringify({ event: 'check_complete', summary, message: text, timestamp: new Date().toISOString() });

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent', webhookStatus: res.status }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook delivery failed: ' + err.message }),
    };
  }
};
