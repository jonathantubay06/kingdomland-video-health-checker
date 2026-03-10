import 'dotenv/config';

/**
 * Kingdomland Video Checker — Dashboard Server (TypeScript version)
 *
 * Serves the index.html dashboard and bridges the check-videos.js
 * script output to the browser via Server-Sent Events (SSE).
 *
 * Usage:
 *   npm start          # starts server on port 3000
 *   node dist/src/server.js
 */

import express from 'express';
import type { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { crosscheck, applyChanges } from '../crosscheck';
import * as cron from 'node-cron';
import webpush from 'web-push';
import { STATUS, RUN_STATUS } from '../lib/constants';
import type { RunStatusType } from '../lib/constants';
import * as db from '../lib/db';
import type { VideoResult, CheckSummary, CheckReport } from './types';

// Configure VAPID for push notifications
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@kingdomlandkids.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const app = express();
app.use(express.json());

// Serve static assets
app.use('/css', express.static(path.join(__dirname, '..', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'js')));
app.use('/screenshots', express.static(path.join(__dirname, '..', 'screenshots')));
app.use('/icons', express.static(path.join(__dirname, '..', 'icons')));

// Favicon
app.get('/favicon.ico', (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'favicon.ico')));

// PWA files
app.get('/manifest.json', (_req: Request, res: Response) => res.sendFile(path.join(__dirname, '..', 'manifest.json')));
app.get('/sw.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, '..', 'sw.js'));
});

// Notification sound
app.get('/sounds/:file', (req: Request, res: Response) => {
  const filePath = path.join(__dirname, '..', 'sounds', req.params.file as string);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// ============== Run State ==============
interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface RunState {
  status: RunStatusType;
  process: ChildProcess | null;
  pid: number | null;
  startedAt: string | null;
  sseClients: Response[];
  latestResults: VideoResult[] | null;
  latestSummary: CheckSummary | null;
  eventLog: SSEEvent[];
}

const runState: RunState = {
  status: RUN_STATUS.IDLE,
  process: null,
  pid: null,
  startedAt: null,
  sseClients: [],
  latestResults: null,
  latestSummary: null,
  eventLog: [],
};

function broadcastSSE(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  runState.sseClients.forEach(client => {
    try { client.write(data); } catch { /* client disconnected */ }
  });
  runState.eventLog.push(event);
  if (runState.eventLog.length > 2000) {
    runState.eventLog = runState.eventLog.slice(-1500);
  }
}

// ============== Routes ==============

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/crosscheck', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'crosscheck.html'));
});

// Start a check run
app.post('/api/run', (req: Request, res: Response) => {
  if (runState.status === RUN_STATUS.RUNNING) {
    return res.status(409).json({ error: 'A check is already running' });
  }

  const { mode, email, password, failedOnly, titles } = req.body || {};
  const args = ['check-videos.js', '--json-stream'];
  if (mode === 'story') args.push('--story');
  if (mode === 'music') args.push('--music');

  const childEnv = { ...process.env };
  if (email) childEnv.KL_USERNAME = email;
  if (password) childEnv.KL_PASSWORD = password;
  if (failedOnly && titles && titles.length) {
    childEnv.CHECK_TITLES = JSON.stringify(titles);
  }

  const child = spawn('node', args, {
    cwd: path.join(__dirname, '..'),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runState.status = RUN_STATUS.RUNNING;
  runState.process = child;
  runState.pid = child.pid || null;
  runState.startedAt = new Date().toISOString();
  runState.latestResults = null;
  runState.latestSummary = null;
  runState.eventLog = [];

  let buffer = '';
  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as SSEEvent;
        if (event.type === 'complete') {
          runState.latestResults = event.allResults as VideoResult[];
          runState.latestSummary = event.summary as CheckSummary;
        }
        broadcastSSE(event);
      } catch {
        // Non-JSON line
      }
    }
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) broadcastSSE({ type: 'error', message: msg });
  });

  child.on('close', (code: number | null) => {
    runState.status = RUN_STATUS.COMPLETE;
    runState.process = null;
    broadcastSSE({ type: 'process-exit', code });
  });

  child.on('error', (err: Error) => {
    runState.status = RUN_STATUS.IDLE;
    runState.process = null;
    broadcastSSE({ type: 'error', message: `Failed to start: ${err.message}` });
  });

  res.json({ status: 'started', pid: child.pid });
});

// SSE endpoint
app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', runStatus: runState.status })}\n\n`);

  for (const event of runState.eventLog) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  runState.sseClients.push(res);

  req.on('close', () => {
    runState.sseClients = runState.sseClients.filter(c => c !== res);
  });
});

// Current status
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    status: runState.status,
    pid: runState.pid,
    startedAt: runState.startedAt,
    hasPreviousReport: !!runState.latestResults || fs.existsSync(path.join(__dirname, '..', 'video-report.json')),
  });
});

// Latest report
app.get('/api/report', (_req: Request, res: Response) => {
  if (runState.latestResults) {
    return res.json({
      timestamp: runState.startedAt,
      summary: runState.latestSummary,
      allResults: runState.latestResults,
    });
  }

  const reportPath = path.join(__dirname, '..', 'video-report.json');
  if (fs.existsSync(reportPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      return res.json(data);
    } catch {
      return res.status(500).json({ error: 'Failed to parse report file' });
    }
  }

  res.status(404).json({ error: 'No report available' });
});

// Download files
app.get('/api/download/:format', (req: Request, res: Response) => {
  const fileMap: Record<string, { file: string; mime: string }> = {
    csv: { file: 'video-report.csv', mime: 'text/csv' },
    json: { file: 'video-report.json', mime: 'application/json' },
    txt: { file: 'failed-videos.txt', mime: 'text/plain' },
  };

  const entry = fileMap[req.params.format as string];
  if (!entry) return res.status(400).json({ error: 'Invalid format. Use csv, json, or txt.' });

  const filePath = path.join(__dirname, '..', entry.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not yet generated. Run a check first.' });

  res.setHeader('Content-Disposition', `attachment; filename="${entry.file}"`);
  res.setHeader('Content-Type', entry.mime);
  fs.createReadStream(filePath).pipe(res);
});

// History data
app.get('/api/history', (_req: Request, res: Response) => {
  const historyPath = path.join(__dirname, '..', 'history.json');
  if (fs.existsSync(historyPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      return res.json(data);
    } catch {
      return res.json([]);
    }
  }
  res.json([]);
});

// Previous report for diff comparison
app.get('/api/previous-report', (_req: Request, res: Response) => {
  const prevPath = path.join(__dirname, '..', 'previous-report.json');
  if (fs.existsSync(prevPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(prevPath, 'utf-8'));
      return res.json(data);
    } catch {
      return res.status(500).json({ error: 'Failed to parse previous report' });
    }
  }
  res.status(404).json({ error: 'No previous report available' });
});

// Health badge (SVG)
app.get('/api/health-badge', (_req: Request, res: Response) => {
  let label = 'Video Health';
  let value = 'unknown';
  let color = '#999';

  const reportPath = path.join(__dirname, '..', 'video-report.json');
  if (runState.latestResults || fs.existsSync(reportPath)) {
    try {
      let summary: CheckSummary | undefined;
      if (runState.latestSummary) {
        summary = runState.latestSummary;
      } else {
        const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        summary = data.summary;
      }

      if (summary && summary.total > 0) {
        const rate = Math.round((summary.passed / summary.total) * 100);
        value = `${rate}% (${summary.passed}/${summary.total})`;
        if (rate >= 99) color = '#4c1';
        else if (rate >= 90) color = '#dfb317';
        else color = '#e05d44';
      }
    } catch { /* ignore */ }
  }

  const labelWidth = label.length * 6.5 + 10;
  const valueWidth = value.length * 6.5 + 10;
  const totalWidth = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#555"/><rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/><rect width="${totalWidth}" height="20" fill="url(#s)"/></g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${label}</text><text x="${labelWidth / 2}" y="13">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${value}</text><text x="${labelWidth + valueWidth / 2}" y="13">${value}</text>
  </g></svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache, max-age=300');
  res.send(svg);
});

// Report last-modified timestamp
app.get('/api/report-timestamp', (_req: Request, res: Response) => {
  const reportPath = path.join(__dirname, '..', 'video-report.json');
  if (runState.latestResults) {
    return res.json({ timestamp: runState.startedAt, status: runState.status });
  }
  if (fs.existsSync(reportPath)) {
    try {
      const stat = fs.statSync(reportPath);
      return res.json({ timestamp: stat.mtime.toISOString(), status: runState.status });
    } catch {
      return res.json({ timestamp: null, status: runState.status });
    }
  }
  res.json({ timestamp: null, status: runState.status });
});

// Full history with per-video detail
app.get('/api/history-detail', (_req: Request, res: Response) => {
  const historyPath = path.join(__dirname, '..', 'history.json');
  if (fs.existsSync(historyPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      return res.json(data);
    } catch {
      return res.json([]);
    }
  }
  res.json([]);
});

// Shareable self-contained HTML report
app.get('/api/share-report', (_req: Request, res: Response) => {
  const reportPath = path.join(__dirname, '..', 'video-report.json');
  let report: Partial<CheckReport> | undefined;
  if (runState.latestResults) {
    report = {
      timestamp: runState.startedAt || undefined,
      summary: runState.latestSummary || undefined,
      allResults: runState.latestResults,
    };
  } else if (fs.existsSync(reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    } catch {
      return res.status(500).json({ error: 'Failed to parse report' });
    }
  } else {
    return res.status(404).json({ error: 'No report available' });
  }

  const results = report!.allResults || [];
  const summary = report!.summary || { total: 0, passed: 0, failed: 0, timeouts: 0 };
  const total = summary.total || results.length;
  const passed = summary.passed || results.filter(r => r.status === STATUS.PASS).length;
  const failed = summary.failed || results.filter(r => r.status === STATUS.FAIL).length;
  const timeouts = summary.timeouts || results.filter(r => r.status === STATUS.TIMEOUT).length;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const timestamp = report!.timestamp ? new Date(report!.timestamp).toLocaleString() : new Date().toLocaleString();

  function esc(s: string): string {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const rows = results.map(r => {
    const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
    const statusColor = r.status === STATUS.PASS ? '#22c55e' : r.status === STATUS.FAIL ? '#ef4444' : '#f59e0b';
    return `<tr><td>${r.number}</td><td>${esc(r.title)}</td><td>${esc(r.section || '')}</td><td>${r.page || ''}</td><td style="color:${statusColor};font-weight:600">${r.status}</td><td>${loadTime}</td><td style="color:#888;font-size:0.85em">${esc(r.error || '-')}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingdomland Video Report - ${timestamp}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f3fa;color:#080331;line-height:1.5;padding:24px}
.container{max-width:1200px;margin:0 auto}.header{background:linear-gradient(135deg,#4c6bcd,#080331);color:white;padding:24px 32px;border-radius:12px;margin-bottom:24px}
.header h1{font-size:1.4rem;margin-bottom:4px}.header p{opacity:0.8;font-size:0.9rem}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.card{background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.card-label{font-size:0.8rem;text-transform:uppercase;letter-spacing:0.05em;color:#555;margin-bottom:4px}.card-value{font-size:1.8rem;font-weight:700}
.card-pass .card-value{color:#22c55e}.card-fail .card-value{color:#ef4444}.card-timeout .card-value{color:#f59e0b}
.rate-bar{height:8px;background:#e5e7eb;border-radius:4px;margin:16px 0 24px;overflow:hidden}.rate-fill{height:100%;border-radius:4px}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
th{background:#f8f9fc;text-align:left;padding:10px 14px;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.03em;color:#555;border-bottom:1px solid #e2e6f8}
td{padding:10px 14px;border-bottom:1px solid #f0f2f8;font-size:0.88rem}tr:hover{background:#f8f9fc}
.footer{text-align:center;padding:20px;color:#888;font-size:0.8rem;margin-top:24px}
@media(max-width:768px){.cards{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="container">
<div class="header"><h1>Kingdomland Video Checker Report</h1><p>go.kingdomlandkids.com &middot; ${esc(timestamp)}</p></div>
<div class="cards">
<div class="card"><div class="card-label">Total Videos</div><div class="card-value">${total}</div></div>
<div class="card card-pass"><div class="card-label">Passed</div><div class="card-value">${passed}</div></div>
<div class="card card-fail"><div class="card-label">Failed</div><div class="card-value">${failed}</div></div>
<div class="card card-timeout"><div class="card-label">Timed Out</div><div class="card-value">${timeouts}</div></div>
</div>
<div style="margin-bottom:24px"><div style="font-size:0.9rem;margin-bottom:6px">Pass Rate: <strong>${rate}%</strong></div>
<div class="rate-bar"><div class="rate-fill" style="width:${rate}%;background:${rate >= 100 ? '#22c55e' : rate >= 90 ? '#f59e0b' : '#ef4444'}"></div></div></div>
<table><thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Load Time</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Generated by Kingdomland Video Checker</div>
</div></body></html>`;

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Content-Disposition', `attachment; filename="video-report-${Date.now()}.html"`);
  res.send(html);
});

// Screenshots
app.get('/api/screenshots', (_req: Request, res: Response) => {
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) return res.json([]);
  try {
    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
    res.json(files.map(f => ({ filename: f, url: `/screenshots/${f}` })));
  } catch {
    res.json([]);
  }
});

// ============== Video Trending (SQLite) ==============

app.get('/api/video-trend/:title', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const data = db.getPerformanceTrend(req.params.title as string, days);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/degrading-videos', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 14;
    const data = db.getDegradingVideos(days);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/video-history/:title', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const data = db.getVideoHistory(req.params.title as string, days);
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.post('/api/db/migrate', (_req: Request, res: Response) => {
  try {
    const count = db.migrateFromJson();
    res.json({ status: 'ok', imported: count });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ============== Schedule Config ==============
let scheduledTask: cron.ScheduledTask | null = null;
const scheduleConfigPath = path.join(__dirname, '..', 'data', 'schedule-config.json');

interface ScheduleConfigData {
  enabled: boolean;
  cron: string;
}

function loadScheduleConfig(): ScheduleConfigData {
  try {
    if (fs.existsSync(scheduleConfigPath)) {
      return JSON.parse(fs.readFileSync(scheduleConfigPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { enabled: false, cron: '0 6 * * *' };
}

function saveScheduleConfig(config: ScheduleConfigData): void {
  const dir = path.dirname(scheduleConfigPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(scheduleConfigPath, JSON.stringify(config, null, 2));
}

function applySchedule(config: ScheduleConfigData): void {
  if (scheduledTask) { scheduledTask.stop(); scheduledTask = null; }
  if (!config.enabled || !config.cron) return;
  if (!cron.validate(config.cron)) { console.error('Invalid cron:', config.cron); return; }
  scheduledTask = cron.schedule(config.cron, () => {
    if (runState.status === RUN_STATUS.RUNNING) return;
    console.log('[Scheduled] Auto-check triggered at', new Date().toISOString());
    const email = process.env.KL_EMAIL;
    const password = process.env.KL_PASSWORD;
    if (!email || !password) {
      console.log('[Scheduled] No KL_EMAIL/KL_PASSWORD set, skipping scheduled check');
      return;
    }
    const child = spawn('node', ['check-videos.js', '--mode=both'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, KL_EMAIL: email, KL_PASSWORD: password },
    });
    child.stdout?.on('data', (d: Buffer) => process.stdout.write('[Scheduled] ' + d));
    child.stderr?.on('data', (d: Buffer) => process.stderr.write('[Scheduled] ' + d));
  });
  console.log('Schedule active:', config.cron);
}

app.get('/api/config/schedule', (_req: Request, res: Response) => {
  res.json(loadScheduleConfig());
});

app.post('/api/config/schedule', (req: Request, res: Response) => {
  const config: ScheduleConfigData = { enabled: !!req.body.enabled, cron: req.body.cron || '0 6 * * *' };
  if (config.cron && !cron.validate(config.cron)) {
    return res.status(400).json({ error: 'Invalid cron expression' });
  }
  saveScheduleConfig(config);
  applySchedule(config);
  res.json({ status: 'ok', config });
});

// ============== Push Notifications ==============
const subscriptionsPath = path.join(__dirname, '..', 'data', 'push-subscriptions.json');

interface PushSubscriptionEntry {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  prefs: { failures: boolean; dailySummary?: boolean };
}

function loadSubscriptions(): PushSubscriptionEntry[] {
  try {
    if (fs.existsSync(subscriptionsPath)) {
      return JSON.parse(fs.readFileSync(subscriptionsPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveSubscriptions(subs: PushSubscriptionEntry[]): void {
  const dir = path.dirname(subscriptionsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(subscriptionsPath, JSON.stringify(subs, null, 2));
}

app.get('/api/notifications/vapid-key', (_req: Request, res: Response) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(404).json({ error: 'VAPID keys not configured' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/notifications/subscribe', (req: Request, res: Response) => {
  const { subscription, prefs } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const subs = loadSubscriptions();
  const existing = subs.findIndex(s => s.subscription.endpoint === subscription.endpoint);
  if (existing !== -1) {
    subs[existing] = { subscription, prefs: prefs || { failures: true } };
  } else {
    subs.push({ subscription, prefs: prefs || { failures: true } });
  }
  saveSubscriptions(subs);
  res.json({ status: 'subscribed' });
});

app.post('/api/notifications/unsubscribe', (req: Request, res: Response) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'No endpoint' });
  const subs = loadSubscriptions().filter(s => s.subscription.endpoint !== endpoint);
  saveSubscriptions(subs);
  res.json({ status: 'unsubscribed' });
});

app.put('/api/notifications/settings', (req: Request, res: Response) => {
  const { prefs } = req.body;
  const subs = loadSubscriptions();
  subs.forEach(s => { s.prefs = prefs; });
  saveSubscriptions(subs);
  res.json({ status: 'ok' });
});

app.post('/api/notifications/test', (_req: Request, res: Response) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(404).json({ error: 'VAPID keys not configured' });
  }
  const payload = JSON.stringify({
    title: 'Video Checker Test',
    body: 'Push notifications are working!',
    icon: '/icons/icon-192.png',
    tag: 'test',
  });
  const subs = loadSubscriptions();
  Promise.all(subs.map(s => webpush.sendNotification(s.subscription, payload).catch(() => {})));
  res.json({ status: 'sent', count: subs.length });
});

// ============== Cross-check Endpoints ==============

app.post('/api/crosscheck', async (req: Request, res: Response) => {
  const spreadsheetId = req.body.spreadsheetId || process.env.GSHEET_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'No spreadsheet ID provided.' });
  }

  let websiteResults: VideoResult[] | undefined = req.body.results;
  if (!websiteResults || !websiteResults.length) {
    if (runState.latestResults && runState.latestResults.length) {
      websiteResults = runState.latestResults;
    } else {
      const reportPath = path.join(__dirname, '..', 'video-report.json');
      if (fs.existsSync(reportPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
          websiteResults = data.allResults || [];
        } catch {
          return res.status(500).json({ error: 'Failed to read saved report' });
        }
      }
    }
  }

  if (!websiteResults || !websiteResults.length) {
    return res.status(400).json({ error: 'No video check results available. Run a video check first.' });
  }

  try {
    const report = await crosscheck(websiteResults, spreadsheetId);
    res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Cross-check error:', err);
    res.status(500).json({ error: `Cross-check failed: ${message}` });
  }
});

app.post('/api/crosscheck/apply', async (req: Request, res: Response) => {
  const webappUrl = req.body.webappUrl || process.env.GSHEET_WEBAPP_URL;
  if (!webappUrl) {
    return res.status(400).json({ error: 'No Google Apps Script web app URL configured.' });
  }

  const changes = req.body.changes;
  if (!changes || !changes.length) {
    return res.status(400).json({ error: 'No changes to apply' });
  }

  try {
    const result = await applyChanges(webappUrl, changes);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Apply changes error:', err);
    res.status(500).json({ error: `Failed to apply changes: ${message}` });
  }
});

// Stop running check
app.post('/api/stop', (_req: Request, res: Response) => {
  if (runState.status !== RUN_STATUS.RUNNING || !runState.process) {
    return res.status(400).json({ error: 'No check is running' });
  }

  const pid = runState.process.pid;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', (pid || 0).toString(), '/f', '/t']);
    } else {
      runState.process.kill('SIGTERM');
    }
  } catch {
    // Process may have already exited
  }

  runState.status = RUN_STATUS.IDLE;
  runState.process = null;
  broadcastSSE({ type: 'stopped', message: 'Check cancelled by user' });
  res.json({ status: 'stopped' });
});

// ============== Start ==============
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Kingdomland Video Checker Dashboard`);
    console.log(`  ────────────────────────────────────`);
    console.log(`  Running at: http://localhost:${PORT}`);
    console.log(`  Press Ctrl+C to stop\n`);
    applySchedule(loadScheduleConfig());
  });
}

export { app, runState };
