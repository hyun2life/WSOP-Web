import { expect, test } from '@playwright/test';
import { publicPages } from '../../data/public-pages';

test.describe('Public pages smoke', () => {
  for (const publicPage of publicPages) {
    test(`${publicPage.name} opens and shows core content`, async ({ page }) => {
      const response = await page.goto(publicPage.url, { waitUntil: 'domcontentloaded' });

      expect(response, `${publicPage.name} should return a response`).not.toBeNull();
      expect(response!.status(), `${publicPage.name} HTTP status`).toBeLessThan(400);
      await expect(page.locator('body')).toBeVisible();

      const bodyText = await page.locator('body').innerText();
      const hasExpectedText = publicPage.expectedTexts.some((text) =>
        new RegExp(escapeRegExp(text), 'i').test(bodyText),
      );

      expect(
        hasExpectedText,
        `${publicPage.name} should show at least one expected visible text: ${publicPage.expectedTexts.join(', ')}`,
      ).toBe(true);
    });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
