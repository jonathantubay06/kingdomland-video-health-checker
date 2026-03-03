// Proxies "Apply Changes" to the Google Apps Script web app.
// Env vars needed: GSHEET_WEBAPP_URL (optional, can be sent in request body)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const webappUrl = body.webappUrl || process.env.GSHEET_WEBAPP_URL;
  if (!webappUrl) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No Google Apps Script web app URL configured. Set GSHEET_WEBAPP_URL in environment or deploy the Apps Script first.' }),
    };
  }

  const changes = body.changes;
  if (!changes || !changes.length) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No changes to apply' }),
    };
  }

  try {
    // POST to the Google Apps Script web app
    const res = await fetch(webappUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
      redirect: 'follow',
    });

    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { success: true, raw: text };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Failed to apply changes: ${err.message}` }),
    };
  }
};
