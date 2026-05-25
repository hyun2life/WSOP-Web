import { expect, test } from '@playwright/test';
import { cleanInnerText, cleanPlayerName, firstVisible, openPublicPage } from './support';

test.describe('Player Search functional flow', () => {
  test('search or trending list opens a player profile with core stats', async ({ page }) => {
    await openPublicPage(page, '/player-search/');

    await expect(page.getByRole('heading', { name: /Player Search/i })).toBeVisible();

    const searchInput = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox')).first();
    if ((await searchInput.count()) > 0 && (await searchInput.isVisible().catch(() => false))) {
      await searchInput.fill('Phil Hellmuth');

      const submitSearch = page.locator('button[type="submit"], button.btn-search').first();
      if ((await submitSearch.count()) > 0) {
        await submitSearch.click();
      } else {
        await searchInput.press('Enter');
      }

      await page.waitForTimeout(1_000);
    }

    let playerName = 'Phil Hellmuth';
    const searchedPlayerRow = page.getByRole('row', { name: /Phil Hellmuth/i }).first();
    await searchedPlayerRow.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);

    if ((await searchedPlayerRow.count()) > 0 && (await searchedPlayerRow.isVisible().catch(() => false))) {
      await searchedPlayerRow.click();
    } else {
      const preferredPlayer = page.locator('a[href*="/players/"]').filter({ hasText: /Phil Hellmuth/i });
      const playerLink =
        (await preferredPlayer.count()) > 0
          ? await firstVisible(preferredPlayer, 'Phil Hellmuth should be available after player search')
          : await firstVisible(
              page.locator('a[href*="/players/"]').filter({ hasText: /[A-Za-z]/ }),
              'At least one player profile link should be available',
            );

      playerName = cleanPlayerName(await cleanInnerText(playerLink));
      await playerLink.click();
    }

    await expect(page).toHaveURL(/\/players\/[^/]+\/?$/i);
    await expect(page.getByRole('heading', { name: /Player Profile/i })).toBeVisible();
    await expect(page.locator('body')).toContainText(new RegExp(playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    await expect(page.locator('body')).toContainText(/Bracelets|Rings|Total Earnings|Career WSOP Winnings/i);
  });
});
