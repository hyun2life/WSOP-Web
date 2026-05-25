import { expect, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { expectAnyTextVisible, expectPlayerLinksVisible } from './resultListAssertions';

export type StandingsCategory = {
  categoryName: string;
  pageUrl: string;
  expectedHeading?: string;
  expectedColumns?: string[];
  viewFullListExpected?: boolean;
  missingViewFullListPolicy?: 'fail' | 'warn';
};

export async function openPlayerStandings(page: Page) {
  const response = await page.goto('/player-standings/', { waitUntil: 'domcontentloaded' });
  expect(response, '/player-standings/ should return a response').not.toBeNull();
  expect(response!.status(), '/player-standings/ HTTP status').toBeLessThan(400);
  await expect(page.locator('body'), '/player-standings/ body should be visible').toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
  await expectAnyTextVisible(page, ['Player Standings', '2026 Standings', 'All-Time Earnings'], {
    pageUrl: '/player-standings/',
    label: 'Player Standings core area',
  });
}

export async function openStandingsCategory(page: Page, category: StandingsCategory) {
  const response = await page.goto(category.pageUrl, { waitUntil: 'domcontentloaded' });
  expect(response, `${category.categoryName} should return a response: ${category.pageUrl}`).not.toBeNull();
  expect(
    response!.status(),
    `${category.categoryName} HTTP status should be < 400. If this is 404, classify as fixture URL mismatch: ${category.pageUrl}`,
  ).toBeLessThan(400);

  await expect(page.locator('body'), `${category.categoryName} body should be visible`).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  if (category.expectedHeading) {
    await expectAnyTextVisible(page, [category.expectedHeading, category.categoryName], {
      pageUrl: category.pageUrl,
      label: `${category.categoryName} heading`,
    });
  }
}

export async function assertStandingsListVisible(page: Page, category: StandingsCategory) {
  const listSurface = page.locator('table, [role="table"], [role="grid"], [class*="standing" i], [class*="rank" i], [class*="list" i]');
  const hasListSurface = (await listSurface.count()) > 0 && (await listSurface.first().isVisible().catch(() => false));
  expect(hasListSurface, `${category.categoryName} should expose a table/list/card ranking surface: ${category.pageUrl}`).toBeTruthy();

  if (category.expectedColumns?.length) {
    const visibleColumns = [];
    const bodyText = await page.locator('body').innerText().catch(() => '');
    for (const column of category.expectedColumns) {
      if (new RegExp(`\\b${column}\\b`, 'i').test(bodyText)) {
        visibleColumns.push(column);
      }
    }

    expect(
      visibleColumns.length,
      `${category.categoryName} should expose at least one expected column from [${category.expectedColumns.join(', ')}]`,
    ).toBeGreaterThan(0);
  }

  await expectPlayerLinksVisible(page, 1, `${category.categoryName} standings list`);
}

export async function clickViewFullListIfExists(page: Page, category: StandingsCategory) {
  const link = page
    .getByRole('link', { name: /view full list|full list|view all|all rankings/i })
    .or(page.locator('a').filter({ hasText: /view full list|full list|view all|all rankings/i }))
    .first();

  if ((await link.count()) === 0 || !(await link.isVisible().catch(() => false))) {
    const message = `${category.categoryName} did not expose a View full list link.`;
    if (category.viewFullListExpected && category.missingViewFullListPolicy !== 'warn') {
      expect(false, message).toBeTruthy();
    } else {
      addWarning('phase4-view-full-list', message, { categoryName: category.categoryName, pageUrl: category.pageUrl });
    }
    return false;
  }

  const href = (await link.getAttribute('href')) ?? '';
  const responsePromise = page.waitForResponse((response) => response.url().includes(href.replace(/^\//, ''))).catch(() => null);
  await link.click();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  const response = await responsePromise;
  if (response) {
    expect(response.status(), `${category.categoryName} View full list should not return 4xx/5xx: ${href}`).toBeLessThan(400);
  }

  await expect(page.locator('body'), `${category.categoryName} View full list destination should render body`).toBeVisible();
  return true;
}
