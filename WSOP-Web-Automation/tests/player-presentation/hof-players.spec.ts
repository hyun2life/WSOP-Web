import { expect, test } from '@playwright/test';

import {
  checkBadgeOrMarkVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  playerNamePattern,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { findPlayerProfileLink, openPlayerSearch, searchPlayerIfSearchInputExists } from '../../utils/playerPresentation/playerSearchHelpers';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const hofPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('hof-players.fixture.json');

test.describe('Phase 3 - Hall of Fame player presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('Hall of Fame area exposes representative HOF players or searchable profile targets', async ({ page }) => {
    const response = await page.goto('/hall-of-fame/', { waitUntil: 'domcontentloaded' });
    expect(response, '/hall-of-fame/ should return a response').not.toBeNull();
    expect(response!.status(), '/hall-of-fame/ HTTP status').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

    await expect(
      page.locator('body').filter({ hasText: /Hall of Fame|Poker Hall of Fame/i }),
      'Hall of Fame page should expose its core area',
    ).toBeVisible();

    const validatedPlayers: PlayerFixture[] = [];
    for (const player of hofPlayers) {
      const visibleOnHof = await page.locator('body').filter({ hasText: playerNamePattern(player.displayName) }).isVisible().catch(() => false);
      if (visibleOnHof) {
        validatedPlayers.push(player);
        continue;
      }

      await openPlayerSearch(page);
      await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `hof-fallback-${player.displayName}`);
      await findPlayerProfileLink(page, player);
      validatedPlayers.push(player);

      await page.goto('/hall-of-fame/', { waitUntil: 'domcontentloaded' });
    }

    expect(
      validatedPlayers.length,
      `At least 3 HOF players should be visible on Hall of Fame or searchable. Found: ${validatedPlayers.map((p) => p.displayName).join(', ')}`,
    ).toBeGreaterThanOrEqual(3);

    for (const player of validatedPlayers.slice(0, 3)) {
      await expectProfilePageLoaded(page, player);
      await checkBadgeOrMarkVisible(page, ['Hall of Fame'], {
        required: false,
        testName: `hof-mark-${player.displayName}`,
        player,
      });
    }
  });
});
