/**
 * Video Load Checker for go.kingdomlandkids.com
 *
 * Navigates through ALL carousel sections (clicking > arrows) to discover
 * every video card, then checks each one loads properly.
 *
 * SETUP:
 *   npm init -y
 *   npm install playwright
 *   npx playwright install chromium
 *
 * USAGE:
 *   node check-videos.js              # headless (fast)
 *   node check-videos.js --debug      # visible browser
 *   node check-videos.js --story      # only STORY page
 *   node check-videos.js --music      # only MUSIC page
 */

const { chromium } = require('playwright');
const fs = require('fs');

// ============== CONFIG ==============
const CONFIG = {
  baseUrl: 'https://go.kingdomlandkids.com',
  loginUrl: 'https://go.kingdomlandkids.com/login',
  musicUrl: 'https://go.kingdomlandkids.com/music',

  // Credentials (env vars required — no hardcoded fallbacks for security)
  username: process.env.KL_USERNAME || '',
  password: process.env.KL_PASSWORD || '',

  // Selectors (verified from actual site inspection)
  emailSelector: 'input[type="text"]',
  passwordSelector: 'input[type="password"]',
  loginButtonSelector: 'button[type="submit"]',

  // Timeouts
  videoLoadTimeout: 20000,
  navigationTimeout: 30000,

  // Retry: re-check failed/timed out videos once
  retryFailures: true,
  maxRetries: 1,

  // Screenshots on failure
  screenshotOnFailure: true,
  screenshotDir: 'screenshots',
};
// ====================================

const DEBUG = process.argv.includes('--debug');
const STORY_ONLY = process.argv.includes('--story');
const MUSIC_ONLY = process.argv.includes('--music');
const JSON_STREAM = process.argv.includes('--json-stream');

// Titles filter: only check specific videos (used by "Check Failed Only")
let TITLES_FILTER = null;
if (process.env.CHECK_TITLES) {
  try { TITLES_FILTER = new Set(JSON.parse(process.env.CHECK_TITLES)); } catch { TITLES_FILTER = null; }
}

// Ensure screenshot directory exists
if (CONFIG.screenshotOnFailure) {
  const screenshotPath = require('path').join(__dirname, CONFIG.screenshotDir);
  if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath, { recursive: true });
}

function emit(obj) {
  if (JSON_STREAM) process.stdout.write(JSON.stringify(obj) + '\n');
}

function log(msg) {
  if (JSON_STREAM) {
    emit({ type: 'status', message: msg });
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }
}

async function login(page) {
  if (!CONFIG.username || !CONFIG.password) {
    throw new Error('Missing credentials. Set KL_USERNAME and KL_PASSWORD environment variables.');
  }
  log('Logging in to go.kingdomlandkids.com...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });

  if (!page.url().includes('login')) {
    log('Already logged in!');
    return;
  }

  await page.fill(CONFIG.emailSelector, CONFIG.username);
  await page.fill(CONFIG.passwordSelector, CONFIG.password);
  await page.click(CONFIG.loginButtonSelector);
  await page.waitForTimeout(5000);

  if (page.url().includes('/login')) {
    throw new Error('Login failed — still on login page. Check credentials.');
  }

  log('Logged in as Jonathan Tubay\n');
}

/**
 * Scroll the page vertically to load all lazy sections.
 */
async function scrollToLoadAll(page) {
  let prevHeight = 0;
  for (let i = 0; i < 30; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === prevHeight) break;
    prevHeight = height;
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(600);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/**
 * Get all section names (h2 headings) on the current page.
 */
async function getSectionNames(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h2'))
      .map(h => h.textContent.trim())
      .filter(Boolean);
  });
}

/**
 * Click the carousel "next" (right >) or "prev" (left <) arrow for a section.
 * Tries multiple strategies to find the arrow button.
 * Returns true if an arrow was found and clicked.
 */
async function clickCarouselArrow(page, sectionName, direction = 'next') {
  // Step 1: Find the arrow element and return its bounding box (no clicking inside evaluate)
  const bounds = await page.evaluate(({ secName, dir }) => {
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      if (h2.textContent.trim() !== secName) continue;

      // Walk up from the h2 to find the header row that also contains arrow buttons.
      let headerArea = h2.parentElement;
      for (let depth = 0; depth < 5; depth++) {
        if (!headerArea) break;
        const svgCount = headerArea.querySelectorAll('svg').length;
        const btnCount = headerArea.querySelectorAll('button, [role="button"]').length;
        if (svgCount >= 2 || btnCount >= 2) break;
        headerArea = headerArea.parentElement;
      }
      if (!headerArea) return null;

      function getCenter(el) {
        // Scroll into view first — arrows may be off-screen after page scrolling
        el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }

      // --- Strategy 1: buttons/clickable elements with SVG icons ---
      const buttons = Array.from(headerArea.querySelectorAll('button, [role="button"]'));
      const arrowBtns = buttons.filter(btn => {
        const hasSvg = btn.querySelector('svg');
        const text = btn.textContent.trim();
        const isArrowChar = /^[<>‹›←→❮❯\u2039\u203A\u2190\u2192]$/.test(text);
        return hasSvg || isArrowChar;
      });
      if (arrowBtns.length >= 2) {
        const idx = dir === 'next' ? arrowBtns.length - 1 : 0;
        return getCenter(arrowBtns[idx]);
      }

      // --- Strategy 2: SVGs directly ---
      const svgs = Array.from(headerArea.querySelectorAll('svg'));
      if (svgs.length >= 2) {
        const idx = dir === 'next' ? svgs.length - 1 : 0;
        const target = svgs[idx].closest('button') || svgs[idx].closest('[role="button"]') || svgs[idx].parentElement;
        return getCenter(target);
      }

      // --- Strategy 3: Text-based arrows ---
      const allEls = Array.from(headerArea.querySelectorAll('*'));
      const rightChars = ['>', '\u203A', '\u2192', '\u276F'];
      const leftChars = ['<', '\u2039', '\u2190', '\u276E'];
      const targetChars = dir === 'next' ? rightChars : leftChars;
      for (const el of allEls) {
        if (el.children.length > 0) continue;
        const text = el.textContent.trim();
        if (targetChars.includes(text)) {
          return getCenter(el.closest('button') || el);
        }
      }

      return null;
    }
    return null;
  }, { secName: sectionName, dir: direction });

  // Step 2: Click at the coordinates using Playwright's native mouse
  if (!bounds) return false;
  await page.waitForTimeout(100); // let scrollIntoView settle
  // Re-read position after scroll settled (coordinates may have shifted)
  await page.mouse.click(bounds.x, bounds.y);
  return true;
}

/**
 * Get all card titles currently in the DOM for a specific section.
 */
async function getCardTitlesInSection(page, sectionName) {
  return await page.evaluate((secName) => {
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      if (h2.textContent.trim() !== secName) continue;

      // Walk up from h2 to find the nearest ancestor that contains video cards.
      let container = h2;
      for (let i = 0; i < 10; i++) {
        container = container.parentElement;
        if (!container) break;
        if (container.querySelectorAll('[class*="cursor-pointer"] img').length > 0) break;
      }
      if (!container) return [];

      const cardEls = container.querySelectorAll('[class*="cursor-pointer"]');
      const titles = [];
      for (const card of cardEls) {
        const img = card.querySelector('img');
        if (!img) continue;
        const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
        if (title && title !== 'Avatar' && title !== 'Search' && !title.includes('Logo')) {
          titles.push(title);
        }
      }
      return titles;
    }
    return [];
  }, sectionName);
}

/**
 * STORY PAGE: Collect ALL video cards by navigating through every carousel.
 * Clicks the ">" arrow repeatedly in each section to discover hidden cards.
 */
async function collectStoryCards(page) {
  await scrollToLoadAll(page);

  const sectionNames = await getSectionNames(page);
  const allCards = [];
  const seenKeys = new Set(); // key = "section::title" to allow same title in different sections

  for (const secName of sectionNames) {
    log(`   Scanning carousel: ${secName}`);
    let noNewCount = 0;

    // Collect cards visible initially
    const initialTitles = await getCardTitlesInSection(page, secName);
    for (const title of initialTitles) {
      const key = `${secName}::${title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allCards.push({ title, section: secName });
      }
    }

    // Click "next" arrow repeatedly to reveal all hidden cards
    for (let clicks = 0; clicks < 80; clicks++) {
      const clicked = await clickCarouselArrow(page, secName, 'next');
      if (!clicked) break;

      // Wait for carousel animation + DOM update
      await page.waitForTimeout(1200);

      const titles = await getCardTitlesInSection(page, secName);
      let foundNew = false;
      for (const title of titles) {
        const key = `${secName}::${title}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allCards.push({ title, section: secName });
          foundNew = true;
        }
      }

      if (!foundNew) {
        noNewCount++;
        if (noNewCount >= 5) break; // be patient — some carousels scroll slowly
      } else {
        noNewCount = 0;
      }
    }

    const count = allCards.filter(c => c.section === secName).length;
    log(`      -> ${count} videos found`);
    emit({ type: 'discovery', page: 'STORY', section: secName, count, total: allCards.length });

    // Reset carousel back to start
    for (let i = 0; i < 60; i++) {
      const prevClicked = await clickCarouselArrow(page, secName, 'prev');
      if (!prevClicked) break;
      await page.waitForTimeout(150);
    }
  }

  // Final catch-all sweep: scan ALL cards on the entire page regardless of section.
  // This catches cards in featured/banner areas, or sections without h2 headings.
  await scrollToLoadAll(page);
  const allPageCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    const results = [];
    for (const card of cards) {
      const img = card.querySelector('img');
      if (!img) continue;
      const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
      if (!title || title === 'Avatar' || title === 'Search' || title.includes('Logo')) continue;

      // Try to find nearest h2 for section name
      let section = '';
      let el = card;
      for (let j = 0; j < 15; j++) {
        el = el.parentElement;
        if (!el) break;
        const h = el.querySelector(':scope > div > div > h2') ||
                  el.querySelector(':scope > div > h2') ||
                  el.querySelector(':scope > h2') ||
                  el.querySelector('h2');
        if (h) { section = h.textContent.trim(); break; }
      }
      results.push({ title, section });
    }
    return results;
  });

  let extraCount = 0;
  for (const c of allPageCards) {
    const key = `${c.section || 'STORY'}::${c.title}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      allCards.push({ title: c.title, section: c.section || 'STORY' });
      extraCount++;
    }
  }
  if (extraCount > 0) {
    log(`   Catch-all sweep found ${extraCount} additional video(s)`);
  }

  emit({ type: 'discovery-complete', page: 'STORY', cards: allCards, total: allCards.length });
  return allCards;
}

/**
 * Click the "View more" button on the MUSIC page.
 * Uses Playwright's native click (not el.click()) for React/Ant Design compatibility.
 */
async function clickViewMore(page) {
  // Playwright locator: matches button or link containing "View more" (case-insensitive)
  const btn = page.locator('button:has-text("View more"), a:has-text("View more"), button:has-text("Load more"), a:has-text("Load more"), button:has-text("Show more"), a:has-text("Show more")').first();

  try {
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      return true;
    }
  } catch {
    // Not found or not visible
  }
  return false;
}

/**
 * Collect all card titles currently visible in the MUSIC page grid.
 */
async function getAllMusicCardTitles(page) {
  return await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    const titles = [];
    for (const card of cards) {
      const img = card.querySelector('img');
      if (!img) continue;
      const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
      if (title && title !== 'Avatar' && title !== 'Search' && !title.includes('Logo')) {
        titles.push(title);
      }
    }
    return titles;
  });
}

/**
 * MUSIC PAGE: Collect ALL video cards.
 *
 * Strategy:
 *  1. Scroll to load all lazy sections
 *  2. Find all clickable tabs (EPISODES, RECOMMENDED, etc.) and click each
 *  3. Within each tab, click "View more" repeatedly
 *  4. Also check for carousel sections (same as STORY page) in case music
 *     page has mixed layouts
 *  5. Collect every unique video card found
 */
async function collectMusicCards(page) {
  const allCards = [];
  const seenTitles = new Set();

  // Helper: scan the current DOM for all video cards and add new ones
  async function harvestCards(sourceLabel) {
    const cardData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="cursor-pointer"]');
      const results = [];
      for (const card of cards) {
        const img = card.querySelector('img');
        if (!img) continue;
        const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
        if (!title || title === 'Avatar' || title === 'Search' || title.includes('Logo')) continue;

        // Walk up to find section h2
        let section = '';
        let el = card;
        for (let j = 0; j < 15; j++) {
          el = el.parentElement;
          if (!el) break;
          const h = el.querySelector(':scope > div > div > h2') ||
                    el.querySelector(':scope > div > h2') ||
                    el.querySelector(':scope > h2') ||
                    el.querySelector('h2');
          if (h) { section = h.textContent.trim(); break; }
        }
        results.push({ title, section });
      }
      return results;
    });

    let newCount = 0;
    for (const c of cardData) {
      if (!seenTitles.has(c.title)) {
        seenTitles.add(c.title);
        allCards.push({ title: c.title, section: c.section || sourceLabel });
        newCount++;
      }
    }
    return newCount;
  }

  // Step 1: Scroll to load all lazy content
  await scrollToLoadAll(page);
  await harvestCards('MUSIC');

  // Step 2: Find all tabs on the page and click each one
  const tabNames = await page.evaluate(() => {
    // Look for tab-like elements: buttons/links that look like tabs
    const candidates = document.querySelectorAll('button, a, [role="tab"]');
    const names = [];
    for (const el of candidates) {
      const text = el.textContent.trim();
      // Tabs are usually short labels
      if (text.length > 0 && text.length < 25) {
        const upper = text.toUpperCase();
        if (upper === 'EPISODES' || upper === 'RECOMMENDED' || upper === 'ALL' ||
            upper === 'LATEST' || upper === 'POPULAR' || upper === 'NEWEST') {
          names.push(text);
        }
      }
    }
    // Also look for any tab-like UI patterns (aria-role, data attributes)
    const roleTabs = document.querySelectorAll('[role="tab"]');
    for (const tab of roleTabs) {
      const text = tab.textContent.trim();
      if (text && text.length < 25 && !names.includes(text)) names.push(text);
    }
    return [...new Set(names)];
  });

  log(`   Found tabs: ${tabNames.length > 0 ? tabNames.join(', ') : '(none)'}`);

  for (const tabName of tabNames) {
    // Use Playwright native click for React/Ant Design compatibility
    const tabLocator = page.locator(`button:has-text("${tabName}"), a:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`).first();
    let tabClicked = false;
    try {
      if (await tabLocator.isVisible({ timeout: 2000 })) {
        await tabLocator.click();
        tabClicked = true;
      }
    } catch {
      tabClicked = false;
    }

    if (!tabClicked) continue;

    log(`   Scanning tab: ${tabName}`);
    await page.waitForTimeout(1500);
    await scrollToLoadAll(page);

    // Click "View more" repeatedly to load all cards in this tab
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      const beforeCount = allCards.length;
      await harvestCards(tabName);

      const clicked = await clickViewMore(page);
      if (clicked) {
        await page.waitForTimeout(1500);
      } else {
        // No "View more" — harvest once more and break
        await harvestCards(tabName);
        break;
      }
    }

    log(`      -> ${allCards.length} total videos found so far`);
  }

  // Step 3: Even without tabs, scroll and click "View more" on the default view
  log(`   Scanning default view (no tab click)...`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await scrollToLoadAll(page);

  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await harvestCards('MUSIC');

    const clicked = await clickViewMore(page);
    if (!clicked) break;
    await page.waitForTimeout(1500);
  }

  // Step 4: Check for carousel sections (in case music page also has carousels)
  const sectionNames = await getSectionNames(page);
  for (const secName of sectionNames) {
    // Try clicking carousel arrows to find more cards
    let noNewCount = 0;
    for (let clicks = 0; clicks < 40; clicks++) {
      const arrowClicked = await clickCarouselArrow(page, secName, 'next');
      if (!arrowClicked) break;
      await page.waitForTimeout(800);

      const newFound = await harvestCards(secName);
      if (newFound === 0) {
        noNewCount++;
        if (noNewCount >= 3) break;
      } else {
        noNewCount = 0;
      }
    }
  }

  log(`      -> ${allCards.length} total videos found after full scan`);
  emit({ type: 'discovery-complete', page: 'MUSIC', cards: allCards, total: allCards.length });
  return allCards;
}

/**
 * MUSIC PAGE: Load all cards by clicking EPISODES tab + "View more" until done.
 * Used before trying to find/click a specific card after navigating back.
 */
async function loadAllMusicCards(page) {
  // Scroll to load lazy content
  await scrollToLoadAll(page);

  // Click EPISODES tab first (page may default to a different view after navigation)
  const episodesTab = page.locator('button:has-text("EPISODES"), a:has-text("EPISODES"), [role="tab"]:has-text("EPISODES")').first();
  try {
    if (await episodesTab.isVisible({ timeout: 2000 })) {
      await episodesTab.click();
      await page.waitForTimeout(1500);
    }
  } catch {
    // Tab not found — continue with default view
  }

  // Scroll again after tab switch
  await scrollToLoadAll(page);

  // Click "View more" repeatedly to load all cards
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const clicked = await clickViewMore(page);
    if (!clicked) break;
    await page.waitForTimeout(1500);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/**
 * Try to find and click a card by title in the current DOM.
 * Uses Playwright's native locator.click() which performs an atomic
 * scroll-into-view + click without coordinate race conditions.
 * Falls back to coordinate-based click if the locator approach fails.
 */
async function tryClickCard(page, title) {
  // Approach 1: Playwright native locator (atomic, no coordinate race condition)
  try {
    // Build a locator that matches cards containing the exact title text
    const cardLocator = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator(`p:text-is("${title.replace(/"/g, '\\"')}")`)
    }).first();

    if (await cardLocator.isVisible({ timeout: 2000 })) {
      await cardLocator.click({ timeout: 5000 });
      return true;
    }
  } catch { /* locator approach failed, try fallback */ }

  // Also try matching by img alt text (some cards don't have <p> titles)
  try {
    const imgLocator = page.locator(`[class*="cursor-pointer"]:has(img[alt="${title.replace(/"/g, '\\"')}"])`).first();
    if (await imgLocator.isVisible({ timeout: 1000 })) {
      await imgLocator.click({ timeout: 5000 });
      return true;
    }
  } catch { /* img alt approach failed, try coordinate fallback */ }

  // Approach 2: Coordinate-based fallback (scroll → re-read coordinates → click)
  const bounds = await page.evaluate((t) => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    for (const card of cards) {
      const p = card.querySelector('p');
      const img = card.querySelector('img');
      const cardTitle = p?.textContent?.trim() || img?.alt || '';
      if (cardTitle === t) {
        card.scrollIntoView({ behavior: 'instant', block: 'center' });
        return true;
      }
    }
    return false;
  }, title);

  if (!bounds) return false;
  await page.waitForTimeout(400); // generous settle time after scroll

  // Re-read coordinates AFTER scroll has settled (avoids stale-coordinate bug)
  const coords = await page.evaluate((t) => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    for (const card of cards) {
      const p = card.querySelector('p');
      const img = card.querySelector('img');
      const cardTitle = p?.textContent?.trim() || img?.alt || '';
      if (cardTitle === t) {
        const rect = card.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, title);

  if (!coords) return false;
  await page.mouse.click(coords.x, coords.y);
  return true;
}

/**
 * STORY PAGE: Navigate the carousel until the card appears, then click it.
 */
async function findAndClickCardStory(page, title, section) {
  if (await tryClickCard(page, title)) return true;

  // Card not in DOM — click carousel "next" until it appears
  for (let i = 0; i < 60; i++) {
    const clicked = await clickCarouselArrow(page, section, 'next');
    if (!clicked) break;
    await page.waitForTimeout(500);
    if (await tryClickCard(page, title)) return true;
  }
  return false;
}

/**
 * MUSIC PAGE: Click "View more" until the card appears, then click it.
 */
async function findAndClickCardMusic(page, title) {
  if (await tryClickCard(page, title)) return true;

  // Card not loaded yet — scroll and click "View more" until it appears
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const hasMore = await clickViewMore(page);
    if (!hasMore) {
      // No "View more" button, but maybe card loaded via scroll
      if (await tryClickCard(page, title)) return true;
      break;
    }
    await page.waitForTimeout(1500);
    if (await tryClickCard(page, title)) return true;
  }
  return false;
}

/**
 * Check a single video: find its card, click it, verify the <video> loads.
 * pageType: 'STORY' (carousels) or 'MUSIC' (grid + view more)
 */
async function checkVideo(page, card, videoNum, totalLabel, pageType = 'STORY') {
  const result = {
    number: videoNum,
    title: card.title,
    section: card.section,
    page: '',
    url: '',
    hlsSrc: '',
    status: 'UNKNOWN',
    error: null,
    loadTimeMs: null,
    duration: null,
    resolution: '',
  };

  const startTime = Date.now();

  try {
    const clicked = pageType === 'MUSIC'
      ? await findAndClickCardMusic(page, card.title)
      : await findAndClickCardStory(page, card.title, card.section);

    if (!clicked) {
      result.status = 'FAIL';
      result.error = 'Could not find card to click';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    // Wait for navigation to /watch/ page
    try {
      await page.waitForURL('**/watch/**', { timeout: 10000 });
    } catch {
      await page.waitForTimeout(3000);
    }

    result.url = page.url();

    // Verify the watch page title matches the expected card title
    try {
      const watchPageTitle = await page.evaluate(() => {
        // Try breadcrumb last item, then h1/h2 heading below video
        const breadcrumbs = document.querySelectorAll('a[href], span');
        let lastCrumb = '';
        for (const el of breadcrumbs) {
          if (el.closest('nav, [class*="breadcrumb"], [class*="Breadcrumb"]')) {
            const t = el.textContent.trim();
            if (t && t.length > 1) lastCrumb = t;
          }
        }
        if (lastCrumb) return lastCrumb;
        // Fallback: look for the title heading below the video
        const heading = document.querySelector('h1, h2');
        return heading?.textContent?.trim() || '';
      });
      if (watchPageTitle && watchPageTitle !== card.title) {
        log(`   ⚠ Title mismatch: expected "${card.title}" but watch page shows "${watchPageTitle}"`);
        result.titleMismatch = watchPageTitle;
      }
    } catch { /* non-critical check */ }

    // Poll for <video> element to appear in DOM or iframes (some pages render it dynamically)
    let videoAppeared = false;
    let videoFrame = null; // the frame containing the <video> element
    for (let attempt = 0; attempt < 50; attempt++) {
      // Check main page first
      videoAppeared = await page.evaluate(() => !!document.querySelector('video'));
      if (videoAppeared) {
        videoFrame = page;
        break;
      }
      // Check all iframes
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const hasVid = await frame.evaluate(() => !!document.querySelector('video'));
          if (hasVid) {
            videoAppeared = true;
            videoFrame = frame;
            break;
          }
        } catch { /* frame may not be accessible */ }
      }
      if (videoAppeared) break;
      await page.waitForTimeout(500); // poll every 500ms, up to 15s total
    }

    if (!videoAppeared) {
      result.status = 'FAIL';
      result.error = 'No <video> element found after 25s';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    // Check whether the <video> actually loads content (using the frame where we found it)
    const checkResult = await videoFrame.evaluate(async (timeout) => {
      const vid = document.querySelector('video');
      if (!vid) return { status: 'NO_VIDEO', error: 'No <video> element found' };

      const src = vid.src || '';
      const hlsSrc = src.includes('.m3u8') ? src : '';

      if (vid.readyState >= 3 && !vid.error) {
        return {
          status: 'LOADED',
          hlsSrc,
          duration: vid.duration,
          videoWidth: vid.videoWidth,
          videoHeight: vid.videoHeight,
        };
      }

      if (vid.error) {
        const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
        return { status: 'ERROR', hlsSrc, error: `MediaError: ${codes[vid.error.code] || vid.error.code}` };
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            status: 'TIMEOUT',
            hlsSrc,
            error: `Did not load in ${timeout / 1000}s (readyState=${vid.readyState})`,
          });
        }, timeout);

        const success = () => {
          clearTimeout(timer);
          vid.removeEventListener('error', fail);
          resolve({
            status: 'LOADED',
            hlsSrc,
            duration: vid.duration,
            videoWidth: vid.videoWidth,
            videoHeight: vid.videoHeight,
          });
        };

        const fail = () => {
          clearTimeout(timer);
          vid.removeEventListener('canplay', success);
          vid.removeEventListener('loadeddata', success);
          const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
          resolve({
            status: 'ERROR',
            hlsSrc,
            error: `MediaError: ${codes[vid.error?.code] || 'Unknown'}`,
          });
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
        result.status = 'PASS';
        result.duration = checkResult.duration ? Math.round(checkResult.duration) + 's' : '';
        result.resolution = checkResult.videoWidth ? `${checkResult.videoWidth}x${checkResult.videoHeight}` : '';
        break;
      case 'ERROR':
        result.status = 'FAIL';
        result.error = checkResult.error;
        break;
      case 'TIMEOUT':
        result.status = 'TIMEOUT';
        result.error = checkResult.error;
        break;
      case 'NO_VIDEO':
        result.status = 'FAIL';
        result.error = checkResult.error;
        break;
      default:
        result.status = 'UNKNOWN';
    }

  } catch (e) {
    result.status = 'FAIL';
    result.error = e.message;
    result.loadTimeMs = Date.now() - startTime;
  }

  // Screenshot on failure
  if (CONFIG.screenshotOnFailure && (result.status === 'FAIL' || result.status === 'TIMEOUT')) {
    try {
      const safeName = (result.title || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
      const screenshotFile = `${CONFIG.screenshotDir}/${safeName}_${videoNum}.png`;
      await page.screenshot({ path: screenshotFile, fullPage: false });
      result.screenshot = screenshotFile;
    } catch { /* screenshot failed — not critical */ }
  }

  logResult(result, videoNum, totalLabel);
  emit({ type: 'check', result });
  return result;
}

function logResult(r, num, total) {
  const icon = r.status === 'PASS' ? '\u2705' : r.status === 'FAIL' ? '\u274C' : r.status === 'TIMEOUT' ? '\u23F1\uFE0F' : '\u26A0\uFE0F';
  const time = r.loadTimeMs ? `(${(r.loadTimeMs / 1000).toFixed(1)}s)` : '';
  const sec = r.section ? `[${r.section}] ` : '';
  const err = r.error ? ` -- ${r.error}` : '';
  const dur = r.duration ? ` [${r.duration}]` : '';
  log(`   [${num}/${total}] ${icon} ${sec}${r.title}${dur} ${time}${err}`);
}

function generateReport(allResults) {
  const passed = allResults.filter(r => r.status === 'PASS');
  const failed = allResults.filter(r => r.status === 'FAIL');
  const timeouts = allResults.filter(r => r.status === 'TIMEOUT');

  if (!JSON_STREAM) {
    console.log('\n' + '='.repeat(60));
    console.log('VIDEO LOAD REPORT -- go.kingdomlandkids.com');
    console.log('='.repeat(60));
    console.log(`Date:       ${new Date().toLocaleString()}`);
    console.log(`Total:      ${allResults.length} videos checked`);
    console.log(`Loaded OK:  ${passed.length}`);
    console.log(`Failed:     ${failed.length}`);
    console.log(`Timed out:  ${timeouts.length}`);
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

  // Save current report as "previous" for diff comparison (before overwriting)
  if (fs.existsSync('video-report.json')) {
    try {
      fs.copyFileSync('video-report.json', 'previous-report.json');
    } catch { /* ignore */ }
  }

  // JSON report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: allResults.length, passed: passed.length, failed: failed.length, timeouts: timeouts.length },
    failedVideos: failed.map(r => ({ num: r.number, page: r.page, section: r.section, title: r.title, url: r.url, error: r.error })),
    allResults,
  };
  emit({ type: 'complete', summary: report.summary, allResults: report.allResults });
  fs.writeFileSync('video-report.json', JSON.stringify(report, null, 2));
  log('Saved: video-report.json');

  // Append to history for trend tracking
  const historyEntry = {
    timestamp: report.timestamp,
    total: allResults.length,
    passed: passed.length,
    failed: failed.length,
    timeouts: timeouts.length,
    avgLoadTimeMs: Math.round(allResults.reduce((sum, r) => sum + (r.loadTimeMs || 0), 0) / (allResults.length || 1)),
    // Per-video summary for video detail history
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
  // Keep only last 50 entries
  if (history.length > 50) history = history.slice(-50);
  fs.writeFileSync('history.json', JSON.stringify(history, null, 2));
  log('Saved: history.json');

  // CSV report
  const csv = 'Number,Page,Section,Title,Status,URL,Error,HLS Source,Duration,Resolution,Load Time (ms)\n' +
    allResults.map(r =>
      [r.number, `"${r.page}"`, `"${r.section || ''}"`, `"${(r.title || '').replace(/"/g, '""')}"`,
       `"${r.status}"`, `"${r.url}"`, `"${(r.error || '').replace(/"/g, '""')}"`,
       `"${r.hlsSrc || ''}"`, `"${r.duration || ''}"`, `"${r.resolution || ''}"`, r.loadTimeMs || ''].join(',')
    ).join('\n');
  fs.writeFileSync('video-report.csv', csv);
  log('Saved: video-report.csv');

  // Failed videos list (plain text for quick reference)
  const failedAndTimeout = [...failed, ...timeouts];
  if (failedAndTimeout.length > 0) {
    const lines = [
      `FAILED VIDEOS — go.kingdomlandkids.com`,
      `Generated: ${new Date().toLocaleString()}`,
      `Total failed: ${failed.length} | Timed out: ${timeouts.length}`,
      '='.repeat(60),
      '',
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
}

/**
 * Scan STORY page: discover all carousel cards, then check each one.
 */
async function scanStoryPage(page, pageUrl, allResults, startNum) {
  if (!JSON_STREAM) console.log('-'.repeat(60));
  log('Scanning STORY page...');
  if (!JSON_STREAM) console.log('-'.repeat(60));

  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(2000);

  log('   Phase 1: Discovering all video cards (navigating carousels)...');
  let cards = await collectStoryCards(page);
  log(`   Found ${cards.length} total video cards on STORY page`);

  // Filter to specific titles if "Check Failed Only" was used
  if (TITLES_FILTER) {
    cards = cards.filter(c => TITLES_FILTER.has(c.title));
    log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
  }

  const sections = [...new Set(cards.map(c => c.section).filter(Boolean))];
  log(`   Sections: ${sections.join(', ')}\n`);

  let videoNum = startNum;
  const totalStr = (startNum + cards.length).toString();

  for (const card of cards) {
    videoNum++;

    if (page.url().includes('/watch/')) {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
      await page.waitForTimeout(2000);
      await scrollToLoadAll(page);
    }

    const result = await checkVideo(page, card, videoNum, totalStr, 'STORY');
    result.page = 'STORY';
    allResults.push(result);
  }

  return videoNum;
}

/**
 * Scan MUSIC page: discover all grid cards (View more + tabs), then check each.
 */
async function scanMusicPage(page, pageUrl, allResults, startNum) {
  if (!JSON_STREAM) console.log('-'.repeat(60));
  log('Scanning MUSIC page...');
  if (!JSON_STREAM) console.log('-'.repeat(60));

  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(2000);

  log('   Phase 1: Discovering all video cards (View more + tabs)...');
  let cards = await collectMusicCards(page);
  log(`   Found ${cards.length} total video cards on MUSIC page`);

  // Filter to specific titles if "Check Failed Only" was used
  if (TITLES_FILTER) {
    cards = cards.filter(c => TITLES_FILTER.has(c.title));
    log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
  }
  log('');

  let videoNum = startNum;
  const totalStr = (startNum + cards.length).toString();

  for (const card of cards) {
    videoNum++;

    if (page.url().includes('/watch/')) {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
      await page.waitForTimeout(2000);
      // Re-load all cards (click "View more" again after page reload)
      await loadAllMusicCards(page);
    }

    const result = await checkVideo(page, card, videoNum, totalStr, 'MUSIC');
    result.page = 'MUSIC';
    allResults.push(result);
  }

  return videoNum;
}

async function main() {
  if (!JSON_STREAM) {
    console.log('\nKingdomland Playwatch -- Video Load Checker');
    console.log('='.repeat(60));
    console.log(`Mode:  ${DEBUG ? 'Debug (visible browser)' : 'Headless'}`);
    console.log(`Pages: ${STORY_ONLY ? 'STORY only' : MUSIC_ONLY ? 'MUSIC only' : 'STORY + MUSIC'}`);
    console.log('='.repeat(60));
  }

  const browser = await chromium.launch({ headless: !DEBUG, slowMo: DEBUG ? 200 : 0 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const allResults = [];
  let videoNum = 0;

  try {
    await login(page);

    if (!MUSIC_ONLY) {
      videoNum = await scanStoryPage(page, CONFIG.baseUrl, allResults, videoNum);
    }

    if (!STORY_ONLY) {
      videoNum = await scanMusicPage(page, CONFIG.musicUrl, allResults, videoNum);
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
    const retryTargets = allResults.filter(r => r.status === 'FAIL' || r.status === 'TIMEOUT');
    if (retryTargets.length > 0 && retryTargets.length <= 20) {
      log(`\nRetrying ${retryTargets.length} failed/timed out video(s)...`);
      emit({ type: 'status', message: `Retrying ${retryTargets.length} failed video(s)...` });

      const browser2 = await chromium.launch({ headless: !DEBUG, slowMo: DEBUG ? 200 : 0 });
      const context2 = await browser2.newContext({ viewport: { width: 1400, height: 900 } });
      const page2 = await context2.newPage();

      try {
        await login(page2);

        for (const orig of retryTargets) {
          const pageUrl = orig.page === 'MUSIC' ? CONFIG.musicUrl : CONFIG.baseUrl;

          if (page2.url().includes('/watch/')) {
            await page2.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
            await page2.waitForTimeout(2000);
          }

          if (!page2.url().includes(pageUrl.replace(CONFIG.baseUrl, ''))) {
            await page2.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
            await page2.waitForTimeout(2000);
          }

          if (orig.page === 'MUSIC') await loadAllMusicCards(page2);
          else await scrollToLoadAll(page2);

          const retryResult = await checkVideo(page2, { title: orig.title, section: orig.section }, orig.number, `${allResults.length} (retry)`, orig.page);
          retryResult.page = orig.page;

          // If retry passed, update the original result
          if (retryResult.status === 'PASS') {
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

  if (allResults.length > 0) {
    generateReport(allResults);
  } else {
    log('\nNo videos checked. Run with --debug to troubleshoot.');
  }
}

main().catch(console.error);
