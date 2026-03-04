require('dotenv').config();

/**
 * Kingdomland Video Checker — Dashboard Server
 *
 * Serves the index.html dashboard and bridges the check-videos.js
 * script output to the browser via Server-Sent Events (SSE).
 *
 * Usage:
 *   npm start          # starts server on port 3000
 *   node server.js     # same thing
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { crosscheck, applyChanges } = require('./crosscheck');

const app = express();
app.use(express.json());

// Serve static assets (css/, js/, screenshots/, icons/)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// PWA files
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Notification sound
app.get('/sounds/:file', (req, res) => {
  const filePath = path.join(__dirname, 'sounds', req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).end();
});

// ============== Run State ==============
const runState = {
  status: 'idle',         // 'idle' | 'running' | 'complete'
  process: null,          // ChildProcess reference
  pid: null,
  startedAt: null,
  sseClients: [],         // SSE response objects
  latestResults: null,    // last complete allResults array
  latestSummary: null,    // last complete summary object
  eventLog: [],           // buffered events for late-joining SSE clients
};

function broadcastSSE(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  runState.sseClients.forEach(client => {
    try { client.write(data); } catch { /* client disconnected */ }
  });
  // Buffer events so late-joining clients can catch up
  runState.eventLog.push(event);
  // Keep only last 2000 events to prevent memory bloat
  if (runState.eventLog.length > 2000) {
    runState.eventLog = runState.eventLog.slice(-1500);
  }
}

// ============== Routes ==============

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve cross-check page
app.get('/crosscheck', (req, res) => {
  res.sendFile(path.join(__dirname, 'crosscheck.html'));
});

// Start a check run
app.post('/api/run', (req, res) => {
  if (runState.status === 'running') {
    return res.status(409).json({ error: 'A check is already running' });
  }

  const { mode, email, password, failedOnly, titles } = req.body || {};
  const args = ['check-videos.js', '--json-stream'];
  if (mode === 'story') args.push('--story');
  if (mode === 'music') args.push('--music');

  // Pass credentials as env vars to child process (dashboard-provided or from server env)
  const childEnv = { ...process.env };
  if (email) childEnv.KL_USERNAME = email;
  if (password) childEnv.KL_PASSWORD = password;
  // Pass failed-only titles filter
  if (failedOnly && titles && titles.length) {
    childEnv.CHECK_TITLES = JSON.stringify(titles);
  }

  const child = spawn('node', args, {
    cwd: __dirname,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runState.status = 'running';
  runState.process = child;
  runState.pid = child.pid;
  runState.startedAt = new Date().toISOString();
  runState.latestResults = null;
  runState.latestSummary = null;
  runState.eventLog = [];

  // Process stdout line by line (NDJSON)
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'complete') {
          runState.latestResults = event.allResults;
          runState.latestSummary = event.summary;
        }
        broadcastSSE(event);
      } catch {
        // Non-JSON line — ignore
      }
    }
  });

  // Capture stderr
  child.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) broadcastSSE({ type: 'error', message: msg });
  });

  child.on('close', (code) => {
    runState.status = 'complete';
    runState.process = null;
    broadcastSSE({ type: 'process-exit', code });
  });

  child.on('error', (err) => {
    runState.status = 'idle';
    runState.process = null;
    broadcastSSE({ type: 'error', message: `Failed to start: ${err.message}` });
  });

  res.json({ status: 'started', pid: child.pid });
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', runStatus: runState.status })}\n\n`);

  // Replay buffered events for late-joining clients
  for (const event of runState.eventLog) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  runState.sseClients.push(res);

  req.on('close', () => {
    runState.sseClients = runState.sseClients.filter(c => c !== res);
  });
});

// Current status
app.get('/api/status', (req, res) => {
  res.json({
    status: runState.status,
    pid: runState.pid,
    startedAt: runState.startedAt,
    hasPreviousReport: !!runState.latestResults || fs.existsSync(path.join(__dirname, 'video-report.json')),
  });
});

// Latest report
app.get('/api/report', (req, res) => {
  if (runState.latestResults) {
    return res.json({
      timestamp: runState.startedAt,
      summary: runState.latestSummary,
      allResults: runState.latestResults,
    });
  }

  const reportPath = path.join(__dirname, 'video-report.json');
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
app.get('/api/download/:format', (req, res) => {
  const fileMap = {
    csv: { file: 'video-report.csv', mime: 'text/csv' },
    json: { file: 'video-report.json', mime: 'application/json' },
    txt: { file: 'failed-videos.txt', mime: 'text/plain' },
  };

  const entry = fileMap[req.params.format];
  if (!entry) return res.status(400).json({ error: 'Invalid format. Use csv, json, or txt.' });

  const filePath = path.join(__dirname, entry.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Report not yet generated. Run a check first.' });

  res.setHeader('Content-Disposition', `attachment; filename="${entry.file}"`);
  res.setHeader('Content-Type', entry.mime);
  fs.createReadStream(filePath).pipe(res);
});

// History data for trend chart
app.get('/api/history', (req, res) => {
  const historyPath = path.join(__dirname, 'history.json');
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
app.get('/api/previous-report', (req, res) => {
  const prevPath = path.join(__dirname, 'previous-report.json');
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
app.get('/api/health-badge', (req, res) => {
  let label = 'Video Health';
  let value = 'unknown';
  let color = '#999';

  const reportPath = path.join(__dirname, 'video-report.json');
  if (runState.latestResults || fs.existsSync(reportPath)) {
    try {
      let summary;
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

// Report last-modified timestamp (for auto-refresh polling)
app.get('/api/report-timestamp', (req, res) => {
  const reportPath = path.join(__dirname, 'video-report.json');
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

// Full history with per-video detail (for video detail pages & comparison)
app.get('/api/history-detail', (req, res) => {
  const historyPath = path.join(__dirname, 'history.json');
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
app.get('/api/share-report', (req, res) => {
  const reportPath = path.join(__dirname, 'video-report.json');
  let report;
  if (runState.latestResults) {
    report = {
      timestamp: runState.startedAt,
      summary: runState.latestSummary,
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

  const results = report.allResults || [];
  const summary = report.summary || {};
  const total = summary.total || results.length;
  const passed = summary.passed || results.filter(r => r.status === 'PASS').length;
  const failed = summary.failed || results.filter(r => r.status === 'FAIL').length;
  const timeouts = summary.timeouts || results.filter(r => r.status === 'TIMEOUT').length;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const timestamp = report.timestamp ? new Date(report.timestamp).toLocaleString() : new Date().toLocaleString();

  const rows = results.map(r => {
    const loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-';
    const statusClass = r.status === 'PASS' ? '#22c55e' : r.status === 'FAIL' ? '#ef4444' : '#f59e0b';
    return `<tr><td>${r.number}</td><td>${esc(r.title)}</td><td>${esc(r.section || '')}</td><td>${r.page || ''}</td><td style="color:${statusClass};font-weight:600">${r.status}</td><td>${loadTime}</td><td style="color:#888;font-size:0.85em">${esc(r.error || '-')}</td></tr>`;
  }).join('');

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
.rate-bar{height:8px;background:#e5e7eb;border-radius:4px;margin:16px 0 24px;overflow:hidden}.rate-fill{height:100%;border-radius:4px;transition:width 0.3s}
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

// Screenshots for video thumbnail previews
app.get('/api/screenshots', (req, res) => {
  const screenshotDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotDir)) return res.json([]);
  try {
    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
    res.json(files.map(f => ({ filename: f, url: `/screenshots/${f}` })));
  } catch {
    res.json([]);
  }
});

// ============== Cross-check Endpoints ==============

// Run cross-check comparison
app.post('/api/crosscheck', async (req, res) => {
  const spreadsheetId = req.body.spreadsheetId || process.env.GSHEET_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'No spreadsheet ID provided. Set GSHEET_SPREADSHEET_ID in .env or pass spreadsheetId in request.' });
  }

  // Get website results from request body, current run state, or saved report
  let websiteResults = req.body.results;
  if (!websiteResults || !websiteResults.length) {
    if (runState.latestResults && runState.latestResults.length) {
      websiteResults = runState.latestResults;
    } else {
      const reportPath = path.join(__dirname, 'video-report.json');
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
  } catch (err) {
    console.error('Cross-check error:', err);
    res.status(500).json({ error: `Cross-check failed: ${err.message}` });
  }
});

// Apply cross-check changes to spreadsheet
app.post('/api/crosscheck/apply', async (req, res) => {
  const webappUrl = req.body.webappUrl || process.env.GSHEET_WEBAPP_URL;
  if (!webappUrl) {
    return res.status(400).json({ error: 'No Google Apps Script web app URL configured. Set GSHEET_WEBAPP_URL in .env or deploy the Apps Script first.' });
  }

  const changes = req.body.changes;
  if (!changes || !changes.length) {
    return res.status(400).json({ error: 'No changes to apply' });
  }

  try {
    const result = await applyChanges(webappUrl, changes);
    res.json(result);
  } catch (err) {
    console.error('Apply changes error:', err);
    res.status(500).json({ error: `Failed to apply changes: ${err.message}` });
  }
});

// Stop running check
app.post('/api/stop', (req, res) => {
  if (runState.status !== 'running' || !runState.process) {
    return res.status(400).json({ error: 'No check is running' });
  }

  const pid = runState.process.pid;
  try {
    if (process.platform === 'win32') {
      // On Windows, kill the entire process tree
      spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
    } else {
      runState.process.kill('SIGTERM');
    }
  } catch {
    // Process may have already exited
  }

  runState.status = 'idle';
  runState.process = null;
  broadcastSSE({ type: 'stopped', message: 'Check cancelled by user' });
  res.json({ status: 'stopped' });
});

// ============== Start ==============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Kingdomland Video Checker Dashboard`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  Running at: http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
