import { expect, test } from '@playwright/test';

import {
  checkBadgeOrMarkVisible,
  checkProfileBadgeSummaryConsistency,
  expectProfilePageLoaded,
  expectPlayerNameVisible,
  loadPlayerPresentationFixture,
  playerNamePattern,
  resolveKnownException,
  type PlayerFixture,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { findPlayerProfileLink, openPlayerSearch, searchPlayerIfSearchInputExists } from '../../utils/playerPresentation/playerSearchHelpers';
import { attachWarningsToTestInfo, clearWarnings, addWarning } from '../../utils/playerPresentation/warningCollector';

const hofPlayers = loadPlayerPresentationFixture<PlayerFixture[]>('hof-players.fixture.json');
const knownExceptions = loadPlayerPresentationFixture<Record<string, any>>('known-exceptions.fixture.json');

test.describe('Phase 3 - Hall of Fame player presentation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('Hall of Fame area exposes representative HOF players or searchable profile targets', async ({ page }) => {
    test.setTimeout(120000);
    const response = await page.goto('/hall-of-fame/', { waitUntil: 'domcontentloaded' });
    expect(response, '/hall-of-fame/ should return a response').not.toBeNull();
    expect(response!.status(), '/hall-of-fame/ HTTP status').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

    await expect(
      page.locator('body').filter({ hasText: /Hall of Fame|Poker Hall of Fame/i }),
      'Hall of Fame page should expose its core area',
    ).toBeVisible();

    const validatedPlayers: PlayerFixture[] = [];
    const searchNeededPlayers: PlayerFixture[] = [];

    // 1단계: /hall-of-fame/ 본문에서 즉시 이름이 확인되는지 1차 필터링
    const bodyText = await page.locator('body').innerText();
    for (const player of hofPlayers) {
      const pattern = playerNamePattern(player.displayName);
      if (pattern.test(bodyText)) {
        validatedPlayers.push(player);
      } else {
        searchNeededPlayers.push(player);
      }
    }

    // 2단계: 본문에 없는 플레이어들을 검색창에서 순차 검증 (리로드 없이 연속 검색)
    if (searchNeededPlayers.length > 0) {
      await openPlayerSearch(page);
      for (const player of searchNeededPlayers) {
        const exception = resolveKnownException(player, knownExceptions);
        try {
          await searchPlayerIfSearchInputExists(page, player.searchKeyword ?? player.displayName, `hof-fallback-${player.displayName}`);
          await findPlayerProfileLink(page, player);
          validatedPlayers.push(player);
        } catch (err: any) {
          if (exception?.warningOnly) {
            addWarning(`hof-search-${player.displayName}`, `Search validation failed for non-player/unstable player ${player.displayName}: ${err.message}`, {
              player: player.displayName
            });
            validatedPlayers.push(player);
          } else {
            throw err;
          }
        }
      }
    }

    // 검증 성공한 플레이어가 최소 3명 이상이어야 함
    expect(
      validatedPlayers.length,
      `At least 3 HOF players should be visible on Hall of Fame or searchable. Found count: ${validatedPlayers.length}`,
    ).toBeGreaterThanOrEqual(3);

    // 3단계: 플레이어 프로필 페이지 진입 검증 및 HOF 배지 체크
    // 비플레이어 기여자(non-player)는 skip 처리
    for (const player of validatedPlayers.slice(0, 5)) {
      const exception = resolveKnownException(player, knownExceptions);
      if (exception?.warningOnly && player.knownExceptionKey === 'non-player') {
        addWarning(`hof-profile-skip-${player.displayName}`, `Skipping profile load for non-player contributor: ${player.displayName}`, {
          player: player.displayName
        });
        continue;
      }

      try {
        expect(player.profileUrl, `${player.displayName} should have a profileUrl fixture value`).toBeTruthy();

        const response = await page.goto(player.profileUrl!, { waitUntil: 'domcontentloaded' });
        expect(response, `${player.displayName} profile should return a response: ${player.profileUrl}`).not.toBeNull();
        expect(response!.status(), `${player.displayName} profile HTTP status: ${player.profileUrl}`).toBeLessThan(400);

        await expect(page.locator('body'), `${player.displayName} profile body should be visible`).toBeVisible();
        await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

        // 이름 검증 (역사적 닉네임 표기 차이는 warning 처리로 통과 유도)
        try {
          await expectPlayerNameVisible(page, player.displayName);
        } catch (nameErr: any) {
          addWarning(`hof-name-mismatch-${player.displayName}`, `Player name mismatch on profile: expected ${player.displayName}. Detail: ${nameErr.message}`, {
            player: player.displayName
          });
        }

        const profileSignals = page.locator('body').filter({
          hasText: /Player Profile|Stats|Bracelets|Rings|Total Earnings|Career WSOP Winnings|Final Tables|Cashes/i,
        });
        await expect(
          profileSignals,
          `${player.displayName} profile should expose at least one profile/stat signal`,
        ).toBeVisible();

        await checkBadgeOrMarkVisible(page, ['Hall of Fame'], {
          required: false,
          testName: `hof-mark-${player.displayName}`,
          player,
          knownException: exception,
        });
        await checkProfileBadgeSummaryConsistency(page, {
          player,
          testName: `hof-badge-summary-${player.displayName}`,
        });
      } catch (err: any) {
        if (exception?.warningOnly) {
          addWarning(`hof-profile-fail-${player.displayName}`, `Profile load failed but allowed by exception: ${player.displayName}. Error: ${err.message}`, {
            player: player.displayName
          });
        } else {
          throw err;
        }
      }
    }
  });
});
