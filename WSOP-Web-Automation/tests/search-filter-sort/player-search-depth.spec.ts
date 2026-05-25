import { test } from '@playwright/test';

import { expectProfilePageLoaded, type PlayerFixture } from '../../utils/playerPresentation/playerPresentationChecks';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  expectPlayerSearchResult,
  expectPlayerAutocompleteResult,
  openFirstPlayerSearchProfile,
  openPlayerSearch,
  submitPlayerSearch,
  type PlayerSearchCase,
} from '../../utils/searchFilterSort/searchHelpers';
import { loadSearchFilterSortFixture } from '../../utils/searchFilterSort/resultListAssertions';

const searchCases = loadSearchFilterSortFixture<PlayerSearchCase[]>('player-search-cases.fixture.json');

test.describe('Phase 4 - player search depth', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const searchCase of searchCases) {
    test(`${searchCase.caseName} returns a player profile target`, async ({ page }) => {
      await openPlayerSearch(page);
      await expectPlayerAutocompleteResult(page, searchCase);
      await submitPlayerSearch(page, searchCase.keyword);
      const links = await expectPlayerSearchResult(page, searchCase);

      const profileHref = await openFirstPlayerSearchProfile(page, searchCase, links);

      const expectedPlayer = searchCase.expectedPlayer ?? searchCase.keyword.trim();
      await expectProfilePageLoaded(page, {
        displayName: expectedPlayer,
        searchKeyword: searchCase.keyword,
        profileUrl: profileHref,
      } as PlayerFixture);
    });
  }
});
