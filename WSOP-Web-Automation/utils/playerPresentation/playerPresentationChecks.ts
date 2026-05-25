import { expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { addWarning } from './warningCollector';

export type KnownException = {
  reason?: string;
  allowMultipleContextMentions?: boolean;
  requireSingleProfileTarget?: boolean;
  warningOnly?: boolean;
};

export type PlayerFixture = {
  displayName: string;
  searchKeyword?: string;
  profileUrl?: string;
  expectedCountry?: string;
  identityType?: string[];
  expectedMarks?: string[];
  knownExceptionKey?: string;
  poyYears?: number[];
};

export type ProfileImageCandidate = {
  src: string;
  alt: string;
  title: string;
  className: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  matchesAvatar: boolean;
  matchesCountry: boolean;
};

export type CheckPolicy = 'fail' | 'warn';

export function loadPlayerPresentationFixture<T>(fileName: string): T {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'player-presentation', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as T;
}

export function resolveKnownException(player: PlayerFixture, exceptions: Record<string, KnownException>): KnownException | undefined {
  if (!player.knownExceptionKey) {
    return undefined;
  }

  return exceptions[player.knownExceptionKey];
}

export async function expectPlayerNameVisible(page: Page, displayName: string) {
  const namePattern = playerNamePattern(displayName);
  const primary = page
    .locator('h1, h2, [class*="profile" i], [class*="player" i], [data-testid*="profile" i], [data-testid*="player" i]')
    .filter({ hasText: namePattern });

  if ((await primary.count()) > 0) {
    await expect(primary.first(), `Player name "${displayName}" should be visible in the profile/player header area`).toBeVisible();
    return;
  }

  const bodyText = await page.locator('body').innerText();
  expect(
    namePattern.test(bodyText),
    `Player name "${displayName}" was not found in profile/player header areas or body fallback`,
  ).toBeTruthy();
}

export async function expectProfilePageLoaded(page: Page, player: PlayerFixture) {
  expect(player.profileUrl, `${player.displayName} should have a profileUrl fixture value`).toBeTruthy();

  const response = await page.goto(player.profileUrl!, { waitUntil: 'domcontentloaded' });
  expect(response, `${player.displayName} profile should return a response: ${player.profileUrl}`).not.toBeNull();
  expect(response!.status(), `${player.displayName} profile HTTP status: ${player.profileUrl}`).toBeLessThan(400);

  await expect(page.locator('body'), `${player.displayName} profile body should be visible`).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  await expectPlayerNameVisible(page, player.displayName);

  const profileSignals = page.locator('body').filter({
    hasText: /Player Profile|Stats|Bracelets|Rings|Total Earnings|Career WSOP Winnings|Final Tables|Cashes/i,
  });
  await expect(
    profileSignals,
    `${player.displayName} profile should expose at least one profile/stat signal`,
  ).toBeVisible();
}

export async function checkCountryOrFlagVisible(
  page: Page,
  player: PlayerFixture,
  options: { policy?: CheckPolicy; testName?: string } = {},
) {
  if (!player.expectedCountry) {
    addWarning(options.testName ?? player.displayName, `No expectedCountry fixture value for ${player.displayName}`, {
      player: player.displayName,
    });
    return;
  }

  const expectedCountry = player.expectedCountry;
  const aliases = countryAliases(expectedCountry);
  const bodyText = await page.locator('body').innerText();
  if (aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(bodyText))) {
    return;
  }

  const candidates = await collectProfileImageCandidates(page);
  const countryNeedles = aliases.map(normalizeComparable);
  const matchingFlag = candidates.find((candidate) =>
    [candidate.alt, candidate.title, candidate.src, candidate.className].some((value) =>
      countryNeedles.some((needle) => normalizeComparable(value).includes(needle)),
    ),
  );

  if (matchingFlag) {
    return;
  }

  const message = `${player.displayName} expected country/flag was not visible: ${expectedCountry}`;
  if (options.policy === 'warn') {
    addWarning(options.testName ?? player.displayName, message, { player: player.displayName, expectedCountry });
    return;
  }

  expect(false, message).toBeTruthy();
}

export async function checkAvatarOrPlayerImage(
  page: Page,
  options: {
    player: PlayerFixture;
    testName?: string;
    requiredInProduction?: boolean;
    knownException?: KnownException;
  },
) {
  const environment = (process.env.ENVIRONMENT || 'production').toLowerCase();
  const candidates = await collectProfileImageCandidates(page);
  const avatarCandidates = candidates.filter((candidate) => candidate.matchesAvatar);
  const loaded = avatarCandidates.some((candidate) => candidate.naturalWidth > 0 || candidate.width > 20 || candidate.height > 20);

  if (loaded) {
    return;
  }

  const message = `${options.player.displayName} avatar/player image candidate was not visibly loaded`;
  const warningOnly =
    environment === 'stage' ||
    options.knownException?.warningOnly ||
    options.requiredInProduction === false ||
    (avatarCandidates.length > 0 && avatarCandidates.every((candidate) => candidate.naturalWidth === 0));

  if (warningOnly) {
    addWarning(options.testName ?? options.player.displayName, message, {
      player: options.player.displayName,
      environment,
      candidateCount: avatarCandidates.length,
      reason: environment === 'stage' ? 'stage-avatar-missing' : options.knownException?.reason ?? 'asset-loading-ambiguous',
    });
    return;
  }

  expect(false, `${message}. Candidate count: ${avatarCandidates.length}`).toBeTruthy();
}

export async function checkBadgeOrMarkVisible(
  page: Page,
  marks: string[] = [],
  options: { required?: boolean; testName?: string; player?: PlayerFixture; knownException?: KnownException } = {},
) {
  const meaningfulMarks = marks.filter(Boolean);
  if (meaningfulMarks.length === 0) {
    return;
  }

  const bodyText = await page.locator('body').innerText();
  const candidates = await collectProfileImageCandidates(page);
  const haystack = [
    bodyText,
    ...candidates.flatMap((candidate) => [candidate.alt, candidate.title, candidate.src, candidate.className]),
  ].join(' ');

  const missing = meaningfulMarks.filter((mark) => !new RegExp(escapeRegExp(mark), 'i').test(haystack));
  if (missing.length === 0) {
    return;
  }

  const message = `${options.player?.displayName ?? 'Player'} badge/mark not visible: ${missing.join(', ')}`;
  if (!options.required || options.knownException?.warningOnly) {
    addWarning(options.testName ?? options.player?.displayName ?? 'badge-check', message, {
      player: options.player?.displayName,
      missing,
      reason: options.knownException?.reason,
    });
    return;
  }

  expect(false, message).toBeTruthy();
}

export async function collectProfileImageCandidates(page: Page): Promise<ProfileImageCandidate[]> {
  return page.evaluate(() =>
    Array.from(document.images).map((image) => {
      const src = image.currentSrc || image.src || '';
      const alt = image.alt || '';
      const title = image.title || '';
      const className = typeof image.className === 'string' ? image.className : '';
      const combined = `${src} ${alt} ${title} ${className}`.toLowerCase();

      return {
        src,
        alt,
        title,
        className,
        width: image.width || 0,
        height: image.height || 0,
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
        matchesAvatar: /avatar|player|profile|headshot|photo|portrait|players/.test(combined),
        matchesCountry: /flag|country|nation/.test(combined),
      };
    }),
  );
}

export function playerNamePattern(displayName: string): RegExp {
  const words = displayName.split(/\s+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(words.join('\\s+'), 'i');
}

export function normalizeProfileTarget(href: string): string {
  try {
    const parsed = new URL(href, 'https://www.wsop.com');
    return parsed.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return href.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '').toLowerCase();
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
