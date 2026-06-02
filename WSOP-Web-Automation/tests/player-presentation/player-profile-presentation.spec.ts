import { test } from '@playwright/test';

import {
  checkAvatarOrPlayerImage,
  checkProfileBadgeSummaryConsistency,
  checkCountryOrFlagVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  resolveKnownException,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const topPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('top-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');

test.describe('Phase 3 - player profile presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of topPlayers) {
    test(`${player.displayName} profile exposes identity UI`, async ({ page }) => {
      const knownException = resolveKnownException(player, knownExceptions);

      await expectProfilePageLoaded(page, player);
      await checkCountryOrFlagVisible(page, player, { testName: `profile-country-${player.displayName}` });
      await checkAvatarOrPlayerImage(page, {
        player,
        testName: `profile-avatar-${player.displayName}`,
        knownException,
      });
      await checkProfileBadgeSummaryConsistency(page, {
        player,
        testName: `profile-badge-summary-${player.displayName}`,
      });
    });
  }
});
