import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('lib/slack', () => {
  let slack;

  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
  });

  describe('postToSlack', () => {
    it('returns false when SLACK_WEBHOOK_URL is not set', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      slack = await import('../../lib/slack.js');
      const result = await slack.postToSlack([], 'test');
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendSlackFailureAlert', () => {
    it('returns false when no failures and no perf alerts', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      slack = await import('../../lib/slack.js');
      const result = await slack.sendSlackFailureAlert([], { total: 10, passed: 10, failed: 0, timeouts: 0 });
      expect(result).toBe(false);
    });

    it('sends Block Kit message for failures', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      mockFetch.mockResolvedValue({ ok: true });
      slack = await import('../../lib/slack.js');

      const failedVideos = [
        { title: 'Video A', section: 'Section 1', error: 'No video element' },
        { title: 'Video B', section: '', error: 'Timeout' },
      ];
      const summary = { total: 10, passed: 8, failed: 2, timeouts: 0 };

      const result = await slack.sendSlackFailureAlert(failedVideos, summary);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks).toBeDefined();
      expect(body.blocks[0].type).toBe('header');
      expect(body.text).toContain('80%');
    });

    it('includes performance alerts when provided', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      mockFetch.mockResolvedValue({ ok: true });
      slack = await import('../../lib/slack.js');

      const perfAlerts = [
        { title: 'Slow Video', loadTimeMs: 12000, level: 'CRITICAL' },
      ];
      const summary = { total: 10, passed: 10, failed: 0, timeouts: 0 };

      const result = await slack.sendSlackFailureAlert([], summary, perfAlerts);
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const perfBlock = body.blocks.find(b => b.text && b.text.text && b.text.text.includes('Performance'));
      expect(perfBlock).toBeDefined();
      expect(perfBlock.text.text).toContain('Slow Video');
    });
  });

  describe('sendSlackDailySummary', () => {
    it('sends summary with trend hearts', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      mockFetch.mockResolvedValue({ ok: true });
      slack = await import('../../lib/slack.js');

      const summary = { total: 100, passed: 100, failed: 0, timeouts: 0 };
      const history = [
        { total: 100, passed: 100, failed: 0, timeouts: 0 },
        { total: 100, passed: 95, failed: 5, timeouts: 0 },
        { total: 100, passed: 80, failed: 20, timeouts: 0 },
      ];

      const result = await slack.sendSlackDailySummary(summary, history);
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.blocks[0].text.text).toContain('Daily Video Health Summary');
      // Check trend block exists
      const trendBlock = body.blocks.find(b => b.text && b.text.text && b.text.text.includes('Trend'));
      expect(trendBlock).toBeDefined();
    });

    it('handles empty history gracefully', async () => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
      mockFetch.mockResolvedValue({ ok: true });
      slack = await import('../../lib/slack.js');

      const summary = { total: 50, passed: 48, failed: 2, timeouts: 0 };
      const result = await slack.sendSlackDailySummary(summary, []);
      expect(result).toBe(true);
    });
  });
});
