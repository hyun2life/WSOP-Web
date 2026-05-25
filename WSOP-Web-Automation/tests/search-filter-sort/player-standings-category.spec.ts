import { test } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { clickNextOrLoadMoreIfExists, assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import { loadSearchFilterSortFixture } from '../../utils/searchFilterSort/resultListAssertions';
import { clickSortIfExists } from '../../utils/searchFilterSort/sortHelpers';
import {
  assertStandingsListVisible,
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
});
