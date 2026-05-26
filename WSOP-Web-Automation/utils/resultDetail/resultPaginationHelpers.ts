import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { collectResultDetailPlayerRows, type ResultDetailPlayerRow, type ResultKnownException } from './resultDetailHelpers';
import { normalizePlayerName, normalizeText } from './resultRowAssertions';

export async function findResultPaginationControls(page: Page): Promise<Locator[]> {
  const candidates = [
    page.getByRole('button', { name: /next|load more|show more|more/i }).first(),
    page.getByRole('link', { name: /next|load more|show more|more/i }).first(),
    page.locator('button, a').filter({ hasText: /next|load more|show more|more/i }).first(),
    page.locator('[class*="pagination" i] a, [class*="paging" i] a, [class*="pager" i] a').last(),
  ];

  const visible: Locator[] = [];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      visible.push(candidate);
    }
  }
  return visible;
}

export async function searchPlayerAcrossResultPages(
  page: Page,
  player: { displayName: string },
  maxActions = 2,
): Promise<{ row: ResultDetailPlayerRow | null; actions: number; limited: boolean }> {
  const normalizedPlayer = normalizePlayerName(player.displayName);

  const currentRows = await collectResultDetailPlayerRows(page);
  const currentMatch = findRowFromCollection(currentRows, normalizedPlayer);
  if (currentMatch) {
    return { row: currentMatch, actions: 0, limited: false };
  }

  const controls = await findResultPaginationControls(page);
  if (controls.length === 0) {
    return { row: null, actions: 0, limited: false };
  }

  const target = controls[0];
  for (let action = 1; action <= maxActions; action += 1) {
    await target.click({ timeout: 5_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await assertResultPageDidNotBreak(page);

    const rows = await collectResultDetailPlayerRows(page);
    const match = findRowFromCollection(rows, normalizedPlayer);
    if (match) {
      return { row: match, actions: action, limited: false };
    }
  }

  addWarning('phase5-result-pagination-limit', 'Player row was not found within limited pagination/load-more actions.', {
    displayName: player.displayName,
    maxActions,
    pageUrl: page.url(),
  });
  return { row: null, actions: maxActions, limited: true };
}

export async function assertResultPageDidNotBreak(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  const bodyText = await page.locator('body').innerText().catch(() => '');
  expect(/page not found|server error|\b(404|500)\b/i.test(bodyText), 'Result detail page should not show 4xx/5xx error text').toBeFalsy();

  const rows = await collectResultDetailPlayerRows(page);
  const hasListSurface = rows.length > 0 || normalizeText(bodyText).includes('no results');
  expect(hasListSurface, 'Result detail page should keep table/list/player rows visible after pagination action').toBeTruthy();
}

function findRowFromCollection(rows: ResultDetailPlayerRow[], normalizedPlayerName: string) {
  return (
    rows.find((row) => normalizePlayerName(row.playerName) === normalizedPlayerName) ??
    rows.find((row) => normalizePlayerName(row.rowText).includes(normalizedPlayerName))
  );
}
