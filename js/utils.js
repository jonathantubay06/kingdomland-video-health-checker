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

// ============== Toast Notifications ==============
// Lightweight, non-blocking feedback messages that stack in the bottom-right corner.
// Types: 'success' | 'error' | 'info'   Duration in ms (default 2800)
window.showToast = function(message, type, duration) {
  type = type || 'info';
  duration = duration || 2800;
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ') + '</span><span>' + KL.escHtml(message) + '</span>';
  container.appendChild(toast);
  setTimeout(function() {
    toast.classList.add('removing');
    toast.addEventListener('animationend', function() { toast.remove(); }, { once: true });
  }, duration);
};

// ============== Counter Animation ==============
// Counts a numeric element from 0 → target over ~600ms with ease-out feel.
KL.animateCounter = function(el, target) {
  if (!el || isNaN(target)) { if (el) el.textContent = target; return; }
  if (target === 0) { el.textContent = 0; return; }
  const duration = 1200;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    // Ease-out cubic: decelerates into the final value
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target;
  }
  requestAnimationFrame(step);
  // After counting, do a quick scale-pop so the number feels like it "landed"
  setTimeout(function() {
    el.classList.add('counter-pop');
    el.addEventListener('animationend', function() { el.classList.remove('counter-pop'); }, { once: true });
  }, duration + 20);
};

// ============== Confetti Burst ==============
// Fires ~55 tiny DOM pieces from the health banner on a perfect run (0 failures).
// All pieces are removed from the DOM after their CSS animation ends — no memory leak.
KL.triggerConfetti = function() {
  var banner = document.getElementById('health-summary');
  if (!banner) return;
  var rect = banner.getBoundingClientRect();
  var colors = ['#4c6bcd','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
  for (var i = 0; i < 55; i++) {
    var p = document.createElement('div');
    p.className = 'confetti-piece';
    var rotStart = Math.random() * 360;
    p.style.cssText =
      'left:'  + (rect.left + Math.random() * rect.width)  + 'px;' +
      'top:'   + (rect.top  + rect.height / 2)             + 'px;' +
      'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
      'width:' + (4 + Math.random() * 5) + 'px;' +
      'height:'+ (5 + Math.random() * 8) + 'px;' +
      '--rot-start:' + rotStart + 'deg;' +
      '--rot-end:'   + (rotStart + 360 + Math.random() * 360) + 'deg;' +
      'animation-delay:'    + (Math.random() * 0.4) + 's;' +
      'animation-duration:' + (0.9 + Math.random() * 0.8) + 's';
    document.body.appendChild(p);
    p.addEventListener('animationend', function() { this.remove(); }, { once: true });
  }
};

// ============== Viewport Entrance Observer ==============
// Calls callback(el) the first time el scrolls into the visible viewport.
// Used to gate animations so they play when the user actually sees the section,
// not immediately when the DOM is updated. Falls back to instant-call on old browsers.
KL.onEnterViewport = function(el, callback, threshold) {
  if (!el) return;
  if (!window.IntersectionObserver) { callback(el); return; }
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        callback(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: threshold || 0.08 });
  observer.observe(el);
};

// ============== Debounce ==============
// Returns a debounced version of fn that waits `delay` ms after the last call.
KL.debounce = function(fn, delay) {
  var timer;
  return function() {
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(null, args); }, delay);
  };
};
