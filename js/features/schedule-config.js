// Configurable schedule settings — local mode only
window.KL = window.KL || {};

KL.getScheduleConfig = function() {
  var defaults = { enabled: false, cron: '0 6 * * *', description: 'Daily at 6:00 AM' };
  try {
    var saved = JSON.parse(localStorage.getItem('kl-schedule-config'));
    return saved || defaults;
  } catch { return defaults; }
};

KL.saveScheduleConfig = function(config) {
  localStorage.setItem('kl-schedule-config', JSON.stringify(config));
};

KL.initScheduleUI = function() {
  var section = document.getElementById('schedule-section');
  if (!section) return;

  var config = KL.getScheduleConfig();
  section.style.display = 'block';

  var presets = [
    { label: 'Every 6 hours', cron: '0 */6 * * *' },
    { label: 'Daily at 6 AM', cron: '0 6 * * *' },
    { label: 'Daily at 12 PM', cron: '0 12 * * *' },
    { label: 'Twice daily (6 AM & 6 PM)', cron: '0 6,18 * * *' },
    { label: 'Weekdays at 8 AM', cron: '0 8 * * 1-5' },
    { label: 'Custom', cron: '' },
  ];

  var presetOptions = presets.map(function(p) {
    var selected = p.cron === config.cron ? ' selected' : '';
    return '<option value="' + p.cron + '"' + selected + '>' + p.label + '</option>';
  }).join('');

  var isCustom = !presets.some(function(p) { return p.cron === config.cron && p.cron !== ''; });

  section.innerHTML =
    '<h3>Schedule Settings</h3>' +
    '<div class="schedule-form">' +
      '<label class="schedule-toggle">' +
        '<input type="checkbox" id="schedule-enabled" ' + (config.enabled ? 'checked' : '') + ' onchange="KL.toggleSchedule(this.checked)">' +
        '<span>Enable automatic checks</span>' +
      '</label>' +
      '<div class="schedule-options" id="schedule-options" style="' + (config.enabled ? '' : 'display:none') + '">' +
        '<div class="form-group">' +
          '<label>Schedule preset</label>' +
          '<select id="schedule-preset" onchange="KL.onSchedulePresetChange(this.value)">' + presetOptions + '</select>' +
        '</div>' +
        '<div class="form-group" id="schedule-custom-group" style="' + (isCustom ? '' : 'display:none') + '">' +
          '<label>Cron expression</label>' +
          '<input type="text" id="schedule-cron" value="' + KL.escHtml(config.cron) + '" placeholder="0 6 * * *">' +
          '<small>Format: minute hour day month weekday</small>' +
        '</div>' +
        '<button class="btn btn-sm btn-run" onclick="KL.applySchedule()">Save Schedule</button>' +
        '<span id="schedule-status" style="margin-left:8px;font-size:0.85rem"></span>' +
      '</div>' +
      (KL.isLocal ? '' : '<p class="schedule-note"><small>Cloud mode: schedule is managed via GitHub Actions cron. Changing it here only affects local server runs.</small></p>') +
    '</div>';
};

KL.toggleSchedule = function(enabled) {
  document.getElementById('schedule-options').style.display = enabled ? '' : 'none';
  if (!enabled) {
    var config = KL.getScheduleConfig();
    config.enabled = false;
    KL.saveScheduleConfig(config);
    KL.applyScheduleToServer(config);
  }
};

KL.onSchedulePresetChange = function(value) {
  var customGroup = document.getElementById('schedule-custom-group');
  if (value === '') {
    customGroup.style.display = '';
  } else {
    customGroup.style.display = 'none';
    document.getElementById('schedule-cron').value = value;
  }
};

KL.applySchedule = function() {
  var cron = document.getElementById('schedule-cron').value.trim();
  var enabled = document.getElementById('schedule-enabled').checked;
  if (!cron) { alert('Please enter a valid cron expression.'); return; }

  var config = { enabled: enabled, cron: cron, description: KL.describeCron(cron) };
  KL.saveScheduleConfig(config);
  KL.applyScheduleToServer(config);

  var status = document.getElementById('schedule-status');
  if (status) {
    status.textContent = 'Saved!';
    setTimeout(function() { status.textContent = ''; }, 2000);
  }
};

KL.applyScheduleToServer = async function(config) {
  if (!KL.isLocal) return;
  try {
    await fetch('/api/config/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  } catch { /* server may not support this yet */ }
};

KL.describeCron = function(expr) {
  var parts = expr.split(/\s+/);
  if (parts.length < 5) return expr;
  var min = parts[0], hour = parts[1], dom = parts[2], mon = parts[3], dow = parts[4];
  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour.includes('/')) return 'Every ' + hour.split('/')[1] + ' hours';
    if (hour.includes(',')) return 'Daily at ' + hour.split(',').join(' & ') + ':' + min.padStart(2, '0');
    return 'Daily at ' + hour + ':' + min.padStart(2, '0');
  }
  if (dow === '1-5') return 'Weekdays at ' + hour + ':' + min.padStart(2, '0');
  return expr;
};
