import { expect, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { escapeRegExp, expectAnyTextVisible } from './resultListAssertions';

export async function clickTabOrSection(page: Page, label: string) {
  const pattern = new RegExp(escapeRegExp(label), 'i');
  const candidates = [
    page.getByRole('tab', { name: pattern }).first(),
    page.getByRole('button', { name: pattern }).first(),
    page.getByRole('link', { name: pattern }).first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click();
      await waitForListStabilized(page);
      return 'clicked' as const;
    }
  }

  const sectionHeading = page.getByRole('heading', { name: pattern }).first();
  if ((await sectionHeading.count()) > 0 && (await sectionHeading.isVisible().catch(() => false))) {
    addWarning('phase4-section-heading', `${label} is visible as a heading/section, not a clickable tab.`, { label });
    return 'heading-only' as const;
  }

  const textOnly = page.locator('body').filter({ hasText: pattern });
  await expect(textOnly, `${label} tab/section should be visible`).toBeVisible();
  addWarning('phase4-section-text', `${label} was found as text but no clickable tab/button/link was available.`, { label });
  return 'text-only' as const;
}

export async function expectSectionVisible(page: Page, labels: string[]) {
  await expectAnyTextVisible(page, labels, { label: 'section labels' });
}

export async function waitForListStabilized(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await expect(page.locator('body'), 'Page body should remain visible after tab/section interaction').toBeVisible();
}
