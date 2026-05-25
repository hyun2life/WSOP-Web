import { expect, test } from '@playwright/test';
import { cleanInnerText, firstMeaningfulLine, firstVisible, firstWordsPattern, openPublicPage } from './support';

test.describe('News functional flow', () => {
  test('first news item opens a detail page with article content', async ({ page }) => {
    await openPublicPage(page, '/news/');

    await expect(page.getByRole('heading', { name: /Latest News/i })).toBeVisible();

    const firstArticle = await firstVisible(
      page.locator('a[href*="/news/"]').filter({ hasText: /[A-Za-z]/ }),
      'At least one news article link should be available',
    );
    const title = firstMeaningfulLine(await cleanInnerText(firstArticle));
    const titlePattern = firstWordsPattern(title, 6);

    await firstArticle.click();

    await expect(page).toHaveURL(/\/news\/[^/]+\/?$/i);
    await expect(page.getByRole('heading', { name: titlePattern })).toBeVisible();
    await expect(page.locator('body')).toContainText(/[A-Z][a-z]{2}\s+\d{2}\s+20\d{2}\s+\d{2}:\d{2}\s+[AP]M\s+EST/);
    await expect(page.getByRole('img', { name: titlePattern }).first()).toBeVisible();
    await expect(page.locator('p').filter({ hasText: /WSOP|World Series|poker/i }).first()).toBeVisible();
  });
});
