// Shared application state (browser)
// Must be loaded after constants.js
window.KL = window.KL || {};

KL.state = {
  status: 'idle',
  mode: 'both',
  phase: '',
  totalDiscovered: 0,
  checkedCount: 0,
  passedCount: 0,
  failedCount: 0,
  timeoutCount: 0,
  results: [],
  checkStartTime: null,
  sectionMap: {},
};

// Module-level variables shared across modules
KL.eventSource = null;
KL.sortColumn = 'number';
KL.sortDir = 'asc';
KL.isLocal = false;
KL.savedCredentials = null;
KL.currentPage = 1;
KL.pageSize = 25;
KL.lastFilteredResults = [];
KL.ghRunId = null;
KL.pollTimer = null;
KL.progressTimer = null;
KL.comparisonHistory = [];
