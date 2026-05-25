import { test } from '@playwright/test';

import {
  checkAvatarOrPlayerImage,
  checkBadgeOrMarkVisible,
  checkCountryOrFlagVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  resolveKnownException,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { findPlayerProfileLink, openPlayerSearch, searchPlayerIfSearchInputExists } from '../../utils/playerPresentation/playerSearchHelpers';
import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const legendPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('legend-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');

test.describe('Phase 3 - legend player profile presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of legendPlayers) {
    test(`${player.displayName} legend group profile is reachable and recognizable`, async ({ page }) => {
      const knownException = resolveKnownException(player, knownExceptions);
      let profilePlayer = player;

      try {
        await expectProfilePageLoaded(page, player);
      } catch (error) {
        addWarning(`legend-direct-${player.displayName}`, 'Direct profile URL failed. Falling back to Player Search.', {
          player: player.displayName,
          profileUrl: player.profileUrl,
          error: error instanceof Error ? error.message : String(error),
        });

        await openPlayerSearch(page);
        await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `legend-search-${player.displayName}`);
        const result = await findPlayerProfileLink(page, player, knownException);
        profilePlayer = { ...player, profileUrl: result.href };
        await expectProfilePageLoaded(page, profilePlayer);
      }

      await checkCountryOrFlagVisible(page, profilePlayer, {
        policy: profilePlayer.expectedCountry ? 'fail' : 'warn',
        testName: `legend-country-${player.displayName}`,
      });
      await checkAvatarOrPlayerImage(page, {
        player: profilePlayer,
        testName: `legend-avatar-${player.displayName}`,
        knownException,
      });
      await checkBadgeOrMarkVisible(page, player.expectedMarks ?? [], {
        required: false,
        testName: `legend-mark-${player.displayName}`,
        player: profilePlayer,
        knownException,
      });
    });
  }
});
