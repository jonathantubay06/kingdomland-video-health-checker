/**
 * SQLite database layer using better-sqlite3.
 *
 * Schema:
 *   runs     — one row per check run (timestamp, summary counts)
 *   results  — one row per video per run (status, load time, error, etc.)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { VideoResult, CheckReport, CheckSummary, DegradingVideo } from '../src/types';

interface RunRow {
  id: number;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  avg_load_ms: number;
}

interface ResultRow {
  id: number;
  run_id: number;
  number: number;
  title: string;
  section: string;
  page: string;
  url: string;
  hls_src: string;
  status: string;
  error: string;
  load_time_ms: number;
  duration: string;
  resolution: string;
}

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'checker.db');

let _db: Database.Database | null = null;

function getDbPath(): string {
  return process.env.KL_DB_PATH || DEFAULT_DB_PATH;
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      timeouts INTEGER NOT NULL DEFAULT 0,
      avg_load_ms INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      number INTEGER,
      title TEXT NOT NULL,
      section TEXT DEFAULT '',
      page TEXT DEFAULT '',
      url TEXT DEFAULT '',
      hls_src TEXT DEFAULT '',
      status TEXT NOT NULL,
      error TEXT DEFAULT '',
      load_time_ms INTEGER DEFAULT 0,
      duration TEXT DEFAULT '',
      resolution TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);
    CREATE INDEX IF NOT EXISTS idx_results_title ON results(title);
    CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
  `);

  return _db;
}

export function saveRun(report: Partial<CheckReport>): number {
  const db = getDb();
  const summary = report.summary || {} as CheckSummary;
  const allResults = report.allResults || [];

  const avgLoadMs = allResults.length > 0
    ? Math.round(allResults.reduce((sum, r) => sum + (r.loadTimeMs || 0), 0) / allResults.length)
    : 0;

  const insertRun = db.prepare(`
    INSERT INTO runs (timestamp, total, passed, failed, timeouts, avg_load_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertResult = db.prepare(`
    INSERT INTO results (run_id, number, title, section, page, url, hls_src, status, error, load_time_ms, duration, resolution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runTransaction = db.transaction(() => {
    const info = insertRun.run(
      report.timestamp || new Date().toISOString(),
      summary.total || allResults.length,
      summary.passed || 0,
      summary.failed || 0,
      summary.timeouts || 0,
      avgLoadMs
    );
    const runId = info.lastInsertRowid as number;

    for (const r of allResults) {
      insertResult.run(
        runId,
        r.number || 0,
        r.title || '',
        r.section || '',
        r.page || '',
        r.url || '',
        r.hlsSrc || '',
        r.status || 'UNKNOWN',
        r.error || '',
        r.loadTimeMs || 0,
        r.duration || '',
        r.resolution || ''
      );
    }
    return runId;
  });

  return runTransaction();
}

export function getLatestRun() {
  const db = getDb();
  const run = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as RunRow | undefined;
  if (!run) return null;

  const results = db.prepare('SELECT * FROM results WHERE run_id = ? ORDER BY number').all(run.id) as ResultRow[];
  return {
    timestamp: run.timestamp,
    summary: { total: run.total, passed: run.passed, failed: run.failed, timeouts: run.timeouts },
    allResults: results.map(mapResult),
  };
}

export function getRunHistory(limit = 50) {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as RunRow[];
  return runs.reverse().map(r => ({
    timestamp: r.timestamp,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    timeouts: r.timeouts,
    avgLoadTimeMs: r.avg_load_ms,
  }));
}

export function getRunHistoryDetail(limit = 50) {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as RunRow[];

  return runs.reverse().map(r => {
    const results = db.prepare('SELECT * FROM results WHERE run_id = ? ORDER BY number').all(r.id) as ResultRow[];
    return {
      timestamp: r.timestamp,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      timeouts: r.timeouts,
      avgLoadTimeMs: r.avg_load_ms,
      videos: results.map(res => ({
        title: res.title,
        section: res.section,
        page: res.page,
        status: res.status,
        loadTimeMs: res.load_time_ms,
        error: res.error,
      })),
    };
  });
}

export function getVideoHistory(title: string, days = 30) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const rows = db.prepare(`
    SELECT r.timestamp, res.status, res.load_time_ms, res.error
    FROM results res
    JOIN runs r ON r.id = res.run_id
    WHERE res.title = ? AND r.timestamp >= ?
    ORDER BY r.timestamp
  `).all(title, since) as Array<{ timestamp: string; status: string; load_time_ms: number; error: string }>;

  return rows.map(row => ({
    timestamp: row.timestamp,
    status: row.status,
    loadTimeMs: row.load_time_ms,
    error: row.error,
  }));
}

export function getPerformanceTrend(title: string, days = 30) {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  return db.prepare(`
    SELECT r.timestamp, res.load_time_ms as loadTimeMs, res.status
    FROM results res
    JOIN runs r ON r.id = res.run_id
    WHERE res.title = ? AND r.timestamp >= ?
    ORDER BY r.timestamp
  `).all(title, since);
}

export function getDegradingVideos(days = 14): DegradingVideo[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const titles = db.prepare(`
    SELECT DISTINCT res.title
    FROM results res
    JOIN runs r ON r.id = res.run_id
    WHERE r.timestamp >= ? AND res.load_time_ms > 0
    GROUP BY res.title
    HAVING COUNT(*) >= 4
  `).all(since).map((r: any) => r.title as string);

  const degrading: DegradingVideo[] = [];

  for (const title of titles) {
    const rows = db.prepare(`
      SELECT res.load_time_ms
      FROM results res
      JOIN runs r ON r.id = res.run_id
      WHERE res.title = ? AND r.timestamp >= ? AND res.load_time_ms > 0
      ORDER BY r.timestamp
    `).all(title, since) as Array<{ load_time_ms: number }>;

    if (rows.length < 4) continue;

    const allAvg = rows.reduce((s, r) => s + r.load_time_ms, 0) / rows.length;
    const recent = rows.slice(-3);
    const recentAvg = recent.reduce((s, r) => s + r.load_time_ms, 0) / recent.length;

    if (recentAvg > allAvg * 1.5) {
      degrading.push({
        title,
        allAvg: Math.round(allAvg),
        recentAvg: Math.round(recentAvg),
        degradation: Math.round(((recentAvg - allAvg) / allAvg) * 100),
      });
    }
  }

  return degrading.sort((a, b) => b.degradation - a.degradation);
}

export function migrateFromJson(historyPath?: string, reportPath?: string): number {
  historyPath = historyPath || path.join(__dirname, '..', 'history.json');
  reportPath = reportPath || path.join(__dirname, '..', 'video-report.json');

  let imported = 0;

  if (fs.existsSync(historyPath)) {
    try {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      for (const entry of history) {
        const allResults: VideoResult[] = (entry.videos || []).map((v: any, i: number) => ({
          number: i + 1,
          title: v.title,
          section: v.section || '',
          page: v.page || '',
          url: '',
          hlsSrc: '',
          status: v.status,
          error: v.error || '',
          loadTimeMs: v.loadTimeMs || 0,
          duration: '',
          resolution: '',
        }));

        saveRun({
          timestamp: entry.timestamp,
          summary: {
            total: entry.total || allResults.length,
            passed: entry.passed || 0,
            failed: entry.failed || 0,
            timeouts: entry.timeouts || 0,
          },
          allResults,
        });
        imported++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to import history.json:', message);
    }
  }

  if (imported === 0 && fs.existsSync(reportPath!)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath!, 'utf-8'));
      saveRun(report);
      imported++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to import video-report.json:', message);
    }
  }

  console.log(`Migrated ${imported} entries to SQLite.`);
  return imported;
}

export function close(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function mapResult(row: ResultRow): VideoResult {
  return {
    number: row.number,
    title: row.title,
    section: row.section,
    page: row.page,
    url: row.url,
    hlsSrc: row.hls_src,
    status: row.status as VideoResult['status'],
    error: row.error,
    loadTimeMs: row.load_time_ms,
    duration: row.duration,
    resolution: row.resolution,
  };
}
