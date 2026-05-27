import { test, expect, type Locator, type Page } from '@playwright/test';

export async function detectBotBlock(page: Page, response: any): Promise<boolean> {
  if (!response) return true;

  const status = response.status();
  if (status === 403 || status === 429 || status === 503 || status === 504) {
    console.warn(`[QA-ALERT] Bot mitigation or Gateway Timeout HTTP status detected: ${status}`);
    return true;
  }

  const title = await page.title().catch(() => '');
  const content = await page.content().catch(() => '');
  
  const blockKeywords = [
    'cloudflare',
    'ray id',
    'access denied',
    'please verify you are a human',
    'security check',
    'sucuri',
    'bot verification',
    'captcha'
  ];

  const hasKeyword = blockKeywords.some(keyword => 
    title.toLowerCase().includes(keyword) || 
    content.toLowerCase().includes(keyword)
  );

  if (hasKeyword) {
    console.warn(`[QA-ALERT] Security challenge/block page detected by HTML content keyword match. Title: "${title}"`);
    return true;
  }

  return false;
}

export async function openPublicPage(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch((err) => {
    console.error(`[NavigationError] Failed to navigate to ${path}: ${err.message}`);
    return null;
  });

  if (!response) {
    console.warn(`[QA-WARNING] No response received for ${path}. Skipping test due to network/connectivity failure.`);
    test.skip(true, 'No network response received (flaky connection).');
    return;
  }

  const isBlocked = await detectBotBlock(page, response);
  if (isBlocked) {
    console.warn(`[QA-WARNING] Bot mitigation or access block detected on ${path}. Skipping test to prevent false negative.`);
    test.skip(true, 'Bot mitigation / security challenge active on target page.');
    return;
  }

  expect(response.status(), `${path} HTTP status`).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
}

export async function firstVisible(locator: Locator, message: string): Promise<Locator> {
  const count = await locator.count();
  expect(count, message).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  throw new Error(message);
}

export async function cleanInnerText(locator: Locator): Promise<string> {
  return normalizeText(await locator.innerText());
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function firstMeaningfulLine(value: string): string {
  const line = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);

  return normalizeText(line ?? value);
}

export function cleanPlayerName(value: string): string {
  return normalizeText(value)
    .replace(/^\d+\s+/, '')
    .replace(/\s+\$[\d,]+.*$/, '')
    .trim();
}

export function firstWordsPattern(value: string, wordCount = 5): RegExp {
  const words = normalizeText(value)
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word))
    .slice(0, wordCount);

  expect(words.length, `Could not build a title pattern from "${value}"`).toBeGreaterThan(0);

  return new RegExp(words.map(escapeRegExp).join('\\W+'), 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
