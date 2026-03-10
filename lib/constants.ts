// Shared constants for Kingdomland Video Checker
// Used by: check-videos.js, server.js, daily-summary.js, etc.

export const STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;

export const RUN_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETE: 'complete',
} as const;

export const PAGE = {
  STORY: 'STORY',
  MUSIC: 'MUSIC',
} as const;

export type StatusType = typeof STATUS[keyof typeof STATUS];
export type RunStatusType = typeof RUN_STATUS[keyof typeof RUN_STATUS];
export type PageType = typeof PAGE[keyof typeof PAGE];
