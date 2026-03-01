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

const app = express();
app.use(express.json());

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

// Start a check run
app.post('/api/run', (req, res) => {
  if (runState.status === 'running') {
    return res.status(409).json({ error: 'A check is already running' });
  }

  const { mode } = req.body || {};
  const args = ['check-videos.js', '--json-stream'];
  if (mode === 'story') args.push('--story');
  if (mode === 'music') args.push('--music');

  const child = spawn('node', args, {
    cwd: __dirname,
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
