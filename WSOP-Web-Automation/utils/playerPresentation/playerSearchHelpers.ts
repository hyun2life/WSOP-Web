import { expect, type Locator, type Page } from '@playwright/test';

import {
  escapeRegExp,
  normalizeProfileTarget,
  playerNamePattern,
  type KnownException,
  type PlayerFixture,
} from './playerPresentationChecks';
import { addWarning } from './warningCollector';

export type FoundPlayerProfileLink = {
  locator: Locator;
  href: string;
  distinctTargets: string[];
};

export async function openPlayerSearch(page: Page) {
  const response = await page.goto('/player-search/', { waitUntil: 'domcontentloaded' });
  expect(response, '/player-search/ should return a response').not.toBeNull();
  expect(response!.status(), '/player-search/ HTTP status').toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  const body = page.locator('body');
  await expect(
    body.filter({ hasText: /Player Search|Trending|Winners|Player of the Year|Hall of Fame/i }),
    'Player Search or related player discovery area should be visible',
  ).toBeVisible();
}

export async function searchPlayerIfSearchInputExists(page: Page, keyword: string, testName = 'player-search') {
  const input = await findSearchInput(page);
  if (!input) {
    addWarning(testName, `Search input was not visible. Falling back to current player list for "${keyword}".`, { keyword });
    return false;
  }

  await enterSearchKeyword(input, keyword);

  const clickedButton = await clickFirstVisibleSearchButton(page);
  if (!clickedButton) {
    await input.press('Enter').catch(() => undefined);
  }

  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1_250);

  const keywordVisible = await page
    .locator('body')
    .filter({ hasText: new RegExp(escapeRegExp(keyword), 'i') })
    .isVisible()
    .catch(() => false);
  const inputStillHasKeyword = (await input.inputValue().catch(() => '')).toLowerCase().includes(keyword.toLowerCase());

  if (!keywordVisible && !inputStillHasKeyword) {
    await enterSearchKeyword(input, keyword);
    const retriedButton = await clickFirstVisibleSearchButton(page);
    if (!retriedButton) {
      await input.press('Enter').catch(() => undefined);
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_250);
  }

  return true;
}

export async function expectPlayerAutocompleteVisible(
  page: Page,
  player: PlayerFixture,
  testName = 'player-autocomplete',
  knownException?: KnownException,
) {
  const keyword = player.searchKeyword ?? player.displayName;
  const input = await findSearchInput(page);
  expect(input, `Player Search input should be visible before checking autocomplete for ${player.displayName}`).not.toBeNull();

  const suggestion = autocompleteSuggestion(page, player);
  try {
    await expect
      .poll(
        async () => {
          const currentValue = await input!.inputValue().catch(() => '');
          if (currentValue.trim() !== keyword.trim()) {
            await enterSearchKeyword(input!, keyword);
          }
          return (await suggestion.count()) > 0 && (await suggestion.first().isVisible().catch(() => false));
        },
        {
          message: `${player.displayName} should be visible in autocomplete/search preview after typing "${keyword}"`,
          timeout: 8_000,
          intervals: [400, 800, 1_600],
        },
      )
      .toBeTruthy();

    await expectAutocompleteSuggestionCountryOrFlag(suggestion.first(), player, testName);
  } catch (error) {
    if (knownException?.warningOnly) {
      addWarning(testName, `Autocomplete validation failed for ${player.displayName} but allowed as warning: ${(error as Error).message}`, {
        player: player.displayName,
        reason: knownException.reason,
      });
      return;
    }
    throw error;
  }

  void testName;
}

export async function expectPlayerVisibleInSearchResults(
  page: Page,
  player: PlayerFixture,
  knownException?: KnownException,
) {
  const visible = await isPlayerVisibleInSearchSurface(page, player);
  if (!visible && knownException?.warningOnly) {
    addWarning('search-results', `Player ${player.displayName} was not visible in search results but allowed as warning.`, {
      player: player.displayName,
      reason: knownException.reason,
    });
    return;
  }
  expect(visible, `${player.displayName} should be visible in Player Search results`).toBeTruthy();
}

export async function findPlayerProfileLink(
  page: Page,
  player: PlayerFixture,
  knownException?: KnownException,
): Promise<FoundPlayerProfileLink> {
  let links = await collectMatchingProfileLinks(page, player);
  if (links.length === 0) {
    links = await collectClickableProfileRowTargets(page, player);
  }

  expect(
    links.length,
    `${player.displayName} should have at least one /players/ profile link in the current result set`,
  ).toBeGreaterThan(0);

  const expectedTarget = player.profileUrl ? normalizeProfileTarget(player.profileUrl) : null;
  const preferred = expectedTarget ? links.filter((link) => link.normalizedTarget === expectedTarget) : links;
  const usableLinks = preferred.length > 0 ? preferred : links;
  const distinctTargets = Array.from(new Set(links.map((link) => link.normalizedTarget)));

  if (distinctTargets.length > 1) {
    addWarning(player.displayName, `${player.displayName} resolved to multiple profile targets in Player Search`, {
      targets: distinctTargets,
      knownException: knownException?.reason,
    });
  }

  if (links.length > 1 && knownException?.allowMultipleContextMentions) {
    addWarning(player.displayName, `${player.displayName} appeared in multiple contexts but resolved to one profile target`, {
      target: distinctTargets[0],
      linkCount: links.length,
      reason: knownException.reason,
    });
  }

  return {
    locator: usableLinks[0].locator,
    href: usableLinks[0].href,
    distinctTargets,
  };
}

export async function assertSingleIdentityTarget(page: Page, player: PlayerFixture, knownException?: KnownException) {
  const result = await findPlayerProfileLink(page, player, knownException);

  if (knownException?.requireSingleProfileTarget) {
    expect(
      result.distinctTargets.length,
      `${player.displayName} known exception still requires a single profile target`,
    ).toBe(1);
  }

  return result;
}

async function findSearchInput(page: Page): Promise<Locator | null> {
  const searchbox = page.getByRole('searchbox');
  if ((await searchbox.count()) > 0 && (await searchbox.first().isVisible().catch(() => false))) {
    return searchbox.first();
  }

  const labelledSearch = page.getByRole('textbox', { name: /search/i });
  if ((await labelledSearch.count()) > 0 && (await labelledSearch.first().isVisible().catch(() => false))) {
    return labelledSearch.first();
  }

  const fallback = page.locator('input[type="search"], input[type="text"], input[placeholder*="search" i]');
  if ((await fallback.count()) > 0 && (await fallback.first().isVisible().catch(() => false))) {
    return fallback.first();
  }

  const roleTextbox = page.getByRole('textbox');
  if ((await roleTextbox.count()) > 0 && (await roleTextbox.first().isVisible().catch(() => false))) {
    return roleTextbox.first();
  }

  return null;
}

async function enterSearchKeyword(input: Locator, keyword: string) {
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill('').catch(() => undefined);
  await input.type(keyword, { delay: 35 });

  const currentValue = await input.inputValue().catch(() => '');
  if (currentValue.trim() === keyword.trim()) {
    return;
  }

  await input.click().catch(() => undefined);
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
  await input.fill(keyword).catch(() => undefined);
}

async function clickFirstVisibleSearchButton(page: Page) {
  const candidates = [
    page.locator('button.btn-search').first(),
    page.locator('button[type="submit"]').first(),
    page.getByRole('button', { name: /search/i }).first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) {
      continue;
    }

    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    await candidate.click();
    return true;
  }

  return false;
}

async function collectMatchingProfileLinks(page: Page, player: PlayerFixture) {
  const namePattern = playerNamePattern(player.displayName);
  const keywordPattern = new RegExp(escapeRegExp(player.searchKeyword ?? player.displayName), 'i');
  let locator = page.locator('a[href*="/players/"]').filter({ hasText: namePattern });
  if ((await locator.count()) === 0) {
    locator = page.locator('a[href*="/players/"]').filter({ hasText: keywordPattern });
  }
  const count = await locator.count();
  const links: Array<{ locator: Locator; href: string; normalizedTarget: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const href = (await candidate.getAttribute('href')) ?? '';
    if (!href) {
      continue;
    }

    links.push({ locator: candidate, href, normalizedTarget: normalizeProfileTarget(href) });
  }

  if (links.length === 0 && player.profileUrl) {
    const expectedLocator = page.locator(`a[href="${player.profileUrl}"], a[href="${player.profileUrl.replace(/\/$/, '')}"]`);
    const expectedCount = await expectedLocator.count();
    for (let index = 0; index < expectedCount; index += 1) {
      const candidate = expectedLocator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const href = (await candidate.getAttribute('href')) ?? player.profileUrl;
      links.push({ locator: candidate, href, normalizedTarget: normalizeProfileTarget(href) });
    }
  }

  return links;
}

async function collectClickableProfileRowTargets(page: Page, player: PlayerFixture) {
  const rowCount = await matchingPlayerRows(page, player).count();
  const links: Array<{ locator: Locator; href: string; normalizedTarget: string }> = [];
  const maxRowsToProbe = Math.min(rowCount, 3);

  for (let index = 0; index < maxRowsToProbe; index += 1) {
    if (index > 0) {
      await openPlayerSearch(page);
      await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `profile-row-target-${player.displayName}`);
    }

    const rows = matchingPlayerRows(page, player);
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) {
      continue;
    }

    const nameTarget = row.getByText(playerNamePattern(player.displayName)).first();
    await nameTarget.click({ timeout: 3_000 }).catch(async () => {
      await row.click({ timeout: 3_000 });
    });

    await page.waitForURL(/\/players\//i, { timeout: 5_000 }).catch(() => undefined);
    const href = page.url();
    if (!/\/players\//i.test(href)) {
      continue;
    }

    links.push({
      locator: row,
      href,
      normalizedTarget: normalizeProfileTarget(href),
    });

    if (new Set(links.map((link) => link.normalizedTarget)).size > 1) {
      break;
    }
  }

  return links;
}

function matchingPlayerRows(page: Page, player: PlayerFixture) {
  return page.getByRole('row').filter({ hasText: playerNamePattern(player.displayName) });
}

function autocompleteSuggestion(page: Page, player: PlayerFixture) {
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
    .filter({ hasText: playerNamePattern(player.displayName) });
}

async function expectAutocompleteSuggestionCountryOrFlag(suggestion: Locator, player: PlayerFixture, testName: string) {
  if (!player.expectedCountry) {
    addWarning(testName, `No expectedCountry fixture value for autocomplete suggestion: ${player.displayName}`, {
      player: player.displayName,
    });
    return;
  }

  const aliases = countryAliases(player.expectedCountry);
  const countryCodes = countryFlagCodes(player.expectedCountry);
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
    `${player.displayName} autocomplete suggestion should show expected country/flag: ${player.expectedCountry}. Found flags: ${JSON.stringify(flagImages)}`,
  ).toBeTruthy();
}

async function isPlayerVisibleInSearchSurface(page: Page, player: PlayerFixture) {
  const matchingRows = matchingPlayerRows(page, player);
  if ((await matchingRows.count()) > 0 && (await matchingRows.first().isVisible().catch(() => false))) {
    return true;
  }

  const matchingLinks = page.locator('a[href*="/players/"]').filter({ hasText: playerNamePattern(player.displayName) });
  if ((await matchingLinks.count()) > 0 && (await matchingLinks.first().isVisible().catch(() => false))) {
    return true;
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  return playerNamePattern(player.displayName).test(bodyText);
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
