import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('netlify/functions/webhook-notify', () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    delete process.env.WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
    const mod = await import('../../netlify/functions/webhook-notify.js');
    handler = mod.handler;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it('rejects non-POST requests', async () => {
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('skips when no webhooks configured', async () => {
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ summary: { total: 10, passed: 10, failed: 0 } }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('skipped');
  });

  it('returns 400 for invalid JSON', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    const mod = await import('../../netlify/functions/webhook-notify.js');
    const res = await mod.handler({ httpMethod: 'POST', body: 'not json' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing summary', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    const mod = await import('../../netlify/functions/webhook-notify.js');
    const res = await mod.handler({ httpMethod: 'POST', body: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
  });

  it('sends Block Kit to Slack webhook', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/x';
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const mod = await import('../../netlify/functions/webhook-notify.js');

    const res = await mod.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        summary: { total: 100, passed: 95, failed: 3, timeouts: 2 },
        performanceAlerts: [{ title: 'Slow', loadTimeMs: 10000, level: 'CRITICAL' }],
        runId: '12345',
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('https://hooks.slack.com/services/T/B/x');
    const body = JSON.parse(call[1].body);
    expect(body.blocks).toBeDefined();
    expect(body.blocks.length).toBeGreaterThan(1);
  });

  it('sends generic payload to non-Slack webhook', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const mod = await import('../../netlify/functions/webhook-notify.js');

    const res = await mod.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        summary: { total: 50, passed: 50, failed: 0 },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('check_complete');
    expect(body.summary.total).toBe(50);
  });

  it('includes performanceAlerts in generic webhook', async () => {
    process.env.WEBHOOK_URL = 'https://example.com/hook';
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const mod = await import('../../netlify/functions/webhook-notify.js');

    const res = await mod.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        summary: { total: 10, passed: 8, failed: 2 },
        performanceAlerts: [{ title: 'X', loadTimeMs: 9000, level: 'WARNING' }],
      }),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.performanceAlerts).toHaveLength(1);
    expect(body.performanceAlerts[0].title).toBe('X');
  });
});
