import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  checkAvatarOrPlayerImage,
  checkBadgeOrMarkVisible,
  checkProfileBadgeSummaryConsistency,
  checkCountryOrFlagVisible,
  expectProfilePageLoaded,
  loadPlayerPresentationFixture,
  resolveKnownException,
  type KnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { findPlayerProfileLink, openPlayerSearch, searchPlayerIfSearchInputExists } from '../../utils/playerPresentation/playerSearchHelpers';
import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

const legendPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('legend-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, KnownException>>('known-exceptions.fixture.json');

type LegendPlayerFixture = PlayerFixture & {
  legendSignals?: string[];
};

type LegendSpecialPageCoverage = {
  category: 'Legend special profile';
  name: string;
  sourcePath: string;
  expectedProfileUrl: string;
  actualProfileUrl: string;
  status: 'pass' | 'warn' | 'fail';
  usedSearchFallback: boolean;
  matchedSignals: string[];
  expectedSignals: string[];
  checks: {
    profileReachable: boolean;
    specialPage: boolean;
    specialSignals: boolean;
  };
};

test.describe('Phase 3 - legend player profile presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of legendPlayers as LegendPlayerFixture[]) {
    test(`${player.displayName} legend group profile is reachable and recognizable`, async ({ page }, testInfo) => {
      const knownException = resolveKnownException(player, knownExceptions);
      let profilePlayer = player;
      let usedSearchFallback = false;

      try {
        await expectProfilePageLoaded(page, player);
      } catch (error) {
        usedSearchFallback = true;
        addWarning(`legend-direct-${player.displayName}`, 'Direct profile URL failed. Falling back to Player Search.', {
          player: player.displayName,
          profileUrl: player.profileUrl,
          error: error instanceof Error ? error.message : String(error),
        });

        await openPlayerSearch(page);
        await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `legend-search-${player.displayName}`);
        const result = await findPlayerProfileLink(page, player, knownException);
        profilePlayer = { ...player, profileUrl: result.href };
        await expectProfilePageLoaded(page, profilePlayer);
      }

      await checkCountryOrFlagVisible(page, profilePlayer, {
        policy: profilePlayer.expectedCountry ? 'fail' : 'warn',
        testName: `legend-country-${player.displayName}`,
      });
      await checkAvatarOrPlayerImage(page, {
        player: profilePlayer,
        testName: `legend-avatar-${player.displayName}`,
        knownException,
      });
      await checkBadgeOrMarkVisible(page, player.expectedMarks ?? [], {
        required: false,
        testName: `legend-mark-${player.displayName}`,
        player: profilePlayer,
        knownException,
      });
      await checkProfileBadgeSummaryConsistency(page, {
        player: profilePlayer,
        testName: `legend-badge-summary-${player.displayName}`,
      });
      const signalResult = await expectLegendSpecialPageSignals(page, profilePlayer as LegendPlayerFixture);
      await attachLegendSpecialPageCoverage(testInfo, {
        category: 'Legend special profile',
        name: player.displayName,
        sourcePath: 'fixtures/player-presentation/legend-players.fixture.json',
        expectedProfileUrl: player.profileUrl ?? '',
        actualProfileUrl: profilePlayer.profileUrl ?? player.profileUrl ?? '',
        status: 'pass',
        usedSearchFallback,
        matchedSignals: signalResult.matchedSignals,
        expectedSignals: player.legendSignals ?? [],
        checks: {
          profileReachable: true,
          specialPage: signalResult.specialPage,
          specialSignals: signalResult.specialSignals,
        },
      });
    });
  }
});

async function expectLegendSpecialPageSignals(page: Page, player: LegendPlayerFixture) {
  await expect(
    page.locator('body').filter({ hasText: /Hall of Famer|Poker Hall of Fame Inductee|WSOP Bracelets|Career WSOP Winnings/i }),
    `${player.displayName} should render the special legend profile surface`,
  ).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  const matchedSignals: string[] = [];
  for (const signal of player.legendSignals ?? []) {
    expect(
      bodyText,
      `${player.displayName} legend profile should expose special page signal: ${signal}`,
    ).toMatch(new RegExp(escapeRegExp(signal), 'i'));
    matchedSignals.push(signal);
  }

  return {
    specialPage: true,
    specialSignals: matchedSignals.length === (player.legendSignals ?? []).length,
    matchedSignals,
  };
}

async function attachLegendSpecialPageCoverage(testInfo: TestInfo, coverage: LegendSpecialPageCoverage) {
  await testInfo.attach('player-presentation-legend-special-page-coverage', {
    body: Buffer.from(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: 'legend special profile fixture',
          total: 1,
          passed: coverage.status === 'pass' ? 1 : 0,
          warned: coverage.status === 'warn' ? 1 : 0,
          failed: coverage.status === 'fail' ? 1 : 0,
          players: [coverage],
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
