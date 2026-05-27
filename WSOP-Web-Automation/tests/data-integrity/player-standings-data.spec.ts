import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import { extractStandingsSection, findStandingsRowByPlayer } from '../../utils/dataIntegrity/standingsDataExtractors';
import {
  compareIntegerField,
  compareMoneyField,
  compareUrlField,
  createComparisonResult,
  mergeComparisonResults,
  applyBaselineDowngrade,
} from '../../utils/dataIntegrity/dataComparators';
import { reportComparison, addDataWarning } from '../../utils/dataIntegrity/dataIntegrityReporter';
import type { ExpectedStandingsCategory } from '../../utils/dataIntegrity/dataIntegrityTypes';

const dataSource =
  process.env.DATA_SOURCE === 'api'
    ? new ApiDataSource()
    : process.env.DATA_SOURCE === 'crawler'
    ? new CrawlerDataSource()
    : new FixtureDataSource();

const dataSourceType = process.env.DATA_SOURCE || 'fixture';
const expectedFile =
  dataSourceType === 'crawler'
    ? path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated', 'standings.generated.expected.json')
    : path.join(process.cwd(), 'fixtures', 'data-integrity', 'standings.expected.json');

let fixtureData = { categories: [] as ExpectedStandingsCategory[] };
try {
  if (fs.existsSync(expectedFile)) {
    fixtureData = JSON.parse(fs.readFileSync(expectedFile, 'utf8')) as { categories: ExpectedStandingsCategory[] };
  }
} catch {
  // Pass to show runtime warning test case
}

test.describe('Phase 6 - Player Standings Data Integrity', () => {
  for (const expectedCategory of fixtureData.categories) {
    test(`Standings category ${expectedCategory.sectionHeading} matches expected data`, async ({ page }, testInfo) => {
      // 1. Expected Data 로드
      const expected = await dataSource.getExpectedStandings(expectedCategory.categoryKey);
      expect(expected, `Expected data should be defined for category: ${expectedCategory.categoryKey}`).not.toBeNull();
      const category = expected!;

      // 2. 스탠딩 페이지 접속
      const targetUrl = category.pageUrl;
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
        expect(false, `Failed to navigate to standings page: ${targetUrl}. error=${err.message}`).toBeTruthy();
        return null;
      });

      if (!response) return;
      expect(response.status(), `Standings URL should return < 400. url=${targetUrl}`).toBeLessThan(400);

      // 테이블 또는 리스트 데이터 렌더링 대기
      const firstCell = page.locator('table tbody tr td, ul li, ol li, [class*="row" i] td, a[href*="/players/"]').first();
      await firstCell.waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);

      // 3. UI에서 섹션 행 파싱
      const uiRows = await extractStandingsSection(page, category);

      if (uiRows.length === 0) {
        // Section이 존재하지 않거나 행을 읽지 못한 경우 (Hard Fail)
        expect(false, `No standings rows extracted for section "${category.sectionHeading}".`).toBeTruthy();
        return;
      }

      const allResults = [];

      // Stale warning 감지
      const generatedAt = (fixtureData as any).metadata?.generatedAt || 'unknown';
      addDataWarning(testInfo, `Standings check using fixture version generated at ${generatedAt}.`);

      // 4. Expected Row 순회하며 대조 검증
      for (const expectedRow of category.expectedRows) {
        const { row: match, diagnostics } = findStandingsRowByPlayer(uiRows, expectedRow.displayName, expectedRow.rank);

        if (!match) {
          const errMsg = `[FAIL] Expected player row "${expectedRow.displayName}" (expected rank: ${expectedRow.rank}) not found in standings list.\nDiagnostics: ${diagnostics.join('\n')}`;
          allResults.push(createComparisonResult([{
            fieldName: 'Player Row Presence',
            expected: `${expectedRow.rank}: ${expectedRow.displayName}`,
            actual: uiRows.slice(0, 10).map((r) => `${r.rank}: ${r.displayName}`),
            status: 'fail',
            message: errMsg,
          }]));
          continue;
        }

        const details = [];
        const context = `${category.categoryKey} -> ${expectedRow.displayName}`;

        // rank (Hard Fail)
        details.push(compareIntegerField(match.rank, expectedRow.rank, `${context}: Rank`));

        // earnings (Warning/Hard Fail)
        if (expectedRow.earnings) {
          details.push(compareMoneyField(match.earnings, expectedRow.earnings, `${context}: Earnings`));
        }

        // bracelets (Hard Fail if exists)
        if (expectedRow.bracelets !== undefined && expectedRow.bracelets !== null) {
          details.push(compareIntegerField(match.bracelets, expectedRow.bracelets, `${context}: Bracelets`));
        }

        // rings (Hard Fail if exists)
        if (expectedRow.rings !== undefined && expectedRow.rings !== null) {
          details.push(compareIntegerField(match.rings, expectedRow.rings, `${context}: Rings`));
        }

        // wins (Hard Fail if exists)
        if (expectedRow.wins !== undefined && expectedRow.wins !== null) {
          details.push(compareIntegerField(match.wins, expectedRow.wins, `${context}: Wins`));
        }

        // finalTables (Hard Fail if exists)
        if (expectedRow.finalTables !== undefined && expectedRow.finalTables !== null) {
          details.push(compareIntegerField(match.finalTables, expectedRow.finalTables, `${context}: Final Tables`));
        }

        // cashes (Hard Fail if exists)
        if (expectedRow.cashes !== undefined && expectedRow.cashes !== null) {
          details.push(compareIntegerField(match.cashes, expectedRow.cashes, `${context}: Cashes`));
        }

        // profileUrlContains (Hard Fail)
        if (expectedRow.profileUrlContains) {
          details.push(compareUrlField(match.profileHref, expectedRow.profileUrlContains, `${context}: Profile Link`));
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
        `Standings data integrity check should pass without hard failures. Issues: \n${finalResult.failures.join('\n')}`
      ).toBe(0);
    });
  }

  if (fixtureData.categories.length === 0) {
    test('Generated expected fixture check', () => {
      expect(
        false,
        `Generated expected fixture file not found: ${expectedFile}. Please run the crawler first:\n` +
        `  npm run crawl:standings && npm run generate:phase6-fixtures`
      ).toBeTruthy();
    });
  }
});
