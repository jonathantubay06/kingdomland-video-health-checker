// Diff Report — changes since last run
window.KL = window.KL || {};

KL.loadAndShowDiffReport = async function() {
  var container = document.getElementById('diff-report');
  if (!container) return;

  try {
    var url = '/api/get-report?file=previous-report.json';
    if (KL.isLocal) url = '/api/report?file=previous-report.json';
    var res = await fetch(url);
    if (!res.ok) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
      container.classList.add('visible');
      return;
    }

    var previousReport = await res.json();
    var previousResults = previousReport.allResults || previousReport || [];

    if (!Array.isArray(previousResults) || previousResults.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
      container.classList.add('visible');
      return;
    }

    var prevMap = {};
    for (var i = 0; i < previousResults.length; i++) {
      prevMap[previousResults[i].title] = previousResults[i].status;
    }

    var newFailures = [];
    var fixed = [];
    var stillFailing = [];

    for (var j = 0; j < KL.state.results.length; j++) {
      var r = KL.state.results[j];
      var prevStatus = prevMap[r.title];
      if (!prevStatus) continue;

      if ((r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT) && prevStatus === KL.STATUS.PASS) {
        newFailures.push(r);
      } else if (r.status === KL.STATUS.PASS && (prevStatus === KL.STATUS.FAIL || prevStatus === KL.STATUS.TIMEOUT)) {
        fixed.push(r);
      } else if ((r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT) && (prevStatus === KL.STATUS.FAIL || prevStatus === KL.STATUS.TIMEOUT)) {
        stillFailing.push(r);
      }
    }

    if (newFailures.length === 0 && fixed.length === 0 && stillFailing.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">No changes from previous run.</p>';
      container.classList.add('visible');
      return;
    }

    var html = '<h3 style="margin:0 0 12px 0;font-size:0.95rem;">Changes Since Last Run</h3>';

    if (newFailures.length > 0) {
      html += '<div class="diff-group diff-new-failures"><h4 style="color:#ef4444;margin:0 0 6px 0;font-size:0.88rem;">New Failures (' + newFailures.length + ')</h4><ul style="margin:0;padding-left:20px;">';
      for (var k = 0; k < newFailures.length; k++) {
        html += '<li style="color:#ef4444;margin-bottom:2px;">' + KL.escHtml(newFailures[k].title) + ' <span style="opacity:0.7">[' + KL.escHtml(newFailures[k].section || '') + ']</span> - ' + newFailures[k].status + '</li>';
      }
      html += '</ul></div>';
    }

    if (fixed.length > 0) {
      html += '<div class="diff-group diff-fixed" style="margin-top:10px;"><h4 style="color:#22c55e;margin:0 0 6px 0;font-size:0.88rem;">Fixed (' + fixed.length + ')</h4><ul style="margin:0;padding-left:20px;">';
      for (var m = 0; m < fixed.length; m++) {
        html += '<li style="color:#22c55e;margin-bottom:2px;">' + KL.escHtml(fixed[m].title) + ' <span style="opacity:0.7">[' + KL.escHtml(fixed[m].section || '') + ']</span></li>';
      }
      html += '</ul></div>';
    }

    if (stillFailing.length > 0) {
      html += '<div class="diff-group diff-still-failing" style="margin-top:10px;"><h4 style="color:#f59e0b;margin:0 0 6px 0;font-size:0.88rem;">Still Failing (' + stillFailing.length + ')</h4><ul style="margin:0;padding-left:20px;">';
      for (var n = 0; n < stillFailing.length; n++) {
        html += '<li style="color:#f59e0b;margin-bottom:2px;">' + KL.escHtml(stillFailing[n].title) + ' <span style="opacity:0.7">[' + KL.escHtml(stillFailing[n].section || '') + ']</span> - ' + stillFailing[n].status + '</li>';
      }
      html += '</ul></div>';
    }

    container.innerHTML = html;
    container.classList.add('visible');
  } catch (e) {
    console.error('Failed to load diff report:', e);
    container.innerHTML = '<p style="color:var(--color-text-muted);padding:12px;">First run -- no comparison available.</p>';
    container.classList.add('visible');
  }
};
