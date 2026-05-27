import { expect, test } from '@playwright/test';
import { cleanInnerText, firstMeaningfulLine, firstVisible, openPublicPage } from './support';

test.describe('Tournament Results functional flow', () => {
  test('results list is accessible and detail result page shows event statistics', async ({ page }) => {
    // 1. 결과 메인 페이지 진입
    await openPublicPage(page, '/results/');

    // 2. 헤더 및 결과 존재 확인
    await expect(page.getByRole('heading', { name: /Tournament Results/i })).toBeVisible();

    // 3. 결과 목록에서 상세 이벤트 결과 링크 (/tournaments/results/ 패턴) 탐색 및 클릭
    const firstResultLink = await firstVisible(
      page.locator('a[href*="/tournaments/results/"]'),
      'At least one tournament result detail link should be available from the results list',
    );
    
    const listText = await cleanInnerText(firstResultLink);
    const eventName = firstMeaningfulLine(listText);
    console.log(`[QA-INFO] Found tournament result event in list: "${eventName}"`);

    await firstResultLink.click();

    // 4. 상세 결과 페이지 URL 및 테이블/통계 메타데이터 검증
    await expect(page).toHaveURL(/\/tournaments\/results\/[^/]+\/?$/i);
    await expect(page.locator('body')).toContainText(/Results|Prize Pool|Entries|Winner/i);

    // 5. 입상자 테이블 정보 검증 (Place, Player, Prize 등 핵심 헤더 확인)
    const resultTable = page.locator('table').first();
    await expect(resultTable).toBeVisible();
    await expect(resultTable).toContainText(/Place|Player|Earnings|Prize/i);
  });
});
