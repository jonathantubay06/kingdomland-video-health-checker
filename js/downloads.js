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
  var rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  var rows = results.map(function(r) {
    return '<tr><td>' + r.number + '</td><td>' + KL.escHtml(r.title) + '</td><td>' + KL.escHtml(r.section || '') + '</td><td>' + (r.page || '') + '</td><td>' + r.status + '</td><td>' + (r.loadTimeMs ? (r.loadTimeMs / 1000).toFixed(1) + 's' : '-') + '</td></tr>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><title>Video Check Report</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:0.9rem}th{background:#f5f5f5}</style></head><body>' +
    '<h1>Kingdomland Video Check Report</h1>' +
    '<p>Total: ' + total + ' | Passed: ' + passed + ' | Failed: ' + failed + ' | Timed Out: ' + timeouts + ' | Rate: ' + rate + '%</p>' +
    '<table><thead><tr><th>#</th><th>Title</th><th>Section</th><th>Page</th><th>Status</th><th>Load Time</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';

  var container = document.getElementById('print-report');
  container.innerHTML = html;
  window.print();
  setTimeout(function() { container.innerHTML = ''; }, 1000);
};
