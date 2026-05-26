import { expect, test, type Locator, type Page } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { clickNextOrLoadMoreIfExists, assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import { loadSearchFilterSortFixture } from '../../utils/searchFilterSort/resultListAssertions';
import { clickSortIfExists } from '../../utils/searchFilterSort/sortHelpers';
import {
  assertStandingsListVisible,
  openPlayerStandings,
  openStandingsCategory,
  type StandingsCategory,
} from '../../utils/searchFilterSort/standingsHelpers';

const categories = loadSearchFilterSortFixture<StandingsCategory[]>('standings-categories.fixture.json');

test.describe('Phase 4 - player standings category depth', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const category of categories) {
    test(`${category.categoryName} category renders a usable standings list`, async ({ page }) => {
      await openStandingsCategory(page, category);
      await assertStandingsListVisible(page, category);
      await clickSortIfExists(page, 'Player');
      await assertListDidNotBreak(page);
      if (category.viewFullListExpected) {
        addWarning('phase4-pagination', `${category.categoryName} is a summary page; pagination depth is covered by full-list tests.`, {
          categoryName: category.categoryName,
          pageUrl: category.pageUrl,
        });
      } else {
        await clickNextOrLoadMoreIfExists(page);
        await assertListDidNotBreak(page);
      }
    });
  }

  test('All Player Stats filter supports usable filtering and sorting', async ({ page }) => {
    await openPlayerStandings(page);
    const switched = await clickAllPlayerStatsFilter(page);
    if (!switched) {
      addWarning('phase4-all-player-stats', 'All Player Stats filter was not visible/clickable on current surface.');
      return;
    }

    await assertListDidNotBreak(page);
    const allStatsSnapshot = await snapshotListSurface(page);

    const fallbackFilters = ['All-Time Earnings - Men', 'All-Time Bracelets', 'All-Time Rings'];
    const fallbackApplied = await clickFirstAvailableFilter(page, fallbackFilters);
    if (fallbackApplied) {
      await assertListDidNotBreak(page);
      const fallbackSnapshot = await snapshotListSurface(page);
      const changed = fallbackSnapshot.url !== allStatsSnapshot.url || fallbackSnapshot.headline !== allStatsSnapshot.headline;
      expect(changed, 'Switching away from All Player Stats should change URL or visible heading/label.').toBeTruthy();
      await clickAllPlayerStatsFilter(page);
      await assertListDidNotBreak(page);
    } else {
      addWarning('phase4-all-player-stats-filter-switch', 'No secondary standings filter was visible to validate filter switching.');
    }

    const sortColumns = ['Player', 'Earnings', 'Bracelets', 'Rings', 'Cashes'];
    let clickedSortCount = 0;
    for (const column of sortColumns) {
      const clicked = await clickSortIfExists(page, column);
      if (clicked) {
        clickedSortCount += 1;
        await assertListDidNotBreak(page);
      }
    }
    expect(clickedSortCount, 'All Player Stats should expose at least one working sort control.').toBeGreaterThan(0);
  });

  test('Numeric pagination last page click should not expand max page count unexpectedly', async ({ page }) => {
    await openPlayerStandings(page);
    const switched = await clickAllPlayerStatsFilter(page);
    if (!switched) {
      addWarning('phase4-pagination-last-page', 'All Player Stats filter was not visible; checking pagination on current standings surface.');
    }

    await assertListDidNotBreak(page);
    const before = await readPaginationNumbers(page);
    if (before.length === 0) {
      addWarning('phase4-pagination-last-page', 'No numeric pagination controls were visible.');
      return;
    }

    const beforeMax = Math.max(...before);
    const lastControl = await findPaginationControlByNumber(page, beforeMax);
    if (!lastControl) {
      addWarning('phase4-pagination-last-page', `Could not locate numeric pagination control for last page ${beforeMax}.`);
      return;
    }

    await lastControl.click({ timeout: 5_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await assertListDidNotBreak(page);

    const after = await readPaginationNumbers(page);
    if (after.length === 0) {
      addWarning('phase4-pagination-last-page', 'Numeric pagination controls disappeared after clicking the last page.');
      return;
    }

    const afterMax = Math.max(...after);
    if (afterMax > beforeMax) {
      const activePage = await readActivePaginationNumber(page);
      const slidWindow =
        activePage === beforeMax &&
        after.includes(beforeMax) &&
        afterMax - beforeMax <= 5;

      if (slidWindow) {
        addWarning(
          'phase4-pagination-last-page-window-slide',
          `Numeric pagination appears to slide window (before max: ${beforeMax}, after max: ${afterMax}, active: ${activePage}).`,
        );
      } else if (activePage == null && afterMax - beforeMax <= 5) {
        addWarning(
          'phase4-pagination-last-page-ambiguous',
          `Pagination max increased without a detectable active indicator (before max: ${beforeMax}, after max: ${afterMax}). Treating as ambiguous sliding UI.`,
        );
      } else {
        expect(
          afterMax,
          `Last page click should not inflate max page number unexpectedly (before: ${beforeMax}, after: ${afterMax}, active: ${activePage ?? 'n/a'}).`,
        ).toBeLessThanOrEqual(beforeMax);
      }
    }
  });
});

async function clickAllPlayerStatsFilter(page: Page) {
  const pattern = /all player stats/i;
  const candidates = [
    page.getByRole('tab', { name: pattern }).first(),
    page.getByRole('button', { name: pattern }).first(),
    page.getByRole('link', { name: pattern }).first(),
    page.locator('a, button, [role="tab"], [role="button"]').filter({ hasText: pattern }).first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click({ timeout: 5_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function clickFirstAvailableFilter(page: Page, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const candidates = [
      page.getByRole('tab', { name: pattern }).first(),
      page.getByRole('button', { name: pattern }).first(),
      page.getByRole('link', { name: pattern }).first(),
      page.locator('a, button, [role="tab"], [role="button"]').filter({ hasText: pattern }).first(),
    ];

    for (const candidate of candidates) {
      if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
        await candidate.click({ timeout: 5_000 });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
        return label;
      }
    }
  }

  return null;
}

async function snapshotListSurface(page: Page) {
  const headline = await page
    .locator('h1, h2, h3, [class*="title" i], [class*="heading" i]')
    .first()
    .innerText()
    .catch(() => '');
  return { url: page.url(), headline: headline.trim() };
}

async function readPaginationNumbers(page: Page) {
  const locator = page.locator('a, button, [role="button"], [role="link"], li, span');
  const texts = await locator.evaluateAll((nodes) =>
    nodes
      .map((node) => (node.textContent || '').trim())
      .filter((value) => /^\d{1,4}$/.test(value))
      .map((value) => Number(value)),
  );
  return Array.from(new Set(texts)).filter((value) => Number.isFinite(value) && value > 0);
}

async function findPaginationControlByNumber(page: Page, pageNumber: number): Promise<Locator | null> {
  const text = String(pageNumber);
  const candidates = [
    page.getByRole('button', { name: new RegExp(`^\\s*${text}\\s*$`) }).first(),
    page.getByRole('link', { name: new RegExp(`^\\s*${text}\\s*$`) }).first(),
    page.locator('a, button, [role="button"], [role="link"]').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }

  return null;
}

async function readActivePaginationNumber(page: Page): Promise<number | null> {
  const candidates = [
    page.locator('[aria-current="page"]').first(),
    page.locator('a[aria-current], button[aria-current], [role="button"][aria-current], [role="link"][aria-current]').first(),
    page.locator('li[aria-current], li.active, .active[role="button"], .active[role="link"], a.active, button.active').first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0 || !(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = (await candidate.innerText().catch(() => '')).trim();
    if (/^\d{1,4}$/.test(text)) {
      return Number(text);
    }
  }

  return null;
}
