import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  checkCountryOrFlagVisible,
  expectProfilePageLoaded,
  escapeRegExp,
  loadPlayerPresentationFixture,
  playerNamePattern,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const topPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('top-players.fixture.json');
const DEFAULT_STANDINGS_LIMIT = 50;
const limit = Number(process.env.PHASE3_STANDINGS_LIMIT || DEFAULT_STANDINGS_LIMIT);
const MIN_STANDING_TARGETS_FOR_PHASE3 = Math.max(1, Math.floor(limit * 3));

test.describe('Phase 3 - standings top player presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('standings exposes representative top players and links them to profiles', async ({ page }) => {
    const response = await page.goto('/player-standings/', { waitUntil: 'domcontentloaded' });
    expect(response, '/player-standings/ should return a response').not.toBeNull();
    expect(response!.status(), '/player-standings/ HTTP status').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

    await expect(
      page.locator('body').filter({ hasText: /All-Time Earnings|All-Time Bracelets|All-Time Rings|Player Standings/i }),
      'Standings page should expose at least one core ranking section',
    ).toBeVisible();

    const visiblePlayers: PlayerFixture[] = [];
    for (const player of topPlayers) {
      const namePattern = playerNamePattern(player.displayName);
      const nameVisible = await page.locator('body').filter({ hasText: namePattern }).isVisible().catch(() => false);
      const profileLinkCount = await page.locator('a[href*="/players/"]').filter({ hasText: namePattern }).count();

      if (nameVisible && profileLinkCount > 0) {
        visiblePlayers.push(player);
      }
    }

    expect(
      visiblePlayers.length,
      `At least 3 representative top players should be visible on standings. Found: ${visiblePlayers.map((p) => p.displayName).join(', ') || 'none'}`,
    ).toBeGreaterThanOrEqual(3);

    for (const player of visiblePlayers.slice(0, 3)) {
      await expectProfilePageLoaded(page, player);
      await checkCountryOrFlagVisible(page, player, { testName: `standings-top-${player.displayName}` });
    }
  });

  test('crawler standings-only target rows expose player identity UI', async ({ page }, testInfo) => {
    const standingTargets = loadStandingTargetsFromStandingsOnlyOutput();
    expect(
      standingTargets.length,
      `Standings-only crawler output should expose at least ${MIN_STANDING_TARGETS_FOR_PHASE3} targets for Phase 3 UI validation`,
    ).toBeGreaterThanOrEqual(MIN_STANDING_TARGETS_FOR_PHASE3);

    const missingProfileLink: string[] = [];
    const missingName: string[] = [];
    const missingCountryOrFlag: string[] = [];
    const missingImage: string[] = [];
    const coverage: StandingCoverage[] = [];
    const allPlayerStatsProfileChecks: Array<{
      coverage: StandingCoverage;
      profileUrl: string;
      label: string;
    }> = [];

    for (const [sourcePath, targets] of groupTargetsBySource(standingTargets)) {
      const response = await page.goto(sourcePath, { waitUntil: 'domcontentloaded' });
      expect(response, `${sourcePath} should return a response`).not.toBeNull();
      expect(response!.status(), `${sourcePath} HTTP status`).toBeLessThan(400);
      await expect(page.locator('body')).toBeVisible();
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

      const rows = page.getByRole('row').filter({ has: page.locator('a[href*="/players/"]') });
      await expect
        .poll(async () => countVisibleRows(rows), {
          message: `${sourcePath} should expose visible player rows`,
          timeout: 10_000,
        })
        .toBeGreaterThan(0);

      for (const target of targets) {
        const row = await collectStandingRowForTarget(page, target);
        if (!row) {
          missingName.push(`${target.label} - row not found`);
          coverage.push(toStandingCoverage(target, null));
          continue;
        }

        if (!/\/players\//i.test(row.href)) {
          missingProfileLink.push(row.label);
        }

        if (!row.playerName || !new RegExp(escapeRegExp(row.playerName), 'i').test(row.text)) {
          missingName.push(row.label);
        }

        if (!row.hasCountryText && !row.hasFlagImage) {
          missingCountryOrFlag.push(row.label);
        }

        const rowCoverage = toStandingCoverage(target, row);
        coverage.push(rowCoverage);

        if (isAllPlayerStatsCategory(target.category) && row.href) {
          allPlayerStatsProfileChecks.push({
            coverage: rowCoverage,
            profileUrl: row.href,
            label: row.label,
          });
          continue;
        }

        if (!rowCoverage.checks.playerImage) {
          missingImage.push(row.label);
        }
      }
    }

    await applyAllPlayerStatsProfileImageChecks(page, allPlayerStatsProfileChecks);
    for (const item of allPlayerStatsProfileChecks) {
      if (!item.coverage.checks.playerImage) {
        missingImage.push(`${item.label} (profile page)`);
      }
    }

    await attachStandingCoverage(testInfo, coverage);

    expect(missingProfileLink, 'Every sampled standings row should link to a player profile').toEqual([]);
    expect(missingName, 'Every sampled standings row should expose the player name').toEqual([]);
    expect(missingCountryOrFlag, 'Every sampled standings row should expose country text or a flag image').toEqual([]);

    if (missingImage.length > 0) {
      addWarning('standings-row-images', 'Some sampled standings rows did not expose an avatar/player image candidate', {
        missingImage,
      });
    }
  });
});

type StandingRowUi = {
  label: string;
  text: string;
  playerName: string;
  href: string;
  rank: number | null;
  sourcePath: string;
  hasCountryText: boolean;
  hasFlagImage: boolean;
  hasPlayerImage: boolean;
};

type StandingTarget = {
  label: string;
  name: string;
  url: string;
  category: string;
  rank: number | null;
  sourcePath: string;
};

type StandingCoverage = {
  category: string;
  rank: number | null;
  name: string;
  sourcePath: string;
  expectedProfileUrl: string;
  actualProfileUrl: string;
  status: 'pass' | 'warn' | 'fail';
  checks: {
    row: boolean;
    name: boolean;
    profileLink: boolean;
    countryOrFlag: boolean;
    playerImage: boolean;
  };
};

async function countVisibleRows(rows: Locator) {
  const rowCount = await rows.count();
  let visibleCount = 0;
  for (let index = 0; index < rowCount; index += 1) {
    if (await rows.nth(index).isVisible().catch(() => false)) {
      visibleCount += 1;
    }
  }
  return visibleCount;
}

async function collectStandingRowForTarget(page: Page, target: StandingTarget): Promise<StandingRowUi | null> {
  const rows = page.getByRole('row').filter({ hasText: playerNamePattern(target.name) });
  const rowCount = await rows.count();

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) {
      continue;
    }

    const rowUi = await collectStandingRowUi(row, target);
    if (rowUi.href && target.url && normalizeProfilePath(rowUi.href) !== normalizeProfilePath(target.url)) {
      continue;
    }

    return rowUi;
  }

  return null;
}

async function attachStandingCoverage(testInfo: TestInfo, coverage: StandingCoverage[]) {
  await testInfo.attach('player-presentation-standings-coverage', {
    body: Buffer.from(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: 'standings-only crawler output',
          total: coverage.length,
          passed: coverage.filter((item) => item.status === 'pass').length,
          warned: coverage.filter((item) => item.status === 'warn').length,
          failed: coverage.filter((item) => item.status === 'fail').length,
          players: coverage,
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
}

function toStandingCoverage(target: StandingTarget, row: StandingRowUi | null): StandingCoverage {
  const checks = {
    row: Boolean(row),
    name: Boolean(row?.playerName && new RegExp(escapeRegExp(row.playerName), 'i').test(row.text)),
    profileLink: Boolean(row?.href && /\/players\//i.test(row.href)),
    countryOrFlag: Boolean(row?.hasCountryText || row?.hasFlagImage),
    playerImage: target.category === 'All Player Stats' ? true : Boolean(row?.hasPlayerImage),
  };
  const requiredOk = checks.row && checks.name && checks.profileLink && checks.countryOrFlag;

  return {
    category: target.category,
    rank: target.rank,
    name: target.name,
    sourcePath: target.sourcePath,
    expectedProfileUrl: target.url,
    actualProfileUrl: row?.href ?? '',
    status: requiredOk ? (checks.playerImage ? 'pass' : 'warn') : 'fail',
    checks,
  };
}

async function collectStandingRowUi(row: Locator, target: StandingTarget): Promise<StandingRowUi> {
  const link = row.locator('a[href*="/players/"]').first();
  const href = (await link.getAttribute('href').catch(() => null)) ?? '';
  const linkText = await link.innerText().catch(() => '');
  const text = await row.innerText().catch(() => '');
  const playerName = cleanStandingPlayerName(linkText || target.name || text);
  const images = await row.locator('img').evaluateAll((items) =>
    items.map((image) => ({
      alt: image.getAttribute('alt') || '',
      title: image.getAttribute('title') || '',
      src: image.getAttribute('src') || '',
      srcset: image.getAttribute('srcset') || '',
      className: image.getAttribute('class') || '',
      width: image.width || 0,
      height: image.height || 0,
      naturalWidth: image.naturalWidth || 0,
    })),
  );
  const rowHaystack = `${text} ${images.flatMap((image) => [image.alt, image.title, image.src, image.srcset, image.className]).join(' ')}`;

  return {
    label: `${target.category} #${target.rank ?? '-'} ${target.name}`,
    text,
    playerName,
    href,
    rank: target.rank,
    sourcePath: target.sourcePath,
    hasCountryText: hasCountryLikeText(text),
    hasFlagImage: images.some((image) => /flag|country|\/flag\/|country code/i.test(`${image.alt} ${image.title} ${image.src} ${image.srcset} ${image.className}`)),
    hasPlayerImage:
      images.some(
        (image) =>
          /avatar|player|profile|headshot|photo|portrait|players/i.test(`${image.alt} ${image.title} ${image.src} ${image.srcset} ${image.className}`) &&
          (image.naturalWidth > 0 || image.width > 10 || image.height > 10) &&
          !(image.src.toLowerCase().includes('profile_default') || (image.src.toLowerCase().includes('/default/') && !image.src.toLowerCase().includes('good-game-service.com')))
      ),
  };
}

async function applyAllPlayerStatsProfileImageChecks(
  page: Page,
  checks: Array<{ coverage: StandingCoverage; profileUrl: string; label: string }>,
) {
  if (checks.length === 0) {
    return;
  }

  const profilePage = await page.context().newPage();
  const cache = new Map<string, boolean>();

  try {
    for (const check of checks) {
      const cacheKey = normalizeProfilePath(check.profileUrl);
      let hasProfileImage = cache.get(cacheKey);
      if (hasProfileImage == null) {
        hasProfileImage = await profilePageHasPlayerImage(profilePage, check.profileUrl);
        cache.set(cacheKey, hasProfileImage);
      }

      check.coverage.checks.playerImage = hasProfileImage;
      const requiredOk =
        check.coverage.checks.row &&
        check.coverage.checks.name &&
        check.coverage.checks.profileLink &&
        check.coverage.checks.countryOrFlag;
      check.coverage.status = requiredOk ? (hasProfileImage ? 'pass' : 'warn') : 'fail';
    }
  } finally {
    await profilePage.close().catch(() => undefined);
  }
}

async function profilePageHasPlayerImage(page: Page, profileUrl: string) {
  const response = await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() >= 400) {
    return false;
  }

  await expect(page.locator('body')).toBeVisible();
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  const images = await page.locator('img').evaluateAll((items) =>
    items.map((image) => ({
      alt: image.getAttribute('alt') || '',
      title: image.getAttribute('title') || '',
      src: image.getAttribute('src') || '',
      srcset: image.getAttribute('srcset') || '',
      className: image.getAttribute('class') || '',
      width: image.width || 0,
      height: image.height || 0,
      naturalWidth: image.naturalWidth || 0,
    })),
  );

  return images.some(
    (image) =>
      /avatar|player|profile|headshot|photo|portrait|players/i.test(`${image.alt} ${image.title} ${image.src} ${image.srcset} ${image.className}`) &&
      (image.naturalWidth > 0 || image.width > 10 || image.height > 10) &&
      !(image.src.toLowerCase().includes('profile_default') || (image.src.toLowerCase().includes('/default/') && !image.src.toLowerCase().includes('good-game-service.com'))),
  );
}

function loadStandingTargetsFromStandingsOnlyOutput(): StandingTarget[] {
  const dataPath = process.env.PHASE3_STANDINGS_DATA || findLatestStandingsOnlyOutput();
  expect(
    dataPath,
    'Phase 3 standings-only crawler output should exist. Run npm run test:phase3 so the runner can prepare PHASE3_STANDINGS_DATA.',
  ).toBeTruthy();
  expect(fs.existsSync(dataPath!), `Phase 3 standings-only crawler output should exist: ${dataPath}`).toBeTruthy();

  const report = JSON.parse(fs.readFileSync(dataPath!, 'utf8')) as {
    mode?: string;
    players?: Array<{
      name?: string;
      url?: string;
      standingsSources?: Array<{
        category?: string;
        rank?: number | null;
        name?: string;
        sourceUrl?: string;
      }>;
    }>;
  };
  expect(report.mode, 'Phase 3 standings data should come from crawler --standings-only mode').toBe('standings-only');

  const targets: StandingTarget[] = [];
  const seen = new Set<string>();
  for (const player of report.players ?? []) {
    for (const source of player.standingsSources ?? []) {
      const name = source.name || player.name || '';
      const url = player.url || '';
      const category = source.category || 'Standings';
      const rank = source.rank ?? null;
      const sourcePath = normalizeSourcePath(source.sourceUrl || '/player-standings/');
      const key = `${sourcePath}|${rank}|${name}|${url}`;
      if (!name || !url || seen.has(key)) {
        continue;
      }

      seen.add(key);
      targets.push({
        label: `${category} #${rank ?? '-'} ${name}`,
        name,
        url,
        category,
        rank,
        sourcePath,
      });
    }
  }

  return targets;
}

function findLatestStandingsOnlyOutput() {
  const outputDir = path.resolve(process.cwd(), 'automation', 'output');
  if (!fs.existsSync(outputDir)) {
    return null;
  }

  const dataFiles = fs
    .readdirSync(outputDir)
    .filter((fileName) => /standings-targets-data\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(outputDir, fileName);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return dataFiles[0]?.filePath ?? null;
}

function groupTargetsBySource(targets: StandingTarget[]) {
  const grouped = new Map<string, StandingTarget[]>();
  for (const target of targets) {
    const list = grouped.get(target.sourcePath) ?? [];
    list.push(target);
    grouped.set(target.sourcePath, list);
  }

  return grouped;
}

function cleanStandingPlayerName(value: string) {
  return normalizeWhitespace(value)
    .replace(/^(\d+\s+)?Avatar Image\s+/i, '')
    .replace(/^\d+\s+/, '')
    .replace(/\s+\$[\d,]+.*$/, '')
    .trim();
}

function hasCountryLikeText(value: string) {
  const normalized = normalizeWhitespace(value);
  return /\b(United States|Canada|United Kingdom|England|Germany|France|Spain|Italy|Brazil|Australia|Norway|Sweden|Finland|Netherlands|Taiwan|China|Japan|South Korea|Belgium|Luxembourg|New Zealand)\b/i.test(
    normalized,
  );
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSourcePath(value: string) {
  try {
    const parsed = new URL(value, 'https://www.wsop.com');
    return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  } catch {
    return value.startsWith('/') ? value : `/${value}`;
  }
}

function normalizeProfilePath(value: string) {
  try {
    const parsed = new URL(value, 'https://www.wsop.com');
    return parsed.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return value.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '').toLowerCase();
  }
}

function isAllPlayerStatsCategory(value: string) {
  return /all player stats/i.test(value || '');
}
