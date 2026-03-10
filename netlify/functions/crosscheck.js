// Runs the spreadsheet cross-check comparison on Netlify.
// Fetches website results from the GitHub data branch and
// compares them with the Google Spreadsheet.
//
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO, GSHEET_SPREADSHEET_ID

const { crosscheck } = require('../../crosscheck');
const { authGuard } = require('../../lib/auth');

async function fetchReportFromGitHub(token, repo) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/video-report.json?ref=data`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

exports.handler = async (event) => {
  const authError = authGuard(event);
  if (authError) return authError;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server not configured (missing GITHUB_TOKEN or GITHUB_REPO)' }),
    };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const spreadsheetId = body.spreadsheetId || process.env.GSHEET_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No spreadsheet ID provided. Set GSHEET_SPREADSHEET_ID in environment or pass spreadsheetId in request.' }),
    };
  }

  // Get website results from request body or fetch from GitHub data branch
  let websiteResults = body.results;
  if (!websiteResults || !websiteResults.length) {
    try {
      const report = await fetchReportFromGitHub(token, repo);
      if (report) {
        websiteResults = report.allResults || [];
      }
    } catch (err) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Failed to fetch report: ${err.message}` }),
      };
    }
  }

  if (!websiteResults || !websiteResults.length) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No video check results available. Run a video check first.' }),
    };
  }

  try {
    const result = await crosscheck(websiteResults, spreadsheetId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Cross-check failed: ${err.message}` }),
    };
  }
};
