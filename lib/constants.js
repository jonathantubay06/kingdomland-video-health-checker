// Shared constants for Kingdomland Video Checker
// Used by: check-videos.js, server.js, daily-summary.js, etc.

const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
};

const RUN_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETE: 'complete',
};

const PAGE = {
  STORY: 'STORY',
  MUSIC: 'MUSIC',
};

module.exports = { STATUS, RUN_STATUS, PAGE };
