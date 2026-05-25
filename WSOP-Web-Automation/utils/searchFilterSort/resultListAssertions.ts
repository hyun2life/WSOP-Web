import { expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export function loadSearchFilterSortFixture<T>(fileName: string): T {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'search-filter-sort', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as T;
}

export function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function expectAnyTextVisible(page: Page, texts: string[], options: { pageUrl?: string; label?: string } = {}) {
  const meaningfulTexts = texts.filter(Boolean);
  expect(meaningfulTexts.length, `${options.label ?? 'Text assertion'} should include at least one text candidate`).toBeGreaterThan(0);

  const structuralSurface = page.locator('main, [role="main"], section, article, table, [class*="content" i], [class*="list" i]');
  for (const text of meaningfulTexts) {
    const pattern = new RegExp(escapeRegExp(text).replace(/\\\./g, '\\.?'), 'i');
    const structuralMatch = structuralSurface.filter({ hasText: pattern }).first();
    if ((await structuralMatch.count()) > 0 && (await structuralMatch.isVisible().catch(() => false))) {
      return;
    }
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const matched = meaningfulTexts.some((text) => new RegExp(escapeRegExp(text).replace(/\\\./g, '\\.?'), 'i').test(bodyText));
  expect(
    matched,
    `${options.label ?? 'Expected text'} should show one of [${meaningfulTexts.join(', ')}]${options.pageUrl ? ` on ${options.pageUrl}` : ''}`,
  ).toBeTruthy();
}

export async function expectPlayerLinksVisible(page: Page, minimumCount: number, context = 'result list') {
  const count = await getVisiblePlayerLinkCount(page);
  expect(count, `${context} should expose at least ${minimumCount} visible /players/ link(s)`).toBeGreaterThanOrEqual(minimumCount);
}

export async function getVisiblePlayerLinkCount(page: Page): Promise<number> {
  const links = page.locator('a[href*="/players/"]');
  const count = await links.count();
  let visible = 0;

  for (let index = 0; index < count; index += 1) {
    if (await links.nth(index).isVisible().catch(() => false)) {
      visible += 1;
    }
  }

  return visible;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
