import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { openPublicPage } from '../functional/support';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import { extractResultDetailMeta, extractResultDetailRows } from '../../utils/dataIntegrity/resultDetailDataExtractors';
import {
  compareIntegerField,
  compareMoneyField,
  compareTextField,
  compareUrlField,
  createComparisonResult,
  mergeComparisonResults,
  applyBaselineDowngrade,
} from '../../utils/dataIntegrity/dataComparators';
import { reportComparison, addDataWarning } from '../../utils/dataIntegrity/dataIntegrityReporter';
import type { ExpectedResultDetail } from '../../utils/dataIntegrity/dataIntegrityTypes';

const dataSource =
  process.env.DATA_SOURCE === 'api'
    ? new ApiDataSource()
    : process.env.DATA_SOURCE === 'crawler'
    ? new CrawlerDataSource()
    : new FixtureDataSource();

const dataSourceType = process.env.DATA_SOURCE || 'fixture';
const expectedFile =
  dataSourceType === 'crawler'
    ? path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated', 'result-details.generated.expected.json')
    : path.join(process.cwd(), 'fixtures', 'data-integrity', 'result-details.expected.json');

let fixtureData = { resultDetails: [] as ExpectedResultDetail[] };
try {
  // resultDetail 데이터는 crawler generated 파일이 없을 시 static fallback 가능하게 dataSource 내에 구현되어 있으나
  // Playwright 루프 구성을 위해 파일이 있으면 generated를 읽고 없으면 static을 읽어 줍니다.
  const pathToCheck = fs.existsSync(expectedFile) ? expectedFile : path.join(process.cwd(), 'fixtures', 'data-integrity', 'result-details.expected.json');
  if (fs.existsSync(pathToCheck)) {
    fixtureData = JSON.parse(fs.readFileSync(pathToCheck, 'utf8')) as { resultDetails: ExpectedResultDetail[] };
  }
} catch {
  // Pass
}

test.describe('Phase 6 - Result Detail Data Integrity', () => {
  for (const expectedResult of fixtureData.resultDetails) {
    test(`Result detail metadata and table match for ${expectedResult.resultKey}`, async ({ page }, testInfo) => {
      // 1. Expected Data 로드
      const expected = await dataSource.getExpectedResultDetail(expectedResult.resultKey);
      expect(expected, `Expected data should be defined for: ${expectedResult.resultKey}`).not.toBeNull();
      const result = expected!;

      const knownException = await dataSource.getKnownException('legacy-result-format');

      // 2. 결과 상세 페이지 접속
      const targetUrl = result.resultUrl;
      await openPublicPage(page, targetUrl);

      // 테이블 내부의 데이터가 실제로 렌더링될 때까지 대기
      // 1. 테이블 내 플레이어 프로필 링크가 렌더링될 때까지 대기 (비동기 데이터 바인딩 대기)
      const tablePlayerLink = page.locator('table tbody tr a[href*="/players/"]').first();
      await tablePlayerLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

      // 2. 폴백: 첫 번째 데이터 셀에 빈 값이 아닌 텍스트가 들어찰 때까지 대기
      const firstDataCell = page.locator('table tbody tr td').first();
      await firstDataCell.waitFor({ state: 'attached', timeout: 5000 }).catch(() => undefined);
      await expect(firstDataCell).not.toBeEmpty({ timeout: 5000 }).catch(() => undefined);

      // 3. UI에서 메타데이터 추출 및 비교
      const actualMeta = await extractResultDetailMeta(page, result);
      const metaDetails = [];
      const metaContext = `${result.resultKey} (Meta)`;

      // eventName (Hard Fail)
      if (result.eventNameContains) {
        metaDetails.push(compareTextField(actualMeta.eventName, result.eventNameContains, `${metaContext}: Event Name`, { mode: 'normalizedContains' }));
      }

      // seriesName (Warning)
      if (result.seriesNameContains) {
        const seriesCheck = compareTextField(actualMeta.seriesName, result.seriesNameContains, `${metaContext}: Series Name`, { mode: 'normalizedContains' });
        if (seriesCheck.status === 'fail') seriesCheck.status = 'warn';
        metaDetails.push(seriesCheck);
      }

      // startDate (Warning)
      if (result.startDateContains) {
        const dateCheck = compareTextField(actualMeta.startDate, result.startDateContains, `${metaContext}: Start Date`, { mode: 'normalizedContains' });
        if (dateCheck.status === 'fail') dateCheck.status = 'warn';
        metaDetails.push(dateCheck);
      }

      // buyIn (Hard Fail)
      if (result.buyIn) {
        metaDetails.push(compareMoneyField(actualMeta.buyIn, result.buyIn, `${metaContext}: Buy-In`));
      }

      // entries (Hard Fail)
      if (result.entries) {
        metaDetails.push(compareIntegerField(actualMeta.entries, result.entries, `${metaContext}: Entries`));
      }

      // prize (Hard Fail)
      if (result.prize) {
        metaDetails.push(compareMoneyField(actualMeta.prize, result.prize, `${metaContext}: Prize Pool`));
      }

      // winner (Hard Fail)
      if (result.winner) {
        metaDetails.push(compareTextField(actualMeta.winner, result.winner, `${metaContext}: Winner Name`, { mode: 'normalizedContains' }));
      }

      // winnerEarnings (Hard Fail)
      if (result.winnerEarnings) {
        metaDetails.push(compareMoneyField(actualMeta.winnerEarnings, result.winnerEarnings, `${metaContext}: Winner Earnings`));
      }

      const metaResult = createComparisonResult(metaDetails);

      // 4. UI에서 결과 테이블/입상 리스트 추출 및 비교
      const uiRows = await extractResultDetailRows(page);
      const tableResults = [];

      for (const expectedRow of result.expectedRows) {
        // rank와 name으로 행 탐색
        const match = uiRows.find(
          (r) =>
            r.rank === expectedRow.rank &&
            r.displayName.toLowerCase().includes(expectedRow.displayName.toLowerCase())
        );

        if (!match) {
          const errMsg = `[FAIL] Expected result detail row (Rank: ${expectedRow.rank}, Player: ${expectedRow.displayName}) not found in table.`;
          tableResults.push(createComparisonResult([{
            fieldName: 'Result Row Presence',
            expected: `Rank ${expectedRow.rank}: ${expectedRow.displayName}`,
            actual: uiRows.slice(0, 10).map((r) => `Rank ${r.rank}: ${r.displayName}`),
            status: 'fail',
            message: errMsg,
          }]));
          continue;
        }

        const details = [];
        const rowContext = `${result.resultKey} -> Rank ${expectedRow.rank} (${expectedRow.displayName})`;

        // country (Warning)
        if (expectedRow.country) {
          const countryCheck = compareTextField(match.country, expectedRow.country, `${rowContext}: Country`, { mode: 'normalizedContains' });
          if (countryCheck.status === 'fail') countryCheck.status = 'warn';
          details.push(countryCheck);
        }

        // earnings (Hard Fail)
        if (expectedRow.earnings) {
          details.push(compareMoneyField(match.earnings, expectedRow.earnings, `${rowContext}: Earnings`));
        }

        // profileUrlContains (Warning/Hard Fail based on legacy format exceptions)
        if (expectedRow.profileUrlContains) {
          const urlCheck = compareUrlField(match.profileUrlContains, expectedRow.profileUrlContains, `${rowContext}: Profile Href`);
          if (urlCheck.status === 'fail' && !match.profileUrlContains && knownException?.warningOnly) {
            // legacy-result-format 예외에 따른 완화
            urlCheck.status = 'warn';
            urlCheck.message += ` (Downgraded to warning as legacy formatting might lack player profile links. Reason: ${knownException.reason})`;
          }
          details.push(urlCheck);
        }

        tableResults.push(createComparisonResult(details));
      }

      // 5. 검증 결과 병합 및 리포팅
      let finalResult = mergeComparisonResults([metaResult, ...tableResults]);

      // Baseline 완화 적용
      const sourceInfo = dataSource.getInfo();
      if (!sourceInfo.sourceOfTruth) {
        finalResult = applyBaselineDowngrade(finalResult);
      }

      reportComparison(testInfo, finalResult);

      expect(
        finalResult.failures.length,
        `Result detail data integrity check should pass without hard failures. Issues: \n${finalResult.failures.join('\n')}`
      ).toBe(0);
    });
  }

  if (fixtureData.resultDetails.length === 0) {
    test('Generated expected fixture check', () => {
      expect(
        false,
        `Generated expected fixture file not found. Please run the crawler first:\n` +
        `  npm run crawl:standings && npm run generate:phase6-fixtures`
      ).toBeTruthy();
    });
  }
});
