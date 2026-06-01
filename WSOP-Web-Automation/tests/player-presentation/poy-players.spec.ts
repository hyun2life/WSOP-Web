import { expect, test } from '@playwright/test';

import {
  checkBadgeOrMarkVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  playerNamePattern,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { findPlayerProfileLink, openPlayerSearch, searchPlayerIfSearchInputExists } from '../../utils/playerPresentation/playerSearchHelpers';
import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const poyPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('poy-players.fixture.json');

test.describe('Phase 3 - Player of the Year presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('POY area exposes representative Player of the Year identities', async ({ page }) => {
    const response = await page.goto('/2026-poy/', { waitUntil: 'domcontentloaded' }).catch(() => null);
    const poyPageAvailable = !!response && response.status() < 400;

    if (poyPageAvailable) {
      await expect(page.locator('body')).toBeVisible();
      await expect(
        page.locator('body').filter({ hasText: /Player of the Year|P\.?O\.?Y\.?|Previous WSOP Player of the Year Winners/i }),
        'POY page should expose Player of the Year content',
      ).toBeVisible();
    } else {
      addWarning('poy-area', '/2026-poy/ was not available. Falling back to Player Search POY area.', {
        status: response?.status(),
      });
      await openPlayerSearch(page);
    }

    const validatedPlayers: PlayerFixture[] = [];
    for (const player of poyPlayers) {
      const visibleInCurrentArea = await page
        .locator('body')
        .filter({ hasText: playerNamePattern(player.displayName) })
        .isVisible()
        .catch(() => false);

      if (visibleInCurrentArea) {
        const link = await findPlayerProfileLink(page, player).catch((error) => {
          addWarning(`poy-profile-link-${player.displayName}`, `POY player was visible but no profile link was resolved: ${player.displayName}`, {
            displayName: player.displayName,
            profileUrl: player.profileUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        validatedPlayers.push(link ? { ...player, profileUrl: link.href } : player);
        continue;
      }

      try {
        await openPlayerSearch(page);
        await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `poy-fallback-${player.displayName}`);
        const link = await findPlayerProfileLink(page, player);
        validatedPlayers.push({ ...player, profileUrl: link.href });
      } catch (error) {
        addWarning(
          `poy-player-${player.displayName}`,
          `POY player was not visible in the current POY area and was not resolved through Player Search: ${player.displayName}`,
          {
            displayName: player.displayName,
            profileUrl: player.profileUrl,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      if (poyPageAvailable) {
        await page.goto('/2026-poy/', { waitUntil: 'domcontentloaded' });
      }
    }

    expect(
      validatedPlayers.length,
      `All POY players should be visible on POY or searchable. Found: ${validatedPlayers.map((p) => p.displayName).join(', ')}`,
    ).toBeGreaterThanOrEqual(poyPlayers.length);
  });
});
