import { expect, test } from '@playwright/test';

import {
  checkCountryOrFlagVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  playerNamePattern,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const topPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('top-players.fixture.json');

test.describe('Phase 3 - standings top player presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('standings exposes representative top players and links them to profiles', async ({ page }) => {
    const response = await page.goto('/player-standings/', { waitUntil: 'domcontentloaded' });
    expect(response, '/player-standings/ should return a response').not.toBeNull();
    expect(response!.status(), '/player-standings/ HTTP status').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

    await expect(
      page.locator('body').filter({ hasText: /All-Time Earnings|All-Time Bracelets|All-Time Rings|Player Standings/i }),
      'Standings page should expose at least one core ranking section',
    ).toBeVisible();

    const visiblePlayers: PlayerFixture[] = [];
    for (const player of topPlayers) {
      const namePattern = playerNamePattern(player.displayName);
      const nameVisible = await page.locator('body').filter({ hasText: namePattern }).isVisible().catch(() => false);
      const profileLinkCount = await page.locator('a[href*="/players/"]').filter({ hasText: namePattern }).count();

      if (nameVisible && profileLinkCount > 0) {
        visiblePlayers.push(player);
      }
    }

    expect(
      visiblePlayers.length,
      `At least 3 representative top players should be visible on standings. Found: ${visiblePlayers.map((p) => p.displayName).join(', ') || 'none'}`,
    ).toBeGreaterThanOrEqual(3);

    for (const player of visiblePlayers.slice(0, 3)) {
      await expectProfilePageLoaded(page, player);
      await checkCountryOrFlagVisible(page, player, { testName: `standings-top-${player.displayName}` });
    }
  });
});
