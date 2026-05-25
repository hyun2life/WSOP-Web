import { test } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  expectPlayerSearchResult,
  openPlayerSearch,
  submitPlayerSearch,
  type PlayerSearchCase,
} from '../../utils/searchFilterSort/searchHelpers';
import { loadSearchFilterSortFixture } from '../../utils/searchFilterSort/resultListAssertions';

const edgeCases = loadSearchFilterSortFixture<PlayerSearchCase[]>('player-search-edge-cases.fixture.json');

test.describe('Phase 4 - player search edge cases', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const searchCase of edgeCases) {
    test(`${searchCase.caseName} is handled by Player Search`, async ({ page }) => {
      await openPlayerSearch(page);
      await submitPlayerSearch(page, searchCase.keyword);

      if (searchCase.warningOnly) {
        try {
          await expectPlayerSearchResult(page, searchCase);
        } catch (error) {
          addWarning(searchCase.caseName, `Warning-only search behavior was not confirmed for "${searchCase.keyword}".`, {
            keyword: searchCase.keyword,
            expectedPlayer: searchCase.expectedPlayer ?? searchCase.expectedPlayerContains,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      await expectPlayerSearchResult(page, searchCase);
    });
  }
});
