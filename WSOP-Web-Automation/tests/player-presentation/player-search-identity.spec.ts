import { test } from '@playwright/test';

import {
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  resolveKnownException,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import {
  expectPlayerAutocompleteVisible,
  expectPlayerVisibleInSearchResults,
  findPlayerProfileLink,
  openPlayerSearch,
  searchPlayerIfSearchInputExists,
} from '../../utils/playerPresentation/playerSearchHelpers';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const topPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('top-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');

test.describe('Phase 3 - player search identity', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of topPlayers) {
    test(`${player.displayName} appears in autocomplete and search results`, async ({ page }) => {
      await openPlayerSearch(page);
      await expectPlayerAutocompleteVisible(page, player, `autocomplete-${player.displayName}`);

      const knownException = resolveKnownException(player, knownExceptions);
      await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `search-${player.displayName}`);
      await expectPlayerVisibleInSearchResults(page, player);
      const result = await findPlayerProfileLink(page, player, knownException);

      await expectProfilePageLoaded(page, { ...player, profileUrl: result.href });
    });
  }
});
