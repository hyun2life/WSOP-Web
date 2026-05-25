import { expect, test } from '@playwright/test';
import { publicPages } from '../../data/public-pages';

const MAX_LINKS_PER_PAGE = 30;
const INTERNAL_HOST_PATTERN = /(^|\.)wsop\.com$/i;
const ALLOWED_SECURITY_STATUS_CODES = new Set([403, 405]);

test.describe('Internal links smoke', () => {
  for (const publicPage of publicPages) {
    test(`${publicPage.name} has no broken sampled internal links`, async ({ page, request, baseURL }) => {
      await page.goto(publicPage.url, { waitUntil: 'domcontentloaded' });

      const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
        anchors
          .map((anchor) => anchor.getAttribute('href')?.trim())
          .filter((href): href is string => Boolean(href)),
      );

      const internalLinks = unique(
        hrefs
          .map((href) => toAbsoluteInternalUrl(href, baseURL))
          .filter((href): href is string => Boolean(href)),
      ).slice(0, MAX_LINKS_PER_PAGE);

      const brokenLinks: string[] = [];

      for (const href of internalLinks) {
        const response = await request.get(href, { failOnStatusCode: false });
        const status = response.status();

        // Some WSOP/security layers intentionally return 403 or 405 for bot-like requests.
        // Treat them as reachable-but-blocked in this smoke suite; tighten this if your team
        // wants those responses to fail the release gate.
        if (status >= 400 && !ALLOWED_SECURITY_STATUS_CODES.has(status)) {
          brokenLinks.push(`${status} ${href}`);
        }
      }

      expect(brokenLinks, `Broken internal links from ${publicPage.name}`).toEqual([]);
    });
  }
});

function toAbsoluteInternalUrl(href: string, baseURL?: string): string | null {
  const normalizedHref = href.trim();

  if (
    normalizedHref === '' ||
    normalizedHref.startsWith('#') ||
    /^mailto:/i.test(normalizedHref) ||
    /^tel:/i.test(normalizedHref) ||
    /^javascript:/i.test(normalizedHref)
  ) {
    return null;
  }

  try {
    const url = new URL(normalizedHref, baseURL ?? 'https://www.wsop.com');
    url.hash = '';

    if (!INTERNAL_HOST_PATTERN.test(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
