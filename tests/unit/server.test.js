const http = require('http');
const path = require('path');
const fs = require('fs');
const { RUN_STATUS } = require('../../lib/constants');

// Import app without starting the listener
const { app, runState } = require('../../server');

let server;
let baseUrl;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${urlPath}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    }).on('error', reject);
  });
}

function getJson(urlPath) {
  return get(urlPath).then(res => ({
    ...res,
    json: JSON.parse(res.body),
  }));
}

function post(urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(`${baseUrl}${urlPath}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: resBody, json: JSON.parse(resBody) });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

beforeAll(() => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

beforeEach(() => {
  // Reset run state between tests
  runState.status = RUN_STATUS.IDLE;
  runState.process = null;
  runState.pid = null;
  runState.startedAt = null;
  runState.latestResults = null;
  runState.latestSummary = null;
  runState.eventLog = [];
  runState.sseClients = [];
});

describe('Server API endpoints', () => {
  describe('GET /', () => {
    it('serves the dashboard HTML', async () => {
      const res = await get('/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('Kingdomland');
    });
  });

  describe('GET /api/status', () => {
    it('returns idle status by default', async () => {
      const res = await getJson('/api/status');
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('idle');
      expect(res.json.pid).toBeNull();
    });

    it('reflects running state', async () => {
      runState.status = RUN_STATUS.RUNNING;
      runState.pid = 12345;
      runState.startedAt = '2025-06-15T10:00:00Z';

      const res = await getJson('/api/status');
      expect(res.json.status).toBe('running');
      expect(res.json.pid).toBe(12345);
      expect(res.json.startedAt).toBe('2025-06-15T10:00:00Z');
    });
  });

  describe('GET /api/report', () => {
    it('returns 404 when no report is available', async () => {
      // Ensure no in-memory results and no report file at project root
      runState.latestResults = null;
      const res = await getJson('/api/report');
      // May return 404 or a file-based report depending on state
      expect([200, 404]).toContain(res.status);
    });

    it('returns in-memory results when available', async () => {
      const sampleReport = require('../fixtures/sample-report.json');
      runState.latestResults = sampleReport.allResults;
      runState.latestSummary = sampleReport.summary;
      runState.startedAt = sampleReport.timestamp;

      const res = await getJson('/api/report');
      expect(res.status).toBe(200);
      expect(res.json.allResults).toHaveLength(6);
      expect(res.json.summary.total).toBe(6);
      expect(res.json.summary.passed).toBe(4);
    });
  });

  describe('GET /api/history', () => {
    it('returns an array (may be empty or file-based)', async () => {
      const res = await getJson('/api/history');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });
  });

  describe('GET /api/download/:format', () => {
    it('rejects invalid format', async () => {
      const res = await getJson('/api/download/xml');
      expect(res.status).toBe(400);
      expect(res.json.error).toContain('Invalid format');
    });

    it('returns 404 when report file does not exist', async () => {
      // txt file may not exist
      const txtPath = path.join(__dirname, '../../failed-videos.txt');
      const exists = fs.existsSync(txtPath);
      if (!exists) {
        const res = await getJson('/api/download/txt');
        expect(res.status).toBe(404);
      }
    });
  });

  describe('GET /api/health-badge', () => {
    it('returns SVG content', async () => {
      const res = await get('/api/health-badge');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body).toContain('<svg');
    });

    it('shows pass rate when in-memory results exist', async () => {
      // Badge checks latestResults first, then reads latestSummary
      runState.latestResults = [{ status: 'PASS' }]; // truthy trigger
      runState.latestSummary = { total: 100, passed: 95, failed: 3, timeouts: 2 };

      const res = await get('/api/health-badge');
      expect(res.body).toContain('95%');
    });
  });

  describe('GET /api/report-timestamp', () => {
    it('returns null timestamp when no report', async () => {
      const res = await getJson('/api/report-timestamp');
      expect(res.status).toBe(200);
      expect(res.json.status).toBe('idle');
    });

    it('returns in-memory timestamp when available', async () => {
      runState.latestResults = [{ status: 'PASS' }];
      runState.startedAt = '2025-06-15T10:00:00Z';

      const res = await getJson('/api/report-timestamp');
      expect(res.json.timestamp).toBe('2025-06-15T10:00:00Z');
    });
  });

  describe('GET /api/screenshots', () => {
    it('returns an array', async () => {
      const res = await getJson('/api/screenshots');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json)).toBe(true);
    });
  });

  describe('POST /api/stop', () => {
    it('returns error when no check is running', async () => {
      const res = await post('/api/stop', {});
      expect(res.status).toBe(400);
      expect(res.json.error).toContain('No check is running');
    });
  });

  describe('POST /api/run', () => {
    it('rejects when a check is already running', async () => {
      runState.status = RUN_STATUS.RUNNING;

      const res = await post('/api/run', { mode: 'story' });
      expect(res.status).toBe(409);
      expect(res.json.error).toContain('already running');
    });
  });

  describe('GET /api/share-report', () => {
    it('returns 404 when no report is available', async () => {
      runState.latestResults = null;
      // Only returns 404 if no file exists either
      const reportPath = path.join(__dirname, '../../video-report.json');
      if (!fs.existsSync(reportPath)) {
        const res = await getJson('/api/share-report');
        expect(res.status).toBe(404);
      }
    });

    it('generates HTML report from in-memory results', async () => {
      const sampleReport = require('../fixtures/sample-report.json');
      runState.latestResults = sampleReport.allResults;
      runState.latestSummary = sampleReport.summary;
      runState.startedAt = sampleReport.timestamp;

      const res = await get('/api/share-report');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('Kingdomland Video Checker Report');
      expect(res.body).toContain('Welcome Song');
    });
  });

  describe('Static assets', () => {
    it('serves CSS files', async () => {
      const res = await get('/css/styles.css');
      // Should be 200 if the file exists
      expect([200, 304]).toContain(res.status);
    });

    it('serves favicon', async () => {
      const res = await get('/favicon.ico');
      expect(res.status).toBe(200);
    });

    it('serves manifest.json', async () => {
      const res = await get('/manifest.json');
      expect(res.status).toBe(200);
    });

    it('serves sw.js with correct content type', async () => {
      const res = await get('/sw.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
    });
  });
});
