import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { escapeRegExp, getVisiblePlayerLinkCount } from './resultListAssertions';

const SORTABLE_COLUMNS = ['Rank', 'Player', 'Country', 'Earnings', 'Bracelets', 'Rings', 'Cashes'];

export async function findSortableHeaders(page: Page): Promise<Locator[]> {
  const visible: Locator[] = [];
  for (const column of SORTABLE_COLUMNS) {
    const pattern = new RegExp(`^\\s*${escapeRegExp(column)}\\s*$`, 'i');
    const candidates = [
      page.getByRole('columnheader', { name: pattern }).first(),
      page.getByRole('button', { name: pattern }).first(),
      page.getByRole('link', { name: pattern }).first(),
      page.locator('th, button, a').filter({ hasText: pattern }).first(),
    ];

    for (const candidate of candidates) {
      if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
        visible.push(candidate);
        break;
      }
    }
  }

  return visible;
}

export async function clickSortIfExists(page: Page, columnName: string) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(columnName)}\\s*$`, 'i');
  const candidates = [
    page.getByRole('columnheader', { name: pattern }).first(),
    page.getByRole('button', { name: pattern }).first(),
    page.getByRole('link', { name: pattern }).first(),
    page.locator('th, button, a').filter({ hasText: pattern }).first(),
  ];

  let target: Locator | null = null;
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      target = candidate;
      break;
    }
  }

  if (!target) {
    addWarning('phase4-sort', `Sortable UI for column "${columnName}" was not visible.`);
    return false;
  }

  const beforeCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
  await target.click();
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
  const afterCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
  expect(afterCount, `List should not break after sorting by ${columnName}`).toBeGreaterThanOrEqual(Math.min(beforeCount, 1));
  return true;
}
