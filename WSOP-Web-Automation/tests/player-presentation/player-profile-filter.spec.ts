import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import {
  expectProfilePageLoaded,
  applyProfileFilters,
} from '../../utils/playerPresentation/playerPresentationChecks';
import { attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';

type FilterPlayerFixture = {
  displayName: string;
  searchKeyword?: string;
  profileUrl: string;
  expectedCountry?: string;
  testBrand?: string;
  testSeason?: string | number;
};

const filterPlayers = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'fixtures', 'player-presentation', 'filter-players.fixture.json'),
    'utf8'
  )
) as FilterPlayerFixture[];

test.describe('Phase 3 - Player profile filters and summary consistency', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  for (const player of filterPlayers) {
    test(`${player.displayName} profile applies brand (${player.testBrand}) and season (${player.testSeason}) filters`, async ({ page }) => {
      // 1. 프로필 페이지로 이동 및 로드 검증 (상대경로를 스테이징 도메인과 결합)
      const mockPlayerFixture = {
        displayName: player.displayName,
        searchKeyword: player.searchKeyword,
        profileUrl: `https://wsop-stage.ggnweb.com${player.profileUrl}`,
        expectedCountry: player.expectedCountry,
      };
      await expectProfilePageLoaded(page, mockPlayerFixture);

      // 2. 브랜드 및 시즌 필터 적용
      await applyProfileFilters(page, player.testBrand, player.testSeason);

      // 3. 필터링된 상태에서 프로필 요약값(Cashes, Total Earnings) 파싱
      const bodyText = await page.locator('body').innerText();
      const parseSummaryNumber = (label: string): number | null => {
        const compact = bodyText.replace(/\s+/g, ' ').trim();
        const match = compact.match(new RegExp(`${label}\\s+([\\d,]+)`, 'i'));
        return match ? Number(match[1].replace(/,/g, '')) : null;
      };

      const parseSummaryMoney = (label: string): number | null => {
        const compact = bodyText.replace(/\s+/g, ' ').trim();
        const match = compact.match(new RegExp(`${label}\\s+(?:[^-\\d]*)(-?\\d[\\d,]*)(?:\\s|$)`, 'i'));
        return match ? Number(match[1].replace(/,/g, '')) : null;
      };

      const expectedCashes = parseSummaryNumber('Cashes');
      const expectedEarnings = parseSummaryMoney('Total Earnings');

      console.log(`[테스트] ${player.displayName} 필터 적용 후 요약 - Cashes: ${expectedCashes}, Total Earnings: ${expectedEarnings}`);

      // 4. ALL 탭이 있는 경우 펼치기 (Load more)
      const loadMoreButton = page.locator('button').filter({ hasText: /load\s*more/i }).first();
      let clickCount = 0;
      while ((await loadMoreButton.count()) > 0 && (await loadMoreButton.isVisible().catch(() => false)) && clickCount < 30) {
        await loadMoreButton.click().catch(() => {});
        await page.waitForTimeout(800);
        clickCount++;
      }

      // 이벤트 행 수집
      const resultLinkRows = await page.locator('a[href*="/tournaments/result/"]').evaluateAll((links) => {
        return links.map((link) => {
          const rowNode = link.closest('tr, [role="row"], li, [class*="row"], [class*="item"]') || link.parentElement;
          const rowText = (rowNode?.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
          return { rowText, href: link.getAttribute('href') || '' };
        });
      });

      // 중복 링크 제거
      const uniqueHrefs = new Set<string>();
      const validRows = resultLinkRows.filter(row => {
        if (!row.href || uniqueHrefs.has(row.href)) return false;
        uniqueHrefs.add(row.href);
        return true;
      });

      console.log(`[테스트] ${player.displayName} 필터 적용 후 수집된 고유 이벤트 수: ${validRows.length}`);

      // 5. 정합성 검증 (Cashes 개수 일치 단언)
      if (expectedCashes !== null) {
        expect(validRows.length).toBe(expectedCashes);
      }

      // 6. 개별 행 데이터의 필터 적합성 검증
      if (player.testSeason) {
        const seasonStr = String(player.testSeason);
        for (const row of validRows) {
          const hasSeason = row.rowText.includes(seasonStr) || row.rowText.includes(seasonStr.slice(-2));
          expect(hasSeason, `이벤트 행 "${row.rowText}" 에 지정된 시즌 연도 ${seasonStr}가 포함되어야 합니다.`).toBeTruthy();
        }
      }

      if (player.testBrand && player.testBrand.toUpperCase() !== 'ALL') {
        const brandStr = player.testBrand.toLowerCase();
        for (const row of validRows) {
          const text = row.rowText.toLowerCase();
          const hasBrand = text.includes(brandStr) || (brandStr === 'wsop' && (text.includes('world series') || text.includes('bracelet') || text.includes('ring')));
          expect(hasBrand, `이벤트 행 "${row.rowText}" 에 지정된 브랜드 ${player.testBrand}가 연관되어 있어야 합니다.`).toBeTruthy();
        }
      }
    });
  }
});
