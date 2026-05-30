import { test } from '@playwright/test';

import {
  expectProfilePageLoaded,
  resolveKnownException,
  loadPlayerPresentationFixture,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
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
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');

test.describe('Phase 4 - player search depth', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const searchCase of searchCases) {
    test(`${searchCase.caseName} returns a player profile target`, async ({ page }) => {
      await openPlayerSearch(page);

      const knownException = resolveKnownException(
        { displayName: searchCase.expectedPlayer ?? '', knownExceptionKey: searchCase.knownExceptionKey } as any,
        knownExceptions,
      );

      const autocompleteOk = await expectPlayerAutocompleteResult(page, searchCase, knownException);
      if (!autocompleteOk && (knownException?.warningOnly || searchCase.warningOnly)) {
        return;
      }

      await submitPlayerSearch(page, searchCase.keyword);
      const links = await expectPlayerSearchResult(page, searchCase, knownException);
      if (links.length === 0 && (knownException?.warningOnly || searchCase.warningOnly)) {
        return;
      }

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
