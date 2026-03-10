import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('lib/db', () => {
  let db;
  let tmpDir;

  beforeEach(async () => {
    // Use a temp directory for each test to avoid conflicts
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-db-test-'));
    process.env.KL_DB_PATH = path.join(tmpDir, 'test.db');

    // Import the module (first time loads, subsequent reuses cached module)
    db = await import('../../lib/db.js');
    // Close any prior connection so getDb() opens a fresh DB at new path
    db.close();
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    delete process.env.KL_DB_PATH;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function sampleReport(overrides = {}) {
    return {
      timestamp: overrides.timestamp || new Date().toISOString(),
      summary: { total: 3, passed: 2, failed: 1, timeouts: 0, ...overrides.summary },
      allResults: overrides.allResults || [
        { number: 1, title: 'Video A', section: 'Sec1', page: 'STORY', url: 'http://x/1', hlsSrc: '', status: 'PASS', error: '', loadTimeMs: 1500, duration: '30s', resolution: '1920x1080' },
        { number: 2, title: 'Video B', section: 'Sec1', page: 'STORY', url: 'http://x/2', hlsSrc: '', status: 'PASS', error: '', loadTimeMs: 2500, duration: '45s', resolution: '1280x720' },
        { number: 3, title: 'Video C', section: 'Sec2', page: 'MUSIC', url: 'http://x/3', hlsSrc: '', status: 'FAIL', error: 'No video', loadTimeMs: 5000, duration: '', resolution: '' },
      ],
    };
  }

  it('creates database and tables', () => {
    const dbInstance = db.getDb();
    expect(dbInstance).toBeDefined();
    // Check tables exist
    const tables = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('runs');
    expect(names).toContain('results');
  });

  it('saves and retrieves a run', () => {
    const report = sampleReport();
    const runId = db.saveRun(report);
    expect(runId).toBeGreaterThan(0);

    const latest = db.getLatestRun();
    expect(latest).not.toBeNull();
    expect(latest.summary.total).toBe(3);
    expect(latest.summary.passed).toBe(2);
    expect(latest.summary.failed).toBe(1);
    expect(latest.allResults).toHaveLength(3);
    expect(latest.allResults[0].title).toBe('Video A');
    expect(latest.allResults[0].loadTimeMs).toBe(1500);
  });

  it('returns null for getLatestRun when empty', () => {
    const latest = db.getLatestRun();
    expect(latest).toBeNull();
  });

  it('getRunHistory returns entries in chronological order', () => {
    db.saveRun(sampleReport({ timestamp: '2025-01-01T00:00:00Z' }));
    db.saveRun(sampleReport({ timestamp: '2025-01-02T00:00:00Z' }));
    db.saveRun(sampleReport({ timestamp: '2025-01-03T00:00:00Z' }));

    const history = db.getRunHistory(10);
    expect(history).toHaveLength(3);
    expect(history[0].timestamp).toBe('2025-01-01T00:00:00Z');
    expect(history[2].timestamp).toBe('2025-01-03T00:00:00Z');
  });

  it('getRunHistoryDetail includes per-video data', () => {
    db.saveRun(sampleReport());
    const detail = db.getRunHistoryDetail(1);
    expect(detail).toHaveLength(1);
    expect(detail[0].videos).toHaveLength(3);
    expect(detail[0].videos[0].title).toBe('Video A');
  });

  it('getVideoHistory returns check history for a title', () => {
    db.saveRun(sampleReport({ timestamp: new Date().toISOString() }));
    db.saveRun(sampleReport({ timestamp: new Date().toISOString() }));

    const history = db.getVideoHistory('Video A', 30);
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe('PASS');
  });

  it('getPerformanceTrend returns load times over time', () => {
    db.saveRun(sampleReport({ timestamp: new Date().toISOString() }));
    const trend = db.getPerformanceTrend('Video C', 30);
    expect(trend).toHaveLength(1);
    expect(trend[0].loadTimeMs).toBe(5000);
  });

  it('getDegradingVideos detects performance degradation', () => {
    // Simulate 5 runs where Video C gets progressively slower
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - (5 - i) * 86400000).toISOString();
      const loadTime = i < 2 ? 1000 : 10000; // slow in recent runs
      db.saveRun(sampleReport({
        timestamp: ts,
        allResults: [
          { number: 1, title: 'Stable Video', section: '', page: '', url: '', hlsSrc: '', status: 'PASS', error: '', loadTimeMs: 1500, duration: '', resolution: '' },
          { number: 2, title: 'Degrading Video', section: '', page: '', url: '', hlsSrc: '', status: 'PASS', error: '', loadTimeMs: loadTime, duration: '', resolution: '' },
        ],
      }));
    }

    const degrading = db.getDegradingVideos(30);
    expect(degrading.length).toBeGreaterThan(0);
    expect(degrading[0].title).toBe('Degrading Video');
    expect(degrading[0].degradation).toBeGreaterThan(50);
  });

  it('getDegradingVideos returns empty when no degradation', () => {
    for (let i = 0; i < 5; i++) {
      db.saveRun(sampleReport({
        timestamp: new Date(Date.now() - i * 86400000).toISOString(),
      }));
    }
    const degrading = db.getDegradingVideos(30);
    // Videos have consistent load times so should not flag
    expect(degrading.length).toBe(0);
  });

  it('migrateFromJson imports history file', () => {
    const historyPath = path.join(tmpDir, 'history.json');
    const history = [
      {
        timestamp: '2025-01-01T00:00:00Z',
        total: 2, passed: 1, failed: 1, timeouts: 0,
        videos: [
          { title: 'V1', section: 'S1', page: 'STORY', status: 'PASS', loadTimeMs: 1000, error: '' },
          { title: 'V2', section: 'S1', page: 'STORY', status: 'FAIL', loadTimeMs: 3000, error: 'No video' },
        ],
      },
    ];
    fs.writeFileSync(historyPath, JSON.stringify(history));

    const count = db.migrateFromJson(historyPath);
    expect(count).toBe(1);

    const latest = db.getLatestRun();
    expect(latest.summary.total).toBe(2);
    expect(latest.allResults).toHaveLength(2);
  });
});
