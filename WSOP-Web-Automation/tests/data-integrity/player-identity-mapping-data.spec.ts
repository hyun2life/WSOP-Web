import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { FixtureDataSource } from '../../utils/dataIntegrity/fixtureDataSource';
import { ApiDataSource } from '../../utils/dataIntegrity/apiDataSource';
import { CrawlerDataSource } from '../../utils/dataIntegrity/crawlerDataSource';
import {
  compareTextField,
  compareUrlField,
  createComparisonResult,
  applyBaselineDowngrade,
} from '../../utils/dataIntegrity/dataComparators';
import { reportComparison, addDataWarning } from '../../utils/dataIntegrity/dataIntegrityReporter';
import type { ExpectedIdentityMapping } from '../../utils/dataIntegrity/dataIntegrityTypes';

const dataSource =
  process.env.DATA_SOURCE === 'api'
    ? new ApiDataSource()
    : process.env.DATA_SOURCE === 'crawler'
    ? new CrawlerDataSource()
    : new FixtureDataSource();

const dataSourceType = process.env.DATA_SOURCE || 'fixture';
const expectedFile =
  dataSourceType === 'crawler'
    ? path.join(process.cwd(), 'fixtures', 'data-integrity', 'generated', 'identity-mapping.generated.expected.json')
    : path.join(process.cwd(), 'fixtures', 'data-integrity', 'identity-mapping.expected.json');

let fixtureData = { players: [] as ExpectedIdentityMapping[] };
try {
  if (fs.existsSync(expectedFile)) {
    fixtureData = JSON.parse(fs.readFileSync(expectedFile, 'utf8')) as { players: ExpectedIdentityMapping[] };
  }
} catch {
  // Pass
}

test.describe('Phase 6 - Player Identity & URL Mapping Integrity', () => {
  for (const expectedPlayer of fixtureData.players) {
    test(`Identity mapping resolves consistently for ${expectedPlayer.displayName}`, async ({ page }, testInfo) => {
      // 1. Expected Data 및 Exception 로드
      const expected = await dataSource.getExpectedIdentityMapping(expectedPlayer.playerKey);
      expect(expected, `Expected identity mapping should be defined for: ${expectedPlayer.playerKey}`).not.toBeNull();
      const mapping = expected!;

      const knownException = mapping.knownExceptionKey
        ? await dataSource.getKnownException(mapping.knownExceptionKey)
        : null;

      // 2. 프로필 다이렉트 페이지 접속 및 URL 검증
      const targetUrl = mapping.profileUrl;
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch((err) => {
        expect(false, `Failed to navigate to target profile page: ${targetUrl}. error=${err.message}`).toBeTruthy();
        return null;
      });

      if (!response) return;
      expect(response.status(), `Target profile URL status should be < 400. url=${targetUrl}`).toBeLessThan(400);

      const details = [];
      const context = `Identity Mapping -> ${mapping.displayName}`;

      // 3. profileUrl 일치 검사
      details.push(compareUrlField(page.url(), mapping.profileUrl, `${context}: Profile URL Target`));

      // 4. 별칭(Aliases) 및 기본 표시 이름 유효성 검사
      const titleLocator = page.locator('h1, h2, [class*="name" i]').first();
      const actualName = await titleLocator.innerText().catch(() => '');
      
      let aliasMatched = false;
      const allowedAliases = mapping.allowedAliases || mapping.aliases || [mapping.displayName];
      for (const alias of allowedAliases) {
        if (actualName.toLowerCase().includes(alias.toLowerCase())) {
          aliasMatched = true;
          break;
        }
      }

      if (!aliasMatched) {
        details.push({
          fieldName: 'Allowed Aliases Match',
          expected: allowedAliases,
          actual: actualName,
          status: process.env.STRICT_DATA_CHECK === 'true' ? 'fail' : 'warn',
          message: `[WARN] Profile display name "${actualName}" does not match any allowed aliases: ${JSON.stringify(allowedAliases)}`,
        });
      } else {
        details.push({
          fieldName: 'Allowed Aliases Match',
          expected: allowedAliases,
          actual: actualName,
          status: 'pass',
          message: `[PASS] Profile display name "${actualName}" matches allowed aliases.`,
        });
      }

      // 5. playerId / onepassId 매핑 확장 구조 구현 (현재는 fixture가 null이므로 skip되게 설계)
      if (mapping.playerId !== null) {
        details.push(compareTextField(null, mapping.playerId, `${context}: playerId`));
      }
      if (mapping.onepassId !== null) {
        details.push(compareTextField(null, mapping.onepassId, `${context}: onepassId`));
      }

      // 6. Daniel Negreanu 등 known exception에 따른 다중 컨텍스트 허용 유무 수집
      if (knownException?.allowMultipleContextMentions) {
        addDataWarning(testInfo, `Known multiple context mentions allowed for player.`, {
          playerKey: mapping.playerKey,
          reason: knownException.reason,
        });
      }

      // 7. 검증 결과 리포팅
      let finalResult = createComparisonResult(details);

      // Baseline 완화 적용
      const sourceInfo = dataSource.getInfo();
      if (!sourceInfo.sourceOfTruth) {
        finalResult = applyBaselineDowngrade(finalResult);
      }

      reportComparison(testInfo, finalResult);

      expect(
        finalResult.failures.length,
        `Identity mapping integrity check should pass without hard failures. Issues: \n${finalResult.failures.join('\n')}`
      ).toBe(0);
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
