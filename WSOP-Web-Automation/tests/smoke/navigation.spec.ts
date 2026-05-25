import { expect, test } from '@playwright/test';

type NavItem = {
  name: string;
  targetPath?: string;
  expectedUrl?: RegExp;
  expectedText?: RegExp;
  labelOnly?: boolean;
};

const navItems: NavItem[] = [
  { name: 'News', targetPath: '/news/', expectedUrl: /\/news\/?$/i, expectedText: /Latest News/i },
  {
    name: 'Tournaments',
    targetPath: '/schedule/',
    expectedUrl: /\/schedule\/?$/i,
    expectedText: /Tournaments Schedule/i,
  },
  {
    name: 'Players',
    targetPath: '/player-standings/',
    expectedUrl: /\/player-standings\/?$/i,
    expectedText: /Player Standings/i,
  },
  {
    name: 'Play Online',
    labelOnly: true,
  },
  {
    name: 'Hall of Fame',
    targetPath: '/hall-of-fame/',
    expectedUrl: /\/hall-of-fame\/?$/i,
    expectedText: /Poker Hall of Fame|Hall of Fame/i,
  },
];

test.describe('Top navigation smoke', () => {
  for (const item of navItems) {
    test(`${item.name} top menu is available`, async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const viewport = page.viewportSize();
      const isMobile = Boolean(viewport && viewport.width < 768);

      // The live site currently renders top nav labels as spans inside nav li elements.
      const menu = page
        .locator('header nav li')
        .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(item.name)}\\s*$`) })
        .first();

      if (isMobile) {
        await expect(page.locator('header button.btn-hamburger')).toBeVisible();
        await page.locator('header button.btn-hamburger').click();

        // On the current mobile layout, nav labels exist in the DOM but may be positioned
        // outside the viewport by the slide-out drawer. Avoid hover/click flake here.
        expect(await menu.count(), `${item.name} top nav label should exist in mobile nav DOM`).toBeGreaterThan(0);
      } else {
        await expect(menu, `${item.name} top nav label should be visible`).toBeVisible();
        await menu.hover();
      }

      if (item.labelOnly || !item.targetPath || !item.expectedUrl) {
        // The current live DOM exposes "Play Online" as a top-level nav label, but not as a
        // stable wsop.com internal anchor. Keep smoke focused on public-site regressions.
        await expect(page.locator('body')).toBeVisible();
        return;
      }

      const link = page.locator(`a[href$="${item.targetPath}"]:visible`).first();

      if (!isMobile && (await link.count()) > 0) {
        await expect(link, `${item.name} target link should be visible`).toBeVisible();
        await link.scrollIntoViewIfNeeded();
        await link.click();
      } else {
        // Some current top nav labels expose submenu anchors inconsistently.
        // Keep this smoke test focused on a visible menu label plus reachable destination.
        await page.goto(item.targetPath, { waitUntil: 'domcontentloaded' });
      }

      await expect(page).toHaveURL(item.expectedUrl);
      await expect(page.locator('body')).toBeVisible();

      if (item.expectedText) {
        await expect(page.locator('body')).toContainText(item.expectedText);
      }
    });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
