import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { openPublicPage } from '../functional/support';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import { extractPlayerResultRows } from '../../utils/dataIntegrity/playerDataExtractors';
import {
  compareMoneyField,
  compareTextField,
  compareUrlField,
  createComparisonResult,
  mergeComparisonResults,
  applyBaselineDowngrade,
} from '../../utils/dataIntegrity/dataComparators';
import { reportComparison } from '../../utils/dataIntegrity/dataIntegrityReporter';
import type { ExpectedPlayerResults } from '../../utils/dataIntegrity/dataIntegrityTypes';

const dataSource =
  process.env.DATA_SOURCE === 'api'
    ? new ApiDataSource()
    : process.env.DATA_SOURCE === 'crawler'
    ? new CrawlerDataSource()
    : new FixtureDataSource();

const dataSourceType = process.env.DATA_SOURCE || 'fixture';
const expectedFile =
  dataSourceType === 'crawler'
    ? path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated', 'player-results.generated.expected.json')
    : path.join(process.cwd(), 'fixtures', 'data-integrity', 'player-results.expected.json');

let fixtureData = { playerResults: [] as ExpectedPlayerResults[] };
try {
  if (fs.existsSync(expectedFile)) {
    fixtureData = JSON.parse(fs.readFileSync(expectedFile, 'utf8')) as { playerResults: ExpectedPlayerResults[] };
  }
} catch {
  // Pass to show runtime warning test case
}

test.describe('Phase 6 - Player Profile Results Data Integrity', () => {
  for (const expectedResult of fixtureData.playerResults) {
    test(`${expectedResult.playerKey} profile results contain expected sample rows`, async ({ page }, testInfo) => {
      // 1. Expected Data 로드
      const expected = await dataSource.getExpectedPlayerResults(expectedResult.playerKey);
      expect(expected, `Expected data should be defined for playerKey: ${expectedResult.playerKey}`).not.toBeNull();
      const results = expected!;

      // 2. 프로필 URL 접속
      const targetUrl = results.profileUrl;
      await openPublicPage(page, targetUrl);

      // 3. UI에서 결과 목록 추출
      // playerDataExtractors는 기존의 헬퍼 함수를 내부적으로 사용하여 UI rows를 반환함
      const actualRows = await extractPlayerResultRows(page, {
        playerKey: results.playerKey,
        displayName: results.playerKey.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        profileUrl: results.profileUrl,
        country: null, bracelets: null, rings: null, finalTables: null, cashes: null, totalEarnings: null, knownExceptionKey: null
      });

      const allResults = [];

      // 4. Expected Sample Row를 순회하며 매칭 행 탐색 및 비교
      for (const expectedRow of results.expectedRows) {
        // UI에서 이벤트명이 일치하거나 포함되는 행을 찾음
        const match = actualRows.find((row) =>
          row.rowText.toLowerCase().includes(expectedRow.eventNameContains.toLowerCase())
        );

        if (!match) {
          const errMsg = `[FAIL] Expected result row "${expectedRow.eventNameContains}" not found in profile page UI rows.`;
          allResults.push(createComparisonResult([{
            fieldName: 'Result Row Availability',
            expected: expectedRow.eventNameContains,
            actual: actualRows.map(r => r.eventName).slice(0, 10),
            status: 'fail',
            message: errMsg
          }]));
          continue;
        }

        const details = [];
        const context = `${results.playerKey} -> ${expectedRow.eventNameContains}`;

        // eventNameContains (Hard Fail)
        details.push(compareTextField(match.eventName, expectedRow.eventNameContains, `${context}: Event Name`, { mode: 'normalizedContains' }));

        // seriesContains (Warning)
        if (expectedRow.seriesContains) {
          const seriesCheck = compareTextField(match.rowText, expectedRow.seriesContains, `${context}: Series Name`, { mode: 'normalizedContains' });
          if (seriesCheck.status === 'fail') seriesCheck.status = 'warn'; // Optional context, downgrade to warning
          details.push(seriesCheck);
        }

        // dateContains (Warning)
        if (expectedRow.dateContains) {
          details.push(compareTextField(match.dateText, expectedRow.dateContains, `${context}: Date`, { mode: 'date' }));
        }

        // rankContains (Hard Fail)
        if (expectedRow.rankContains) {
          details.push(compareTextField(match.rankText, expectedRow.rankContains, `${context}: Rank`, { mode: 'normalizedContains' }));
        }

        // earnings (Warning/Hard Fail)
        if (expectedRow.earnings) {
          details.push(compareMoneyField(match.earningsText, expectedRow.earnings, `${context}: Earnings`));
        }

        // resultUrlContains (Hard Fail)
        if (expectedRow.resultUrlContains) {
          details.push(compareUrlField(match.resultHref, expectedRow.resultUrlContains, `${context}: Result Href`));
        }

        allResults.push(createComparisonResult(details));
      }

      // 5. 검증 결과 병합 및 리포팅
      let finalResult = mergeComparisonResults(allResults);

      // Baseline 완화 적용
      const sourceInfo = dataSource.getInfo();
      if (!sourceInfo.sourceOfTruth) {
        finalResult = applyBaselineDowngrade(finalResult);
      }

      reportComparison(testInfo, finalResult);

      expect(
        finalResult.failures.length,
        `Player results list check should pass without hard failures. Issues: \n${finalResult.failures.join('\n')}`
      ).toBe(0);
    });
  }

  if (fixtureData.playerResults.length === 0) {
    test('Generated expected fixture check', () => {
      expect(
        false,
        `Generated expected fixture file not found: ${expectedFile}. Please run the crawler first:\n` +
        `  npm run crawl:standings && npm run generate:phase6-fixtures`
      ).toBeTruthy();
    });
  }
});
