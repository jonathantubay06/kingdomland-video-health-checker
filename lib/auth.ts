// API key authentication for Netlify Functions
// Reads API_KEY from env. If set, all protected endpoints require X-API-Key header.
// If API_KEY is not set, auth is disabled (open access).

import type { AuthResult, NetlifyEvent, NetlifyResponse } from '../src/types';

export function validateApiKey(event: NetlifyEvent): AuthResult {
  const apiKey = process.env.API_KEY;
  // If no API_KEY configured, allow all requests (auth disabled)
  if (!apiKey) return { valid: true };

  const provided = event.headers['x-api-key'] || event.headers['X-API-Key'] || '';
  if (!provided) {
    return { valid: false, statusCode: 401, error: 'Missing X-API-Key header' };
  }
  if (provided !== apiKey) {
    return { valid: false, statusCode: 403, error: 'Invalid API key' };
  }
  return { valid: true };
}

export function authGuard(event: NetlifyEvent): NetlifyResponse | null {
  const result = validateApiKey(event);
  if (!result.valid) {
    return {
      statusCode: result.statusCode!,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: result.error }),
    };
  }
  return null; // null means auth passed
}
