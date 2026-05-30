import { test } from '@playwright/test';

import {
  loadPlayerPresentationFixture,
  resolveKnownException,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import {
  expectPlayerAutocompleteVisible,
  expectPlayerVisibleInSearchResults,
  openPlayerSearch,
  searchPlayerIfSearchInputExists,
} from '../../utils/playerPresentation/playerSearchHelpers';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const topPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('top-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');
const playerSearchSamples = topPlayers.filter((player) => player.identityType?.some((type) => type.startsWith('top-')));

test.describe('Phase 3 - player search identity', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of playerSearchSamples) {
    test(`${player.displayName} appears in autocomplete and search results`, async ({ page }) => {
      await openPlayerSearch(page);
      const knownException = resolveKnownException(player, knownExceptions);
      await expectPlayerAutocompleteVisible(page, player, `autocomplete-${player.displayName}`, knownException);

      await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `search-${player.displayName}`);
      await expectPlayerVisibleInSearchResults(page, player, knownException);
    });
  }
});
