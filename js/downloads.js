// Download and print report functions
window.KL = window.KL || {};

window.downloadFile = function(format) {
  if (KL.isLocal) {
    window.location.href = '/api/download/' + format;
  } else {
    var fileMap = { csv: 'video-report.csv', json: 'video-report.json', txt: 'failed-videos.txt' };
    var file = fileMap[format];
    if (file) window.location.href = '/api/get-report?file=' + file;
  }
};

window.printReport = function() {
  var results = KL.state.results;
  if (!results.length) { alert('No results to print.'); return; }
  var total = results.length;
  var passed = KL.state.passedCount;
  var failed = KL.state.failedCount;
  var timeouts = KL.state.timeoutCount;
  var rate = total > 0 ? (passed / total * 100).toFixed(1) : 0;

  // Build sections map
  var sections = {};
  results.forEach(function(r) {
    var key = (r.page || '') + '::' + (r.section || 'Unknown');
    if (!sections[key]) sections[key] = { page: r.page || '', section: r.section || 'Unknown', total: 0, passed: 0, failed: 0 };
    sections[key].total++;
    if (r.status === 'PASS') sections[key].passed++;
    else sections[key].failed++;
  });

  var sectionCards = Object.values(sections).map(function(s) {
    var pct = s.total > 0 ? Math.round(s.passed / s.total * 100) : 0;
    var tagColor = s.page === 'MUSIC' ? '#be185d' : '#6d28d9';
    var tagBg = s.page === 'MUSIC' ? '#fce7f3' : '#ede9fe';
    var barColor = s.failed > 0 ? '#ef4444' : '#22c55e';
    return '<div style="flex:1 1 calc(25% - 8px);min-width:160px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;background:#f9fafb">' +
      '<div style="font-size:0.82rem;font-weight:700;color:#1e1b4b;margin-bottom:3px">' + KL.escHtml(s.section) + '</div>' +
      '<span style="display:inline-block;font-size:0.62rem;font-weight:700;padding:1px 6px;border-radius:4px;background:' + tagBg + ';color:' + tagColor + ';text-transform:uppercase;margin-bottom:6px">' + s.page + '</span>' +
      '<div style="height:5px;background:#e5e7eb;border-radius:3px;margin-bottom:6px"><div style="height:5px;width:' + pct + '%;background:' + barColor + ';border-radius:3px"></div></div>' +
      '<div style="font-size:0.72rem;display:flex;justify-content:space-between">' +
        '<span style="color:#16a34a;font-weight:600">' + s.passed + ' passed</span>' +
        '<span style="color:' + (s.failed > 0 ? '#dc2626' : '#6b7280') + '">' + s.failed + ' failed</span>' +
        '<span style="color:#6b7280">' + pct + '%</span>' +
      '</div>' +
    '</div>';
  }).join('');

  var resultRows = results.map(function(r, i) {
    var rowBg = r.status === 'FAIL' ? '#fef2f2' : r.status === 'TIMEOUT' ? '#fffbeb' : (i % 2 === 1 ? '#f9fafb' : '#fff');
    var statusColor = r.status === 'PASS' ? '#16a34a' : r.status === 'FAIL' ? '#dc2626' : '#d97706';
    var loadTime = r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : (r.duration || '-');
    return '<tr style="background:' + rowBg + '">' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + KL.escHtml(r.title) + '</td>' +
      '<td>' + KL.escHtml(r.section || '') + '</td>' +
      '<td>' + (r.page || '') + '</td>' +
      '<td style="color:' + statusColor + ';font-weight:600">' + r.status + '</td>' +
      '<td>' + loadTime + '</td>' +
      '<td style="color:#dc2626;font-size:0.68rem">' + (r.error ? KL.escHtml(r.error) : '-') + '</td>' +
    '</tr>';
  }).join('');

  var badgeColor = failed === 0 ? '#15803d' : '#dc2626';
  var badgeBg = failed === 0 ? '#dcfce7' : '#fef2f2';
  var badgeText = failed === 0 ? '✓ All ' + total + ' Videos OK' : '✗ ' + failed + ' Failed';
  var dateStr = new Date().toISOString().slice(0, 10);

  var container = document.getElementById('print-report');
  container.innerHTML =
    '<style>' +
    '@page{size:11in 8.5in;margin:0.5in}' +
    'body{font-family:"Segoe UI",Arial,sans-serif;color:#111;background:#fff}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#f3f4f6;font-weight:600;text-transform:uppercase;font-size:0.68rem;letter-spacing:0.04em;color:#374151;padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left}' +
    'td{padding:5px 8px;font-size:0.72rem;color:#374151;border-bottom:1px solid #f0f0f0}' +
    '</style>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #4f46e5;padding-bottom:12px;margin-bottom:20px">' +
      '<div><h1 style="font-size:1.4rem;margin:0 0 2px;color:#1e1b4b">Kingdomland Video Check Report</h1>' +
      '<p style="font-size:0.8rem;color:#6b7280;margin:0">go.kingdomlandkids.com &middot; Generated: ' + new Date().toLocaleString() + '</p></div>' +
      '<div style="text-align:right">' +
        '<div style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:0.85rem;font-weight:700;background:' + badgeBg + ';color:' + badgeColor + ';margin-bottom:4px">' + badgeText + '</div>' +
        '<div style="font-size:0.8rem;color:#6b7280">Pass Rate: <strong>' + rate + '%</strong></div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:12px;margin-bottom:20px">' +
      '<div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px">Total Videos</div><div style="font-size:1.5rem;font-weight:700">' + total + '</div></div>' +
      '<div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px">Passed</div><div style="font-size:1.5rem;font-weight:700;color:#16a34a">' + passed + '</div></div>' +
      '<div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px">Failed</div><div style="font-size:1.5rem;font-weight:700;color:#dc2626">' + failed + '</div></div>' +
      '<div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px">Timed Out</div><div style="font-size:1.5rem;font-weight:700">' + timeouts + '</div></div>' +
      '<div style="flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f9fafb"><div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px">Pass Rate</div><div style="font-size:1.5rem;font-weight:700">' + rate + '%</div></div>' +
    '</div>' +
    '<div style="font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#374151;margin:0 0 10px;border-left:3px solid #4f46e5;padding-left:8px">Section Breakdown</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">' + sectionCards + '</div>' +
    '<div style="font-size:0.9rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#374151;margin:0 0 8px;border-left:3px solid #4f46e5;padding-left:8px">Detailed Results</div>' +
    '<table><thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Load Time</th><th>Error</th></tr></thead><tbody>' + resultRows + '</tbody></table>';

  var origTitle = document.title;
  document.title = 'KDL-Video-Check-' + dateStr;
  window.print();
  setTimeout(function() {
    container.innerHTML = '';
    document.title = origTitle;
  }, 1000);
};
