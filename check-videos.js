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
const { sendSlackFailureAlert, sendSlackOutageAlert, sendSlackRecoveryAlert } = require('./lib/slack');
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

  // Throttle between video checks (#1) — avoids tripping the CDN's rate-limiting /
  // bot-protection, which was the likely cause of the recurring "all videos 403"
  // false outages. Base delay + random jitter makes traffic look less bot-like.
  // Set THROTTLE_MS=0 to disable.
  throttleBaseMs: parseInt(process.env.THROTTLE_MS, 10) >= 0 ? parseInt(process.env.THROTTLE_MS, 10) : 600,
  throttleJitterMs: 500,

  // Outage confirmation (#2) — before declaring an outage, pause and re-test a few
  // failed videos. If any recover, it was a transient blip / rate-limit, not an outage.
  outageConfirmPauseMs: parseInt(process.env.OUTAGE_CONFIRM_PAUSE_MS, 10) || 60000,
  outageConfirmSamples: 3,

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

// Long-term uptime log: summary-only (no per-video detail), so it can be kept for
// years without the file getting huge — unlike history.json, which carries full
// per-video detail and is capped at 50 runs (~12 days) for that reason. Without
// this, "30-Day"/"All-Time" uptime were silently computed over whatever happened
// to survive the 50-run cap, which could be well under 30 days.
const UPTIME_LOG_FILE = 'uptime-log.json';
const UPTIME_LOG_MAX = 5000; // ~3.4 years at 4 runs/day

if (CONFIG.screenshotOnFailure) {
  const screenshotPath = require('path').join(__dirname, CONFIG.screenshotDir);
  if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath, { recursive: true });
}

function emit(obj) { if (JSON_STREAM) process.stdout.write(JSON.stringify(obj) + '\n'); }
function log(msg) {
  if (JSON_STREAM) emit({ type: 'status', message: msg });
  else console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// Throttle helper (#1): base delay + random jitter between video checks.
function throttleDelay() {
  const base = CONFIG.throttleBaseMs || 0;
  if (base <= 0) return Promise.resolve();
  const ms = base + Math.floor(Math.random() * (CONFIG.throttleJitterMs || 0));
  return new Promise(r => setTimeout(r, ms));
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
    // HTTP failure diagnosis (only populated on FAIL/TIMEOUT)
    httpStatus: null,          // real HTTP status of the HLS manifest
    httpContentType: null,
    httpBodySnippet: null,
    failureDiagnosis: null,    // plain-English: rate-limit vs outage vs missing
    capturedErrors: null,      // { network, requestsFailed, console, pageErrors } on failure
  };
  const startTime = Date.now();

  // Capture network/console/JS errors during this video's load (detached in finally)
  const capture = attachErrorCapture(page);

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

    // ---- HTTP DIAGNOSIS on failure (tells us WHY: outage vs rate-limit vs missing) ----
    // Directly fetch the HLS manifest and record the real HTTP status + body snippet.
    // This distinguishes a genuine CDN outage (5xx / error page) from the checker
    // simply being rate-limited / bot-blocked (403) — where real users are unaffected.
    if (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT) {
      try {
        await probeManifest(page, card, result);
      } catch { /* diagnosis is best-effort */ }
    }
  } catch (e) {
    result.status = STATUS.FAIL;
    result.error = e.message;
    result.loadTimeMs = Date.now() - startTime;
  } finally {
    // Attach captured network/console/JS errors on failure, then detach listeners.
    try {
      if (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT) {
        const snap = capture.snapshot();
        if (snap) result.capturedErrors = snap;
        // Refine: master playlist was OK (200/valid) but sub-resources failed →
        // the video genuinely can't play, even though the top manifest looked fine.
        if (snap && snap.network && /200 with a valid manifest/.test(result.failureDiagnosis || '')) {
          const cdnFails = snap.network.filter(n => /cloudfront|\.m3u8|\.ts|\.m4s/i.test(n.url));
          if (cdnFails.length) {
            result.failureDiagnosis = `🔴 The master playlist loaded (200) but ${cdnFails.length} video segment/variant request(s) failed (e.g. HTTP ${cdnFails[0].status}). The video genuinely cannot play for viewers.`;
          }
        }
      }
    } catch { /* best-effort */ }
    capture.detach();
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

/**
 * Attach passive listeners to capture errors during a video's load:
 *   - network responses with status >= 400 (segments, variant playlists, APIs)
 *   - failed requests (DNS/TLS/connection errors)
 *   - console.error messages from the page
 *   - uncaught JS exceptions (pageerror)
 * Returns { snapshot(), detach() }. Caller must detach() when done.
 * Only relevant (CDN / kingdomlandkids / video / api) URLs are kept, capped.
 */
function attachErrorCapture(page) {
  // Match by HOSTNAME (not full URL) so analytics calls that embed the site URL
  // in a query param (e.g. Google Analytics ?dl=...kingdomlandkids...) don't match.
  const isRelevant = (u) => {
    try {
      const url = new URL(u);
      const host = url.hostname;
      // Exclude known analytics / tracking / error-reporting hosts
      if (/google|doubleclick|analytics|gstatic|facebook|segment|sentry|hotjar|mixpanel|clarity|cookiebot/i.test(host)) return false;
      // Keep: the streaming CDN, the app domain, or any HLS asset
      if (/cloudfront\.net$|kingdomlandkids\.com$/i.test(host)) return true;
      if (/\.(m3u8|ts|m4s)(\?|$)/i.test(url.pathname)) return true;
      return false;
    } catch { return false; }
  };

  const net = [];        // { url, status }
  const failedReqs = []; // { url, reason }
  const consoleErrs = [];
  const pageErrs = [];

  const onResponse = (resp) => {
    try {
      const s = resp.status();
      const u = resp.url();
      if (s >= 400 && isRelevant(u) && net.length < 15) net.push({ url: u.slice(0, 160), status: s });
    } catch { /* ignore */ }
  };
  const onRequestFailed = (req) => {
    try {
      const u = req.url();
      if (isRelevant(u) && failedReqs.length < 15) {
        const f = req.failure();
        failedReqs.push({ url: u.slice(0, 160), reason: (f && f.errorText) || 'request failed' });
      }
    } catch { /* ignore */ }
  };
  const onConsole = (msg) => {
    try {
      if (msg.type() === 'error' && consoleErrs.length < 8) consoleErrs.push((msg.text() || '').slice(0, 200));
    } catch { /* ignore */ }
  };
  const onPageError = (err) => {
    try { if (pageErrs.length < 5) pageErrs.push(String((err && err.message) || err).slice(0, 200)); } catch { /* ignore */ }
  };

  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    snapshot() {
      const seen = new Set();
      const netDedup = net.filter(n => { const k = n.status + n.url; if (seen.has(k)) return false; seen.add(k); return true; });
      const out = {};
      if (netDedup.length) out.network = netDedup;
      if (failedReqs.length) out.requestsFailed = failedReqs;
      if (consoleErrs.length) out.console = [...new Set(consoleErrs)];
      if (pageErrs.length) out.pageErrors = [...new Set(pageErrs)];
      return Object.keys(out).length ? out : null;
    },
    detach() {
      try {
        page.off('response', onResponse);
        page.off('requestfailed', onRequestFailed);
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
      } catch { /* ignore */ }
    },
  };
}

/**
 * On failure, fetch the HLS manifest directly to learn WHY it failed.
 * Records the real HTTP status + a body snippet on the result, and a
 * plain-English classification. Uses Playwright's request context so it
 * inherits the logged-in session's cookies/auth.
 *
 * Mutates result with: httpStatus, httpContentType, httpBodySnippet, failureDiagnosis
 */
async function probeManifest(page, card, result) {
  // Determine the manifest URL: prefer the one the player used, else construct it.
  let manifestUrl = result.hlsSrc || '';
  if (!manifestUrl && card.videoId) {
    manifestUrl = `https://d394daiw0g5hmq.cloudfront.net/videos/hls/${card.videoId}/master.m3u8`;
  }
  if (!manifestUrl) {
    result.failureDiagnosis = 'No manifest URL available to probe.';
    return;
  }

  try {
    const resp = await page.context().request.get(manifestUrl, { timeout: 8000 });
    const status = resp.status();
    const contentType = (resp.headers()['content-type'] || '').toLowerCase();
    let body = '';
    try { body = (await resp.text()).slice(0, 300); } catch { /* body may be binary */ }

    result.httpStatus = status;
    result.httpContentType = contentType;
    result.httpBodySnippet = body.replace(/\s+/g, ' ').trim().slice(0, 200);

    // Classify
    const looksLikeManifest = /^#EXTM3U/.test(body.trim());
    if (status === 403 || status === 401) {
      // CloudFront returns 403 AccessDenied both for rate-limiting/WAF blocks AND
      // for genuinely inaccessible objects — so 403 alone isn't conclusive. The
      // outage-level pattern (all videos at once + self-recovery) is the tiebreaker.
      result.failureDiagnosis = `🤖 HTTP ${status} (CDN refused the request). When this hits ALL videos at once and then recovers on its own, it's typically rate-limiting / bot-protection against the automated checker (real users usually fine) or a transient CDN access issue — not individual broken videos. If only a few videos show this, those specific files may be inaccessible.`;
    } else if (status === 429) {
      result.failureDiagnosis = `🤖 HTTP 429 Too Many Requests — the checker is being rate-limited. Real users likely unaffected. Consider spacing out checks.`;
    } else if (status >= 500) {
      result.failureDiagnosis = `🔴 HTTP ${status} — the streaming origin/CDN returned a server error. This is a GENUINE outage that affects real viewers.`;
    } else if (status === 404) {
      result.failureDiagnosis = `⚠️ HTTP 404 — the video manifest was not found. The video may have been removed or its files are missing.`;
    } else if (status === 200 && !looksLikeManifest) {
      result.failureDiagnosis = `🔴 HTTP 200 but the body is NOT a valid HLS manifest (got ${contentType || 'unknown content'}). The CDN is serving an error/placeholder page instead of video — a GENUINE problem affecting real viewers.`;
    } else if (status === 200 && looksLikeManifest) {
      result.failureDiagnosis = `🟡 HTTP 200 with a valid manifest — the playlist is fine, so the decode failure may be codec/player-specific (Playwright's headless Chromium), not necessarily user-facing.`;
    } else {
      result.failureDiagnosis = `HTTP ${status} (${contentType || 'no content-type'}).`;
    }
  } catch (e) {
    result.httpStatus = null;
    result.failureDiagnosis = `Could not reach the manifest at all (${e.message.slice(0, 80)}) — likely a network/DNS issue or the CDN is fully down.`;
  }
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
  // On failure, surface the HTTP diagnosis (real status code + what it means)
  if (r.failureDiagnosis && (r.status === STATUS.FAIL || r.status === STATUS.TIMEOUT)) {
    log(`        ↳ ${r.failureDiagnosis}`);
  }
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

// Read the previous run's video total from history.json (for discovery sanity #3).
function readPrevTotal() {
  try {
    if (!fs.existsSync('history.json')) return null;
    const h = JSON.parse(fs.readFileSync('history.json', 'utf-8'));
    if (!Array.isArray(h) || !h.length) return null;
    // Walk back to the last run with a meaningful total (skip filtered rechecks / discovery fails)
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].total && h[i].total > 20 && !h[i].discoveryFailure) return h[i].total;
    }
    return null;
  } catch { return null; }
}

// Append a lightweight summary entry to the long-term uptime log. Deliberately
// carries NO per-video detail (that's history.json's job) so it can be retained
// for years without the file growing unreasonably large.
function appendUptimeLog(entry) {
  let uptimeLog = [];
  if (fs.existsSync(UPTIME_LOG_FILE)) {
    try { uptimeLog = JSON.parse(fs.readFileSync(UPTIME_LOG_FILE, 'utf-8')); } catch { uptimeLog = []; }
  }
  if (!Array.isArray(uptimeLog)) uptimeLog = [];
  uptimeLog.push(entry);
  if (uptimeLog.length > UPTIME_LOG_MAX) uptimeLog = uptimeLog.slice(-UPTIME_LOG_MAX);
  try {
    fs.writeFileSync(UPTIME_LOG_FILE, JSON.stringify(uptimeLog, null, 2));
    log('Saved: ' + UPTIME_LOG_FILE);
  } catch (e) {
    log(`Failed to save ${UPTIME_LOG_FILE} (non-critical): ${e.message}`);
  }
}

// #3 Write a minimal report flagging a discovery failure (0 videos found), so the
// dashboard shows a clear "discovery failed" banner instead of looking healthy/empty.
function writeDiscoveryFailureReport(expected) {
  const report = {
    timestamp: new Date().toISOString(),
    browser: BROWSER_NAME,
    summary: { total: 0, passed: 0, failed: 0, timeouts: 0 },
    failedVideos: [],
    performanceAlerts: [],
    outage: null,
    discoveryFailure: { detected: true, expected: expected || null },
    allResults: [],
  };
  emit({ type: 'complete', summary: report.summary, allResults: [] });
  try {
    if (fs.existsSync('video-report.json')) fs.copyFileSync('video-report.json', 'previous-report.json');
  } catch { /* ignore */ }
  try { fs.writeFileSync('video-report.json', JSON.stringify(report, null, 2)); log('Saved: video-report.json (discovery failure)'); } catch { /* ignore */ }

  // Append a history entry so the trend reflects the gap honestly
  try {
    let history = [];
    if (fs.existsSync('history.json')) { try { history = JSON.parse(fs.readFileSync('history.json', 'utf-8')); } catch { history = []; } }
    history.push({ timestamp: report.timestamp, total: 0, passed: 0, failed: 0, timeouts: 0, avgLoadTimeMs: 0, discoveryFailure: true, videos: [] });
    if (history.length > 50) history = history.slice(-50);
    fs.writeFileSync('history.json', JSON.stringify(history, null, 2));
  } catch { /* ignore */ }

  // Record in the long-term log too, so uptime math doesn't have a silent gap.
  // total=0 contributes nothing to the passed/total ratio either way — a discovery
  // failure means "we don't know", not "videos are down", and shouldn't move the number.
  appendUptimeLog({ timestamp: report.timestamp, total: 0, passed: 0, failed: 0, timeouts: 0, discoveryFailure: true });

  // Alert (Slack if configured; otherwise dashboard banner covers it)
  sendSlackOutageAlert(
    'Discovery failed — 0 videos found (login or site change?)',
    0,
    expected || 0,
    `🚨 The checker logged in but found 0 videos on Home${expected ? ` (expected ~${expected})` : ''}. This is a login/site-structure problem, not a video-playback outage — the checker likely needs its selectors updated.`
  ).catch(err => log(`Slack discovery alert failed (non-critical): ${err.message}`));
}

// #4 Detect per-video performance regressions: a PASSing video that's now much
// slower than its own historical median. Needs >=3 past samples to be meaningful.
function detectPerfRegressions(allResults) {
  let history = [];
  try {
    if (fs.existsSync('history.json')) history = JSON.parse(fs.readFileSync('history.json', 'utf-8'));
  } catch { history = []; }
  if (!Array.isArray(history) || history.length < 3) return [];

  // Build per-title list of past load times (PASS runs only)
  const past = {};
  for (const run of history) {
    if (!run.videos) continue;
    for (const v of run.videos) {
      if (v.status === 'PASS' && v.loadTimeMs > 0) {
        (past[v.title] = past[v.title] || []).push(v.loadTimeMs);
      }
    }
  }

  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const out = [];
  for (const r of allResults) {
    if (r.status !== STATUS.PASS || !r.loadTimeMs) continue;
    const samples = past[r.title];
    if (!samples || samples.length < 3) continue;
    const med = median(samples);
    // Regression = now ≥2.5× the historical median AND clearly slow in absolute terms
    if (med > 0 && r.loadTimeMs >= med * 2.5 && r.loadTimeMs >= 8000) {
      out.push({
        title: r.title,
        section: r.section || '',
        nowMs: r.loadTimeMs,
        medianMs: Math.round(med),
        ratio: +(r.loadTimeMs / med).toFixed(1),
        samples: samples.length,
      });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

function generateReport(allResults) {
  const passed = allResults.filter(r => r.status === STATUS.PASS);
  const failed = allResults.filter(r => r.status === STATUS.FAIL);
  const timeouts = allResults.filter(r => r.status === STATUS.TIMEOUT);

  // Integrity flag summaries (informational)
  const silentVideos      = allResults.filter(r => r.hasAudio === false);
  const titleMismatches   = allResults.filter(r => r.titleMismatch);
  const thumbMismatches   = allResults.filter(r => r.thumbnailMismatch);

  // #4 Performance regression detection — compare each PASSing video's load time
  // against its own historical median. Flag ones that have clearly degraded.
  const regressions = detectPerfRegressions(allResults);

  // Transient state captured during the run (declared early — used in console output below)
  const outage = global.__KL_OUTAGE__ || null;
  const discoveryWarning = global.__KL_DISCOVERY_WARNING__ || null;

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

    if (regressions.length > 0) {
      console.log('-'.repeat(60));
      console.log('⏳ PERFORMANCE REGRESSIONS (passing, but much slower than usual):');
      regressions.slice(0, 10).forEach(r => {
        console.log(`  ${r.title} — now ${(r.nowMs / 1000).toFixed(1)}s vs usual ${(r.medianMs / 1000).toFixed(1)}s (${r.ratio}× over ${r.samples} runs)`);
      });
    }
    if (discoveryWarning) {
      console.log('-'.repeat(60));
      console.log(`⚠️ PARTIAL DISCOVERY: found ${discoveryWarning.found} videos (expected ~${discoveryWarning.expected}).`);
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
    failedVideos: failed.map(r => ({ num: r.number, page: r.page, section: r.section, title: r.title, url: r.url, error: r.error, httpStatus: r.httpStatus, failureDiagnosis: r.failureDiagnosis })),
    performanceAlerts: perfAlerts,
    regressions,
    outage: outage ? { detected: true, error: outage.error, checkedBeforeAbort: outage.checkedCount, diagnosis: outage.diagnosis, httpStatuses: outage.httpStatuses } : null,
    discoveryWarning,
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
      httpStatus: r.httpStatus != null ? r.httpStatus : undefined,
      failureDiagnosis: r.failureDiagnosis || undefined,
    })),
  };
  let history = [];
  if (fs.existsSync('history.json')) {
    try { history = JSON.parse(fs.readFileSync('history.json', 'utf-8')); } catch { history = []; }
  }
  // Capture the PREVIOUS run (last entry before we append this one) for recovery detection
  const prevRun = history.length > 0 ? history[history.length - 1] : null;
  history.push(historyEntry);
  if (history.length > 50) history = history.slice(-50);
  fs.writeFileSync('history.json', JSON.stringify(history, null, 2));
  log('Saved: history.json');

  // Long-term summary log (#1) — kept far longer than history.json's 50-run cap,
  // so "30-Day"/"All-Time" uptime reflect what actually happened in that window
  // instead of whatever survived the recent-detail cap.
  appendUptimeLog({
    timestamp: historyEntry.timestamp,
    total: historyEntry.total,
    passed: historyEntry.passed,
    failed: historyEntry.failed,
    timeouts: historyEntry.timeouts,
    outage: !!outage,
  });

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

  // ===== Slack alerts =====
  if (outage) {
    // #1 Single consolidated outage alert (instead of N per-video failure lines)
    if (!JSON_STREAM) {
      console.log('-'.repeat(60));
      console.log(`🚨 OUTAGE: ${outage.checkedCount} videos checked, all failed with the same error.`);
      console.log(`   "${outage.error}"`);
      if (outage.diagnosis) console.log(`   Diagnosis: ${outage.diagnosis}`);
      if (outage.httpStatuses && outage.httpStatuses.length) console.log(`   HTTP status(es) seen: ${outage.httpStatuses.join(', ')}`);
      console.log(`   Treated all ${allResults.length} videos as down. Per-video alerts suppressed.`);
    }
    sendSlackOutageAlert(outage.error, outage.checkedCount, allResults.length, outage.diagnosis)
      .catch(err => log(`Slack outage alert failed (non-critical): ${err.message}`));
  } else if (failed.length > 0 || perfAlerts.length > 0) {
    // Normal failure alert (only when NOT an outage)
    sendSlackFailureAlert(report.failedVideos, report.summary, perfAlerts)
      .catch(err => log(`Slack alert failed (non-critical): ${err.message}`));
  }

  // #2 Recovery alert — current run is healthy, but the PREVIOUS run had issues
  if (!outage && failed.length === 0 && timeouts.length === 0 && prevRun) {
    const prevIssues = (prevRun.failed || 0) + (prevRun.timeouts || 0);
    if (prevIssues > 0) {
      log(`✅ Recovery detected — previous run had ${prevIssues} issue(s), now back to 100%.`);
      sendSlackRecoveryAlert(report.summary, { failed: prevRun.failed, timeouts: prevRun.timeouts })
        .catch(err => log(`Slack recovery alert failed (non-critical): ${err.message}`));
    }
  }

  // Clear transient state so it doesn't leak into a subsequent run in the same process
  global.__KL_OUTAGE__ = null;
  global.__KL_DISCOVERY_WARNING__ = null;
}

/**
 * #2 Confirm a suspected outage is real (not a transient blip / rate-limit).
 * Pauses, then re-tests a sample of the failed videos. Returns:
 *   true  → still failing after the pause  → REAL outage
 *   false → at least one recovered          → transient, NOT an outage
 */
async function confirmOutageReal(page, sampleCards, outageError) {
  const pauseSec = Math.round(CONFIG.outageConfirmPauseMs / 1000);
  log('');
  log(`   ⏸ ${sampleCards.length === 0 ? '' : ''}Suspected outage ("${outageError}"). Pausing ${pauseSec}s, then re-testing ${Math.min(sampleCards.length, CONFIG.outageConfirmSamples)} video(s) to rule out a transient blip / rate-limit...`);
  await page.waitForTimeout(CONFIG.outageConfirmPauseMs);

  const samples = sampleCards.slice(0, CONFIG.outageConfirmSamples);
  let recovered = 0;
  for (const c of samples) {
    try {
      const r = await checkVideo(page, c, 0, 'confirm');
      if (r.status === STATUS.PASS) recovered++;
    } catch { /* treat as still-failing */ }
    await throttleDelay();
  }
  log(`   Re-test result: ${recovered}/${samples.length} recovered.`);
  return recovered === 0; // real outage only if NONE recovered
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
    // Discovery can flake if the page hasn't finished rendering when the scroll runs.
    // Retry (reload + re-scroll) before trusting a 0 result — prevents false discovery alarms.
    let discAttempts = 0;
    while (cards.length === 0 && discAttempts < 2) {
      discAttempts++;
      log(`   Discovery found 0 videos — reloading and retrying (${discAttempts}/2)...`);
      try {
        await page.goto(CONFIG.homeUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
      } catch { /* fall through to scroll anyway */ }
      await page.waitForTimeout(3000);
      cards = await discoverHomeVideos(page);
    }
    emit({ type: 'discovery-complete', page: PAGE.HOME, cards, total: cards.length });

    // #3 Discovery sanity check — distinguish "login/UI broke" from "videos broke".
    // Compare what we found against the previous run's total.
    if (!TITLES_FILTER) {
      const prevTotal = readPrevTotal();
      if (cards.length === 0) {
        log('');
        log('🚨 DISCOVERY FAILED: 0 videos found on Home.');
        log('   This is NOT a video-playback issue — login may have failed, or the site structure/selectors changed.');
        writeDiscoveryFailureReport(prevTotal);
        await browser.close();
        return; // nothing to check
      }
      if (prevTotal && prevTotal > 20 && cards.length < prevTotal * 0.5) {
        log('');
        log(`⚠️ PARTIAL DISCOVERY: found ${cards.length} videos but previous run had ${prevTotal}.`);
        log('   Possible lazy-load/scroll issue or a site change. Checking what was found, but flagging this.');
        global.__KL_DISCOVERY_WARNING__ = { found: cards.length, expected: prevTotal };
      }
    }

    if (TITLES_FILTER) {
      cards = cards.filter(c => TITLES_FILTER.has(c.title));
      log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
    }

    const totalStr = cards.length.toString();
    // Outage detection: if the first N videos ALL fail with the same error,
    // it's a CDN/streaming outage — abort early and synthesize the rest as
    // outage-failures (saves ~24 min of pointless checking during an outage).
    const OUTAGE_THRESHOLD = 15;
    let outageDetected = false;
    let outageRuledOut = false; // set if confirmation shows it was a transient blip

    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      videoNum++;
      const result = await checkVideo(page, card, videoNum, totalStr);
      allResults.push(result);

      // #1 Throttle between checks (skip after the last one)
      if (ci < cards.length - 1) await throttleDelay();

      // Only evaluate while we have NOT yet seen a single pass
      const passedSoFar = allResults.filter(r => r.status === STATUS.PASS).length;
      if (!outageDetected && !outageRuledOut && passedSoFar === 0 && allResults.length >= OUTAGE_THRESHOLD) {
        const errs = new Set(allResults.map(r => r.error || ''));
        if (errs.size === 1) {
          const outageError = [...errs][0];

          // #2 Confirm before declaring an outage — pause and re-test a few of the
          // failed videos. If any recover, it was a transient blip / rate-limit.
          const sampleCards = [cards[0], cards[Math.floor(allResults.length / 2)], cards[allResults.length - 1]].filter(Boolean);
          const isReal = await confirmOutageReal(page, sampleCards, outageError);

          if (!isReal) {
            outageRuledOut = true;
            log('');
            log(`   ✓ Re-test passed — this was a TRANSIENT blip (likely rate-limit/throttle), NOT an outage.`);
            log(`   Continuing the normal run; the ${allResults.length} early failures will be retried at the end.`);
            continue; // keep checking the rest of the library
          }

          outageDetected = true;
          log('');
          log(`🚨 OUTAGE CONFIRMED: first ${allResults.length} videos ALL failed with the same error, and re-test still failed:`);
          log(`   "${outageError}"`);
          log(`   Aborting remaining ${cards.length - allResults.length} checks — this is a platform-wide issue, not individual videos.`);

          // Synthesize the remaining cards as outage-skipped failures so the
          // report total stays accurate and the trend chart shows a full red bar.
          const remaining = cards.slice(allResults.length);
          for (const skipCard of remaining) {
            videoNum++;
            allResults.push({
              number: videoNum,
              title: skipCard.title,
              section: '',
              page: PAGE.HOME,
              url: '',
              hlsSrc: '',
              thumbnailUrl: skipCard.thumbnailUrl || '',
              status: STATUS.FAIL,
              error: 'Skipped — outage detected (' + outageError + ')',
              loadTimeMs: null,
              duration: null,
              resolution: '',
              hasAudio: null, audioWarning: null, titleMismatch: null, thumbnailMismatch: null,
              outageSkipped: true,
            });
          }
          break;
        }
      }
    }

    // Stash outage state for the report stage
    if (outageDetected) {
      const checked = allResults.filter(r => !r.outageSkipped);
      const firstError = (checked[0] || {}).error || 'Unknown error';
      // Most common HTTP diagnosis among the probed failures (tells us real cause)
      const diagCounts = {};
      checked.forEach(r => { if (r.failureDiagnosis) diagCounts[r.failureDiagnosis] = (diagCounts[r.failureDiagnosis] || 0) + 1; });
      const topDiagnosis = Object.keys(diagCounts).sort((a, b) => diagCounts[b] - diagCounts[a])[0] || null;
      const statuses = [...new Set(checked.map(r => r.httpStatus).filter(s => s != null))];
      global.__KL_OUTAGE__ = {
        error: firstError,
        checkedCount: checked.length,
        totalCount: cards.length,
        diagnosis: topDiagnosis,
        httpStatuses: statuses,
      };
      if (topDiagnosis) {
        log('');
        log(`   Diagnosis: ${topDiagnosis}`);
      }
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
  // Skip retries entirely during an outage — every video is down, retrying is pointless.
  if (CONFIG.retryFailures && allResults.length > 0 && !global.__KL_OUTAGE__) {
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
