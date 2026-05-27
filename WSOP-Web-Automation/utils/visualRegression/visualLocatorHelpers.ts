import { Page, Locator, expect } from '@playwright/test';

interface ComponentConfig {
  componentKey: string;
  name: string;
  url: string;
  snapshotName: string;
  locatorHints: string[];
  preferredSelectors: string[];
  maskKeys: string[];
  required: boolean;
}

/**
 * 컴포넌트 설정을 기반으로 최적의 시각적 요소(Locator)를 찾습니다.
 */
export async function findVisualSection(
  page: Page,
  config: ComponentConfig
): Promise<Locator> {
  // 1. preferredSelectors 중 일치하고 보이는 요소가 있는지 확인
  if (config.preferredSelectors && config.preferredSelectors.length > 0) {
    for (const selector of config.preferredSelectors) {
      try {
        const loc = page.locator(selector).first();
        if (await loc.isVisible()) {
          return loc;
        }
      } catch (e) {
        // 무시하고 다음 selector 시도
      }
    }
  }

  // 2. locatorHints 기반으로 XPath 활용하여 부모 컨테이너(section, article, div 등) 검색
  if (config.locatorHints && config.locatorHints.length > 0) {
    for (const hint of config.locatorHints) {
      // 텍스트를 포함하는 엘리먼트 중 조상 컨테이너 탐색
      const xpath = `xpath=//*[contains(text(), "${hint}") or contains(@placeholder, "${hint}")]/ancestor-or-self::*[self::section or self::article or self::table or self::div or self::ul or self::li][1]`;
      try {
        const loc = page.locator(xpath).first();
        if (await loc.isVisible()) {
          return loc;
        }
      } catch (e) {
        // 무시
      }
    }

    // 컨테이너를 직접 못 찾았을 경우 텍스트를 가진 엘리먼트 자체라도 찾음
    for (const hint of config.locatorHints) {
      const xpathText = `xpath=//*[contains(text(), "${hint}")]`;
      try {
        const loc = page.locator(xpathText).first();
        if (await loc.isVisible()) {
          return loc;
        }
      } catch (e) {
        // 무시
      }
    }
  }

  // 3. 만약 필수 항목(required=true)인데 찾지 못했다면 에러 발생 (Hard Fail)
  if (config.required) {
    throw new Error(
      `[VisualLocatorHelpers] Required section "${config.name}" (key: ${config.componentKey}) could not be resolved using preferredSelectors or locatorHints on ${config.url}`
    );
  }

  // 4. 필수 항목이 아니라면 body fallback
  console.warn(
    `[VisualLocatorHelpers] Optional section "${config.name}" not found. Falling back to page body.`
  );
  return page.locator('body');
}

/**
 * 페이지 진입 시 필수 텍스트가 정상 렌더링되었는지 검증합니다.
 */
export async function expectCriticalTextsVisible(
  page: Page,
  pageKey: string,
  name: string,
  url: string,
  criticalTexts: string[]
): Promise<void> {
  if (!criticalTexts || criticalTexts.length === 0) return;

  const errors: string[] = [];
  for (const text of criticalTexts) {
    try {
      // 텍스트가 존재하는지 검증
      await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 5000 });
    } catch (e) {
      errors.push(`Critical text "${text}" not found`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[VisualLocatorHelpers] Failed to load "${name}" (${pageKey}) at ${url}. Errors: ${errors.join(', ')}`
    );
  }
}

/**
 * 스크린샷 캡쳐 대상 Locator를 획득합니다.
 */
export async function getStableLocatorForScreenshot(
  page: Page,
  mode: 'page' | 'component',
  componentConfig?: ComponentConfig
): Promise<Locator> {
  if (mode === 'component' && componentConfig) {
    return await findVisualSection(page, componentConfig);
  }
  return page.locator('body');
}
