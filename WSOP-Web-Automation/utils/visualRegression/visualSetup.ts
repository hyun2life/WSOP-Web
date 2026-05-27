import { Page } from '@playwright/test';

/**
 * 시각적 스냅샷 촬영 전에 페이지 상태를 안정화합니다.
 */
export async function preparePageForVisualSnapshot(page: Page): Promise<void> {
  // 1. 애니메이션 비활성화 및 캐럿 숨김
  await disableAnimations(page);

  // 2. 알려진 쿠키 배너 및 팝업 닫기
  await closeKnownPopups(page);

  // 3. 폰트 로딩 완료 대기
  await page.evaluate(() => document.fonts.ready);

  // 4. Lazy Load 이미지 트리거를 위한 스크롤 처리
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 300));
    window.scrollTo(0, 0);
  });

  // 5. 시각적 준비 상태 대기
  await waitForVisualReady(page);
}

/**
 * CSS를 주입하여 transition, animation, caret, smooth scrolling을 비활성화합니다.
 */
export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition: none !important;
        transition-duration: 0s !important;
        animation: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      input, textarea, [contenteditable] {
        caret-color: transparent !important;
      }
    `
  });
}

/**
 * 쿠키 배너, 뉴스레터 팝업 등 시각적 회귀에 방해되는 공통 UI 요소를 감지하고 닫습니다.
 */
export async function closeKnownPopups(page: Page): Promise<void> {
  const closeSelectors = [
    '#onetrust-accept-btn-handler', // OneTrust 쿠키 동의
    '.cookie-banner-close',
    '.cookie-close',
    '[aria-label="Close"]',
    '.modal-close',
    'button[class*="close"]',
    'div[class*="close"]'
  ];

  for (const selector of closeSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 500 })) {
        await element.click({ timeout: 1000 });
        console.warn(`[VisualSetup] Closed popup using selector: ${selector}`);
      }
    } catch (e) {
      // 팝업 닫기 실패는 warning 처리
    }
  }
}

/**
 * DOM 로드 완료 및 추가 안정화 시간을 대기합니다.
 */
export async function waitForVisualReady(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    await page.waitForLoadState('load', { timeout: 5000 });
  } catch (e) {
    console.warn('[VisualSetup] Timeout waiting for load states, continuing...');
  }
  // 추가적인 안정화를 위한 1초 대기
  await page.waitForTimeout(1000);
}
