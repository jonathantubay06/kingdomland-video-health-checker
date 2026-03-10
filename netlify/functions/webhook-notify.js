// Forwards check results to a configured webhook URL
// Env vars needed: WEBHOOK_URL (optional — Slack, Discord, or any URL)
//                  SLACK_WEBHOOK_URL (optional — dedicated Slack webhook for Block Kit)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl && !slackUrl) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped', reason: 'No WEBHOOK_URL or SLACK_WEBHOOK_URL configured' }),
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

  const rate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const icon = rate >= 99 ? ':white_check_mark:' : rate >= 90 ? ':warning:' : ':rotating_light:';
  const results = [];

  // Send Block Kit message to Slack if configured
  if (slackUrl || (webhookUrl && webhookUrl.includes('hooks.slack.com'))) {
    const targetUrl = slackUrl || webhookUrl;
    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${icon} Video Check Complete`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Pass Rate:*\n${rate}% (${summary.passed}/${summary.total})` },
          { type: 'mrkdwn', text: `*Failed:* ${summary.failed}  |  *Timed Out:* ${summary.timeouts || 0}` },
        ],
      },
    ];

    // Add performance alerts if included
    const perfAlerts = payload.performanceAlerts || [];
    if (perfAlerts.length > 0) {
      const perfLines = perfAlerts.slice(0, 10).map(a =>
        `:snail: *${a.title}* — ${(a.loadTimeMs / 1000).toFixed(1)}s (${a.level})`
      );
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '*Performance Alerts:*\n' + perfLines.join('\n') },
      });
    }

    if (payload.runId) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Run ID: ${payload.runId}  |  ${new Date().toISOString()}` },
        ],
      });
    }

    const fallback = `${icon} Video Check: ${rate}% pass rate (${summary.failed} failed)`;

    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fallback, blocks }),
      });
      results.push({ target: 'slack', status: res.status });
    } catch (err) {
      results.push({ target: 'slack', error: err.message });
    }
  }

  // Send to generic webhook (non-Slack) if configured separately
  if (webhookUrl && !webhookUrl.includes('hooks.slack.com')) {
    const emojiIcon = rate >= 99 ? '\u2705' : rate >= 90 ? '\u26A0\uFE0F' : '\uD83D\uDEA8';
    const text = `${emojiIcon} Kingdomland Video Check Complete\n` +
      `Pass rate: ${rate}% (${summary.passed}/${summary.total})\n` +
      (summary.failed > 0 ? `Failed: ${summary.failed}\n` : '') +
      (summary.timeouts > 0 ? `Timed out: ${summary.timeouts}\n` : '');

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'check_complete',
          summary,
          performanceAlerts: payload.performanceAlerts || [],
          message: text,
          timestamp: new Date().toISOString(),
          runId: payload.runId,
        }),
      });
      results.push({ target: 'webhook', status: res.status });
    } catch (err) {
      results.push({ target: 'webhook', error: err.message });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'sent', results }),
  };
};
