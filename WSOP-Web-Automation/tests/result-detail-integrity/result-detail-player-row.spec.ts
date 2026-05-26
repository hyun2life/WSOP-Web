import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';

import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  collectResultRowsFromProfile,
  openPlayerProfileForResults,
  pickSampleResultRows,
  type ResultDetailPlayerFixture,
} from '../../utils/resultDetail/playerResultsListHelpers';
import {
  assertResultDetailPlayerRow,
  assertResultTableVisible,
  collectResultDetailPlayerRows,
  findPlayerRowInResultDetail,
  openResultDetail,
  type ResultKnownException,
} from '../../utils/resultDetail/resultDetailHelpers';

const players = loadResultFixture<ResultDetailPlayerFixture[]>('result-detail-players.fixture.json');
const knownExceptions = loadResultFixture<Record<string, ResultKnownException>>('known-result-exceptions.fixture.json');

test.describe('Phase 5 - result detail player row integrity', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of players) {
    test(`${player.displayName} appears in result detail rows linked from profile results`, async ({ page }) => {
      await openPlayerProfileForResults(page, player);
      const rows = await collectResultRowsFromProfile(page, player);
      const samples = pickSampleResultRows(rows, player.sampleResultClickCount ?? 2);

      for (const sample of samples) {
        await openResultDetail(page, sample.resultHref);
        await assertResultTableVisible(page);
        const detailRows = await collectResultDetailPlayerRows(page);
        const knownException = resolveException(player, knownExceptions);
        const found = findPlayerRowInResultDetail(detailRows, player, sample, knownException);
        assertResultDetailPlayerRow(found, player, knownException);
      }
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
