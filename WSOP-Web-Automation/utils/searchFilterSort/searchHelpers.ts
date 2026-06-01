import { expect, type Locator, type Page } from '@playwright/test';

import { addWarning } from '../playerPresentation/warningCollector';
import { type KnownException } from '../playerPresentation/playerPresentationChecks';
import { escapeRegExp, expectAnyTextVisible, getVisiblePlayerLinkCount, normalizeText } from './resultListAssertions';

export type PlayerSearchCase = {
  caseName: string;
  keyword: string;
  expectedPlayer?: string;
  expectedPlayerContains?: string;
  expectedCountry?: string;
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

export async function expectPlayerAutocompleteResult(
  page: Page,
  searchCase: PlayerSearchCase,
  knownException?: KnownException,
) {
  const input = await findSearchInput(page);
  if (!input) {
    addWarning('phase4-player-autocomplete', `Search input was not visible. Autocomplete cannot be checked for "${searchCase.keyword}".`, {
      keyword: searchCase.keyword,
      expectedPlayer: searchCase.expectedPlayer,
    });
    return false;
  }

  const keyword = searchCase.keyword.trim();
  const expected = searchCase.expectedPlayer ?? searchCase.expectedPlayerContains ?? keyword;
  try {
    await typeAutocompleteKeyword(input, keyword);

    const suggestion = autocompleteSuggestion(page, expected);
    await expect
      .poll(async () => {
        const inputValue = await input.inputValue().catch(() => '');
        if (inputValue.trim() !== keyword) {
          await typeAutocompleteKeyword(input, keyword);
        }

        return (await suggestion.count()) > 0 && (await suggestion.first().isVisible().catch(() => false));
      }, {
        message: `${searchCase.caseName}: autocomplete should show "${expected}" after typing "${keyword}"`,
        timeout: 6_000,
        intervals: [300, 700, 1_200],
      })
      .toBeTruthy();

    await expectAutocompleteCountryOrFlag(suggestion.first(), searchCase);
  } catch (error) {
    if (knownException?.warningOnly || searchCase.warningOnly) {
      addWarning(searchCase.caseName, `Autocomplete validation failed but allowed as warning: ${(error as Error).message}`, {
        keyword,
        expected,
        reason: knownException?.reason,
      });
      return false;
    }
    throw error;
  }
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

async function typeAutocompleteKeyword(input: Locator, keyword: string) {
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill('').catch(() => undefined);
  await input.type(keyword, { delay: 30 });

  const currentValue = await input.inputValue().catch(() => '');
  if (currentValue.trim() === keyword) {
    return;
  }

  await input.click().catch(() => undefined);
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill(keyword).catch(() => undefined);
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

export async function expectPlayerSearchResult(
  page: Page,
  searchCase: PlayerSearchCase,
  knownException?: KnownException,
) {
  if (searchCase.expectedNoResults) {
    await expectNoResultState(page, searchCase);
    return [];
  }

  const expected = searchCase.expectedPlayer ?? searchCase.expectedPlayerContains ?? searchCase.keyword.trim();
  try {
    const expectedNormalized = normalizeText(expected);
    const minimum = searchCase.minExpectedResults ?? 1;
    let targetLinks: PlayerResultLink[] = [];

    await expect.poll(async () => {
      const links = await collectPlayerResultLinks(page, expected);
      const matchingLinks = links.filter((link) => link.normalizedText.includes(expectedNormalized));
      const profileTargetCount = matchingLinks.filter((link) => link.href.includes(searchCase.expectedProfileUrlContains ?? '/players/')).length;
      const clickableRowCount = matchingLinks.filter((link) => link.source === 'row').length;
      const linkCount = profileTargetCount || clickableRowCount;
      
      targetLinks = matchingLinks.length > 0 ? matchingLinks : links;
      
      return linkCount >= minimum && targetLinks.some((link) => link.href.includes(searchCase.expectedProfileUrlContains ?? '/players/') || link.source === 'row');
    }, {
      message: `${searchCase.caseName}: expected at least ${minimum} matching player link(s) for "${expected}"`,
      timeout: 10_000,
    }).toBeTruthy();

    return targetLinks;
  } catch (error) {
    if (knownException?.warningOnly || searchCase.warningOnly) {
      addWarning(searchCase.caseName, `Search result validation failed but allowed as warning: ${(error as Error).message}`, {
        expected,
        reason: knownException?.reason,
      });
      return [];
    }
    throw error;
  }
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

function autocompleteSuggestion(page: Page, expectedPlayer: string) {
  const pattern = new RegExp(escapeRegExp(expectedPlayer), 'i');
  return page
    .locator(
      [
        '.autocomplete-container li',
        '[class*="autocomplete" i] li',
        '[class*="autocomplete" i] [role="option"]',
        '[class*="autocomplete" i] tr',
        '[class*="autocomplete" i] [class*="item" i]',
      ].join(', '),
    )
    .filter({ hasText: pattern });
}

async function expectAutocompleteCountryOrFlag(suggestion: Locator, searchCase: PlayerSearchCase) {
  if (!searchCase.expectedCountry) {
    addWarning('phase4-player-autocomplete-country', `No expectedCountry fixture value for autocomplete case "${searchCase.caseName}".`, {
      keyword: searchCase.keyword,
      expectedPlayer: searchCase.expectedPlayer,
    });
    return;
  }

  const aliases = countryAliases(searchCase.expectedCountry);
  const countryCodes = countryFlagCodes(searchCase.expectedCountry);
  const text = await suggestion.innerText().catch(() => '');
  if (aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(text))) {
    return;
  }

  const flagImages = await suggestion
    .locator('img')
    .evaluateAll((images) =>
      images.map((image) => ({
        alt: image.getAttribute('alt') || '',
        title: image.getAttribute('title') || '',
        src: image.getAttribute('src') || '',
        srcset: image.getAttribute('srcset') || '',
        className: image.getAttribute('class') || '',
      })),
    )
    .catch(() => []);
  const expectedNeedles = [...aliases, ...countryCodes].map(normalizeComparable);
  const matched = flagImages.some((image) =>
    [image.alt, image.title, image.src, image.srcset, image.className].some((value) =>
      expectedNeedles.some((needle) => normalizeComparable(value).includes(needle)),
    ),
  );

  expect(
    matched,
    `${searchCase.caseName}: autocomplete should show expected country/flag "${searchCase.expectedCountry}". Found flags: ${JSON.stringify(flagImages)}`,
  ).toBeTruthy();
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
  await expect.poll(async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const noResultMessageVisible = /no results?|no players?|not found|0 results?/i.test(bodyText);
    const matchingLinks = await collectPlayerResultLinks(page, searchCase.keyword.trim());
    return noResultMessageVisible || matchingLinks.length === 0;
  }, {
    message: `${searchCase.caseName}: no-result search should show empty/no-result state or avoid player links for "${searchCase.keyword}"`,
    timeout: 10_000,
  }).toBeTruthy();
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

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function countryAliases(country: string): string[] {
  const normalized = normalizeComparable(country);
  const aliases: Record<string, string[]> = {
    unitedstates: ['United States', 'USA', 'US', 'Country Code - US'],
    canada: ['Canada', 'CAN', 'CA', 'Country Code - CA'],
  };

  return aliases[normalized] ?? [country];
}

function countryFlagCodes(country: string): string[] {
  const normalized = normalizeComparable(country);
  const codes: Record<string, string[]> = {
    unitedstates: ['US'],
    canada: ['CA'],
  };

  return codes[normalized] ?? [];
}
