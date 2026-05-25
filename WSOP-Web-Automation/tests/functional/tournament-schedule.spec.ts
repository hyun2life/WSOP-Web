import { expect, test } from '@playwright/test';
import { cleanInnerText, firstMeaningfulLine, firstVisible, firstWordsPattern, openPublicPage } from './support';

test.describe('Tournament Schedule functional flow', () => {
  test('filters are clickable and a tournament detail page preserves the event title', async ({ page }) => {
    await openPublicPage(page, '/schedule/');

    await expect(page.getByRole('heading', { name: /Tournaments Schedule/i })).toBeVisible();

    await expect(page.getByRole('button', { name: /^All$/i }), 'All schedule tab should be visible').toBeVisible();

    for (const tabName of ['BRACELETS', 'SUPER CIRCUIT', 'CIRCUIT']) {
      const tab = page.getByRole('button', { name: new RegExp(`^${tabName}$`, 'i') });
      await expect(tab, `${tabName} schedule tab should be visible`).toBeVisible();
      await tab.click();
      await expect(page.locator('a[href*="/tournaments/"]').filter({ hasText: /WSOP/i }).first()).toBeVisible();
    }

    const filters = page.getByRole('button', { name: /filters/i });
    await expect(filters, 'Schedule filters control should be visible').toBeVisible();
    await filters.click();
    await openPublicPage(page, '/schedule/');

    const firstTournament = await firstVisible(
      page.locator('a[href*="/tournaments/"]').filter({ hasText: /WSOP/i }),
      'At least one tournament detail link should be available from the schedule list',
    );
    const listText = await cleanInnerText(firstTournament);
    const cardTitle = await firstTournament.locator('p').first().innerText().catch(() => '');
    const eventName = firstMeaningfulLine(cardTitle || listText);

    await firstTournament.click();

    await expect(page).toHaveURL(/\/tournaments\/[^/]+\/?$/i);
    await expect(page.getByRole('heading', { name: firstWordsPattern(eventName, 3) })).toBeVisible();
    await expect(page.locator('body')).toContainText(/Event Schedule|Tournament details|Date\s+Event/i);
  });
});
