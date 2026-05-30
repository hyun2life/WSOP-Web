import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { collectResultDetailPlayerRows, type ResultDetailPlayerRow } from './resultDetailHelpers';
import { normalizePlayerName, normalizeText } from './resultRowAssertions';

export async function findResultPaginationControls(page: Page): Promise<Locator[]> {
  const candidates = [
    page.getByRole('button', { name: /\b(next|load more|show more|more)\b/i }).first(),
    page.getByRole('link', { name: /\b(next|load more|show more|more)\b/i }).first(),
    page.locator('button, a').filter({ hasText: /\b(next|load more|show more|more)\b/i }).first(),
    page.locator('[class*="pagination" i] a, [class*="paging" i] a, [class*="pager" i] a').first(),
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

  for (let action = 1; action <= maxActions; action += 1) {
    const roundControls = await findResultPaginationControls(page);
    if (roundControls.length === 0) {
      return { row: null, actions: action - 1, limited: true };
    }

    const target = await pickBestPaginationControl(roundControls);
    const clicked = await safeClick(target);
    if (!clicked) {
      addWarning('phase5-result-pagination-click-failed', 'Pagination control click could not be completed reliably.', {
        displayName: player.displayName,
        action,
        pageUrl: page.url(),
      });
      return { row: null, actions: action, limited: true };
    }

    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    const pageHealthy = await assertResultPageDidNotBreak(page);
    if (!pageHealthy) {
      addWarning('phase5-result-pagination-page-break', 'Result page became unstable during pagination search.', {
        displayName: player.displayName,
        action,
        pageUrl: page.url(),
      });
      return { row: null, actions: action, limited: true };
    }

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

export async function assertResultPageDidNotBreak(page: Page): Promise<boolean> {
  try {
    await expect(page.locator('body')).toBeVisible();
  } catch {
    return false;
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/page not found|server error|\b(404|500)\b/i.test(bodyText)) {
    return false;
  }

  const rows = await collectResultDetailPlayerRows(page);
  const hasListSurface = rows.length > 0 || normalizeText(bodyText).includes('no results');
  return hasListSurface;
}

function findRowFromCollection(rows: ResultDetailPlayerRow[], normalizedPlayerName: string) {
  return (
    rows.find((row) => normalizePlayerName(row.playerName) === normalizedPlayerName) ??
    rows.find((row) => normalizePlayerName(row.rowText).includes(normalizedPlayerName))
  );
}

async function pickBestPaginationControl(controls: Locator[]): Promise<Locator> {
  for (const control of controls) {
    if (!(await isActiveControl(control)) && (await isEnabledControl(control))) {
      return control;
    }
  }
  return controls[0];
}

async function safeClick(target: Locator): Promise<boolean> {
  try {
    await target.click({ timeout: 5_000 });
    return true;
  } catch {
    // Continue fallback.
  }

  try {
    await target.click({ timeout: 5_000, force: true });
    return true;
  } catch {
    // Continue fallback.
  }

  try {
    await target.evaluate((el) => (el as HTMLElement).click());
    return true;
  } catch {
    return false;
  }
}

async function isActiveControl(control: Locator): Promise<boolean> {
  return control
    .evaluate((element) => {
      const classes = String((element as HTMLElement).className || '');
      return element.getAttribute('aria-current') === 'page' || /\bactive\b/i.test(classes);
    })
    .catch(() => false);
}

async function isEnabledControl(control: Locator): Promise<boolean> {
  return control
    .evaluate((element) => {
      const classes = String((element as HTMLElement).className || '');
      return !(element as HTMLButtonElement).disabled && element.getAttribute('aria-disabled') !== 'true' && !/\bdisabled\b/i.test(classes);
    })
    .catch(() => false);
}
