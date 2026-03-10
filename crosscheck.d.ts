export interface CrosscheckChange {
  title: string;
  currentStatus: string;
  newStatus: string;
  reason: string;
}

export interface CrosscheckResult {
  changes: CrosscheckChange[];
  onWebsite: string[];
  inSpreadsheet: string[];
  matchCount: number;
}

export function crosscheck(
  websiteResults: Array<{ title: string; section?: string; status?: string }>,
  spreadsheetId: string
): Promise<CrosscheckResult>;

export function applyChanges(
  webappUrl: string,
  changes: CrosscheckChange[]
): Promise<{ success: boolean; message?: string }>;

export function fetchSpreadsheetCSV(
  spreadsheetId: string,
  gid?: string
): Promise<string>;

export function parseCSV(
  csv: string
): Array<Record<string, string>>;
