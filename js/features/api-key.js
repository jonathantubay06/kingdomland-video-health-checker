// API key settings — stores the Netlify X-API-Key in localStorage so KL.apiFetch
// can attach it. Cloud mode only; the local server.js dashboard has no API auth.
window.KL = window.KL || {};

KL.initApiKeyUI = function() {
  var section = document.getElementById('api-key-section');
  if (!section) return;
  section.style.display = 'block';

  var lockSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

  function render() {
    var key = localStorage.getItem('kl-api-key') || '';
    var status = key
      ? '<span class="api-key-status api-key-set">Key saved (' + key.slice(0, 4) + '&hellip;' + key.slice(-4) + ')</span>'
      : '<span class="api-key-status api-key-unset">No key saved</span>';

    section.innerHTML =
      '<h3>API Key</h3>' +
      '<div class="schedule-info-row">' + lockSvg + status + '</div>' +
      '<div class="api-key-row">' +
        '<input type="password" id="api-key-input" class="api-key-input" ' +
          'placeholder="Paste your API key" autocomplete="off" spellcheck="false">' +
        '<button class="btn-outline" id="api-key-save">Save</button>' +
        (key ? '<button class="btn-outline" id="api-key-clear">Clear</button>' : '') +
      '</div>' +
      '<p class="schedule-note"><small>Required only when this dashboard is hosted on Netlify and ' +
        '<code>API_KEY</code> is set there. Stored in this browser only &mdash; re-enter it on each device.</small></p>';

    document.getElementById('api-key-save').onclick = function() {
      var val = (document.getElementById('api-key-input').value || '').trim();
      if (!val) return;
      localStorage.setItem('kl-api-key', val);
      render();
    };

    var clearBtn = document.getElementById('api-key-clear');
    if (clearBtn) {
      clearBtn.onclick = function() {
        localStorage.removeItem('kl-api-key');
        render();
      };
    }
  }

  render();
};
