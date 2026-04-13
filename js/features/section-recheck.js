// Bulk Recheck by Section
window.KL = window.KL || {};

KL.updateSectionRecheckDropdown = function() {
  var select = document.getElementById('section-recheck-select');
  if (!select) return;

  var sections = Object.keys(KL.state.sectionMap);
  if (sections.length === 0 || KL.state.status !== 'complete') {
    select.style.display = 'none';
    return;
  }

  select.innerHTML = '<option value="">Re-check a section...</option>';

  // Failed sections first
  for (var i = 0; i < sections.length; i++) {
    var key = sections[i];
    var s = KL.state.sectionMap[key];
    var failCount = (s.failed || 0) + (s.timeout || 0);
    if (failCount > 0) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = s.section + ' (' + s.page + ') \u2014 ' + failCount + ' failed';
      select.appendChild(opt);
    }
  }

  // Then all-passed sections
  for (var j = 0; j < sections.length; j++) {
    var key2 = sections[j];
    var s2 = KL.state.sectionMap[key2];
    var failCount2 = (s2.failed || 0) + (s2.timeout || 0);
    if (failCount2 === 0) {
      var opt2 = document.createElement('option');
      opt2.value = key2;
      opt2.textContent = s2.section + ' (' + s2.page + ') \u2014 ' + s2.total + ' videos';
      select.appendChild(opt2);
    }
  }

  select.style.display = 'inline-flex';
  select.onchange = function() {
    if (select.value) KL.recheckSection(select.value);
    select.value = '';
  };
};

KL.recheckSection = function(sectionKey) {
  var sectionVideos = KL.state.results.filter(function(r) { return (r.page + ' - ' + r.section) === sectionKey; });
  if (sectionVideos.length === 0) return;

  window._sectionRecheckTitles = sectionVideos.map(function(r) { return r.title; });
  window._credModalMode = 'recheck';
  KL.openCredentialsModal();
};
