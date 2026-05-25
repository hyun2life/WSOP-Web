import { test } from '@playwright/test';

import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { clickTabOrSection, expectSectionVisible } from '../../utils/searchFilterSort/filterHelpers';
import { assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import { openPlayerSearch } from '../../utils/searchFilterSort/searchHelpers';
import { expectPlayerLinksVisible, getVisiblePlayerLinkCount } from '../../utils/searchFilterSort/resultListAssertions';

const discoveryLabels = ['Trending', 'Winners', 'Player of the Year', 'Hall of Fame'];

test.describe('Phase 4 - player search tabs and sections', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const label of discoveryLabels) {
    test(`Player Search ${label} section can be inspected without breaking the list`, async ({ page }) => {
      await openPlayerSearch(page);
      await expectSectionVisible(page, discoveryLabels);
      await clickTabOrSection(page, label);
      await assertListDidNotBreak(page);
      const count = await getVisiblePlayerLinkCount(page);
      if (count > 0) {
        await expectPlayerLinksVisible(page, 1, `Player Search ${label} section`);
      }
    });
  }
});
