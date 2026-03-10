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

KL.PAGE = {
  STORY: 'STORY',
  MUSIC: 'MUSIC',
};
