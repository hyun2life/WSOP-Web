import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import {
  calculatePlayerSummaryFromRows,
  compareCalculatedSummary,
} from '../../utils/dataIntegrity/calculationHelpers';
import { reportComparison, addDataWarning } from '../../utils/dataIntegrity/dataIntegrityReporter';

const dataSource =
  process.env.DATA_SOURCE === 'api'
    ? new ApiDataSource()
    : process.env.DATA_SOURCE === 'crawler'
    ? new CrawlerDataSource()
    : new FixtureDataSource();

const dataSourceType = process.env.DATA_SOURCE || 'fixture';
const expectedFile =
  dataSourceType === 'crawler'
    ? path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated', 'players.generated.expected.json')
    : path.join(process.cwd(), 'fixtures', 'data-integrity', 'players.expected.json');

let targetPlayers = ['phil-hellmuth'];
try {
  if (fs.existsSync(expectedFile)) {
    const data = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
    if (dataSourceType === 'crawler' && data.players) {
      targetPlayers = data.players.map((p: any) => p.playerKey);
    }
  }
} catch {
  // Pass
}

test.describe('Phase 6 - Player Results Summary Calculation Integrity', () => {
  for (const playerKey of targetPlayers) {
    test(`Sum calculation matches profile summary for ${playerKey}`, async ({}, testInfo) => {
      // 1. Expected Profile 및 Results 로드
      const expectedProfile = await dataSource.getExpectedPlayerProfile(playerKey);
      const expectedResults = await dataSource.getExpectedPlayerResults(playerKey);

      expect(expectedProfile, `Profile expected data should be defined for ${playerKey}`).not.toBeNull();
      expect(expectedResults, `Results expected data should be defined for ${playerKey}`).not.toBeNull();

      // 2. Fixture metadata에서 calculationScope 획득
      let scope: 'sample' | 'complete' = 'sample';
      if (dataSource instanceof FixtureDataSource) {
        scope = dataSource.getCalculationScope('player-results.expected.json') as 'sample' | 'complete';
      } else if (dataSource instanceof CrawlerDataSource) {
        scope = 'sample';
      }

      // 3. 기대 결과 목록(expectedRows)을 기반으로 계산 수행
      const calculated = calculatePlayerSummaryFromRows(expectedResults!.expectedRows);

      // 4. 기대 요약 통계와 비교
      const comparisonResult = compareCalculatedSummary(expectedProfile!, calculated, scope);

      // 5. 검증 결과 리포팅
      reportComparison(testInfo, comparisonResult);

      if (scope === 'sample') {
        addDataWarning(testInfo, `Calculation scope is set to "sample". Mismatches will not cause hard failure.`, {
          playerKey,
          calculatedCashes: calculated.cashes,
          calculatedEarnings: calculated.totalEarnings,
        });
      }

      // STRICT_DATA_CHECK=true가 아니고, sample scope일 경우 fail를 warn으로 변환했기 때문에 
      // failures가 0인 상태여야 정상 통과합니다.
      expect(
        comparisonResult.failures.length,
        `Sum calculation check should pass. Calculation scope: ${scope}. Issues: \n${comparisonResult.failures.join('\n')}`
      ).toBe(0);
    });
  }
});
