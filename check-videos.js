/**
 * Video Load Checker for go.kingdomlandkids.com (new UI, 2026+)
 *
 * Strategy:
 *   1. Login (new email/password form — no more #login_email IDs)
 *   2. Pick the first kid profile (KidProfileSelection_card__*)
 *   3. On Home, scroll patiently — all 185+ videos lazy-load
 *   4. For each card, extract its UUID from the React fiber + thumbnail
 *   5. Visit /watch/{uuid}, grab the real category from the watch-page metadata,
 *      verify the <video> plays
 *
 * USAGE:
 *   node check-videos.js                        # headless Chromium (default)
 *   node check-videos.js --debug                # visible browser
 *   node check-videos.js --browser=firefox      # use Firefox
 *   node check-videos.js --browser=webkit       # use WebKit
 */

try { require('dotenv').config(); } catch (_) {}
const playwright = require('playwright');
const fs = require('fs');
const { STATUS, PAGE } = require('./lib/constants');
const { sendSlackFailureAlert } = require('./lib/slack');
const db = require('./lib/db');

// ============== CONFIG ==============
const CONFIG = {
  baseUrl: 'https://go.kingdomlandkids.com',
  loginUrl: 'https://go.kingdomlandkids.com/login',
  homeUrl: 'https://go.kingdomlandkids.com/',

  // Credentials (env vars required — no hardcoded fallbacks for security)
  username: process.env.KL_USERNAME || '',
  password: process.env.KL_PASSWORD || '',

  // New-UI selectors (no more #login_email — the form fields have no IDs)
  emailSelector: 'input[type="email"]',
  passwordSelector: 'input[type="password"]',
  // NOTE: there's also a "Log in with Google" button — must use type=submit specifically
  loginButtonSelector: 'button[type="submit"]',
  // Profile card on /child-profile-selection — CSS module class
  profileCardSelector: 'button[class*="KidProfileSelection_card"]',

  // Timeouts
  videoLoadTimeout: 20000,
  navigationTimeout: 30000,

  // Retry: re-check failed/timed out videos once
  retryFailures: true,
  maxRetries: 1,

  // Screenshots on failure
  screenshotOnFailure: true,
  screenshotDir: 'screenshots',

  // Performance thresholds (ms) — Playwright is ~3× slower than a real browser for HLS
  performanceThresholds: {
    warning: parseInt(process.env.PERF_WARN_MS, 10) || 15000,
    critical: parseInt(process.env.PERF_CRIT_MS, 10) || 25000,
  },
};
// ====================================

const DEBUG = process.argv.includes('--debug');
const JSON_STREAM = process.argv.includes('--json-stream');

// Browser engine selection
const BROWSER_ARG = (process.argv.find(a => a.startsWith('--browser=')) || '').split('=')[1];
const BROWSER_NAME = (BROWSER_ARG || process.env.BROWSER || 'chromium').toLowerCase();
const SUPPORTED_BROWSERS = { chromium: playwright.chromium, firefox: playwright.firefox, webkit: playwright.webkit };
const browserEngine = SUPPORTED_BROWSERS[BROWSER_NAME];
if (!browserEngine) {
  console.error(`Unknown browser: "${BROWSER_NAME}". Supported: chromium, firefox, webkit`);
  process.exit(1);
}

// Titles filter (for "Check Failed Only")
let TITLES_FILTER = null;
if (process.env.CHECK_TITLES) {
  try { TITLES_FILTER = new Set(JSON.parse(process.env.CHECK_TITLES)); } catch { TITLES_FILTER = null; }
}

if (CONFIG.screenshotOnFailure) {
  const screenshotPath = require('path').join(__dirname, CONFIG.screenshotDir);
  if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath, { recursive: true });
}

function emit(obj) { if (JSON_STREAM) process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) {
  if (JSON_STREAM) emit({ type: 'status', message: msg });
  else console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ============================================================
// LOGIN + PROFILE SELECTION
// ============================================================

async function login(page) {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error('Missing credentials. Set KL_USERNAME and KL_PASSWORD environment variables.');
  }

  log(`Logging in to go.kingdomlandkids.com...`);
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });

  await page.locator(CONFIG.emailSelector).first().fill(CONFIG.username);
  await page.waitForTimeout(300);
  await page.locator(CONFIG.passwordSelector).first().fill(CONFIG.password);
  await page.waitForTimeout(300);

  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }),
      page.locator(CONFIG.loginButtonSelector).first().click()
    ]);
  } catch (err) {
    throw new Error(`Login failed — navigation error: ${err.message}`);
  }

  // After login the SPA may still be redirecting (e.g. → /child-profile-selection)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  log('Logged in successfully!');

  await handleProfileSelection(page);
  log('');
}

async function handleProfileSelection(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Retry-aware check for whether we're on profile page (handles SPA navigation race)
  let onProfile = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      onProfile = await page.evaluate(() => location.pathname.includes('profile'));
      break;
    } catch (e) {
      if (e.message.includes('Execution context was destroyed') && attempt < 3) {
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
      } else throw e;
    }
  }

  if (!onProfile) {
    log('   (Already past profile selection)');
    return;
  }

  log('   Selecting first profile...');
  try {
    await page.locator(CONFIG.profileCardSelector).first().waitFor({ state: 'visible', timeout: 10000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }).catch(() => {}),
      page.locator(CONFIG.profileCardSelector).first().click()
    ]);
    // Wait until we leave the profile page
    try {
      await page.waitForURL(url => !url.toString().includes('profile'), { timeout: 15000 });
    } catch (e) { /* may have already landed */ }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    log('   Profile selected!');
  } catch (e) {
    log(`   Profile selection error: ${e.message}`);
  }
}

// ============================================================
// HOME DISCOVERY — infinite scroll, no carousels, no tabs
// ============================================================

/**
 * Scroll patiently to the bottom — content lazy-loads as scrollHeight grows.
 * Returns when scrollHeight stops growing for 2 consecutive rounds.
 */
async function fullScroll(page, maxRounds = 20) {
  let lastHeight = 0;
  let stableRounds = 0;
  for (let round = 0; round < maxRounds; round++) {
    const h = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (h === lastHeight) {
      stableRounds++;
      if (stableRounds >= 2) break;
    } else stableRounds = 0;
    lastHeight = h;

    for (let y = 0; y < h + 1000; y += 500) {
      await page.evaluate(s => window.scrollTo(0, s), y).catch(() => {});
      await page.waitForTimeout(180);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Harvest all video cards on Home. Each card is a <button> with an inner <img>.
 * Pulls the video UUID from React fiber + thumbnail from img srcset.
 */
async function discoverHomeVideos(page) {
  log('Scrolling Home page to lazy-load all videos...');
  await fullScroll(page);

  const cards = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    // Real card buttons use the KThumb CSS module class
    const cardButtons = document.querySelectorAll('button[class*="KThumb_rootButton"], button[class*="KThumb_root"]');

    cardButtons.forEach(btn => {
      const img = btn.querySelector('img');
      if (!img) return;

      // Title is on img.alt (most reliable) or aria-label on the button
      let title = (img.alt || btn.getAttribute('aria-label') || '').trim();
      if (!title || title.length > 120) return;

      // Decode the Next.js _next/image proxy URL to get the real thumbnail URL.
      // The thumbnail URL path contains the UUID:
      //   /uploads/thumbnails/{UUID}/filename.png
      const rawSrc = img.src || '';
      let thumbnailUrl = rawSrc;
      let videoId = null;

      // Pull the inner url= param if it's a Next.js image proxy
      const proxyMatch = rawSrc.match(/[?&]url=([^&]+)/);
      if (proxyMatch) {
        try { thumbnailUrl = decodeURIComponent(proxyMatch[1]); }
        catch { thumbnailUrl = proxyMatch[1]; }
      }

      // Extract UUID from the thumbnail path
      const uuidMatch = thumbnailUrl.match(/\/thumbnails\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
      if (uuidMatch) videoId = uuidMatch[1];

      // Fallback: search anywhere in the src for a UUID
      if (!videoId) {
        const anyUuid = rawSrc.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        if (anyUuid) videoId = anyUuid[1];
      }

      // Duration: card may have a small overlay span with mm:ss
      let duration = '';
      const durEl = btn.querySelector('span, time, [class*="duration" i]');
      if (durEl) {
        const m = (durEl.textContent || '').match(/(\d{1,2}):(\d{2})/);
        if (m) duration = m[0];
      }

      const key = title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      out.push({ title, videoId, thumbnailUrl, duration });
    });
    return out;
  });

  log(`Found ${cards.length} unique videos on Home.`);
  // Log how many have a UUID extracted
  const withId = cards.filter(c => c.videoId).length;
  log(`   With UUID extracted: ${withId} / ${cards.length}`);
  return cards;
}

// ============================================================
// CHECK A SINGLE VIDEO
// ============================================================

async function checkVideo(page, card, videoNum, totalLabel) {
  const result = {
    number: videoNum,
    title: card.title,
    section: '',
    page: PAGE.HOME,
    url: '',
    hlsSrc: '',
    thumbnailUrl: card.thumbnailUrl || '',
    status: STATUS.UNKNOWN,
    error: null,
    loadTimeMs: null,
    duration: null,
    resolution: '',
    // Integrity flags (informational, never affect PASS/FAIL)
    hasAudio: null,            // true | false | null (unknown)
    audioWarning: null,        // human-readable note if audio is missing/muted
    titleMismatch: null,       // "expected X, got Y" if watch page disagrees with card
    thumbnailMismatch: null,   // UUID mismatch between card thumb and watch-page poster
  };
  const startTime = Date.now();

  try {
    // ---- Navigate to /watch/{uuid} directly (skip clicking the card) ----
    if (!card.videoId) {
      result.status = STATUS.FAIL;
      result.error = 'No video UUID extracted from card';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    const watchUrl = `${CONFIG.baseUrl}/watch/${card.videoId}?from=home`;
    try {
      await page.goto(watchUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (navErr) {
      // Some watch pages keep the network busy — fall back to domcontentloaded
      try {
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e2) {
        result.status = STATUS.FAIL;
        result.error = `Navigation failed: ${e2.message}`;
        result.loadTimeMs = Date.now() - startTime;
        logResult(result, videoNum, totalLabel);
        emit({ type: 'check', result });
        return result;
      }
    }
    result.url = page.url();

    if (!page.url().includes('/watch/')) {
      result.status = STATUS.FAIL;
      result.error = `Did not land on /watch/ (got ${page.url()})`;
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    // ---- Extract real category from watch page metadata ----
    // The watch page shows the title heading then a "<Section> · Kingdomland" line below it.
    try {
      const meta = await page.evaluate(() => {
        // Look for LEAF elements (no element children) whose text matches "<section> · Kingdomland"
        // This avoids matching parent <div>s that contain both the title and the section text.
        const all = Array.from(document.querySelectorAll('p, span'));
        for (const el of all) {
          // Must be a leaf-ish element — text comes only from this node, not nested elements
          if (el.children.length > 0) continue;
          const text = (el.textContent || '').trim();
          // Strict match: section name (2-40 chars, no newlines, no "·") then " · Kingdomland"
          const m = text.match(/^([^·\n]{2,40})\s+·\s+Kingdomland\s*$/);
          if (m) return m[1].trim();
        }
        // Second pass: allow small parent <div> if text is short and matches
        const divs = Array.from(document.querySelectorAll('p, span, div'));
        for (const el of divs) {
          const text = (el.textContent || '').trim();
          if (text.length > 80) continue; // too long, probably contains other stuff
          const m = text.match(/^([^·\n]{2,40})\s+·\s+Kingdomland\s*$/);
          if (m) return m[1].trim();
        }
        // Fallback: breadcrumb's first item (page name)
        const crumbs = document.querySelectorAll('a[href]');
        for (const a of crumbs) {
          const href = a.getAttribute('href') || '';
          const text = (a.textContent || '').trim();
          if (['/bible-stories', '/music', '/learn-fun-zone'].includes(href)) return text;
        }
        return '';
      });
      if (meta) result.section = meta;
    } catch { /* non-critical */ }

    // ---- Poll for the <video> element (in page or iframe) ----
    let videoAppeared = false;
    let videoFrame = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      videoAppeared = await page.evaluate(() => !!document.querySelector('video')).catch(() => false);
      if (videoAppeared) { videoFrame = page; break; }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const hasVid = await frame.evaluate(() => !!document.querySelector('video'));
          if (hasVid) { videoAppeared = true; videoFrame = frame; break; }
        } catch { /* frame inaccessible */ }
      }
      if (videoAppeared) break;
      await page.waitForTimeout(500); // ~25s total
    }

    if (!videoAppeared) {
      // Fallback: try clicking a play overlay
      try {
        const overlay = page.locator('[data-testid="play-overlay"], button[aria-label*="play" i], [class*="playOverlay"]').first();
        if (await overlay.isVisible({ timeout: 2000 })) {
          await overlay.click();
          await page.waitForTimeout(4000);
          videoAppeared = await page.evaluate(() => !!document.querySelector('video')).catch(() => false);
          if (videoAppeared) videoFrame = page;
        }
      } catch {}
    }

    if (!videoAppeared) {
      // Final fallback: reload once
      try {
        await page.goto(watchUrl, { waitUntil: 'networkidle', timeout: 15000 });
        for (let i = 0; i < 20; i++) {
          videoAppeared = await page.evaluate(() => !!document.querySelector('video')).catch(() => false);
          if (videoAppeared) { videoFrame = page; break; }
          await page.waitForTimeout(500);
        }
      } catch {}
    }

    if (!videoAppeared) {
      result.status = STATUS.FAIL;
      result.error = 'No <video> element found after 25s';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    // ---- Verify <video> actually loads ----
    const checkResult = await videoFrame.evaluate(async (timeout) => {
      const vid = document.querySelector('video');
      if (!vid) return { status: 'NO_VIDEO', error: 'No <video> element found' };
      const src = vid.src || '';
      const hlsSrc = src.includes('.m3u8') ? src : '';
      if (vid.readyState >= 3 && !vid.error) {
        return { status: 'LOADED', hlsSrc, duration: vid.duration, videoWidth: vid.videoWidth, videoHeight: vid.videoHeight };
      }
      if (vid.error) {
        const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
        return { status: 'ERROR', hlsSrc, error: `MediaError: ${codes[vid.error.code] || vid.error.code}` };
      }
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          resolve({ status: 'TIMEOUT', hlsSrc, error: `Did not load in ${timeout / 1000}s (readyState=${vid.readyState})` });
        }, timeout);
        const success = () => {
          clearTimeout(timer);
          vid.removeEventListener('error', fail);
          resolve({ status: 'LOADED', hlsSrc, duration: vid.duration, videoWidth: vid.videoWidth, videoHeight: vid.videoHeight });
        };
        const fail = () => {
          clearTimeout(timer);
          vid.removeEventListener('canplay', success);
          vid.removeEventListener('loadeddata', success);
          const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
          resolve({ status: 'ERROR', hlsSrc, error: `MediaError: ${codes[vid.error?.code] || 'Unknown'}` });
        };
        vid.addEventListener('canplay', success, { once: true });
        vid.addEventListener('loadeddata', success, { once: true });
        vid.addEventListener('error', fail, { once: true });
        if (vid.networkState === 0 || vid.readyState === 0) {
          try { vid.load(); } catch {}
        }
      });
    }, CONFIG.videoLoadTimeout);

    result.loadTimeMs = Date.now() - startTime;
    result.hlsSrc = checkResult.hlsSrc || '';

    switch (checkResult.status) {
      case 'LOADED':
        result.status = STATUS.PASS;
        result.duration = checkResult.duration ? Math.round(checkResult.duration) + 's' : '';
        result.resolution = checkResult.videoWidth ? `${checkResult.videoWidth}x${checkResult.videoHeight}` : '';
        break;
      case 'ERROR':
        result.status = STATUS.FAIL;
        result.error = checkResult.error;
        break;
      case 'TIMEOUT':
        result.status = STATUS.TIMEOUT;
        result.error = checkResult.error;
        break;
      case 'NO_VIDEO':
        result.status = STATUS.FAIL;
        result.error = checkResult.error;
        break;
      default:
        result.status = STATUS.UNKNOWN;
    }

    // ---- INTEGRITY CHECKS (informational only — never flip PASS to FAIL) ----
    // Only run when the video is PASSing — no point checking audio on a broken video.
    if (result.status === STATUS.PASS) {
      try {
        await runIntegrityChecks(page, videoFrame, card, result, checkResult.hlsSrc);
      } catch { /* integrity checks are best-effort, never affect status */ }
    }
  } catch (e) {
    result.status = STATUS.FAIL;
    result.error = e.message;
    result.loadTimeMs = Date.now() - startTime;
  }

  // Screenshot on failure
  if (CONFIG.screenshotOnFailure && (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT)) {
    try {
      const safeName = (result.title || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
      const screenshotFile = `${CONFIG.screenshotDir}/${safeName}_${videoNum}.png`;
      await page.screenshot({ path: screenshotFile, fullPage: false });
      result.screenshot = screenshotFile;
    } catch { /* non-critical */ }
  }

  logResult(result, videoNum, totalLabel);
  emit({ type: 'check', result });
  return result;
}

function logResult(r, num, total) {
  const icon = r.status === STATUS.PASS ? '✅' : r.status === STATUS.FAIL ? '❌' : r.status === STATUS.TIMEOUT ? '⏱️' : '⚠️';
  const time = r.loadTimeMs ? `(${(r.loadTimeMs / 1000).toFixed(1)}s)` : '';
  const sec = r.section ? `[${r.section}] ` : '';
  const err = r.error ? ` -- ${r.error}` : '';
  const dur = r.duration ? ` [${r.duration}]` : '';
  // Soft warnings (informational only — never affect PASS/FAIL)
  const warns = [];
  if (r.hasAudio === false) warns.push('🔇 silent');
  if (r.titleMismatch) warns.push('⚠ title mismatch');
  if (r.thumbnailMismatch) warns.push('⚠ thumb mismatch');
  const warnStr = warns.length ? ` ${warns.join(' ')}` : '';
  log(`   [${num}/${total}] ${icon} ${sec}${r.title}${dur} ${time}${warnStr}${err}`);
}

/**
 * Integrity checks — INFORMATIONAL ONLY. Never flips PASS to FAIL.
 * All operations wrapped in try/catch so any failure here is silent.
 * Mutates result by adding: hasAudio, audioWarning, titleMismatch, thumbnailMismatch
 */
async function runIntegrityChecks(page, videoFrame, card, result, hlsSrc) {
  // ---- AUDIO DETECTION ----
  // Read what the browser knows about audio tracks on the <video> element
  try {
    const audioInfo = await videoFrame.evaluate(() => {
      const vid = document.querySelector('video');
      if (!vid) return null;
      return {
        audioTracksLength: vid.audioTracks ? vid.audioTracks.length : null,
        muted: vid.muted,
        volume: vid.volume,
        // Chrome-specific: bytes of audio actually decoded
        webkitAudioDecodedByteCount: typeof vid.webkitAudioDecodedByteCount === 'number' ? vid.webkitAudioDecodedByteCount : null,
        // Firefox-specific
        mozHasAudio: typeof vid.mozHasAudio === 'boolean' ? vid.mozHasAudio : null,
      };
    }).catch(() => null);

    // Decide audio presence from any available signal
    let hasAudio = null; // null = unknown
    if (audioInfo) {
      if (audioInfo.mozHasAudio === true || audioInfo.audioTracksLength > 0 || audioInfo.webkitAudioDecodedByteCount > 0) {
        hasAudio = true;
      } else if (audioInfo.audioTracksLength === 0 || audioInfo.mozHasAudio === false) {
        // Browser explicitly says no audio
        hasAudio = false;
      }
    }

    // Cross-check: fetch the HLS manifest and look for an audio media line.
    // Use Playwright's request context (inherits cookies/auth) for the fetch.
    if (hlsSrc && hasAudio !== true) {
      try {
        const resp = await page.context().request.get(hlsSrc, { timeout: 5000 });
        if (resp.ok()) {
          const text = await resp.text();
          if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/m.test(text) || /\.aac|\.mp3/i.test(text)) {
            hasAudio = true;
          } else if (hasAudio === null) {
            // Master manifest may reference a separate variant — check if any URI ends in /audio/
            if (/audio/i.test(text)) hasAudio = true;
            else hasAudio = false;
          }
        }
      } catch { /* manifest fetch failed — leave hasAudio as-is */ }
    }

    result.hasAudio = hasAudio;
    if (hasAudio === false) {
      result.audioWarning = 'No audio track detected';
    } else if (audioInfo && audioInfo.muted === true && audioInfo.volume === 0) {
      result.audioWarning = 'Audio present but muted by default';
    }
  } catch { /* audio check failed silently */ }

  // ---- TITLE MISMATCH ----
  // Compare the watch page heading with the card title we discovered.
  try {
    const watchTitle = await page.evaluate(() => {
      // Prefer the h1; fall back to breadcrumb's last item
      const h1 = document.querySelector('h1');
      if (h1) {
        const t = h1.textContent.trim();
        if (t && t.length < 120) return t;
      }
      const crumbs = document.querySelectorAll('nav a, [class*="breadcrumb" i] a, [class*="breadcrumb" i] span');
      let last = '';
      crumbs.forEach(el => {
        const t = (el.textContent || '').trim();
        if (t && t.length > 1 && t.length < 80) last = t;
      });
      return last;
    }).catch(() => '');

    if (watchTitle && card.title) {
      // Normalize: lowercase + collapse whitespace + strip punctuation for fuzzy compare
      const norm = s => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      const a = norm(watchTitle);
      const b = norm(card.title);
      // Exact match OR one contains the other (handles "Marvelous Light Episode 3" vs "Marvelous Light Ep 3")
      if (a !== b && !a.includes(b) && !b.includes(a)) {
        result.titleMismatch = `expected "${card.title}", watch page shows "${watchTitle}"`;
      }
    }
  } catch { /* title check failed silently */ }

  // ---- THUMBNAIL MISMATCH ----
  // Compare the card thumbnail UUID with the watch-page poster/video UUID.
  // Both should reference the same video UUID.
  try {
    if (card.thumbnailUrl && card.videoId) {
      const watchPoster = await page.evaluate(() => {
        const vid = document.querySelector('video');
        const posterUrl = vid?.poster || '';
        // Also check any large image on the page that might be a poster
        const imgs = document.querySelectorAll('img');
        const altPoster = imgs.length ? imgs[0].src : '';
        return posterUrl || altPoster;
      }).catch(() => '');

      if (watchPoster) {
        const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
        const posterUuid = (watchPoster.match(uuidPattern) || [])[1];
        if (posterUuid && posterUuid.toLowerCase() !== card.videoId.toLowerCase()) {
          result.thumbnailMismatch = `card UUID ${card.videoId} ≠ poster UUID ${posterUuid}`;
        }
      }
    }
  } catch { /* thumbnail check failed silently */ }
}

// ============================================================
// REPORT GENERATION
// ============================================================

function generateReport(allResults) {
  const passed = allResults.filter(r => r.status === STATUS.PASS);
  const failed = allResults.filter(r => r.status === STATUS.FAIL);
  const timeouts = allResults.filter(r => r.status === STATUS.TIMEOUT);

  // Integrity flag summaries (informational)
  const silentVideos      = allResults.filter(r => r.hasAudio === false);
  const titleMismatches   = allResults.filter(r => r.titleMismatch);
  const thumbMismatches   = allResults.filter(r => r.thumbnailMismatch);

  if (!JSON_STREAM) {
    console.log('\n' + '='.repeat(60));
    console.log('VIDEO LOAD REPORT -- go.kingdomlandkids.com');
    console.log('='.repeat(60));
    console.log(`Date:       ${new Date().toLocaleString()}`);
    console.log(`Total:      ${allResults.length} videos checked`);
    console.log(`Loaded OK:  ${passed.length}`);
    console.log(`Failed:     ${failed.length}`);
    console.log(`Timed out:  ${timeouts.length}`);
    if (silentVideos.length > 0 || titleMismatches.length > 0 || thumbMismatches.length > 0) {
      console.log('-'.repeat(60));
      console.log('INTEGRITY WARNINGS (PASSing videos with anomalies):');
      if (silentVideos.length > 0)    console.log(`  🔇 Silent:           ${silentVideos.length}`);
      if (titleMismatches.length > 0) console.log(`  ⚠ Title mismatch:   ${titleMismatches.length}`);
      if (thumbMismatches.length > 0) console.log(`  ⚠ Thumb mismatch:   ${thumbMismatches.length}`);
    }
    console.log('-'.repeat(60));

    if (failed.length > 0) {
      console.log('\nFAILED VIDEOS:');
      console.log('-'.repeat(40));
      failed.forEach(r => {
        console.log(`  ${r.number}. [${r.page}] ${r.section ? r.section + ' > ' : ''}${r.title}`);
        console.log(`     URL:   ${r.url}`);
        console.log(`     Error: ${r.error}`);
        if (r.hlsSrc) console.log(`     HLS:   ${r.hlsSrc}`);
        console.log('');
      });
    }
    if (timeouts.length > 0) {
      console.log('\nTIMED OUT:');
      console.log('-'.repeat(40));
      timeouts.forEach(r => {
        console.log(`  ${r.number}. [${r.page}] ${r.section ? r.section + ' > ' : ''}${r.title}`);
        console.log(`     URL: ${r.url}`);
        console.log('');
      });
    }
    if (passed.length === allResults.length) {
      console.log('\nALL VIDEOS LOADED SUCCESSFULLY!');
    }
  }

  if (fs.existsSync('video-report.json')) {
    try { fs.copyFileSync('video-report.json', 'previous-report.json'); } catch {}
  }

  const perfAlerts = allResults
    .filter(r => r.loadTimeMs && r.loadTimeMs > CONFIG.performanceThresholds.warning)
    .map(r => ({
      title: r.title,
      section: r.section || '',
      loadTimeMs: r.loadTimeMs,
      level: r.loadTimeMs >= CONFIG.performanceThresholds.critical ? 'CRITICAL' : 'WARNING',
    }))
    .sort((a, b) => b.loadTimeMs - a.loadTimeMs);

  const report = {
    timestamp: new Date().toISOString(),
    browser: BROWSER_NAME,
    summary: { total: allResults.length, passed: passed.length, failed: failed.length, timeouts: timeouts.length },
    failedVideos: failed.map(r => ({ num: r.number, page: r.page, section: r.section, title: r.title, url: r.url, error: r.error })),
    performanceAlerts: perfAlerts,
    allResults,
  };
  emit({ type: 'complete', summary: report.summary, allResults: report.allResults });
  fs.writeFileSync('video-report.json', JSON.stringify(report, null, 2));
  log('Saved: video-report.json');

  try { db.saveRun(report); log('Saved: SQLite database'); }
  catch (err) { log(`SQLite save failed (non-critical): ${err.message}`); }

  const historyEntry = {
    timestamp: report.timestamp,
    total: allResults.length,
    passed: passed.length,
    failed: failed.length,
    timeouts: timeouts.length,
    avgLoadTimeMs: Math.round(allResults.reduce((s, r) => s + (r.loadTimeMs || 0), 0) / (allResults.length || 1)),
    videos: allResults.map(r => ({
      title: r.title,
      section: r.section || '',
      page: r.page || '',
      status: r.status,
      loadTimeMs: r.loadTimeMs || 0,
      error: r.error || '',
    })),
  };
  let history = [];
  if (fs.existsSync('history.json')) {
    try { history = JSON.parse(fs.readFileSync('history.json', 'utf-8')); } catch { history = []; }
  }
  history.push(historyEntry);
  if (history.length > 50) history = history.slice(-50);
  fs.writeFileSync('history.json', JSON.stringify(history, null, 2));
  log('Saved: history.json');

  const csv = 'Number,Page,Section,Title,Status,URL,Error,HLS Source,Duration,Resolution,Load Time (ms)\n' +
    allResults.map(r =>
      [r.number, `"${r.page}"`, `"${r.section || ''}"`, `"${(r.title || '').replace(/"/g, '""')}"`,
       `"${r.status}"`, `"${r.url}"`, `"${(r.error || '').replace(/"/g, '""')}"`,
       `"${r.hlsSrc || ''}"`, `"${r.duration || ''}"`, `"${r.resolution || ''}"`, r.loadTimeMs || ''].join(',')
    ).join('\n');
  fs.writeFileSync('video-report.csv', csv);
  log('Saved: video-report.csv');

  const failedAndTimeout = [...failed, ...timeouts];
  if (failedAndTimeout.length > 0) {
    const lines = [
      `FAILED VIDEOS — go.kingdomlandkids.com`,
      `Generated: ${new Date().toLocaleString()}`,
      `Total failed: ${failed.length} | Timed out: ${timeouts.length}`,
      '='.repeat(60), '',
    ];
    for (const r of failedAndTimeout) {
      lines.push(`[${r.status}] #${r.number} [${r.page}] ${r.section ? r.section + ' > ' : ''}${r.title}`);
      if (r.url) lines.push(`  URL:   ${r.url}`);
      lines.push(`  Error: ${r.error}`);
      if (r.hlsSrc) lines.push(`  HLS:   ${r.hlsSrc}`);
      lines.push('');
    }
    fs.writeFileSync('failed-videos.txt', lines.join('\n'));
    log('Saved: failed-videos.txt');
  }

  if (!JSON_STREAM && perfAlerts.length > 0) {
    console.log(`\nPERFORMANCE ALERTS (>${CONFIG.performanceThresholds.warning / 1000}s warning, >${CONFIG.performanceThresholds.critical / 1000}s critical):`);
    console.log('-'.repeat(40));
    for (const a of perfAlerts) {
      const icon = a.level === 'CRITICAL' ? '🔴' : '🟡';
      console.log(`  ${icon} [${a.level}] ${a.title} — ${(a.loadTimeMs / 1000).toFixed(1)}s`);
    }
  }

  if (failed.length > 0 || perfAlerts.length > 0) {
    sendSlackFailureAlert(report.failedVideos, report.summary, perfAlerts)
      .catch(err => log(`Slack alert failed (non-critical): ${err.message}`));
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!JSON_STREAM) {
    console.log('\nKingdomland Playwatch -- Video Load Checker (new UI)');
    console.log('='.repeat(60));
    console.log(`Mode:    ${DEBUG ? 'Debug (visible browser)' : 'Headless'}`);
    console.log(`Browser: ${BROWSER_NAME}`);
    console.log(`Pages:   Home (single-pass discovery)`);
    console.log('='.repeat(60));
  }

  const browser = await browserEngine.launch({ headless: !DEBUG, slowMo: DEBUG ? 200 : 0 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const allResults = [];
  let videoNum = 0;

  try {
    await login(page);

    // Navigate to Home (login may have landed us elsewhere)
    if (!page.url().endsWith('/') && !page.url().endsWith(CONFIG.baseUrl)) {
      await page.goto(CONFIG.homeUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
      await page.waitForTimeout(1500);
    }

    let cards = await discoverHomeVideos(page);
    emit({ type: 'discovery-complete', page: PAGE.HOME, cards, total: cards.length });

    if (TITLES_FILTER) {
      cards = cards.filter(c => TITLES_FILTER.has(c.title));
      log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
    }

    const totalStr = cards.length.toString();
    for (const card of cards) {
      videoNum++;
      const result = await checkVideo(page, card, videoNum, totalStr);
      allResults.push(result);
    }

  } catch (error) {
    console.error(`\nFatal error: ${error.message}`);
    if (DEBUG) {
      console.error(error.stack);
      log('Browser stays open 30s for inspection...');
      await page.waitForTimeout(30000);
    }
  } finally {
    await browser.close();
  }

  // ===== Retry failed/timed out videos =====
  if (CONFIG.retryFailures && allResults.length > 0) {
    const retryTargets = allResults.filter(r => r.status === STATUS.FAIL || r.status === STATUS.TIMEOUT);
    if (retryTargets.length > 0 && retryTargets.length <= 20) {
      log(`\nRetrying ${retryTargets.length} failed/timed out video(s)...`);
      emit({ type: 'status', message: `Retrying ${retryTargets.length} failed video(s)...` });

      const browser2 = await browserEngine.launch({ headless: !DEBUG, slowMo: DEBUG ? 200 : 0 });
      const context2 = await browser2.newContext({ viewport: { width: 1400, height: 900 } });
      const page2 = await context2.newPage();

      try {
        await login(page2);
        // We don't need to re-discover — we already have the UUIDs from the first pass
        for (const orig of retryTargets) {
          // Use stored UUID from original card discovery (parsed from URL if needed)
          let videoId = null;
          const m = (orig.url || '').match(/\/watch\/([0-9a-f-]+)/);
          if (m) videoId = m[1];

          const retryCard = {
            title: orig.title,
            videoId,
            thumbnailUrl: orig.thumbnailUrl,
            duration: orig.duration || '',
          };
          if (!videoId) {
            log(`   ⚠ No UUID for retry of "${orig.title}", skipping`);
            continue;
          }
          const retryResult = await checkVideo(page2, retryCard, orig.number, `${allResults.length} (retry)`);

          if (retryResult.status === STATUS.PASS) {
            const idx = allResults.findIndex(r => r.number === orig.number);
            if (idx !== -1) {
              allResults[idx] = retryResult;
              log(`   Retry SUCCESS: ${orig.title}`);
            }
          }
        }
      } catch (e) {
        log(`Retry error: ${e.message}`);
      } finally {
        await browser2.close();
      }
    }
  }

  if (allResults.length > 0) generateReport(allResults);
  else log('\nNo videos checked. Run with --debug to troubleshoot.');
}

main().catch(console.error);
