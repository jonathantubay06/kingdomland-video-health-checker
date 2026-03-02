// Returns an SVG health badge (like shields.io) based on latest report
// Env vars needed: GITHUB_TOKEN, GITHUB_REPO

exports.handler = async (event) => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  let label = 'Video Health';
  let value = 'unknown';
  let color = '#999';

  if (token && repo) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/contents/video-report.json?ref=data`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const report = JSON.parse(content);
        const s = report.summary;

        if (s && s.total > 0) {
          const rate = Math.round((s.passed / s.total) * 100);
          value = `${rate}% (${s.passed}/${s.total})`;

          if (rate >= 99) color = '#4c1';        // green
          else if (rate >= 90) color = '#dfb317';  // yellow
          else color = '#e05d44';                  // red
        }
      }
    } catch {
      value = 'error';
      color = '#999';
    }
  }

  // Generate SVG badge
  const labelWidth = label.length * 6.5 + 10;
  const valueWidth = value.length * 6.5 + 10;
  const totalWidth = labelWidth + valueWidth;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="13">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="13">${value}</text>
  </g>
</svg>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache, max-age=300',
    },
    body: svg,
  };
};
