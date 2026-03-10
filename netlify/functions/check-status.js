// Checks the status of a GitHub Actions workflow run
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO

const { authGuard } = require('../../lib/auth');

exports.handler = async (event) => {
  const authError = authGuard(event);
  if (authError) return authError;

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const runId = event.queryStringParameters?.runId;

  try {
    if (runId) {
      // Check specific run
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      const data = await res.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: data.id,
          status: data.status,           // queued, in_progress, completed
          conclusion: data.conclusion,   // success, failure, cancelled (only when completed)
          startedAt: data.run_started_at,
          updatedAt: data.updated_at,
          htmlUrl: data.html_url,
        }),
      };
    }

    // No runId — check if any workflow is currently running
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/check-videos.yml/runs?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    const data = await res.json();
    const latest = data.workflow_runs?.[0];

    if (!latest) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'none' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        startedAt: latest.run_started_at,
        updatedAt: latest.updated_at,
        htmlUrl: latest.html_url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
