import { expect, test } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import { expectAnyTextVisible, expectPlayerLinksVisible } from '../../utils/searchFilterSort/resultListAssertions';
import { openPlayerStandings } from '../../utils/searchFilterSort/standingsHelpers';

test.describe('Phase 4 - player standings full list navigation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('Standings View full list links navigate to usable list pages', async ({ page }) => {
    await openPlayerStandings(page);

    const hrefs = await page
      .locator('a')
      .filter({ hasText: /view full list|full list|view all|all rankings/i })
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href') || '')
          .filter((href) => href && !href.startsWith('#')),
      );

    const uniqueHrefs = Array.from(new Set(hrefs)).slice(0, 3);
    if (uniqueHrefs.length === 0) {
      addWarning('phase4-view-full-list', 'No View full list links were visible on /player-standings/.');
      await expectPlayerLinksVisible(page, 1, 'Player Standings fallback list');
      return;
    }

    for (const href of uniqueHrefs) {
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' });
      expect(response, `View full list should return a response: ${href}`).not.toBeNull();
      expect(response!.status(), `View full list should not return 4xx/5xx: ${href}`).toBeLessThan(400);
      await expectAnyTextVisible(page, ['Player', 'Country', 'Earnings', 'Bracelets', 'Rings', 'Cashes'], {
        pageUrl: href,
        label: 'Standings full list destination',
      });
      await assertListDidNotBreak(page);
      await expectPlayerLinksVisible(page, 1, `Standings full list ${href}`);
    }
  });
});
