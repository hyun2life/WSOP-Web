import { expect, test } from '@playwright/test';

import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import {
  expectAnyTextVisible,
  expectPlayerLinksVisible,
  loadSearchFilterSortFixture,
} from '../../utils/searchFilterSort/resultListAssertions';

type PoyFilterCase = {
  caseName: string;
  pageUrl: string;
  expectedTexts: string[];
  expectedPlayerCandidates: string[];
};

const poyCases = loadSearchFilterSortFixture<PoyFilterCase[]>('poy-filter-cases.fixture.json');

test.describe('Phase 4 - POY filter and winner depth', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('POY page exposes leaderboard and previous winners areas', async ({ page }) => {
    const response = await page.goto('/2026-poy/', { waitUntil: 'domcontentloaded' });
    expect(response, '/2026-poy/ should return a response').not.toBeNull();
    expect(response!.status(), '/2026-poy/ HTTP status').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();

    await expectAnyTextVisible(page, ['2026 WSOP Player of the Year', 'P.O.Y.', 'Leaderboard'], {
      pageUrl: '/2026-poy/',
      label: 'Current POY area',
    });
    await expectAnyTextVisible(page, ['Previous WSOP Player of the Year Winners'], {
      pageUrl: '/2026-poy/',
      label: 'Previous POY winners area',
    });

    for (const poyCase of poyCases) {
      await expectAnyTextVisible(page, poyCase.expectedTexts, {
        pageUrl: poyCase.pageUrl,
        label: poyCase.caseName,
      });
      await expectAnyTextVisible(page, poyCase.expectedPlayerCandidates, {
        pageUrl: poyCase.pageUrl,
        label: `${poyCase.caseName} player candidates`,
      });
    }

    await assertListDidNotBreak(page);

    const links = await page.locator('a[href*="/players/"], a[href*="poy"], a').filter({ hasText: /view|details|Daniel|Shaun|Scott|Ian/i }).count();
    if (links > 0) {
      await expectPlayerLinksVisible(page, 1, 'POY player/profile links');
    }
  });
});
