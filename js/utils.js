// Utility / helper functions
window.KL = window.KL || {};

KL.escHtml = function(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Convenience alias for global scope (used in inline onclick handlers)
window.escHtml = KL.escHtml;

// Authenticated fetch: adds X-API-Key header if configured in localStorage
KL.apiFetch = function(url, options) {
  options = options || {};
  var apiKey = localStorage.getItem('kl-api-key') || '';
  if (apiKey) {
    options.headers = options.headers || {};
    if (typeof options.headers === 'object' && !(options.headers instanceof Headers)) {
      options.headers['X-API-Key'] = apiKey;
    }
  }
  return fetch(url, options);
};

KL.timeAgo = function(dateStr) {
  if (!dateStr) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
};
