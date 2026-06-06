/**
 * Dead-man's switch — alerts if the video checker has gone silent.
 *
 * Run independently (separate GitHub Actions workflow) from the main check.
 * Reads history.json (fetched from the data branch) and, if the most recent
 * run is older than STALE_HOURS, posts a Slack alert. This catches the case
 * where the main workflow itself is broken (expired secret, YAML error,
 * Actions quota exhausted) — situations the main checker can't report on
 * because it never runs.
 *
 * Env:
 *   SLACK_WEBHOOK_URL  — required to send the alert
 *   STALE_HOURS        — optional, default 12 (max normal gap is 8h)
 *
 * Exit codes: always 0 (a missing/fresh report is not a workflow failure).
 */

const fs = require('fs');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const STALE_HOURS = parseInt(process.env.STALE_HOURS, 10) || 12;
const HISTORY_FILE = process.env.HISTORY_FILE || 'history.json';

async function postToSlack(text, blocks) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('No SLACK_WEBHOOK_URL set — would have alerted:', text);
    return false;
  }
  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });
    return res.ok;
  } catch (err) {
    console.error('Slack post failed:', err.message);
    return false;
  }
}

function hoursSince(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return Infinity;
  return (Date.now() - then) / (1000 * 60 * 60);
}

(async () => {
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { history = []; }
  }

  // No history at all — the checker has never produced a report.
  if (!Array.isArray(history) || history.length === 0) {
    console.log('No history found — alerting (checker has never run, or data branch missing history.json).');
    await postToSlack(':warning: Heartbeat: no video-check history found. The checker may never have run successfully.', [
      {
        type: 'header',
        text: { type: 'plain_text', text: ':warning: Video Checker Heartbeat — No Data', emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'No `history.json` found on the data branch. The scheduled video check may not be running. Check the GitHub Actions workflow.' },
      },
    ]);
    process.exit(0);
  }

  const last = history[history.length - 1];
  const age = hoursSince(last.timestamp);

  if (age > STALE_HOURS) {
    const ageStr = age === Infinity ? 'unknown' : age.toFixed(1) + 'h';
    console.log(`STALE: last run was ${ageStr} ago (threshold ${STALE_HOURS}h) — alerting.`);
    await postToSlack(
      `:rotating_light: Heartbeat: no video check in ${ageStr} (expected every few hours). The scheduled checker may be broken.`,
      [
        {
          type: 'header',
          text: { type: 'plain_text', text: ':rotating_light: Video Checker Has Gone Silent', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `The last successful video check was *${ageStr} ago* — that's past the ${STALE_HOURS}h threshold.\n\nThe scheduled GitHub Actions check may have stopped running (expired secret, workflow error, or Actions quota). *No video health data is being collected right now.*`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Last run:*\n${new Date(last.timestamp).toLocaleString()}` },
            { type: 'mrkdwn', text: `*Last result:*\n${last.passed || 0}/${last.total || 0} passed` },
          ],
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: 'Check: github.com/jonathantubay06/kingdomland-video-health-checker/actions' }],
        },
      ]
    );
  } else {
    console.log(`OK: last run was ${age.toFixed(1)}h ago (threshold ${STALE_HOURS}h). No alert needed.`);
  }
  process.exit(0);
})();
