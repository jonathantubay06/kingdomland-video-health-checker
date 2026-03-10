// Bulk actions — select multiple videos, recheck or mark false positive
window.KL = window.KL || {};

KL.state.selectedTitles = [];
KL.state.falsePositives = JSON.parse(localStorage.getItem('kl-false-positives') || '[]');

KL.toggleBulkSelect = function(checkbox) {
  var title = checkbox.dataset.title;
  var idx = KL.state.selectedTitles.indexOf(title);
  if (checkbox.checked && idx === -1) {
    KL.state.selectedTitles.push(title);
  } else if (!checkbox.checked && idx !== -1) {
    KL.state.selectedTitles.splice(idx, 1);
  }
  KL.updateBulkBar();
};

KL.selectAllVisible = function(checked) {
  var checkboxes = document.querySelectorAll('.row-checkbox');
  KL.state.selectedTitles = [];
  checkboxes.forEach(function(cb) {
    cb.checked = checked;
    if (checked) KL.state.selectedTitles.push(cb.dataset.title);
  });
  KL.updateBulkBar();
};

KL.selectAllFailed = function() {
  KL.state.selectedTitles = [];
  var checkboxes = document.querySelectorAll('.row-checkbox');
  checkboxes.forEach(function(cb) {
    var r = KL.state.results.find(function(v) { return v.title === cb.dataset.title; });
    var isFailed = r && (r.status === KL.STATUS.FAIL || r.status === KL.STATUS.TIMEOUT);
    cb.checked = isFailed;
    if (isFailed) KL.state.selectedTitles.push(cb.dataset.title);
  });
  KL.updateBulkBar();
};

KL.updateBulkBar = function() {
  var bar = document.getElementById('bulk-actions-bar');
  if (!bar) return;
  var count = KL.state.selectedTitles.length;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('bulk-count').textContent = count + ' selected';
  } else {
    bar.style.display = 'none';
  }
  // Update select-all checkbox state
  var selectAll = document.getElementById('select-all-checkbox');
  if (selectAll) {
    var total = document.querySelectorAll('.row-checkbox').length;
    selectAll.checked = count > 0 && count === total;
    selectAll.indeterminate = count > 0 && count < total;
  }
};

KL.bulkRecheck = function() {
  if (KL.state.selectedTitles.length === 0) return;
  window._sectionRecheckTitles = KL.state.selectedTitles.slice();
  KL.openCredentialsModal();
};

KL.bulkMarkFalsePositive = function() {
  if (KL.state.selectedTitles.length === 0) return;
  var fp = KL.state.falsePositives;
  KL.state.selectedTitles.forEach(function(title) {
    if (fp.indexOf(title) === -1) fp.push(title);
  });
  localStorage.setItem('kl-false-positives', JSON.stringify(fp));

  // Visual feedback: dim these rows
  KL.state.selectedTitles.forEach(function(title) {
    var cb = document.querySelector('.row-checkbox[data-title="' + CSS.escape(title) + '"]');
    if (cb) {
      var tr = cb.closest('tr');
      if (tr) tr.classList.add('false-positive');
    }
  });
  KL.clearBulkSelection();
};

KL.bulkClearFalsePositive = function() {
  if (KL.state.selectedTitles.length === 0) return;
  KL.state.falsePositives = KL.state.falsePositives.filter(function(t) {
    return KL.state.selectedTitles.indexOf(t) === -1;
  });
  localStorage.setItem('kl-false-positives', JSON.stringify(KL.state.falsePositives));

  KL.state.selectedTitles.forEach(function(title) {
    var cb = document.querySelector('.row-checkbox[data-title="' + CSS.escape(title) + '"]');
    if (cb) {
      var tr = cb.closest('tr');
      if (tr) tr.classList.remove('false-positive');
    }
  });
  KL.clearBulkSelection();
};

KL.clearBulkSelection = function() {
  KL.state.selectedTitles = [];
  document.querySelectorAll('.row-checkbox').forEach(function(cb) { cb.checked = false; });
  KL.updateBulkBar();
};

KL.isFalsePositive = function(title) {
  return KL.state.falsePositives.indexOf(title) !== -1;
};
