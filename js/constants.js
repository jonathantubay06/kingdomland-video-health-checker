// Shared constants for Kingdomland Video Checker (browser)
// Must be loaded before app.js in index.html
window.KL = window.KL || {};

KL.STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
};

KL.RUN_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETE: 'complete',
};

// New UI: single Home page. STORY/MUSIC kept as legacy aliases
// so historical reports still render in the dashboard.
KL.PAGE = {
  HOME: 'HOME',
  STORY: 'STORY',
  MUSIC: 'MUSIC',
};
