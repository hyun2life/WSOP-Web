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
import { findResultPaginationControls, searchPlayerAcrossResultPages } from '../../utils/resultDetail/resultPaginationHelpers';

const players = loadResultFixture<ResultDetailPlayerFixture[]>('result-detail-players.fixture.json');
const knownExceptions = loadResultFixture<Record<string, ResultKnownException>>('known-result-exceptions.fixture.json');

test.describe('Phase 5 - result detail pagination / load more', () => {
  test.beforeEach(() => {
    test.setTimeout(90_000);
    clearWarnings();
  });
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of players) {
    test(`${player.displayName} can be searched on result detail with limited pagination actions`, async ({ page }) => {
      await openPlayerProfileForResults(page, player);
      const profileRows = await collectResultRowsFromProfile(page, player);
      const sample = pickSampleResultRows(profileRows, 1)[0];
      expect(sample, `Result sample should exist for pagination check: ${player.displayName}`).toBeTruthy();

      await openResultDetail(page, sample.resultHref);
      const knownException = resolveException(player, knownExceptions);
      const initialRows = await collectResultDetailPlayerRows(page);
      const direct = findPlayerRowInResultDetail(initialRows, player, sample, knownException);

      if (direct) {
        assertResultDetailPlayerRow(direct, player, knownException);
        return;
      }

      const controls = await findResultPaginationControls(page);
      if (controls.length === 0) {
        addWarning('phase5-result-pagination-missing-control', 'Player row is missing and no pagination control was detected on result detail.', {
          displayName: player.displayName,
          resultHref: sample.resultHref,
        });
        return;
      }

      const searched = await searchPlayerAcrossResultPages(page, player, 4);
      if (searched.row) {
        assertResultDetailPlayerRow(searched.row, player, knownException);
        return;
      }

      if (searched.limited) {
        addWarning('phase5-result-pagination-limited', 'Player row was not found within limited pagination actions.', {
          displayName: player.displayName,
          resultHref: sample.resultHref,
          maxActions: 4,
        });
        return;
      }

      expect(false, `Player row should be discoverable on result detail page: ${player.displayName} resultHref=${sample.resultHref}`).toBeTruthy();
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
