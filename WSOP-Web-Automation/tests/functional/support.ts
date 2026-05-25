import { expect, type Locator, type Page } from '@playwright/test';

export async function openPublicPage(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

  expect(response, `${path} should return a response`).not.toBeNull();
  expect(response!.status(), `${path} HTTP status`).toBeLessThan(400);
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
