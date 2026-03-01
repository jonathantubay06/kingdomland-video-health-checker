// Fetches live progress from GitHub Actions: job steps + log output
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO

exports.handler = async (event) => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const runId = event.queryStringParameters?.runId;
  if (!runId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'runId required' }) };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    // Get jobs for this run
    const jobsRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`,
      { headers }
    );
    const jobsData = await jobsRes.json();
    const job = jobsData.jobs?.[0];

    if (!job) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'waiting', steps: [], log: '' }),
      };
    }

    // Format steps
    const steps = (job.steps || []).map(s => ({
      name: s.name,
      status: s.status,           // queued, in_progress, completed
      conclusion: s.conclusion,   // success, failure, skipped, null
      startedAt: s.started_at,
      completedAt: s.completed_at,
    }));

    // Try to get live log for this job
    let log = '';
    try {
      const logRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`,
        { headers, redirect: 'follow' }
      );
      if (logRes.ok) {
        const fullLog = await logRes.text();
        // Extract only the "Run video check" step output (most relevant)
        const lines = fullLog.split('\n');
        // Get the last 50 lines to show most recent progress
        const recent = lines.slice(-50).join('\n');
        log = recent;
      }
    } catch {
      // Logs may not be available yet during early steps
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: job.status,
        conclusion: job.conclusion,
        steps,
        log,
        htmlUrl: job.html_url,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
