import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  collectResultRowsFromProfile,
  openPlayerProfileForResults,
  pickSampleResultRows,
  type ResultDetailPlayerFixture,
} from '../../utils/resultDetail/playerResultsListHelpers';
import {
  assertResultDetailPlayerRow,
  collectResultDetailPlayerRows,
  findPlayerRowInResultDetail,
  openResultDetail,
  type ResultKnownException,
} from '../../utils/resultDetail/resultDetailHelpers';
import { searchPlayerAcrossResultPages } from '../../utils/resultDetail/resultPaginationHelpers';
import { normalizePlayerName } from '../../utils/resultDetail/resultRowAssertions';

const players = loadResultFixture<ResultDetailPlayerFixture[]>('result-detail-players.fixture.json');
const knownExceptions = loadResultFixture<Record<string, ResultKnownException>>('known-result-exceptions.fixture.json');

test.describe('Phase 5 - result detail player backlink', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of players) {
    test(`${player.displayName} result detail row links back to correct profile`, async ({ page }) => {
      await openPlayerProfileForResults(page, player);
      const profileRows = await collectResultRowsFromProfile(page, player);
      const sample = pickSampleResultRows(profileRows, 1)[0];
      expect(sample, `Result sample should exist: ${player.displayName}`).toBeTruthy();

      await openResultDetail(page, sample.resultHref);
      const knownException = resolveException(player, knownExceptions);
      const rows = await collectResultDetailPlayerRows(page);
      let found = findPlayerRowInResultDetail(rows, player, sample, knownException);
      if (!found) {
        const searched = await searchPlayerAcrossResultPages(page, player, 2);
        if (!searched.row && searched.limited) {
          addWarning('phase5-backlink-pagination-limited', 'Backlink check could not complete due to limited/unstable pagination on result detail.', {
            displayName: player.displayName,
            resultHref: sample.resultHref,
            maxActions: 2,
          });
          return;
        }
        found = searched.row;
      }
      assertResultDetailPlayerRow(found, player, knownException);
      const targetRow = found!;

      if (!targetRow.playerHref) {
        expect(knownException?.warningOnly, `Missing player backlink is hard fail unless legacy warning exception is set: ${player.displayName}`).toBeTruthy();
        return;
      }

      const response = await page.goto(targetRow.playerHref, { waitUntil: 'domcontentloaded' });
      expect(response, `Backlink profile should return response: ${player.displayName} href=${targetRow.playerHref}`).not.toBeNull();
      expect(response!.status(), `Backlink profile status should be < 400: ${player.displayName} href=${targetRow.playerHref}`).toBeLessThan(400);
      await expect(page.locator('body')).toBeVisible();

      const currentPath = new URL(page.url(), 'https://www.wsop.com').pathname.toLowerCase();
      if (player.expectedProfileUrlContains) {
        expect(
          currentPath.includes(player.expectedProfileUrlContains.toLowerCase().replace(/https?:\/\/[^/]+/i, '')),
          `Backlink should return expected profile target: ${player.displayName} expected=${player.expectedProfileUrlContains} actual=${page.url()}`,
        ).toBeTruthy();
      } else {
        expect(currentPath.includes('/players/'), `Backlink should land on /players/ profile path: ${player.displayName} actual=${page.url()}`).toBeTruthy();
      }

      const bodyText = await page.locator('body').innerText().catch(() => '');
      expect(
        normalizePlayerName(bodyText).includes(normalizePlayerName(player.displayName)),
        `Backlink profile should expose target player name: ${player.displayName} url=${page.url()}`,
      ).toBeTruthy();
    });
  }
});

function loadResultFixture<T>(fileName: string): T {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'result-detail-integrity', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as T;
}

function resolveException(player: ResultDetailPlayerFixture, known: Record<string, ResultKnownException>) {
  if (!player.knownExceptionKey) return undefined;
  return known[player.knownExceptionKey];
}
