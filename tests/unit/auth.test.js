import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('lib/auth', () => {
  let auth;

  beforeEach(async () => {
    auth = await import('../../lib/auth.js');
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  function makeEvent(headers = {}) {
    return { headers };
  }

  describe('validateApiKey', () => {
    it('allows all requests when API_KEY is not set', () => {
      delete process.env.API_KEY;
      const result = auth.validateApiKey(makeEvent());
      expect(result.valid).toBe(true);
    });

    it('rejects missing X-API-Key header when API_KEY is set', () => {
      process.env.API_KEY = 'test-secret-key';
      const result = auth.validateApiKey(makeEvent());
      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(401);
    });

    it('rejects wrong API key', () => {
      process.env.API_KEY = 'test-secret-key';
      const result = auth.validateApiKey(makeEvent({ 'x-api-key': 'wrong-key' }));
      expect(result.valid).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it('accepts correct API key (lowercase header)', () => {
      process.env.API_KEY = 'test-secret-key';
      const result = auth.validateApiKey(makeEvent({ 'x-api-key': 'test-secret-key' }));
      expect(result.valid).toBe(true);
    });

    it('accepts correct API key (mixed-case header)', () => {
      process.env.API_KEY = 'test-secret-key';
      const result = auth.validateApiKey(makeEvent({ 'X-API-Key': 'test-secret-key' }));
      expect(result.valid).toBe(true);
    });
  });

  describe('authGuard', () => {
    it('returns null when auth passes', () => {
      delete process.env.API_KEY;
      const result = auth.authGuard(makeEvent());
      expect(result).toBeNull();
    });

    it('returns error response when auth fails', () => {
      process.env.API_KEY = 'my-key';
      const result = auth.authGuard(makeEvent());
      expect(result).not.toBeNull();
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).error).toContain('Missing');
    });

    it('returns 403 for wrong key', () => {
      process.env.API_KEY = 'my-key';
      const result = auth.authGuard(makeEvent({ 'x-api-key': 'bad' }));
      expect(result.statusCode).toBe(403);
    });
  });
});
