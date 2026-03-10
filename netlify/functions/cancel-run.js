// Cancels a GitHub Actions workflow run
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO

const { authGuard } = require('../../lib/auth');

exports.handler = async (event) => {
  const authError = authGuard(event);
  if (authError) return authError;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let runId;
  try {
    const body = JSON.parse(event.body || '{}');
    runId = body.runId;
  } catch {}

  if (!runId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'runId required' }) };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/cancel`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (res.status === 202) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      };
    }

    const errorText = await res.text();
    return {
      statusCode: res.status,
      body: JSON.stringify({ error: errorText }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
