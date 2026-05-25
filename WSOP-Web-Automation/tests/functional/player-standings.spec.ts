import { expect, test } from '@playwright/test';
import { cleanInnerText, cleanPlayerName, firstVisible, openPublicPage } from './support';

test.describe('Player Standings functional flow', () => {
  test('ranking sections link through to player profiles', async ({ page }) => {
    await openPublicPage(page, '/player-standings/');

    await expect(page.getByRole('heading', { name: /Player Standings/i })).toBeVisible();
    await expect(page.locator('body')).toContainText(/All-Time Earnings/i);
    await expect(page.locator('body')).toContainText(/All-Time Bracelets|Bracelets/i);
    await expect(page.locator('body')).toContainText(/All-Time Rings|Rings/i);

    const rankingPlayer = await firstVisible(
      page.locator('a[href*="/players/"]').filter({ hasText: /[A-Za-z]/ }),
      'At least one ranking player link should be available',
    );
    const playerName = cleanPlayerName(await cleanInnerText(rankingPlayer));

    await rankingPlayer.click();

    await expect(page).toHaveURL(/\/players\/[^/]+\/?$/i);
    await expect(page.getByRole('heading', { name: /Player Profile/i })).toBeVisible();
    await expect(page.locator('body')).toContainText(new RegExp(playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await expect(page.locator('body')).toContainText(/Total Earnings|Career WSOP Winnings/i);
  });
});
