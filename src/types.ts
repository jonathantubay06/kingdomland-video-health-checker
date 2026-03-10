// Shared type definitions for Kingdomland Video Checker

export interface VideoResult {
  number: number;
  title: string;
  section: string;
  page: string;
  url: string;
  hlsSrc: string;
  status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'UNKNOWN';
  error: string;
  loadTimeMs: number;
  duration: string;
  resolution: string;
}

export interface CheckSummary {
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
}

export interface PerformanceAlert {
  title: string;
  section: string;
  loadTimeMs: number;
  level: 'WARNING' | 'CRITICAL';
}

export interface CheckReport {
  timestamp: string;
  browser?: string;
  summary: CheckSummary;
  failedVideos: Array<{
    num: number;
    page: string;
    section: string;
    title: string;
    url: string;
    error: string;
  }>;
  performanceAlerts: PerformanceAlert[];
  allResults: VideoResult[];
}

export interface HistoryEntry {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
  avgLoadTimeMs?: number;
  videos: Array<{
    title: string;
    section: string;
    page: string;
    status: string;
    loadTimeMs: number;
    error: string;
  }>;
}

export interface RunRecord {
  id: number;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  timeouts: number;
}

export interface VideoHistoryRecord {
  timestamp: string;
  status: string;
  loadTimeMs: number;
  error: string;
}

export interface PerformanceTrendRecord {
  timestamp: string;
  loadTimeMs: number;
}

export interface DegradingVideo {
  title: string;
  recentAvg: number;
  allAvg: number;
  degradation: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  cron: string;
  mode: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  preferences?: {
    failures: boolean;
    dailySummary: boolean;
  };
}

export interface AuthResult {
  valid: boolean;
  statusCode?: number;
  error?: string;
}

export interface NetlifyEvent {
  httpMethod: string;
  headers: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

export interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}
