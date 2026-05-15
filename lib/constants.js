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

// PAGE values: now driven by the new UI (Home is the single aggregator).
// STORY/MUSIC kept as legacy aliases so historical reports still render.
const PAGE = {
  HOME: 'HOME',
  STORY: 'STORY',   // legacy
  MUSIC: 'MUSIC',   // legacy
};

module.exports = { STATUS, RUN_STATUS, PAGE };
