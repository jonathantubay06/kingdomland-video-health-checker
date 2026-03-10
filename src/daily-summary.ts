#!/usr/bin/env node
/**
 * Daily Summary — sends a Slack summary of the latest video check.
 *
 * Reads video-report.json and history.json, then sends a formatted
 * Block Kit summary to Slack via SLACK_WEBHOOK_URL.
 *
 * Usage:
 *   node dist/src/daily-summary.js
 *
 * Env vars:
 *   SLACK_WEBHOOK_URL — Slack incoming webhook URL (required)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { sendSlackDailySummary } from '../lib/slack';
import type { CheckSummary, HistoryEntry } from './types';

async function main(): Promise<void> {
  const rootDir = path.join(__dirname, '..');

  // Load latest report
  let report: { summary?: CheckSummary };
  try {
    report = JSON.parse(fs.readFileSync(path.join(rootDir, 'video-report.json'), 'utf-8'));
  } catch {
    console.error('No video-report.json found. Run a check first.');
    process.exit(1);
  }

  const summary = report.summary;
  if (!summary) {
    console.error('Report has no summary data.');
    process.exit(1);
  }

  // Load history for trend
  let history: HistoryEntry[] = [];
  try {
    history = JSON.parse(fs.readFileSync(path.join(rootDir, 'history.json'), 'utf-8'));
  } catch {
    // No history — that's fine
  }

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('SLACK_WEBHOOK_URL not set — printing summary to console instead.');
    const rate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
    console.log(`\nDaily Video Health Summary`);
    console.log(`  Total: ${summary.total}  |  Pass Rate: ${rate}%`);
    console.log(`  Passed: ${summary.passed}  |  Failed: ${summary.failed}  |  Timed Out: ${summary.timeouts}`);
    return;
  }

  const ok = await sendSlackDailySummary(summary, history);
  if (ok) {
    console.log('Daily summary sent to Slack.');
  } else {
    console.error('Failed to send daily summary to Slack.');
    process.exit(1);
  }
}

main();
