/**
 * Video Load Checker for go.kingdomlandkids.com (TypeScript version)
 *
 * Navigates through ALL carousel sections (clicking > arrows) to discover
 * every video card, then checks each one loads properly.
 *
 * SETUP:
 *   npm init -y
 *   npm install playwright
 *   npx playwright install chromium
 *   npx playwright install firefox webkit   # optional: multi-browser
 *
 * USAGE:
 *   node dist/src/check-videos.js                    # headless Chromium (default)
 *   node dist/src/check-videos.js --debug            # visible browser
 *   node dist/src/check-videos.js --story            # only STORY page
 *   node dist/src/check-videos.js --music            # only MUSIC page
 *   node dist/src/check-videos.js --browser=firefox  # use Firefox
 *   node dist/src/check-videos.js --browser=webkit   # use WebKit (Safari)
 */

import * as playwright from 'playwright';
import type { Page, Frame, BrowserType } from 'playwright';
import fs from 'fs';
import path from 'path';
import { STATUS, PAGE } from '../lib/constants';
import type { StatusType, PageType } from '../lib/constants';
import { sendSlackFailureAlert } from '../lib/slack';
import * as db from '../lib/db';
import type { VideoResult, CheckSummary, PerformanceAlert, CheckReport, HistoryEntry } from './types';

// ============== CONFIG ==============
interface Config {
  baseUrl: string;
  loginUrl: string;
  musicUrl: string;
  username: string;
  password: string;
  emailSelector: string;
  passwordSelector: string;
  loginButtonSelector: string;
  videoLoadTimeout: number;
  navigationTimeout: number;
  retryFailures: boolean;
  screenshotOnFailure: boolean;
  screenshotDir: string;
  performanceThresholds: {
    warning: number;
    critical: number;
  };
}

const CONFIG: Config = {
  baseUrl: 'https://go.kingdomlandkids.com',
  loginUrl: 'https://go.kingdomlandkids.com/login',
  musicUrl: 'https://go.kingdomlandkids.com/music',

  username: process.env.KL_USERNAME || '',
  password: process.env.KL_PASSWORD || '',

  emailSelector: 'input[type="text"]',
  passwordSelector: 'input[type="password"]',
  loginButtonSelector: 'button[type="submit"]',

  videoLoadTimeout: 20000,
  navigationTimeout: 30000,

  retryFailures: true,

  screenshotOnFailure: true,
  screenshotDir: 'screenshots',

  performanceThresholds: {
    warning: parseInt(process.env.PERF_WARN_MS || '', 10) || 8000,
    critical: parseInt(process.env.PERF_CRIT_MS || '', 10) || 15000,
  },
};
// ====================================

const DEBUG = process.argv.includes('--debug');
const STORY_ONLY = process.argv.includes('--story');
const MUSIC_ONLY = process.argv.includes('--music');
const JSON_STREAM = process.argv.includes('--json-stream');

// Browser engine selection
const BROWSER_ARG = (process.argv.find(a => a.startsWith('--browser=')) || '').split('=')[1];
const BROWSER_NAME = (BROWSER_ARG || process.env.BROWSER || 'chromium').toLowerCase();
const SUPPORTED_BROWSERS: Record<string, BrowserType> = {
  chromium: playwright.chromium,
  firefox: playwright.firefox,
  webkit: playwright.webkit,
};
const browserEngine = SUPPORTED_BROWSERS[BROWSER_NAME];
if (!browserEngine) {
  console.error(`Unknown browser: "${BROWSER_NAME}". Supported: chromium, firefox, webkit`);
  process.exit(1);
}

// Titles filter for "Check Failed Only"
let TITLES_FILTER: Set<string> | null = null;
if (process.env.CHECK_TITLES) {
  try { TITLES_FILTER = new Set(JSON.parse(process.env.CHECK_TITLES)); } catch { TITLES_FILTER = null; }
}

// Ensure screenshot directory exists
if (CONFIG.screenshotOnFailure) {
  const screenshotPath = path.join(__dirname, '..', CONFIG.screenshotDir);
  if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath, { recursive: true });
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

function emit(obj: StreamEvent): void {
  if (JSON_STREAM) process.stdout.write(JSON.stringify(obj) + '\n');
}

function log(msg: string): void {
  if (JSON_STREAM) {
    emit({ type: 'status', message: msg });
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }
}

interface CardInfo {
  title: string;
  section: string;
}

interface CheckVideoResult extends VideoResult {
  screenshot?: string;
  titleMismatch?: string;
}

async function login(page: Page): Promise<void> {
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

async function scrollToLoadAll(page: Page): Promise<void> {
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

async function getSectionNames(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('h2'))
      .map(h => h.textContent?.trim() || '')
      .filter(Boolean);
  });
}

async function clickCarouselArrow(page: Page, sectionName: string, direction: 'next' | 'prev' = 'next'): Promise<boolean> {
  const bounds = await page.evaluate(({ secName, dir }: { secName: string; dir: string }) => {
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      if (h2.textContent?.trim() !== secName) continue;

      let headerArea: HTMLElement | null = h2.parentElement;
      for (let depth = 0; depth < 5; depth++) {
        if (!headerArea) break;
        const svgCount = headerArea.querySelectorAll('svg').length;
        const btnCount = headerArea.querySelectorAll('button, [role="button"]').length;
        if (svgCount >= 2 || btnCount >= 2) break;
        headerArea = headerArea.parentElement;
      }
      if (!headerArea) return null;

      function getCenter(el: Element): { x: number; y: number } {
        el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'nearest' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }

      const buttons = Array.from(headerArea.querySelectorAll('button, [role="button"]'));
      const arrowBtns = buttons.filter(btn => {
        const hasSvg = btn.querySelector('svg');
        const text = btn.textContent?.trim() || '';
        const isArrowChar = /^[<>‹›←→❮❯\u2039\u203A\u2190\u2192]$/.test(text);
        return hasSvg || isArrowChar;
      });
      if (arrowBtns.length >= 2) {
        const idx = dir === 'next' ? arrowBtns.length - 1 : 0;
        return getCenter(arrowBtns[idx]);
      }

      const svgs = Array.from(headerArea.querySelectorAll('svg'));
      if (svgs.length >= 2) {
        const idx = dir === 'next' ? svgs.length - 1 : 0;
        const target = svgs[idx].closest('button') || svgs[idx].closest('[role="button"]') || svgs[idx].parentElement;
        return target ? getCenter(target) : null;
      }

      const allEls = Array.from(headerArea.querySelectorAll('*'));
      const rightChars = ['>', '\u203A', '\u2192', '\u276F'];
      const leftChars = ['<', '\u2039', '\u2190', '\u276E'];
      const targetChars = dir === 'next' ? rightChars : leftChars;
      for (const el of allEls) {
        if (el.children.length > 0) continue;
        const text = el.textContent?.trim() || '';
        if (targetChars.includes(text)) {
          const clickTarget = el.closest('button') || el;
          return getCenter(clickTarget);
        }
      }

      return null;
    }
    return null;
  }, { secName: sectionName, dir: direction });

  if (!bounds) return false;
  await page.waitForTimeout(100);
  await page.mouse.click(bounds.x, bounds.y);
  return true;
}

async function getCardTitlesInSection(page: Page, sectionName: string): Promise<string[]> {
  return await page.evaluate((secName: string) => {
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      if (h2.textContent?.trim() !== secName) continue;

      let container: HTMLElement | null = h2 as HTMLElement;
      for (let i = 0; i < 10; i++) {
        container = container!.parentElement;
        if (!container) break;
        if (container.querySelectorAll('[class*="cursor-pointer"] img').length > 0) break;
      }
      if (!container) return [];

      const cardEls = container.querySelectorAll('[class*="cursor-pointer"]');
      const titles: string[] = [];
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

async function collectStoryCards(page: Page): Promise<CardInfo[]> {
  await scrollToLoadAll(page);

  const sectionNames = await getSectionNames(page);
  const allCards: CardInfo[] = [];
  const seenKeys = new Set<string>();

  for (const secName of sectionNames) {
    log(`   Scanning carousel: ${secName}`);
    let noNewCount = 0;

    const initialTitles = await getCardTitlesInSection(page, secName);
    for (const title of initialTitles) {
      const key = `${secName}::${title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allCards.push({ title, section: secName });
      }
    }

    for (let clicks = 0; clicks < 80; clicks++) {
      const clicked = await clickCarouselArrow(page, secName, 'next');
      if (!clicked) break;

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
        if (noNewCount >= 5) break;
      } else {
        noNewCount = 0;
      }
    }

    const count = allCards.filter(c => c.section === secName).length;
    log(`      -> ${count} videos found`);
    emit({ type: 'discovery', page: PAGE.STORY, section: secName, count, total: allCards.length });

    for (let i = 0; i < 60; i++) {
      const prevClicked = await clickCarouselArrow(page, secName, 'prev');
      if (!prevClicked) break;
      await page.waitForTimeout(150);
    }
  }

  // Final catch-all sweep
  await scrollToLoadAll(page);
  const allPageCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    const results: Array<{ title: string; section: string }> = [];
    for (const card of cards) {
      const img = card.querySelector('img');
      if (!img) continue;
      const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
      if (!title || title === 'Avatar' || title === 'Search' || title.includes('Logo')) continue;

      let section = '';
      let el: HTMLElement | null = card as HTMLElement;
      for (let j = 0; j < 15; j++) {
        el = el!.parentElement;
        if (!el) break;
        const h = el.querySelector(':scope > div > div > h2') ||
                  el.querySelector(':scope > div > h2') ||
                  el.querySelector(':scope > h2') ||
                  el.querySelector('h2');
        if (h) { section = h.textContent?.trim() || ''; break; }
      }
      results.push({ title, section });
    }
    return results;
  });

  let extraCount = 0;
  for (const c of allPageCards) {
    const key = `${c.section || PAGE.STORY}::${c.title}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      allCards.push({ title: c.title, section: c.section || PAGE.STORY });
      extraCount++;
    }
  }
  if (extraCount > 0) {
    log(`   Catch-all sweep found ${extraCount} additional video(s)`);
  }

  emit({ type: 'discovery-complete', page: PAGE.STORY, cards: allCards, total: allCards.length });
  return allCards;
}

async function clickViewMore(page: Page): Promise<boolean> {
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

async function getAllMusicCardTitles(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    const titles: string[] = [];
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

async function collectMusicCards(page: Page): Promise<CardInfo[]> {
  const allCards: CardInfo[] = [];
  const seenTitles = new Set<string>();

  async function harvestCards(sourceLabel: string): Promise<number> {
    const cardData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="cursor-pointer"]');
      const results: Array<{ title: string; section: string }> = [];
      for (const card of cards) {
        const img = card.querySelector('img');
        if (!img) continue;
        const title = card.querySelector('p')?.textContent?.trim() || img.alt || '';
        if (!title || title === 'Avatar' || title === 'Search' || title.includes('Logo')) continue;

        let section = '';
        let el: HTMLElement | null = card as HTMLElement;
        for (let j = 0; j < 15; j++) {
          el = el!.parentElement;
          if (!el) break;
          const h = el.querySelector(':scope > div > div > h2') ||
                    el.querySelector(':scope > div > h2') ||
                    el.querySelector(':scope > h2') ||
                    el.querySelector('h2');
          if (h) { section = h.textContent?.trim() || ''; break; }
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

  await scrollToLoadAll(page);
  await harvestCards(PAGE.MUSIC);

  const tabNames = await page.evaluate(() => {
    const candidates = document.querySelectorAll('button, a, [role="tab"]');
    const names: string[] = [];
    for (const el of candidates) {
      const text = el.textContent?.trim() || '';
      if (text.length > 0 && text.length < 25) {
        const upper = text.toUpperCase();
        if (upper === 'EPISODES' || upper === 'RECOMMENDED' || upper === 'ALL' ||
            upper === 'LATEST' || upper === 'POPULAR' || upper === 'NEWEST') {
          names.push(text);
        }
      }
    }
    const roleTabs = document.querySelectorAll('[role="tab"]');
    for (const tab of roleTabs) {
      const text = tab.textContent?.trim() || '';
      if (text && text.length < 25 && !names.includes(text)) names.push(text);
    }
    return [...new Set(names)];
  });

  log(`   Found tabs: ${tabNames.length > 0 ? tabNames.join(', ') : '(none)'}`);

  for (const tabName of tabNames) {
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

    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      await harvestCards(tabName);

      const clicked = await clickViewMore(page);
      if (clicked) {
        await page.waitForTimeout(1500);
      } else {
        await harvestCards(tabName);
        break;
      }
    }

    log(`      -> ${allCards.length} total videos found so far`);
  }

  log(`   Scanning default view (no tab click)...`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await scrollToLoadAll(page);

  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await harvestCards(PAGE.MUSIC);

    const clicked = await clickViewMore(page);
    if (!clicked) break;
    await page.waitForTimeout(1500);
  }

  const sectionNames = await getSectionNames(page);
  for (const secName of sectionNames) {
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
  emit({ type: 'discovery-complete', page: PAGE.MUSIC, cards: allCards, total: allCards.length });
  return allCards;
}

async function loadAllMusicCards(page: Page): Promise<void> {
  await scrollToLoadAll(page);

  const episodesTab = page.locator('button:has-text("EPISODES"), a:has-text("EPISODES"), [role="tab"]:has-text("EPISODES")').first();
  try {
    if (await episodesTab.isVisible({ timeout: 2000 })) {
      await episodesTab.click();
      await page.waitForTimeout(1500);
    }
  } catch {
    // Tab not found
  }

  await scrollToLoadAll(page);

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

async function tryClickCard(page: Page, title: string): Promise<boolean> {
  try {
    const cardLocator = page.locator('[class*="cursor-pointer"]').filter({
      has: page.locator(`p:text-is("${title.replace(/"/g, '\\"')}")`)
    }).first();

    if (await cardLocator.isVisible({ timeout: 2000 })) {
      await cardLocator.click({ timeout: 5000 });
      return true;
    }
  } catch { /* locator approach failed */ }

  try {
    const imgLocator = page.locator(`[class*="cursor-pointer"]:has(img[alt="${title.replace(/"/g, '\\"')}"])`).first();
    if (await imgLocator.isVisible({ timeout: 1000 })) {
      await imgLocator.click({ timeout: 5000 });
      return true;
    }
  } catch { /* img alt approach failed */ }

  const bounds = await page.evaluate((t: string) => {
    const cards = document.querySelectorAll('[class*="cursor-pointer"]');
    for (const card of cards) {
      const p = card.querySelector('p');
      const img = card.querySelector('img');
      const cardTitle = p?.textContent?.trim() || img?.alt || '';
      if (cardTitle === t) {
        card.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
        return true;
      }
    }
    return false;
  }, title);

  if (!bounds) return false;
  await page.waitForTimeout(400);

  const coords = await page.evaluate((t: string) => {
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

async function findAndClickCardStory(page: Page, title: string, section: string): Promise<boolean> {
  if (await tryClickCard(page, title)) return true;

  for (let i = 0; i < 60; i++) {
    const clicked = await clickCarouselArrow(page, section, 'next');
    if (!clicked) break;
    await page.waitForTimeout(500);
    if (await tryClickCard(page, title)) return true;
  }
  return false;
}

async function findAndClickCardMusic(page: Page, title: string): Promise<boolean> {
  if (await tryClickCard(page, title)) return true;

  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const hasMore = await clickViewMore(page);
    if (!hasMore) {
      if (await tryClickCard(page, title)) return true;
      break;
    }
    await page.waitForTimeout(1500);
    if (await tryClickCard(page, title)) return true;
  }
  return false;
}

interface VideoCheckResult {
  status: string;
  hlsSrc?: string;
  error?: string;
  duration?: number;
  videoWidth?: number;
  videoHeight?: number;
}

async function checkVideo(
  page: Page,
  card: CardInfo,
  videoNum: number,
  totalLabel: string,
  pageType: string = PAGE.STORY
): Promise<CheckVideoResult> {
  const result: CheckVideoResult = {
    number: videoNum,
    title: card.title,
    section: card.section,
    page: '',
    url: '',
    hlsSrc: '',
    status: STATUS.UNKNOWN,
    error: '',
    loadTimeMs: 0,
    duration: '',
    resolution: '',
  };

  const startTime = Date.now();

  try {
    const clicked = pageType === PAGE.MUSIC
      ? await findAndClickCardMusic(page, card.title)
      : await findAndClickCardStory(page, card.title, card.section);

    if (!clicked) {
      result.status = STATUS.FAIL;
      result.error = 'Could not find card to click';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    try {
      await page.waitForURL('**/watch/**', { timeout: 10000 });
    } catch {
      await page.waitForTimeout(3000);
    }

    result.url = page.url();

    // Verify watch page title
    try {
      const watchPageTitle = await page.evaluate(() => {
        const breadcrumbs = document.querySelectorAll('a[href], span');
        let lastCrumb = '';
        for (const el of breadcrumbs) {
          if (el.closest('nav, [class*="breadcrumb"], [class*="Breadcrumb"]')) {
            const t = el.textContent?.trim() || '';
            if (t && t.length > 1) lastCrumb = t;
          }
        }
        if (lastCrumb) return lastCrumb;
        const heading = document.querySelector('h1, h2');
        return heading?.textContent?.trim() || '';
      });
      if (watchPageTitle && watchPageTitle !== card.title) {
        log(`   \u26A0 Title mismatch: expected "${card.title}" but watch page shows "${watchPageTitle}"`);
        result.titleMismatch = watchPageTitle;
      }
    } catch { /* non-critical */ }

    // Poll for <video> element
    let videoAppeared = false;
    let videoFrame: Page | Frame = page;
    for (let attempt = 0; attempt < 50; attempt++) {
      videoAppeared = await page.evaluate(() => !!document.querySelector('video'));
      if (videoAppeared) {
        videoFrame = page;
        break;
      }
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
      await page.waitForTimeout(500);
    }

    if (!videoAppeared) {
      result.status = STATUS.FAIL;
      result.error = 'No <video> element found after 25s';
      result.loadTimeMs = Date.now() - startTime;
      logResult(result, videoNum, totalLabel);
      emit({ type: 'check', result });
      return result;
    }

    const checkResult: VideoCheckResult = await videoFrame.evaluate(async (timeout: number) => {
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
        const codes: Record<number, string> = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
        return { status: 'ERROR', hlsSrc, error: `MediaError: ${codes[vid.error.code] || vid.error.code}` };
      }

      return new Promise<VideoCheckResult>((resolve) => {
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
          const codes: Record<number, string> = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
          resolve({
            status: 'ERROR',
            hlsSrc,
            error: `MediaError: ${codes[vid.error?.code || 0] || 'Unknown'}`,
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
        result.status = STATUS.PASS;
        result.duration = checkResult.duration ? Math.round(checkResult.duration) + 's' : '';
        result.resolution = checkResult.videoWidth ? `${checkResult.videoWidth}x${checkResult.videoHeight}` : '';
        break;
      case 'ERROR':
        result.status = STATUS.FAIL;
        result.error = checkResult.error || '';
        break;
      case 'TIMEOUT':
        result.status = STATUS.TIMEOUT;
        result.error = checkResult.error || '';
        break;
      case 'NO_VIDEO':
        result.status = STATUS.FAIL;
        result.error = checkResult.error || '';
        break;
      default:
        result.status = STATUS.UNKNOWN;
    }

  } catch (e: unknown) {
    result.status = STATUS.FAIL;
    result.error = e instanceof Error ? e.message : String(e);
    result.loadTimeMs = Date.now() - startTime;
  }

  // Screenshot on failure
  if (CONFIG.screenshotOnFailure && (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT)) {
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

function logResult(r: CheckVideoResult, num: number, total: string): void {
  const icon = r.status === STATUS.PASS ? '\u2705' : r.status === STATUS.FAIL ? '\u274C' : r.status === STATUS.TIMEOUT ? '\u23F1\uFE0F' : '\u26A0\uFE0F';
  const time = r.loadTimeMs ? `(${(r.loadTimeMs / 1000).toFixed(1)}s)` : '';
  const sec = r.section ? `[${r.section}] ` : '';
  const err = r.error ? ` -- ${r.error}` : '';
  const dur = r.duration ? ` [${r.duration}]` : '';
  log(`   [${num}/${total}] ${icon} ${sec}${r.title}${dur} ${time}${err}`);
}

function generateReport(allResults: CheckVideoResult[]): void {
  const passed = allResults.filter(r => r.status === STATUS.PASS);
  const failed = allResults.filter(r => r.status === STATUS.FAIL);
  const timeouts = allResults.filter(r => r.status === STATUS.TIMEOUT);

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

  // Save current report as "previous"
  if (fs.existsSync('video-report.json')) {
    try { fs.copyFileSync('video-report.json', 'previous-report.json'); } catch { /* ignore */ }
  }

  // Performance threshold analysis
  const perfAlerts: PerformanceAlert[] = allResults
    .filter(r => r.loadTimeMs && r.loadTimeMs > CONFIG.performanceThresholds.warning)
    .map(r => ({
      title: r.title,
      section: r.section || '',
      loadTimeMs: r.loadTimeMs,
      level: (r.loadTimeMs >= CONFIG.performanceThresholds.critical ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING',
    }))
    .sort((a, b) => b.loadTimeMs - a.loadTimeMs);

  const report: CheckReport = {
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

  // Save to SQLite
  try {
    db.saveRun(report);
    log('Saved: SQLite database');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`SQLite save failed (non-critical): ${message}`);
  }

  // Append to history
  const historyEntry: HistoryEntry = {
    timestamp: report.timestamp,
    total: allResults.length,
    passed: passed.length,
    failed: failed.length,
    timeouts: timeouts.length,
    avgLoadTimeMs: Math.round(allResults.reduce((sum, r) => sum + (r.loadTimeMs || 0), 0) / (allResults.length || 1)),
    videos: allResults.map(r => ({
      title: r.title,
      section: r.section || '',
      page: r.page || '',
      status: r.status,
      loadTimeMs: r.loadTimeMs || 0,
      error: r.error || '',
    })),
  };
  let history: HistoryEntry[] = [];
  if (fs.existsSync('history.json')) {
    try { history = JSON.parse(fs.readFileSync('history.json', 'utf-8')); } catch { history = []; }
  }
  history.push(historyEntry);
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

  // Failed videos list
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

  // Performance threshold console output
  if (!JSON_STREAM && perfAlerts.length > 0) {
    console.log(`\nPERFORMANCE ALERTS (>${CONFIG.performanceThresholds.warning / 1000}s warning, >${CONFIG.performanceThresholds.critical / 1000}s critical):`);
    console.log('-'.repeat(40));
    for (const a of perfAlerts) {
      const icon = a.level === 'CRITICAL' ? '\uD83D\uDD34' : '\uD83D\uDFE1';
      console.log(`  ${icon} [${a.level}] ${a.title} — ${(a.loadTimeMs / 1000).toFixed(1)}s`);
    }
  }

  // Send Slack alert
  if (failed.length > 0 || perfAlerts.length > 0) {
    sendSlackFailureAlert(
      report.failedVideos,
      report.summary,
      perfAlerts
    ).catch((err: Error) => log(`Slack alert failed (non-critical): ${err.message}`));
  }
}

async function scanStoryPage(page: Page, pageUrl: string, allResults: CheckVideoResult[], startNum: number): Promise<number> {
  if (!JSON_STREAM) console.log('-'.repeat(60));
  log('Scanning STORY page...');
  if (!JSON_STREAM) console.log('-'.repeat(60));

  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(2000);

  log('   Phase 1: Discovering all video cards (navigating carousels)...');
  let cards = await collectStoryCards(page);
  log(`   Found ${cards.length} total video cards on STORY page`);

  if (TITLES_FILTER) {
    cards = cards.filter(c => TITLES_FILTER!.has(c.title));
    log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
  }

  const sections = [...new Set(cards.map(c => c.section).filter(Boolean))];
  log(`   Sections: ${sections.join(', ')}\n`);

  let videoNum = startNum;
  const totalStr = (startNum + cards.length).toString();
  let consecutiveFails = 0;

  for (const card of cards) {
    videoNum++;

    const needsReload = page.url().includes('/watch/') || consecutiveFails >= 2;
    if (needsReload) {
      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
        await page.waitForTimeout(2000);
        await scrollToLoadAll(page);
      } catch {
        log('   \u26A0 Failed to reload story page, retrying...');
        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigationTimeout });
          await page.waitForTimeout(3000);
          await scrollToLoadAll(page);
        } catch { /* continue anyway */ }
      }
      consecutiveFails = 0;
    }

    const result = await checkVideo(page, card, videoNum, totalStr, PAGE.STORY);
    result.page = PAGE.STORY;
    allResults.push(result);

    if (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT) {
      consecutiveFails++;
    } else {
      consecutiveFails = 0;
    }
  }

  return videoNum;
}

async function scanMusicPage(page: Page, pageUrl: string, allResults: CheckVideoResult[], startNum: number): Promise<number> {
  if (!JSON_STREAM) console.log('-'.repeat(60));
  log('Scanning MUSIC page...');
  if (!JSON_STREAM) console.log('-'.repeat(60));

  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(2000);

  log('   Phase 1: Discovering all video cards (View more + tabs)...');
  let cards = await collectMusicCards(page);
  log(`   Found ${cards.length} total video cards on MUSIC page`);

  if (TITLES_FILTER) {
    cards = cards.filter(c => TITLES_FILTER!.has(c.title));
    log(`   Filtered to ${cards.length} videos (re-checking failed only)`);
  }
  log('');

  let videoNum = startNum;
  const totalStr = (startNum + cards.length).toString();
  let consecutiveFails = 0;

  for (const card of cards) {
    videoNum++;

    const needsReload = page.url().includes('/watch/') || consecutiveFails >= 2;
    if (needsReload) {
      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
        await page.waitForTimeout(2000);
        await loadAllMusicCards(page);
      } catch {
        log('   \u26A0 Failed to reload music page, retrying...');
        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigationTimeout });
          await page.waitForTimeout(3000);
          await loadAllMusicCards(page);
        } catch { /* continue anyway */ }
      }
      consecutiveFails = 0;
    }

    const result = await checkVideo(page, card, videoNum, totalStr, PAGE.MUSIC);
    result.page = PAGE.MUSIC;
    allResults.push(result);

    if (result.status === STATUS.FAIL || result.status === STATUS.TIMEOUT) {
      consecutiveFails++;
    } else {
      consecutiveFails = 0;
    }
  }

  return videoNum;
}

async function main(): Promise<void> {
  if (!JSON_STREAM) {
    console.log('\nKingdomland Playwatch -- Video Load Checker');
    console.log('='.repeat(60));
    console.log(`Mode:    ${DEBUG ? 'Debug (visible browser)' : 'Headless'}`);
    console.log(`Browser: ${BROWSER_NAME}`);
    console.log(`Pages:   ${STORY_ONLY ? 'STORY only' : MUSIC_ONLY ? 'MUSIC only' : 'STORY + MUSIC'}`);
    console.log('='.repeat(60));
  }

  const browser = await browserEngine.launch({ headless: !DEBUG, slowMo: DEBUG ? 200 : 0 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const allResults: CheckVideoResult[] = [];
  let videoNum = 0;

  try {
    await login(page);

    if (!MUSIC_ONLY) {
      videoNum = await scanStoryPage(page, CONFIG.baseUrl, allResults, videoNum);
    }

    if (!STORY_ONLY) {
      videoNum = await scanMusicPage(page, CONFIG.musicUrl, allResults, videoNum);
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal error: ${message}`);
    if (DEBUG && error instanceof Error) {
      console.error(error.stack);
      log('Browser stays open 30s for inspection...');
      await page.waitForTimeout(30000);
    }
  } finally {
    await browser.close();
  }

  // Retry failed/timed out videos
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

        for (const orig of retryTargets) {
          const pageUrl = orig.page === PAGE.MUSIC ? CONFIG.musicUrl : CONFIG.baseUrl;

          if (page2.url().includes('/watch/')) {
            await page2.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
            await page2.waitForTimeout(2000);
          }

          if (!page2.url().includes(pageUrl.replace(CONFIG.baseUrl, ''))) {
            await page2.goto(pageUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigationTimeout });
            await page2.waitForTimeout(2000);
          }

          if (orig.page === PAGE.MUSIC) await loadAllMusicCards(page2);
          else await scrollToLoadAll(page2);

          const retryResult = await checkVideo(page2, { title: orig.title, section: orig.section }, orig.number, `${allResults.length} (retry)`, orig.page);
          retryResult.page = orig.page;

          if (retryResult.status === STATUS.PASS) {
            const idx = allResults.findIndex(r => r.number === orig.number);
            if (idx !== -1) {
              allResults[idx] = retryResult;
              log(`   Retry SUCCESS: ${orig.title}`);
            }
          }
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        log(`Retry error: ${message}`);
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
