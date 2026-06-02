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

type ProfileBadgeKey = 'bracelets' | 'rings';

type ProfileBadgeDef = {
  key: ProfileBadgeKey;
  label: 'Bracelets' | 'Rings';
  fileName: string;
  altPattern: RegExp;
};

type ProfileBadgeCounts = Record<ProfileBadgeKey, number> & {
  details: Record<ProfileBadgeKey, Array<{ count: number; alt: string; src: string }>>;
};

const PROFILE_BADGE_DEFS: ProfileBadgeDef[] = [
  { key: 'bracelets', label: 'Bracelets', fileName: 'badge_WSOPBracelet.webp', altPattern: /wsop\s+bracelet/i },
  { key: 'rings', label: 'Rings', fileName: 'badge_WSOPRing.webp', altPattern: /wsop\s+ring/i },
];

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

  if (!loaded) {
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
    return;
  }

  // Loaded is true, check if the loaded avatars are only default placeholders
  const hasCustomAvatar = avatarCandidates.some((candidate) => {
    const isLoaded = candidate.naturalWidth > 0 || candidate.width > 20 || candidate.height > 20;
    if (!isLoaded) return false;

    const srcLower = candidate.src.toLowerCase();
    const isDefault = srcLower.includes('profile_default') || (srcLower.includes('/default/') && !srcLower.includes('good-game-service.com'));
    return !isDefault;
  });

  if (!hasCustomAvatar) {
    const message = `${options.player.displayName} is using a default placeholder avatar instead of a custom photo`;
    addWarning(options.testName ?? options.player.displayName, message, {
      player: options.player.displayName,
      environment,
      candidateCount: avatarCandidates.length,
      reason: 'default-avatar-placeholder',
    });
  }
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

export async function checkProfileBadgeSummaryConsistency(
  page: Page,
  options: { player: PlayerFixture; testName?: string },
) {
  const bodyText = await page.locator('body').innerText();
  const badgeCounts = await collectProfileBadgeCounts(page);

  for (const badgeDef of PROFILE_BADGE_DEFS) {
    const summaryValue = parseProfileSummaryNumber(bodyText, badgeDef.label);
    const badgeValue = badgeCounts[badgeDef.key];

    if (summaryValue === null) {
      if (badgeValue > 0) {
        addWarning(options.testName ?? `profile-badge-${options.player.displayName}`, `${options.player.displayName} ${badgeDef.label} badge exists but summary value was not parsed`, {
          player: options.player.displayName,
          badge: badgeDef.label,
          badgeValue,
        });
      }
      continue;
    }

    if (summaryValue !== badgeValue) {
      addWarning(options.testName ?? `profile-badge-${options.player.displayName}`, `${options.player.displayName} ${badgeDef.label} summary/badge count mismatch`, {
        player: options.player.displayName,
        badge: badgeDef.label,
        summaryValue,
        badgeValue,
        badgeFile: badgeDef.fileName,
        details: badgeCounts.details[badgeDef.key],
      });
    }
  }
}

export async function collectProfileBadgeCounts(page: Page): Promise<ProfileBadgeCounts> {
  return page.evaluate((badgeDefs) => {
    const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
    const parseCount = (value: unknown, strict = false) => {
      const text = normalize(value);
      const exactMatch = text.match(/^(?:#\s*)?(\d[\d,]*)$/);
      if (exactMatch) return Number(exactMatch[1].replace(/,/g, ''));
      if (strict) return null;
      const match = text.match(/\d[\d,]*/);
      return match ? Number(match[0].replace(/,/g, '')) : null;
    };
    const parseCountFromElement = (element: Element | null | undefined, strict = true) => element ? parseCount(element.textContent, strict) : null;
    const isVisibleElement = (element: Element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    };
    const findExplicitCountElement = (root: Element | null | undefined) => {
      if (!root) return null;
      const elements = Array.from(root.querySelectorAll?.('*') || []);
      return elements.find((element) => {
        const className = String(element.getAttribute('class') || '');
        if (!/(^|[-_\s])(count|qty|quantity|number|badge-count)([-_\s]|$)/i.test(className)) return false;
        if (!isVisibleElement(element)) return false;
        return parseCountFromElement(element, true) !== null;
      }) || null;
    };
    const readBadgeCount = (image: HTMLImageElement) => {
      const container = image.closest('li') || image.parentElement;
      const explicitCountElement = findExplicitCountElement(image.parentElement) || findExplicitCountElement(container) || findExplicitCountElement(image.parentElement?.parentElement);
      const candidates = [
        explicitCountElement,
        image.nextElementSibling,
        image.previousElementSibling,
        image.parentElement?.nextElementSibling,
        image.parentElement?.previousElementSibling,
      ];
      for (const candidate of candidates) {
        const count = parseCountFromElement(candidate, true);
        if (count !== null) return count;
      }
      return 1;
    };
    const counts = {
      bracelets: 0,
      rings: 0,
      details: {
        bracelets: [] as Array<{ count: number; alt: string; src: string }>,
        rings: [] as Array<{ count: number; alt: string; src: string }>,
      },
    };

    for (const image of Array.from(document.images)) {
      if (!isVisibleElement(image)) continue;
      const sourceText = normalize([
        image.getAttribute('src'),
        image.getAttribute('srcset'),
        image.getAttribute('alt'),
        image.currentSrc,
      ].filter(Boolean).join(' '));
      const badgeDef = badgeDefs.find((def) => sourceText.includes(def.fileName) || new RegExp(def.altPatternSource, 'i').test(sourceText));
      if (!badgeDef) continue;

      const count = readBadgeCount(image);
      counts[badgeDef.key] += count;
      counts.details[badgeDef.key].push({
        count,
        alt: image.getAttribute('alt') || '',
        src: image.getAttribute('src') || image.currentSrc || '',
      });
    }

    return counts;
  }, PROFILE_BADGE_DEFS.map((badgeDef) => ({
    key: badgeDef.key,
    fileName: badgeDef.fileName,
    altPatternSource: badgeDef.altPattern.source,
  })));
}

function parseProfileSummaryNumber(bodyText: string, label: string) {
  const compact = bodyText.replace(/\s+/g, ' ').trim();
  const match = compact.match(new RegExp(`${escapeRegExp(label)}\\s+([\\d,]+)`, 'i'));
  return match ? Number(match[1].replace(/,/g, '')) : null;
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
