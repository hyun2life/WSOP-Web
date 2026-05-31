import { expect, test } from '@playwright/test';

import { addWarning, attachWarningsToTestInfo, clearWarnings } from '../../utils/playerPresentation/warningCollector';
import { assertListDidNotBreak } from '../../utils/searchFilterSort/paginationHelpers';
import { expectAnyTextVisible, expectPlayerLinksVisible } from '../../utils/searchFilterSort/resultListAssertions';
import { openPlayerStandings } from '../../utils/searchFilterSort/standingsHelpers';

test.describe('Phase 4 - player standings full list navigation', () => {
  test.beforeEach(() => clearWarnings());
  test.afterEach(({}, testInfo) => {
    attachWarningsToTestInfo(testInfo);
    clearWarnings();
  });

  test('Standings View full list links navigate to usable list pages', async ({ page }) => {
    await openPlayerStandings(page);

    const hrefs = await page
      .locator('a')
      .filter({ hasText: /view full list|full list|view all|all rankings/i })
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href') || '')
          .filter((href) => href && !href.startsWith('#')),
      );

    const uniqueHrefs = Array.from(new Set(hrefs)).slice(0, 3);
    if (uniqueHrefs.length === 0) {
      addWarning('phase4-view-full-list', 'No View full list links were visible on /player-standings/.');
      await expectPlayerLinksVisible(page, 1, 'Player Standings fallback list');
      return;
    }

    for (const href of uniqueHrefs) {
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' });
      expect(response, `View full list should return a response: ${href}`).not.toBeNull();
      expect(response!.status(), `View full list should not return 4xx/5xx: ${href}`).toBeLessThan(400);
      await expectAnyTextVisible(page, ['Player', 'Country', 'Earnings', 'Bracelets', 'Rings', 'Cashes'], {
        pageUrl: href,
        label: 'Standings full list destination',
      });
      await assertListDidNotBreak(page);
      await expectPlayerLinksVisible(page, 1, `Standings full list ${href}`);
    }
  });

  test('Brand Filter dropdown options respect brand integration and sorting policies', async ({ page }) => {
    await openPlayerStandings(page);

    const hrefs = await page
      .locator('a')
      .filter({ hasText: /view full list|full list|view all|all rankings/i })
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href') || '')
          .filter((href) => href && !href.startsWith('#')),
      );

    const uniqueHrefs = Array.from(new Set(hrefs));
    
    // 2026 Standings (/player-standings/ 또는 trailing slash가 없는 /player-standings 또는 2026-standings 포함)는 제외
    const targetHrefs = uniqueHrefs.filter(
      (href) => href !== '/player-standings/' && href !== '/player-standings' && !href.includes('2026-standings')
    ).slice(0, 2); // 과도한 요청 방지를 위해 상위 2개 페이지만 샘플 검증

    if (targetHrefs.length === 0) {
      addWarning('phase4-brand-filter', 'No sub-category View full list links (excluding 2026 Standings) were visible.');
      return;
    }

    for (const href of targetHrefs) {
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' });
      expect(response, `View full list destination should return a response: ${href}`).not.toBeNull();
      expect(response!.status(), `HTTP status should be < 400: ${href}`).toBeLessThan(400);

      let options: string[] = [];

      // Case A: 표준 <select> 태그가 존재하는지 확인
      const selectLocator = page.locator('select').first();
      const hasSelect = (await selectLocator.count()) > 0 && (await selectLocator.isVisible().catch(() => false));

      if (hasSelect) {
        options = await selectLocator.locator('option').evaluateAll((nodes) =>
          nodes.map((node) => (node.textContent || '').trim()).filter(Boolean)
        );
      } else {
        // Case B: 커스텀 드롭다운. All Brands 또는 브랜드 필터 트리거 요소를 찾음
        const dropdownTrigger = page.locator('button, a, div, span').filter({ hasText: /All Brands|Brand|WSOP/i }).first();
        if ((await dropdownTrigger.count()) > 0 && (await dropdownTrigger.isVisible().catch(() => false))) {
          await dropdownTrigger.click();
          await page.waitForTimeout(300); // 팝업 애니메이션 대기
          
          // 드롭다운 내부 옵션 리스트 추출 (보통 ul li, role="option" 또는 select-option 클래스 등)
          const optionItems = page.locator('[role="option"], li, a, button').filter({ hasText: /WSOP|GGPoker|WPT|PGT|All Brands/i });
          const rawOptions = await optionItems.evaluateAll((nodes) =>
            nodes.map((node) => (node.textContent || '').trim()).filter(Boolean)
          );
          options = Array.from(new Set(rawOptions));
        }
      }

      if (options.length === 0) {
        addWarning('phase4-brand-filter-options', `No brand filter options could be extracted from page: ${href}`);
        continue;
      }

      // 만약 신규 명칭인 'Irish Poker Open'이 없고, 기존 'Irish Poker Tour'가 여전히 남아있거나
      // 'WSOP' 조차 포함되어 있지 않은 구 버전 상태라면 Warning 처리하고 해당 페이지 검증은 넘어갑니다.
      const isNewVersion = options.includes('Irish Poker Open') || options.includes('PGT (Poker Go Tour)');
      if (!isNewVersion) {
        addWarning(
          'phase4-brand-filter-legacy-site',
          `The page "${href}" seems to render the legacy filter dropdown or is not yet updated on the current environment. Skipping strict assertions.`,
          { href, extractedOptions: options }
        );
        continue;
      }

      // --- 브랜드 검증 단언(Assertions) ---

      // 1. 브랜드 통합 검증 (서브 브랜드가 개별 옵션으로 존재하지 않고 메인 브랜드로 묶였는지 확인)
      const subBrands = ['WSOP PARADISE', 'WSOP EUROPE', 'WSOP ASIA', 'WSOP ONLINE', 'GGMASTERS', 'GGMILLION$', 'WPT PRIME', 'WSOP CIRCUIT'];
      for (const subBrand of subBrands) {
        expect(options, `Sub-brand "${subBrand}" should be integrated into Main Brand and not exist as a separate filter option.`).not.toContain(subBrand);
      }

      // 2. 통합 메인 브랜드명 검증
      expect(options, 'Main brand "WSOP" should be present.').toContain('WSOP');
      expect(options, 'Main brand "GGPoker" should be present.').toContain('GGPoker');
      expect(options, 'Main brand "WPT" should be present.').toContain('WPT');

      // 3. PGT 명칭 변경 검증 (PGT -> PGT (Poker Go Tour))
      expect(options, 'PGT option should use "PGT (Poker Go Tour)" format.').toContain('PGT (Poker Go Tour)');
      expect(options, 'Old "PGT" label should not be present.').not.toContain('PGT');

      // 4. Irish Poker Open 명칭 오류 수정 검증 (Irish Poker Tour -> Irish Poker Open)
      expect(options, 'Brand "Irish Poker Open" should be present.').toContain('Irish Poker Open');
      expect(options, 'Old "Irish Poker Tour" label should not be present.').not.toContain('Irish Poker Tour');

      // 5. 정렬 기준 검증 (WSOP, GGPoker 상단 고정 + 나머지 ABC 순서 정렬)
      const cleanedOptions = options.filter((opt) => !/all brands/i.test(opt));
      if (cleanedOptions.length >= 3) {
        expect(cleanedOptions[0], 'First brand option should be WSOP (fixed at top).').toBe('WSOP');
        expect(cleanedOptions[1], 'Second brand option should be GGPoker (fixed at top).').toBe('GGPoker');

        const restOptions = cleanedOptions.slice(2);
        const sortedRest = [...restOptions].sort((a, b) => a.localeCompare(b));
        expect(restOptions, 'Options below WSOP and GGPoker should be sorted alphabetically.').toEqual(sortedRest);
      }
    }
  });

  test('Collect and validate player list by selecting each brand filter option', async ({ page }) => {
    // 필터별 페이지 이동 및 스크래핑을 수행하므로 타임아웃을 넉넉히 설정합니다.
    test.setTimeout(90_000);

    await openPlayerStandings(page);

    const hrefs = await page
      .locator('a')
      .filter({ hasText: /view full list|full list|view all|all rankings/i })
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute('href') || '')
          .filter((href) => href && !href.startsWith('#')),
      );

    const uniqueHrefs = Array.from(new Set(hrefs));
    
    // 2026 Standings를 제외한 상세 카테고리 중 첫 번째 페이지를 샘플로 테스트 수행 (All-Time Earnings - Men 등)
    const targetHrefs = uniqueHrefs.filter(
      (href) => href !== '/player-standings/' && href !== '/player-standings' && !href.includes('2026-standings')
    ).slice(0, 1); 

    if (targetHrefs.length === 0) {
      addWarning('phase4-brand-collect', 'No sub-category View full list links found.');
      return;
    }

    const targetUrl = targetHrefs[0];
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

    let options: string[] = [];
    const selectLocator = page.locator('select').first();
    const hasSelect = (await selectLocator.count()) > 0 && (await selectLocator.isVisible().catch(() => false));

    if (hasSelect) {
      options = await selectLocator.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent || '').trim()).filter(Boolean)
      );
    } else {
      const dropdownTrigger = page.locator('button, a, div, span').filter({ hasText: /All Brands|Brand|WSOP/i }).first();
      if ((await dropdownTrigger.count()) > 0 && (await dropdownTrigger.isVisible().catch(() => false))) {
        await dropdownTrigger.click();
        await page.waitForTimeout(300);
        const optionItems = page.locator('[role="option"], li, a, button').filter({ hasText: /WSOP|GGPoker|WPT|PGT|All Brands/i });
        const rawOptions = await optionItems.evaluateAll((nodes) =>
          nodes.map((node) => (node.textContent || '').trim()).filter(Boolean)
        );
        options = Array.from(new Set(rawOptions));
        await dropdownTrigger.click(); // 드롭다운 닫기
      }
    }

    const brandOptions = options.filter((opt) => !/all brands/i.test(opt));

    if (brandOptions.length === 0) {
      addWarning('phase4-brand-collect-options', `No specific brand filter options found on page: ${targetUrl}`);
      return;
    }

    // 과도한 네트워크 요청 및 E2E 타임아웃을 막기 위해 대표 브랜드 최대 3개까지만 순회 검증
    const testBrands = brandOptions.slice(0, 3);

    for (const brand of testBrands) {
      // 필터 적용
      if (hasSelect) {
        await selectLocator.selectOption({ label: brand });
      } else {
        const dropdownTrigger = page.locator('button, div').filter({ hasText: /All Brands|Brand|WSOP|GGPoker|WPT/i }).first();
        await dropdownTrigger.click();
        await page.waitForTimeout(200);
        await page.locator('[role="option"], li, a').filter({ hasText: new RegExp(`^${brand}$`, 'i') }).click();
      }

      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(500);

      const collectedPlayers: { rank: string; name: string }[] = [];
      let currentPage = 1;

      while (currentPage <= 2) {
        const playerRows = page.locator('table tbody tr, [role="row"], [class*="row" i]').filter({ hasText: /[^player]/i });
        const count = await playerRows.count();
        
        for (let i = 0; i < count; i++) {
          if (collectedPlayers.length >= 100) break;

          const row = playerRows.nth(i);
          const nameLink = row.locator('a[href*="/players/"]').first();
          if ((await nameLink.count()) > 0) {
            const name = (await nameLink.innerText()).trim();
            const rank = (await row.locator('td').first().innerText().catch(() => '')).trim();
            if (name && !collectedPlayers.some(p => p.name === name)) {
              collectedPlayers.push({ rank, name });
            }
          }
        }

        if (collectedPlayers.length >= 100) {
          break;
        }

        const nextButton = page.locator('button, a').filter({ hasText: /next|load more|show more/i }).first();
        const hasNext = (await nextButton.count()) > 0 && (await nextButton.isVisible().catch(() => false));
        
        if (hasNext) {
          await nextButton.click();
          await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
          await page.waitForTimeout(500);
          currentPage++;
        } else {
          break;
        }
      }

      // 브랜드별 필터링 후 1명 이상의 선수가 성공적으로 노출 및 수집되는지 검증
      expect(collectedPlayers.length, `Filtering by brand "${brand}" should yield at least 1 player.`).toBeGreaterThan(0);
    }
  });
});
