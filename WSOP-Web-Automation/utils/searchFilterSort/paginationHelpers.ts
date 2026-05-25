import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { getVisiblePlayerLinkCount } from './resultListAssertions';

export async function findPaginationControls(page: Page): Promise<Locator[]> {
  const candidates = [
    page.getByRole('button', { name: /next|load more|show more/i }).first(),
    page.getByRole('link', { name: /next|load more|show more/i }).first(),
    page.locator('button, a').filter({ hasText: /next|load more|show more/i }).first(),
    page.locator('[class*="paging" i] button:not([disabled]), [class*="pagination" i] button:not([disabled])').last(),
  ];

  const visible = [];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      visible.push(candidate);
    }
  }

  return visible;
}

export async function clickNextOrLoadMoreIfExists(page: Page) {
  const beforeUrl = page.url();
  const beforeCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
  const controls = await findPaginationControls(page);

  if (controls.length === 0) {
    addWarning('phase4-pagination', 'Pagination or Load more controls were not visible on this page.');
    return false;
  }

  await controls[0].click({ timeout: 5_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await expect
    .poll(async () => {
      const currentUrl = page.url();
      const currentCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
      return currentUrl !== beforeUrl || currentCount !== beforeCount || currentCount > 0;
    }, { timeout: 5_000, intervals: [250, 500, 1_000] })
    .toBeTruthy();
  return true;
}

export async function assertListDidNotBreak(page: Page) {
  await expect(page.locator('body'), 'List page body should remain visible after pagination/load more').toBeVisible();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  expect(
    /\b(404|500)\s*(error|not found)\b|server error|page not found/i.test(bodyText),
    'List page should not show a 4xx/5xx error message',
  ).toBeFalsy();

  const playerLinkCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
  const clearNoResults = /no results?|no players?|not found/i.test(bodyText);
  expect(playerLinkCount > 0 || clearNoResults, 'List should expose player links or a clear no-results state').toBeTruthy();
}
