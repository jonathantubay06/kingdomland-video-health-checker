// Fetches the latest report from the GitHub data branch
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO

exports.handler = async (event) => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const file = event.queryStringParameters?.file || 'video-report.json';

  // Only allow known files
  const allowed = ['video-report.json', 'video-report.csv', 'failed-videos.txt', 'status.json', 'history.json', 'previous-report.json'];
  if (!allowed.includes(file)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid file' }) };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${file}?ref=data`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (res.status === 404) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No report found. Run a check first.' }),
      };
    }

    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    // For JSON file, return as JSON; for others, return as text
    const isJson = file.endsWith('.json');

    // For CSV/TXT downloads, set download headers
    if (!isJson) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': file.endsWith('.csv') ? 'text/csv' : 'text/plain',
          'Content-Disposition': `attachment; filename="${file}"`,
        },
        body: content,
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: content,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
