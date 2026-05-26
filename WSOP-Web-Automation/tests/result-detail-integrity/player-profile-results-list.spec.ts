import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';

import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import {
  assertProfileResultRowBasicFields,
  collectResultRowsFromProfile,
  openPlayerProfileForResults,
  type ResultDetailPlayerFixture,
} from '../../utils/resultDetail/playerResultsListHelpers';

const players = loadResultFixture<ResultDetailPlayerFixture[]>('result-detail-players.fixture.json');

test.describe('Phase 5 - player profile results list', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of players) {
    test(`${player.displayName} profile results list is visible and structured`, async ({ page }) => {
      await openPlayerProfileForResults(page, player);
      const rows = await collectResultRowsFromProfile(page, player);
      for (const row of rows) {
        assertProfileResultRowBasicFields(row, player);
      }
    });
  }
});

function loadResultFixture<T>(fileName: string): T {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'result-detail-integrity', fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as T;
}
