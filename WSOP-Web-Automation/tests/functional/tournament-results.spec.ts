import { expect, test } from '@playwright/test';
import { cleanInnerText, firstMeaningfulLine, firstVisible, openPublicPage } from './support';

test.describe('Tournament Results functional flow', () => {
  test('results list is accessible and detail result page shows event statistics', async ({ page }) => {
    // 1. 과거 대회 목록 메인 페이지 진입 (기존 /results/ 대신 실존 경로인 /past-tournaments/ 사용)
    await openPublicPage(page, '/past-tournaments/');

    // 2. 헤더 검증
    await expect(page.getByRole('heading', { name: /Past Tournaments/i })).toBeVisible();

    // 3. 과거 대회 목록에서 특정 대회 링크 (/tournaments/ 패턴) 탐색 및 클릭
    const tournamentLink = await firstVisible(
      page.locator('a[href*="/tournaments/"]').filter({ hasText: /WSOP/i }),
      'At least one past tournament link should be available from the list',
    );
    
    const listText = await cleanInnerText(tournamentLink);
    const tournamentName = firstMeaningfulLine(listText);
    console.log(`[QA-INFO] Navigating to tournament: "${tournamentName}"`);

    await tournamentLink.click();

    // 4. 특정 대회 정보 페이지로 이동 확인
    await expect(page).toHaveURL(/\/tournaments\/[^/]+\/?$/i);
    await page.waitForLoadState('domcontentloaded');
    // 비동기 렌더링 대기
    await page.locator('a[href*="/tournaments/result/"]').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);

    // 5. 해당 대회 내의 개별 이벤트 상세 결과 링크 (/tournaments/result/ 혹은 /tournaments/results/ 패턴) 탐색 및 클릭
    const eventResultLink = await firstVisible(
      page.locator('a[href*="/tournaments/result/"], a[href*="/tournaments/results/"]').filter({ hasText: /Results|Winner/i }),
      'At least one individual event result link should be available in the tournament page',
    ).catch(() => {
      console.warn('[QA-WARNING] Individual event results link not found. Attempting generic tournament locator...');
      return firstVisible(page.locator('a[href*="/tournaments/result/"]'), 'Fallback event result link not found');
    });

    console.log(`[QA-INFO] Clicking individual event results link: ${await eventResultLink.getAttribute('href')}`);
    await eventResultLink.click();

    // 6. 상세 결과 페이지 URL 및 테이블/통계 메타데이터 검증
    await expect(page).toHaveURL(/\/tournaments\/result(s)?\/[^/]+\/?$/i);
    await expect(page.locator('body')).toContainText(/Results|Prize Pool|Entries|Winner/i);

    // 7. 입상자 테이블 정보 검증 (Place, Player, Prize/Earnings 등 핵심 헤더 확인)
    const resultTable = page.locator('table').first();
    await expect(resultTable).toBeVisible();
    await expect(resultTable).toContainText(/Place|Player|Earnings|Prize/i);
  });
});
