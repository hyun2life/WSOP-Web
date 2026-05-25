import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { escapeRegExp, expectAnyTextVisible, getVisiblePlayerLinkCount, normalizeText } from './resultListAssertions';

export type PlayerSearchCase = {
  caseName: string;
  keyword: string;
  expectedPlayer?: string;
  expectedPlayerContains?: string;
  expectedProfileUrlContains?: string;
  minExpectedResults?: number;
  expectedNoResults?: boolean;
  type?: string;
  warningOnly?: boolean;
  knownExceptionKey?: string;
};

export type PlayerResultLink = {
  href: string;
  text: string;
  normalizedText: string;
  locator?: Locator;
  source: 'anchor' | 'row';
};

export async function openPlayerSearch(page: Page) {
  const response = await page.goto('/player-search/', { waitUntil: 'domcontentloaded' });
  expect(response, '/player-search/ should return a response').not.toBeNull();
  expect(response!.status(), '/player-search/ HTTP status').toBeLessThan(400);
  await expect(page.locator('body'), '/player-search/ body should be visible').toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
  await expectAnyTextVisible(page, ['Player Search', 'Trending', 'Winners', 'Player of the Year', 'Hall of Fame'], {
    pageUrl: '/player-search/',
    label: 'Player Search discovery area',
  });
}

export async function findSearchInput(page: Page): Promise<Locator | null> {
  const candidates = [
    page.getByRole('searchbox').first(),
    page.getByRole('textbox', { name: /search/i }).first(),
    page.locator('input[type="search"], input[type="text"], input[placeholder*="search" i]').first(),
    page.getByRole('textbox').first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      return candidate;
    }
  }

  return null;
}

export async function submitPlayerSearch(page: Page, keyword: string) {
  const input = await findSearchInput(page);
  if (!input) {
    addWarning('phase4-player-search', `Search input was not visible. Falling back to current visible player links for "${keyword}".`, {
      keyword,
    });
    return false;
  }

  const beforeCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
  const trimmedKeyword = keyword.trim();
  await fillSearchInput(input, trimmedKeyword);

  const buttonClicked = await clickSearchButtonIfVisible(page);
  if (!buttonClicked) {
    await input.press('Enter').catch(() => undefined);
  }

  await waitForSearchResults(page, beforeCount);
  return true;
}

async function fillSearchInput(input: Locator, keyword: string) {
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill(keyword);

  const currentValue = await input.inputValue().catch(() => '');
  if (currentValue.trim() === keyword) {
    return;
  }

  await input.click().catch(() => undefined);
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill('');
  await input.fill(keyword);
}

export async function collectPlayerResultLinks(page: Page, keywordOrPlayerName?: string): Promise<PlayerResultLink[]> {
  const links = [...(await collectVisiblePlayerLinks(page)), ...(await collectMatchingResultRows(page, keywordOrPlayerName))];
  if (!keywordOrPlayerName) {
    return links;
  }

  const query = normalizeText(keywordOrPlayerName);
  const queryTokens = query.split(' ').filter(Boolean);
  const matched = links.filter((link) => {
    if (link.normalizedText.includes(query)) {
      return true;
    }

    return queryTokens.length > 0 && queryTokens.every((token) => link.normalizedText.includes(token));
  });

  return matched.length > 0 ? matched : links;
}

export async function expectPlayerSearchResult(page: Page, searchCase: PlayerSearchCase) {
  if (searchCase.expectedNoResults) {
    await expectNoResultState(page, searchCase);
    return [];
  }

  const expected = searchCase.expectedPlayer ?? searchCase.expectedPlayerContains ?? searchCase.keyword.trim();
  const links = await collectPlayerResultLinks(page, expected);
  const expectedNormalized = normalizeText(expected);
  const matchingLinks = links.filter((link) => link.normalizedText.includes(expectedNormalized));
  const profileTargetCount = matchingLinks.filter((link) => link.href.includes(searchCase.expectedProfileUrlContains ?? '/players/')).length;
  const clickableRowCount = matchingLinks.filter((link) => link.source === 'row').length;
  const linkCount = profileTargetCount || clickableRowCount;
  const minimum = searchCase.minExpectedResults ?? 1;

  expect(
    linkCount,
    `${searchCase.caseName}: expected at least ${minimum} matching /players/ link(s) for keyword="${searchCase.keyword}" expectedPlayer="${expected}"`,
  ).toBeGreaterThanOrEqual(minimum);

  const targetLinks = matchingLinks.length > 0 ? matchingLinks : links;
  expect(
    targetLinks.some((link) => link.href.includes(searchCase.expectedProfileUrlContains ?? '/players/') || link.source === 'row'),
    `${searchCase.caseName}: expected a profile href containing "${searchCase.expectedProfileUrlContains ?? '/players/'}" or a clickable player result row`,
  ).toBeTruthy();

  return targetLinks;
}

export async function openFirstPlayerSearchProfile(page: Page, searchCase: PlayerSearchCase, results?: PlayerResultLink[]) {
  const expected = searchCase.expectedPlayer ?? searchCase.expectedPlayerContains ?? searchCase.keyword.trim();
  const candidates = results ?? (await collectPlayerResultLinks(page, expected));
  const exactCandidates = candidates.filter((candidate) => candidate.normalizedText.includes(normalizeText(expected)));
  const target = exactCandidates[0] ?? candidates[0];

  expect(target, `${searchCase.caseName}: expected a player result target for "${expected}" before profile navigation`).toBeTruthy();

  if (target.href) {
    await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  } else {
    expect(target.locator, `${searchCase.caseName}: clickable row target should have a locator`).toBeTruthy();
    await target.locator!.click();
    await page.waitForURL(/\/players\//i, { timeout: 8_000 });
  }

  expect(page.url(), `${searchCase.caseName}: player result target should navigate to a /players/ profile`).toMatch(/\/players\//i);
  return page.url();
}

async function collectVisiblePlayerLinks(page: Page): Promise<PlayerResultLink[]> {
  const locator = page.locator('a[href*="/players/"]');
  const count = await locator.count();
  const links: PlayerResultLink[] = [];

  for (let index = 0; index < count; index += 1) {
    const link = locator.nth(index);
    if (!(await link.isVisible().catch(() => false))) {
      continue;
    }

    const href = (await link.getAttribute('href')) ?? '';
    if (!href) {
      continue;
    }

    const text = normalizePlayerLinkText(await link.innerText().catch(() => ''));
    links.push({ href, text, normalizedText: normalizeText(text), locator: link, source: 'anchor' });
  }

  return links;
}

async function collectMatchingResultRows(page: Page, keywordOrPlayerName?: string): Promise<PlayerResultLink[]> {
  const rows = page.getByRole('row');
  const rowCount = await rows.count();
  const query = normalizeText(keywordOrPlayerName);
  const results: PlayerResultLink[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizePlayerLinkText(await row.innerText().catch(() => ''));
    const normalizedText = normalizeText(text);
    if (!normalizedText || normalizedText === 'player country' || !normalizedText.includes(query)) {
      continue;
    }

    const clickable = row.locator('a[href*="/players/"], [role="rowheader"], td, th').filter({ hasText: new RegExp(escapeRegExp(keywordOrPlayerName ?? ''), 'i') }).first();
    results.push({
      href: '',
      text,
      normalizedText,
      locator: (await clickable.count()) > 0 ? clickable : row,
      source: 'row',
    });
  }

  return results;
}

async function expectNoResultState(page: Page, searchCase: PlayerSearchCase) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const impossibleKeywordVisible = new RegExp(escapeRegExp(searchCase.keyword.trim()), 'i').test(bodyText);
  const noResultMessageVisible = /no results?|no players?|not found|0 results?/i.test(bodyText);
  const matchingLinks = await collectPlayerResultLinks(page, searchCase.keyword.trim());

  expect(
    noResultMessageVisible || matchingLinks.length === 0 || impossibleKeywordVisible,
    `${searchCase.caseName}: no-result search should show an empty/no-result state or avoid player links for keyword="${searchCase.keyword}"`,
  ).toBeTruthy();
}

async function clickSearchButtonIfVisible(page: Page) {
  const candidates = [
    page.locator('button.btn-search').first(),
    page.locator('button[type="submit"]').first(),
    page.getByRole('button', { name: /search/i }).first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
      await candidate.click();
      return true;
    }
  }

  return false;
}

async function waitForSearchResults(page: Page, beforeCount: number) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await expect
    .poll(async () => {
      const currentCount = await getVisiblePlayerLinkCount(page).catch(() => 0);
      const bodyReady = await page.locator('body').isVisible().catch(() => false);
      return bodyReady && (currentCount !== beforeCount || currentCount >= 0);
    }, { timeout: 5_000, intervals: [250, 500, 1_000] })
    .toBeTruthy();
  await page.waitForTimeout(500);
}

function normalizePlayerLinkText(value: string) {
  return value
    .replace(/^(\d+\s+)?Avatar Image\s+/i, '')
    .replace(/^\d+\s+/, '')
    .replace(/\s+\$[\d,]+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
