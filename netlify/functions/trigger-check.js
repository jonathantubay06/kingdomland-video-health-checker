// Triggers a GitHub Actions workflow run
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO (owner/repo)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // e.g. "username/kingdomland-video-checker"

  if (!token || !repo) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let mode = 'both';
  try {
    const body = JSON.parse(event.body || '{}');
    if (['both', 'story', 'music'].includes(body.mode)) mode = body.mode;
  } catch {}

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/check-videos.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { mode },
        }),
      }
    );

    if (res.status === 204) {
      // Workflow dispatched — now get the run ID (takes a moment to appear)
      await new Promise(r => setTimeout(r, 2000));

      const runsRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/check-videos.yml/runs?per_page=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      const runsData = await runsRes.json();
      const runId = runsData.workflow_runs?.[0]?.id || null;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'triggered', runId }),
      };
    }

    const errorText = await res.text();
    return {
      statusCode: res.status,
      body: JSON.stringify({ error: `GitHub API error: ${errorText}` }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
