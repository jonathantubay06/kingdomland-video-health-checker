// API key authentication for Netlify Functions
// Reads API_KEY from env. If set, all protected endpoints require X-API-Key header.
// If API_KEY is not set: open in local dev, but 503 on a deployed site.

// True when running under `netlify dev` / local function emulation rather than
// a deployed site. Netlify sets CONTEXT=dev locally and 'production'/'deploy-preview' when hosted.
function isLocalDev() {
  return !process.env.NETLIFY || process.env.CONTEXT === 'dev';
}

function validateApiKey(event) {
  const apiKey = process.env.API_KEY;

  // PUBLIC_ACCESS=true is a deliberate "yes, anyone may use this" switch. It exists so
  // that being open is always a choice someone made, never the result of a missing variable.
  if (process.env.PUBLIC_ACCESS === 'true') return { valid: true };

  if (!apiKey) {
    // Deny by default when deployed: an unset API_KEY used to mean "open to everyone",
    // so a deploy that forgot the variable silently exposed trigger-check / cancel-run
    // to the internet with no signal. Failing loudly is the recoverable direction.
    if (!isLocalDev()) {
      return {
        valid: false,
        statusCode: 503,
        error: 'Server auth is not configured (API_KEY unset). Set API_KEY in the site environment.',
      };
    }
    return { valid: true }; // local dev stays frictionless
  }

  const provided = event.headers['x-api-key'] || event.headers['X-API-Key'] || '';
  if (!provided) {
    return { valid: false, statusCode: 401, error: 'Missing X-API-Key header' };
  }
  if (provided !== apiKey) {
    return { valid: false, statusCode: 403, error: 'Invalid API key' };
  }
  return { valid: true };
}

function authGuard(event) {
  const result = validateApiKey(event);
  if (!result.valid) {
    return {
      statusCode: result.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: result.error }),
    };
  }
  return null; // null means auth passed
}

module.exports = { validateApiKey, authGuard };
