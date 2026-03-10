/**
 * Slack notification helpers using Block Kit formatting.
 *
 * Env vars:
 *   SLACK_WEBHOOK_URL  — Slack incoming webhook URL
 */

import type { CheckSummary, PerformanceAlert, HistoryEntry } from '../src/types';

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

interface FailedVideo {
  title: string;
  section?: string;
  error?: string;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

/**
 * Post a Block Kit message to Slack.
 * Returns true on success, false if skipped or failed.
 */
export async function postToSlack(blocks: SlackBlock[], text: string): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) return false;

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });
    return res.ok;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Slack notification failed:', message);
    return false;
  }
}

/**
 * Send an alert when videos fail a check.
 * Includes a summary header + list of up to 15 failed videos.
 */
export async function sendSlackFailureAlert(
  failedVideos: FailedVideo[],
  summary: CheckSummary,
  perfAlerts?: PerformanceAlert[],
): Promise<boolean> {
  if (!failedVideos.length && (!perfAlerts || !perfAlerts.length)) return false;

  const rate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const icon = rate >= 99 ? ':white_check_mark:' : rate >= 90 ? ':warning:' : ':rotating_light:';

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${icon} Video Check Alert`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Pass Rate:*\n${rate}% (${summary.passed}/${summary.total})` },
        { type: 'mrkdwn', text: `*Failed:* ${summary.failed}  |  *Timed Out:* ${summary.timeouts}` },
      ],
    },
  ];

  // Failed videos list (max 15)
  if (failedVideos.length > 0) {
    const lines = failedVideos.slice(0, 15).map(v =>
      `:x: *${v.title}*${v.section ? ' (' + v.section + ')' : ''}\n      ${v.error || 'Unknown error'}`
    );
    if (failedVideos.length > 15) {
      lines.push(`_...and ${failedVideos.length - 15} more_`);
    }
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Failed Videos:*\n' + lines.join('\n') },
    });
  }

  // Performance alerts
  if (perfAlerts && perfAlerts.length > 0) {
    const perfLines = perfAlerts.slice(0, 10).map(a =>
      `:snail: *${a.title}* — ${(a.loadTimeMs / 1000).toFixed(1)}s (${a.level})`
    );
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Performance Alerts:*\n' + perfLines.join('\n') },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `go.kingdomlandkids.com  |  ${new Date().toLocaleString()}` },
    ],
  });

  const fallback = `${icon} Video Check: ${rate}% pass rate (${summary.failed} failed, ${summary.timeouts} timed out)`;
  return postToSlack(blocks, fallback);
}

/**
 * Send a daily summary with trend data.
 * Shows today's results + a mini sparkline of recent pass rates.
 */
export async function sendSlackDailySummary(
  summary: CheckSummary,
  history?: HistoryEntry[],
): Promise<boolean> {
  const rate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
  const icon = rate >= 100 ? ':white_check_mark:' : rate >= 95 ? ':large_green_circle:' : rate >= 90 ? ':large_yellow_circle:' : ':red_circle:';

  // Build recent trend (last 7 entries)
  const recent = (history || []).slice(-7);
  const trend = recent.map(h => {
    const r = h.total > 0 ? Math.round((h.passed / h.total) * 100) : 0;
    return r >= 100 ? ':green_heart:' : r >= 90 ? ':yellow_heart:' : ':heart:';
  }).join(' ');

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${icon} Daily Video Health Summary`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Total Videos:*\n${summary.total}` },
        { type: 'mrkdwn', text: `*Pass Rate:*\n${rate}%` },
        { type: 'mrkdwn', text: `*Passed:*\n${summary.passed}` },
        { type: 'mrkdwn', text: `*Failed:*\n${summary.failed}` },
      ],
    },
  ];

  if (trend) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*7-Day Trend:* ${trend}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `go.kingdomlandkids.com  |  ${new Date().toLocaleString()}` },
    ],
  });

  const fallback = `Daily Video Health: ${rate}% (${summary.passed}/${summary.total})`;
  return postToSlack(blocks, fallback);
}
