/**
 * Kingdomland Video Checker — Spreadsheet Cross-check Module
 *
 * Fetches a Google Spreadsheet (CSV export), compares video titles
 * with website check results, and returns a diff report showing
 * which statuses need to change.
 *
 * Rules:
 *   1. Video in spreadsheet (status "In PRODUCTION") but NOT on website
 *      → revert to "Ready to Live"
 *   2. Video on website AND in spreadsheet but status ≠ "In PRODUCTION"
 *      → change to "In PRODUCTION"
 *   3. Everything else → leave as-is
 */

const https = require('https');
const http = require('http');

// ============== CSV Fetching ==============

/**
 * Fetch a Google Spreadsheet as CSV.
 * Works for publicly shared or "anyone with the link" sheets.
 */
function fetchSpreadsheetCSV(spreadsheetId, gid = '0') {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

  return new Promise((resolve, reject) => {
    const follow = (urlStr, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));

      const urlObj = new URL(urlStr);
      const client = urlObj.protocol === 'https:' ? https : http;

      client.get(urlStr, {
        headers: { 'User-Agent': 'KingdomlandVideoChecker/1.0' },
      }, (res) => {
        // Follow redirects (Google often redirects CSV exports)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch spreadsheet: HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };

    follow(url);
  });
}

// ============== CSV Parsing ==============

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        result.push(current);
        current = '';
      } else if (c === '\r') {
        // skip carriage return
      } else {
        current += c;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Split CSV text into rows, properly handling multi-line quoted fields.
 */
function splitCSVRows(csvStr) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvStr.length; i++) {
    const c = csvStr[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < csvStr.length && csvStr[i + 1] === '"') {
          current += '""'; // preserve BOTH quotes so parseCSVLine can handle them
          i++; // skip escaped quote
        } else {
          inQuotes = false;
          current += c;
        }
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        current += c;
      } else if (c === '\n') {
        rows.push(current);
        current = '';
      } else if (c === '\r') {
        // skip carriage return
      } else {
        current += c;
      }
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

/**
 * Parse a CSV string into an array of objects using the first row as headers.
 * Handles multi-line quoted fields correctly.
 */
function parseCSV(csvStr) {
  const lines = splitCSVRows(csvStr);
  if (lines.length < 2) return [];

  const rawHeaders = parseCSVLine(lines[0]);
  // Normalize headers: collapse multi-line text, trim whitespace
  const headers = rawHeaders.map(h => h.replace(/[\r\n]+/g, ' ').trim());

  // Find the "Name Episode" column (may have extra text after it)
  const nameColIdx = headers.findIndex(h =>
    h.toLowerCase().startsWith('name episode') || h.toLowerCase().includes('name episode')
  );
  const statusColIdx = headers.findIndex(h => h.toLowerCase() === 'status');
  const categoryColIdx = headers.findIndex(h => h.toLowerCase() === 'categories' || h.toLowerCase() === 'category');

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });

    // Get values by column index (more reliable than header text match)
    const nameValue = nameColIdx >= 0 ? (values[nameColIdx] || '').trim() : '';
    if (nameValue) {
      row._nameEpisode = nameValue;
      row._status = statusColIdx >= 0 ? (values[statusColIdx] || '').trim() : '';
      row._category = categoryColIdx >= 0 ? (values[categoryColIdx] || '').trim() : '';
      row._rowIndex = i + 1; // 1-indexed (row 1 = header in spreadsheet)
      rows.push(row);
    }
  }

  return rows;
}

// ============== Title Matching ==============

/**
 * Normalize a title for comparison.
 * Lowercases, trims, normalizes quotes and whitespace.
 */
function normalizeTitle(title) {
  return (title || '')
    .trim()
    .toLowerCase()
    .replace(/[''`\u2018\u2019]/g, "'")  // normalize smart quotes
    .replace(/[""\u201C\u201D]/g, '"')
    .replace(/[^\w\s'-]/g, '')           // remove special chars except apostrophe/hyphen
    .replace(/\s+/g, ' ')               // collapse whitespace (after special char removal)
    .trim();
}

/**
 * Extract video title(s) from the spreadsheet "Name Episode" column.
 * Returns an object with multiple keys for multi-strategy matching:
 *
 *   shortKey  – first segment + episode/part identifier (if any)
 *               "Jonah and the Whale | S2 EP11 | Marvelous Light | KingdomLand" → "Jonah and the Whale S2 EP11"
 *               "Kembe Sight Words | Part 1 | ABCs | KingdomLand"               → "Kembe Sight Words Part 1"
 *               "Easter | Bible Stories | KingdomLand"                          → "Easter"
 *
 *   fullKey   – all segments except trailing "KingdomLand"
 *               "Great | Sing-a-long | KingdomLand" → "Great Sing-a-long"
 *               "H3 Believe | Sing-a-long | KingdomLand" → "H3 Believe Sing-a-long"
 *
 *   baseKey   – just the first segment (shortest form)
 *               "H3 Believe | Sing-a-long | KingdomLand" → "H3 Believe"
 */
function extractTitle(nameEpisode) {
  if (!nameEpisode) return { shortKey: '', fullKey: '', baseKey: '' };
  const parts = nameEpisode.split('|').map(p => p.trim());

  // Remove trailing "KingdomLand" brand tag
  const cleaned = [...parts];
  if (cleaned.length > 1 && cleaned[cleaned.length - 1].toLowerCase() === 'kingdomland') {
    cleaned.pop();
  }

  const baseKey = parts[0] || '';

  // Build short key: first segment + episode/part identifier (if second segment matches pattern)
  let shortKey = parts[0] || '';
  if (parts.length >= 2 && /^(s\d|ep\d|season\s|episode\s|part\s|pt\s|vol\s|chapter\s)/i.test(parts[1].trim())) {
    shortKey = parts[0] + ' ' + parts[1].trim();
  }

  // Full key: all remaining segments joined
  const fullKey = cleaned.join(' ');

  return { shortKey, fullKey, baseKey };
}

// ============== Cross-check Logic ==============

/**
 * Run the cross-check comparison between website results and spreadsheet data.
 *
 * @param {Array} websiteResults - Array of { title, section, status, ... } from the video checker
 * @param {string} spreadsheetId - Google Spreadsheet ID
 * @returns {Object} Cross-check report
 */
async function crosscheck(websiteResults, spreadsheetId) {
  // 1. Fetch and parse spreadsheet
  const csv = await fetchSpreadsheetCSV(spreadsheetId);
  const spreadsheetRows = parseCSV(csv);

  // 2. Build website lookup: normalizedTitle → entry
  //    (use first occurrence if duplicates exist)
  const websiteMap = new Map();
  const websiteEntries = []; // keep array for fuzzy matching
  for (const r of websiteResults) {
    const key = normalizeTitle(r.title);
    if (key && !websiteMap.has(key)) {
      const entry = { title: r.title, normalizedTitle: key, section: r.section, status: r.status };
      websiteMap.set(key, entry);
      websiteEntries.push(entry);
    }
  }

  // 3. Build spreadsheet lookup using dual keys
  //    Each entry stores shortKey, fullKey, baseKey for multi-strategy matching
  const spreadsheetEntries = [];
  for (const row of spreadsheetRows) {
    const nameEpisode = row._nameEpisode || '';
    const { shortKey, fullKey, baseKey } = extractTitle(nameEpisode);
    const nShort = normalizeTitle(shortKey);
    const nFull = normalizeTitle(fullKey);
    const nBase = normalizeTitle(baseKey);
    if (nShort || nFull) {
      spreadsheetEntries.push({
        episodeName: nameEpisode,
        extractedTitle: shortKey, // display title
        category: row._category || '',
        status: row._status || '',
        rowIndex: row._rowIndex,
        nShort,  // e.g. "kembe sight words part 1"
        nFull,   // e.g. "kembe sight words part 1 abcs"
        nBase,   // e.g. "kembe sight words"
      });
    }
  }

  // Helper: compute word overlap score between two strings
  // Returns fraction of words in shorter string that appear in longer string
  function wordOverlap(a, b) {
    const wordsA = a.split(/\s+/).filter(w => w.length > 1);
    const wordsB = b.split(/\s+/).filter(w => w.length > 1);
    if (wordsA.length === 0 || wordsB.length === 0) return 0;
    const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
    const longer = wordsA.length <= wordsB.length ? wordsB : wordsA;
    let matches = 0;
    for (const w of shorter) {
      // Allow singular/plural: words must be at least 70% similar in length
      // This prevents "be" from matching "believe" while allowing "miracle" ↔ "miracles"
      if (longer.some(lw => {
        if (lw === w) return true;
        const minLen = Math.min(w.length, lw.length);
        const maxLen = Math.max(w.length, lw.length);
        if (minLen / maxLen < 0.7) return false; // too different in length
        return lw.startsWith(w) || w.startsWith(lw);
      })) {
        matches++;
      }
    }
    return matches / shorter.length;
  }

  // ── Two-pass matching ──────────────────────────────────────────────────
  // Pass 1: Exact matches only — ensures perfect matches are never stolen
  // Pass 2: Fuzzy matches (substring + word-overlap) for remaining entries
  //
  // This prevents "He Loves Me" from stealing "Love" via substring,
  // because "Love" exact-matches "Love" in pass 1 first.

  const usedWebKeys = new Set();     // website keys already claimed
  const ssMatchResults = new Map();  // ssEntry index → webEntry

  // --- PASS 1: Exact match on any key variant ---
  for (let i = 0; i < spreadsheetEntries.length; i++) {
    const ssEntry = spreadsheetEntries[i];
    const keysToTry = [...new Set([ssEntry.nShort, ssEntry.nFull, ssEntry.nBase].filter(Boolean))];

    for (const key of keysToTry) {
      if (websiteMap.has(key) && !usedWebKeys.has(key)) {
        ssMatchResults.set(i, websiteMap.get(key));
        usedWebKeys.add(key);
        break;
      }
    }
  }

  // --- PASS 2: Fuzzy match for remaining unmatched entries ---
  // Sort unmatched indices by longest key first (more specific → match first)
  const unmatchedIndices = [];
  for (let i = 0; i < spreadsheetEntries.length; i++) {
    if (!ssMatchResults.has(i)) unmatchedIndices.push(i);
  }
  unmatchedIndices.sort((a, b) => spreadsheetEntries[b].nShort.length - spreadsheetEntries[a].nShort.length);

  for (const i of unmatchedIndices) {
    const ssEntry = spreadsheetEntries[i];
    const keysToTry = [...new Set([ssEntry.nShort, ssEntry.nFull, ssEntry.nBase].filter(Boolean))];

    let bestMatch = null;
    let bestScore = 0;

    // Strategy 2: Prefix/substring match
    for (const key of keysToTry) {
      if (key.length < 3) continue;
      for (const entry of websiteEntries) {
        if (usedWebKeys.has(entry.normalizedTitle)) continue;
        const wk = entry.normalizedTitle;
        const shorter = Math.min(key.length, wk.length);
        const longer = Math.max(key.length, wk.length);
        if (wk.startsWith(key) || key.startsWith(wk) || wk.includes(key) || key.includes(wk)) {
          const score = shorter / longer;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = entry;
          }
        }
      }
    }

    if (bestMatch && bestScore > 0.25) {
      ssMatchResults.set(i, bestMatch);
      usedWebKeys.add(bestMatch.normalizedTitle);
      continue;
    }

    // Strategy 3: Word-overlap match
    // Handles: "h3 believe" ↔ "believe", "jesus miracle" ↔ "jesus miracles",
    //          "auntie bois gift" ↔ "auntie bois gift motion book"
    bestMatch = null;
    bestScore = 0;

    for (const key of keysToTry) {
      const keyWords = key.split(/\s+/).filter(w => w.length > 1);
      if (keyWords.length === 0) continue;

      for (const entry of websiteEntries) {
        if (usedWebKeys.has(entry.normalizedTitle)) continue;
        const wk = entry.normalizedTitle;
        const overlap = wordOverlap(key, wk);
        if (overlap >= 0.6 && overlap > bestScore) {
          bestScore = overlap;
          bestMatch = entry;
        }
      }
    }

    if (bestMatch) {
      ssMatchResults.set(i, bestMatch);
      usedWebKeys.add(bestMatch.normalizedTitle);
    }
  }

  // 4. Compare and build change list
  const changes = [];
  const matched = [];
  const unmatchedWebsite = [];  // on website but not in spreadsheet
  const unmatchedSpreadsheet = []; // in spreadsheet but not on website

  // Build results from match map
  for (let i = 0; i < spreadsheetEntries.length; i++) {
    const ssRow = spreadsheetEntries[i];
    const currentStatus = ssRow.status;
    const webEntry = ssMatchResults.get(i) || null;

    if (webEntry) {
      // Matched — video exists in both places
      matched.push({
        title: ssRow.extractedTitle,
        episodeName: ssRow.episodeName,
        category: ssRow.category,
        section: webEntry.section,
        websiteStatus: webEntry.status,
        spreadsheetStatus: currentStatus,
        rowIndex: ssRow.rowIndex,
      });

      // Rule 2: On website + in spreadsheet but status ≠ "In PRODUCTION" → set to "In PRODUCTION"
      if (currentStatus.toLowerCase() !== 'in production') {
        changes.push({
          action: 'set_in_production',
          title: ssRow.extractedTitle,
          episodeName: ssRow.episodeName,
          category: ssRow.category,
          currentStatus,
          newStatus: 'In PRODUCTION',
          rowIndex: ssRow.rowIndex,
          reason: 'Video is live on website but spreadsheet status is not "In PRODUCTION"',
        });
      }
    } else {
      // Not on website
      unmatchedSpreadsheet.push({
        title: ssRow.extractedTitle,
        episodeName: ssRow.episodeName,
        category: ssRow.category,
        status: currentStatus,
        rowIndex: ssRow.rowIndex,
      });

      // Rule 1: In spreadsheet (status "In PRODUCTION") but NOT on website → revert to "Ready to Live"
      if (currentStatus.toLowerCase() === 'in production') {
        changes.push({
          action: 'revert_to_ready',
          title: ssRow.extractedTitle,
          episodeName: ssRow.episodeName,
          category: ssRow.category,
          currentStatus,
          newStatus: 'Ready to Live',
          rowIndex: ssRow.rowIndex,
          reason: 'Video not found on website but spreadsheet status is "In PRODUCTION"',
        });
      }
    }
  }

  // Find website videos not in spreadsheet at all
  for (const [key, webEntry] of websiteMap) {
    if (!usedWebKeys.has(key)) {
      unmatchedWebsite.push({
        title: webEntry.title,
        section: webEntry.section,
        status: webEntry.status,
      });
    }
  }

  // Sort changes: reverts first, then set-to-production
  changes.sort((a, b) => {
    if (a.action !== b.action) return a.action === 'revert_to_ready' ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  return {
    summary: {
      totalSpreadsheet: spreadsheetEntries.length,
      totalWebsite: websiteMap.size,
      matched: matched.length,
      unmatchedWebsite: unmatchedWebsite.length,
      unmatchedSpreadsheet: unmatchedSpreadsheet.length,
      changesNeeded: changes.length,
      toProduction: changes.filter(c => c.action === 'set_in_production').length,
      toReady: changes.filter(c => c.action === 'revert_to_ready').length,
    },
    changes,
    matched,
    unmatchedWebsite,
    unmatchedSpreadsheet,
  };
}

/**
 * Apply changes to the Google Spreadsheet via a Google Apps Script web app.
 *
 * @param {string} webappUrl - The deployed Google Apps Script web app URL
 * @param {Array} changes - Array of { rowIndex, newStatus } objects
 * @returns {Object} Result from the Apps Script
 */
function applyChanges(webappUrl, changes) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ changes });
    const urlObj = new URL(webappUrl);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const client = urlObj.protocol === 'https:' ? https : http;

    const followRedirectPost = (opts, body, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));

      const req = client.request(opts, (res) => {
        // Google Apps Script returns 302 redirect after POST
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location);
          // Follow redirect as GET (standard for 302)
          const getClient = redirectUrl.protocol === 'https:' ? https : http;
          getClient.get(res.headers.location, (getRes) => {
            let data = '';
            getRes.on('data', chunk => data += chunk);
            getRes.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve({ success: true, raw: data });
              }
            });
          }).on('error', reject);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ success: true, raw: data });
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    };

    followRedirectPost(options, payload);
  });
}

module.exports = { crosscheck, applyChanges, fetchSpreadsheetCSV, parseCSV };
