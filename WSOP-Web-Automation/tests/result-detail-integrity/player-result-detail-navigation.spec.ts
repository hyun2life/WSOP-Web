import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';

import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  assertProfileResultRowBasicFields,
  collectResultRowsFromProfile,
  openPlayerProfileForResults,
  pickSampleResultRows,
  type ResultDetailPlayerFixture,
} from '../../utils/resultDetail/playerResultsListHelpers';
import { assertResultDetailBasicMeta, assertResultTableVisible, openResultDetail } from '../../utils/resultDetail/resultDetailHelpers';

const players = loadResultFixture<ResultDetailPlayerFixture[]>('result-detail-players.fixture.json');

test.describe('Phase 5 - player result detail navigation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of players) {
    test(`${player.displayName} profile result rows navigate to result detail page`, async ({ page }) => {
      await openPlayerProfileForResults(page, player);
      const rows = await collectResultRowsFromProfile(page, player);
      const samples = pickSampleResultRows(rows, player.sampleResultClickCount ?? 2);

      for (const row of samples) {
        assertProfileResultRowBasicFields(row, player);
        await openResultDetail(page, row.resultHref);
        await assertResultDetailBasicMeta(page, row);
        await assertResultTableVisible(page);
      }
    });
  }
});

function loadResultFixture<T>(fileName: string): T {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'result-detail-integrity', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as T;
}
