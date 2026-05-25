import { expect, test } from '@playwright/test';
import { publicPages } from '../../data/public-pages';

const ignoredPatterns = [
  /favicon/i,
  /analytics/i,
  /ads?/i,
  /googletag/i,
  /doubleclick/i,
  /third[- ]?party/i,
  /google-analytics/i,
  /googlesyndication/i,
  /gtm\.js/i,
  /\[SSE\].*EventSource failed for maintenance/i,
  /EventSource failed for maintenance/i,
];

test.describe('Console errors smoke', () => {
  for (const publicPage of publicPages) {
    test(`${publicPage.name} has no unexpected console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (message) => {
        if (message.type() !== 'error') {
          return;
        }

        const text = message.text();
        if (!ignoredPatterns.some((pattern) => pattern.test(text))) {
          consoleErrors.push(text);
        }
      });

      const response = await page.goto(publicPage.url, { waitUntil: 'domcontentloaded' });
      expect(response, `${publicPage.name} should return a response`).not.toBeNull();
      expect(response!.status(), `${publicPage.name} HTTP status`).toBeLessThan(400);

      // Give late bootstrapping scripts a brief chance to surface console errors.
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

      expect(consoleErrors, unexpectedConsoleErrorsMessage(publicPage.name, consoleErrors)).toEqual([]);
    });
  }
});

function unexpectedConsoleErrorsMessage(pageName: string, errors: string[]): string {
  return [
    `${pageName} emitted unexpected console errors.`,
    'Add noisy third-party messages to ignoredPatterns only after confirming they are non-critical.',
    ...errors.map((error) => `- ${error}`),
  ].join('\n');
}
