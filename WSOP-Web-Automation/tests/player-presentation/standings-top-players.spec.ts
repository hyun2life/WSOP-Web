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
const MIN_STANDING_TARGETS_FOR_PHASE3 = 40;

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

  test('crawler standings target rows expose player identity UI', async ({ page }, testInfo) => {
    const crawlerTargets = loadLatestCrawlerStandingTargets();
    expect(
      crawlerTargets.length,
      `A recent crawler standings target file should expose at least ${MIN_STANDING_TARGETS_FOR_PHASE3} targets for Phase 3 UI validation`,
    ).toBeGreaterThanOrEqual(MIN_STANDING_TARGETS_FOR_PHASE3);

    const missingProfileLink: string[] = [];
    const missingName: string[] = [];
    const missingCountryOrFlag: string[] = [];
    const missingImage: string[] = [];
    const coverage: CrawlerStandingCoverage[] = [];

    for (const [sourcePath, targets] of groupTargetsBySource(crawlerTargets)) {
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
          coverage.push(toCrawlerCoverage(target, null));
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

        if (!row.hasPlayerImage) {
          missingImage.push(row.label);
        }

        coverage.push(toCrawlerCoverage(target, row));
      }
    }

    await attachCrawlerCoverage(testInfo, coverage);

    expect(missingProfileLink, 'Every crawler standings target should link to a player profile').toEqual([]);
    expect(missingName, 'Every crawler standings target should expose the player name in its source standings row').toEqual([]);
    expect(missingCountryOrFlag, 'Every crawler standings target should expose country text or a flag image').toEqual([]);

    if (missingImage.length > 0) {
      addWarning('crawler-standings-images', 'Some crawler standings targets did not expose an avatar/player image candidate', {
        missingImage,
      });
    }
  });
});

type CrawlerStandingTarget = {
  label: string;
  name: string;
  url: string;
  category: string;
  rank: number | null;
  sourcePath: string;
};

type StandingRowUi = {
  label: string;
  text: string;
  playerName: string;
  href: string;
  hasCountryText: boolean;
  hasFlagImage: boolean;
  hasPlayerImage: boolean;
};

type CrawlerStandingCoverage = {
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

async function collectStandingRowForTarget(page: Page, target: CrawlerStandingTarget): Promise<StandingRowUi | null> {
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

async function attachCrawlerCoverage(testInfo: TestInfo, coverage: CrawlerStandingCoverage[]) {
  await testInfo.attach('player-presentation-crawler-coverage', {
    body: Buffer.from(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: 'latest crawler standings output',
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

function toCrawlerCoverage(target: CrawlerStandingTarget, row: StandingRowUi | null): CrawlerStandingCoverage {
  const checks = {
    row: Boolean(row),
    name: Boolean(row?.playerName && new RegExp(escapeRegExp(row.playerName), 'i').test(row.text)),
    profileLink: Boolean(row?.href && /\/players\//i.test(row.href)),
    countryOrFlag: Boolean(row?.hasCountryText || row?.hasFlagImage),
    playerImage: Boolean(row?.hasPlayerImage),
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

async function collectStandingRowUi(row: Locator, target: CrawlerStandingTarget): Promise<StandingRowUi> {
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
    hasCountryText: hasCountryLikeText(text),
    hasFlagImage: images.some((image) => /flag|country|\/flag\/|country code/i.test(`${image.alt} ${image.title} ${image.src} ${image.srcset} ${image.className}`)),
    hasPlayerImage:
      images.some(
        (image) =>
          /avatar|player|profile|headshot|photo|portrait|players/i.test(`${image.alt} ${image.title} ${image.src} ${image.srcset} ${image.className}`) &&
          (image.naturalWidth > 0 || image.width > 10 || image.height > 10),
      ) || /avatar image/i.test(rowHaystack),
  };
}

function loadLatestCrawlerStandingTargets(): CrawlerStandingTarget[] {
  const outputDir = path.resolve(process.cwd(), '..', 'WSOP-Player-Standings-Crawler', 'automation', 'output');
  if (!fs.existsSync(outputDir)) {
    return [];
  }

  const dataFiles = fs
    .readdirSync(outputDir)
    .filter((fileName) => /-data\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(outputDir, fileName);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const dataFile of dataFiles) {
    const targets = readCrawlerStandingTargets(dataFile.filePath);
    if (targets.length >= MIN_STANDING_TARGETS_FOR_PHASE3) {
      return targets;
    }
  }

  return [];
}

function readCrawlerStandingTargets(latestDataFile: string): CrawlerStandingTarget[] {
  const report = JSON.parse(fs.readFileSync(latestDataFile, 'utf8')) as {
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

  const targets: CrawlerStandingTarget[] = [];
  const seen = new Set<string>();
  for (const player of report.players ?? []) {
    for (const source of player.standingsSources ?? []) {
      const name = source.name || player.name || '';
      const url = player.url || '';
      const category = source.category || 'Standings';
      const rank = source.rank ?? null;
      const sourcePath = normalizeSourcePath(source.sourceUrl || '/player-standings/');
      const key = `${sourcePath}|${rank}|${name}|${url}`;
      if (!name || seen.has(key)) {
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

function groupTargetsBySource(targets: CrawlerStandingTarget[]) {
  const grouped = new Map<string, CrawlerStandingTarget[]>();
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
