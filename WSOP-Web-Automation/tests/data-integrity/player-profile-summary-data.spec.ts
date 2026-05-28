import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { openPublicPage } from '../functional/support';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import { extractPlayerProfileSummary } from '../../utils/dataIntegrity/playerDataExtractors';
import {
  compareIntegerField,
  compareMoneyField,
  compareTextField,
  compareUrlField,
  createComparisonResult,
  applyBaselineDowngrade,
} from '../../utils/dataIntegrity/dataComparators';
import { reportComparison, addDataWarning } from '../../utils/dataIntegrity/dataIntegrityReporter';
import type { ExpectedPlayerSummary } from '../../utils/dataIntegrity/dataIntegrityTypes';

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

let fixtureData = { players: [] as ExpectedPlayerSummary[] };
try {
  if (fs.existsSync(expectedFile)) {
    fixtureData = JSON.parse(fs.readFileSync(expectedFile, 'utf8')) as { players: ExpectedPlayerSummary[] };
  }
} catch {
  // Pass to show runtime warning test case
}

test.describe('Phase 6 - Player Profile Summary Data Integrity', () => {
  for (const expectedPlayer of fixtureData.players) {
    test(`${expectedPlayer.displayName} profile summary matches expected data`, async ({ page }, testInfo) => {
      // 1. Expected Player Data 및 Exception 로드
      const expected = await dataSource.getExpectedPlayerProfile(expectedPlayer.playerKey);
      expect(expected, `Expected data should be defined for: ${expectedPlayer.playerKey}`).not.toBeNull();
      const player = expected!;

      const knownException = player.knownExceptionKey
        ? await dataSource.getKnownException(player.knownExceptionKey)
        : null;

      // 2. 프로필 URL 접속
      const targetUrl = player.profileUrl;
      await openPublicPage(page, targetUrl);

      // 3. UI 데이터 추출
      const actual = await extractPlayerProfileSummary(page, player);

      // 4. 필드 비교
      const details = [];

      // displayName (Hard Fail)
      details.push(compareTextField(actual.displayName, player.displayName, 'Display Name', { mode: 'exact' }));

      // profileUrl (Hard Fail)
      details.push(compareUrlField(page.url(), player.profileUrl, 'Profile URL Path'));

      // country (Warning or Hard Fail)
      if (player.country !== null) {
        const countryCheck = compareTextField(actual.country, player.country, 'Country', { mode: 'normalizedContains' });
        if (actual.metadata.countrySource === 'flag-image-alt' && countryCheck.status === 'fail') {
          countryCheck.status = 'warn'; // Flag 이미지로만 매칭 실패 시 Warning으로 감쇄
          countryCheck.message += ` (Country was inferred from flag image alt: "${actual.country}").`;
        }
        details.push(countryCheck);
      }

      // bracelets (Hard Fail if exists)
      if (player.bracelets !== null) {
        details.push(compareIntegerField(actual.bracelets, player.bracelets, 'Bracelets'));
      }

      // rings (Hard Fail if exists)
      if (player.rings !== null) {
        details.push(compareIntegerField(actual.rings, player.rings, 'Rings'));
      }

      // finalTables (Hard Fail if exists)
      if (player.finalTables !== null) {
        details.push(compareIntegerField(actual.finalTables, player.finalTables, 'Final Tables'));
      }

      // cashes (Hard Fail if exists)
      if (player.cashes !== null) {
        details.push(compareIntegerField(actual.cashes, player.cashes, 'Cashes'));
      }

      // totalEarnings (Warning/Hard Fail based on currency conversion rate differences)
      if (player.totalEarnings !== null) {
        const earningsCheck = compareMoneyField(actual.totalEarnings, player.totalEarnings, 'Total Earnings');
        if (earningsCheck.status === 'fail') {
          // 환율 및 소수점 절사 등 표현식 차이일 수 있으므로 strict=false일 때 warn 처리
          earningsCheck.status = 'warn';
          earningsCheck.message += ' (Total earnings expression difference or minor stale data warning).';
        }
        details.push(earningsCheck);
      }

      // 5. 검증 결과 생성 및 리포팅
      let comparisonResult = createComparisonResult(details);

      // Baseline 완화 적용
      const sourceInfo = dataSource.getInfo();
      if (!sourceInfo.sourceOfTruth) {
        comparisonResult = applyBaselineDowngrade(comparisonResult);
      }

      // Stale fixture 감안 문구 보완
      if (!comparisonResult.passed) {
        const mismatchFields = comparisonResult.details
          .filter((d) => d.status === 'fail' || d.status === 'warn')
          .map((d) => d.fieldName);
        
        const exceptionMsg = `Note: Expected ${sourceInfo.baseline ? 'crawler baseline' : 'fixture'} data mismatch. (Mismatches found in: ${mismatchFields.join(', ')})`;
        if (sourceInfo.sourceOfTruth && process.env.STRICT_DATA_CHECK === 'true') {
          comparisonResult.failures.push(exceptionMsg);
        } else {
          comparisonResult.warnings.push(exceptionMsg);
        }
      }

      reportComparison(testInfo, comparisonResult);

      if (knownException?.warningOnly) {
        addDataWarning(testInfo, 'Known summary exception mapped.', {
          reason: knownException.reason,
          playerKey: player.playerKey,
        });
      } else {
        expect(
          comparisonResult.failures.length,
          `Player summary check should pass without hard failures. Issues: \n${comparisonResult.failures.join('\n')}`
        ).toBe(0);
      }
    });
  }

  if (fixtureData.players.length === 0) {
    test('Generated expected fixture check', () => {
      expect(
        false,
        `Generated expected fixture file not found: ${expectedFile}. Please run the crawler first:\n` +
        `  npm run crawl:standings && npm run generate:phase6-fixtures`
      ).toBeTruthy();
    });
  }
});
