const { STATUS } = require('../../lib/constants');
const sampleReport = require('../fixtures/sample-report.json');
const sampleHistory = require('../fixtures/sample-history.json');

/**
 * Tests the report computation logic that generateReport() uses.
 * Since generateReport is not exported (it also writes files + emits events),
 * we test the pure logic separately using the same filtering patterns.
 */

function computeSummary(allResults) {
  const passed = allResults.filter(r => r.status === STATUS.PASS);
  const failed = allResults.filter(r => r.status === STATUS.FAIL);
  const timeouts = allResults.filter(r => r.status === STATUS.TIMEOUT);
  return {
    total: allResults.length,
    passed: passed.length,
    failed: failed.length,
    timeouts: timeouts.length,
  };
}

function computeHistoryEntry(allResults, timestamp) {
  return {
    timestamp,
    total: allResults.length,
    passed: allResults.filter(r => r.status === STATUS.PASS).length,
    failed: allResults.filter(r => r.status === STATUS.FAIL).length,
    timeouts: allResults.filter(r => r.status === STATUS.TIMEOUT).length,
    avgLoadTimeMs: Math.round(
      allResults.reduce((sum, r) => sum + (r.loadTimeMs || 0), 0) / (allResults.length || 1)
    ),
    videos: allResults.map(r => ({
      title: r.title,
      section: r.section || '',
      page: r.page || '',
      status: r.status,
      loadTimeMs: r.loadTimeMs || 0,
      error: r.error || '',
    })),
  };
}

function generateCsvRow(r) {
  return [
    r.number,
    `"${r.page}"`,
    `"${r.section || ''}"`,
    `"${(r.title || '').replace(/"/g, '""')}"`,
    `"${r.status}"`,
    `"${r.url}"`,
    `"${(r.error || '').replace(/"/g, '""')}"`,
    `"${r.hlsSrc || ''}"`,
    `"${r.duration || ''}"`,
    `"${r.resolution || ''}"`,
    r.loadTimeMs || '',
  ].join(',');
}

describe('Report computation logic', () => {
  describe('computeSummary', () => {
    it('correctly counts passed, failed, and timed-out videos', () => {
      const summary = computeSummary(sampleReport.allResults);
      expect(summary).toEqual({
        total: 6,
        passed: 4,
        failed: 1,
        timeouts: 1,
      });
    });

    it('handles empty results', () => {
      const summary = computeSummary([]);
      expect(summary).toEqual({ total: 0, passed: 0, failed: 0, timeouts: 0 });
    });

    it('handles all-pass scenario', () => {
      const allPass = sampleReport.allResults.map(r => ({ ...r, status: STATUS.PASS }));
      const summary = computeSummary(allPass);
      expect(summary.passed).toBe(summary.total);
      expect(summary.failed).toBe(0);
      expect(summary.timeouts).toBe(0);
    });

    it('handles all-fail scenario', () => {
      const allFail = sampleReport.allResults.map(r => ({ ...r, status: STATUS.FAIL }));
      const summary = computeSummary(allFail);
      expect(summary.failed).toBe(summary.total);
      expect(summary.passed).toBe(0);
    });
  });

  describe('computeHistoryEntry', () => {
    it('computes correct average load time', () => {
      const entry = computeHistoryEntry(sampleReport.allResults, '2025-06-15T10:30:00.000Z');
      // (2400 + 1800 + 0 + 3100 + 20000 + 1500) / 6 = 28800 / 6 = 4800
      expect(entry.avgLoadTimeMs).toBe(4800);
    });

    it('includes per-video summary in history entry', () => {
      const entry = computeHistoryEntry(sampleReport.allResults, '2025-06-15T10:30:00.000Z');
      expect(entry.videos).toHaveLength(6);
      expect(entry.videos[0]).toEqual({
        title: 'Welcome Song',
        section: 'Praise & Worship',
        page: 'MUSIC',
        status: 'PASS',
        loadTimeMs: 2400,
        error: '',
      });
    });

    it('handles missing optional fields gracefully', () => {
      const sparse = [{ status: STATUS.PASS, title: 'Test' }];
      const entry = computeHistoryEntry(sparse, '2025-01-01T00:00:00Z');
      expect(entry.videos[0].section).toBe('');
      expect(entry.videos[0].page).toBe('');
      expect(entry.videos[0].loadTimeMs).toBe(0);
      expect(entry.videos[0].error).toBe('');
    });

    it('does not divide by zero on empty results', () => {
      const entry = computeHistoryEntry([], '2025-01-01T00:00:00Z');
      expect(entry.avgLoadTimeMs).toBe(0);
      expect(entry.total).toBe(0);
    });
  });

  describe('CSV generation', () => {
    it('escapes double quotes in title', () => {
      const row = generateCsvRow({
        number: 1,
        page: 'STORY',
        section: 'Season 1',
        title: 'He said "Hello"',
        status: 'PASS',
        url: 'https://example.com',
        error: '',
        hlsSrc: '',
        duration: '',
        resolution: '',
        loadTimeMs: 1000,
      });
      expect(row).toContain('"He said ""Hello"""');
    });

    it('handles missing optional fields', () => {
      const row = generateCsvRow({
        number: 1,
        page: 'MUSIC',
        title: 'Test',
        status: 'FAIL',
        url: 'https://example.com',
      });
      expect(row).toContain('""'); // empty fields
    });
  });

  describe('Fixture data integrity', () => {
    it('sample report has consistent summary', () => {
      const computed = computeSummary(sampleReport.allResults);
      expect(computed).toEqual(sampleReport.summary);
    });

    it('sample history has valid entries', () => {
      expect(sampleHistory).toHaveLength(3);
      for (const entry of sampleHistory) {
        expect(entry.total).toBe(entry.passed + entry.failed + entry.timeouts);
        expect(entry.timestamp).toBeTruthy();
        expect(entry.avgLoadTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('all results have required fields', () => {
      for (const r of sampleReport.allResults) {
        expect(r).toHaveProperty('number');
        expect(r).toHaveProperty('title');
        expect(r).toHaveProperty('status');
        expect(r).toHaveProperty('url');
        expect([STATUS.PASS, STATUS.FAIL, STATUS.TIMEOUT, STATUS.UNKNOWN]).toContain(r.status);
      }
    });
  });
});
