// Favorites / Watch List
window.KL = window.KL || {};

KL.WATCHLIST_KEY = 'kl-watchlist';

KL.getWatchlist = function() {
  try {
    return JSON.parse(localStorage.getItem(KL.WATCHLIST_KEY) || '[]');
  } catch (e) { return []; }
};

KL.saveWatchlist = function(list) {
  localStorage.setItem(KL.WATCHLIST_KEY, JSON.stringify(list));
};

window.toggleWatchlist = function(title) {
  var list = KL.getWatchlist();
  if (list.includes(title)) {
    list = list.filter(function(t) { return t !== title; });
  } else {
    list.push(title);
  }
  KL.saveWatchlist(list);
  KL.renderWatchlist();
  document.querySelectorAll('.star-btn').forEach(function(btn) {
    btn.classList.toggle('starred', list.includes(btn.dataset.title));
    btn.textContent = list.includes(btn.dataset.title) ? '\u2605' : '\u2606';
  });
};

KL.renderWatchlist = function() {
  var section = document.getElementById('watchlist-section');
  if (!section) return;
  var list = KL.getWatchlist();

  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }

  var items = list.map(function(title) {
    var result = KL.state.results.find(function(r) { return r.title === title; });
    var status = result ? result.status : 'unknown';
    return '<div class="watchlist-item">' +
      '<span class="wl-status status-' + status + '"></span>' +
      '<span class="wl-title" onclick="showVideoDetail(\'' + KL.escHtml(title).replace(/'/g, "\\'") + '\')" style="cursor:pointer">' + KL.escHtml(title) + '</span>' +
      '<button class="wl-remove" onclick="event.stopPropagation();toggleWatchlist(\'' + KL.escHtml(title).replace(/'/g, "\\'") + '\')" title="Remove from watchlist">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '</button></div>';
  }).join('');

  section.innerHTML =
    '<div class="watchlist-header"><h3>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Watchlist</h3></div>' +
    '<div class="watchlist-items">' + items + '</div>';
  section.style.display = 'block';
};
