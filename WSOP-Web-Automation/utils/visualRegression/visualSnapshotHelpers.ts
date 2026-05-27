import { Page, Locator, expect } from '@playwright/test';

interface ThresholdConfig {
  maxDiffPixelRatio: number;
  threshold: number;
}

interface ThresholdsFixture {
  default: ThresholdConfig;
  page: ThresholdConfig;
  component: ThresholdConfig;
  strictComponent: ThresholdConfig;
}

interface PageConfig {
  pageKey: string;
  name: string;
  url: string;
  snapshotName: string;
  mode: 'page';
  criticalTexts?: string[];
  maskKeys?: string[];
  viewport?: string;
  fullPage?: boolean;
}

interface ComponentConfig {
  componentKey: string;
  name: string;
  url: string;
  snapshotName: string;
  locatorHints: string[];
  preferredSelectors: string[];
  maskKeys: string[];
  required: boolean;
  strict?: boolean;
}

/**
 * 페이지 스크린샷 단언문을 수행합니다.
 */
export async function expectPageScreenshot(
  page: Page,
  config: PageConfig,
  masks: Locator[],
  thresholds: ThresholdsFixture
): Promise<void> {
  const thresholdType = thresholds.page ?? thresholds.default;
  const options = getSnapshotOptions(
    thresholdType,
    masks,
    config.fullPage ?? false
  );

  try {
    await expect(page).toHaveScreenshot(`${config.snapshotName}.png`, options);
  } catch (error: any) {
    const errorMsg = `[VisualSnapshotHelpers] Page visual match failed for "${config.name}" (Key: ${config.pageKey}).\n` +
      `Snapshot Name: ${config.snapshotName}.png\n` +
      `URL: ${config.url}\n` +
      `Error details: ${error.message}`;
    throw new Error(errorMsg);
  }
}

/**
 * 특정 로케이터 영역의 스크린샷 단언문을 수행합니다.
 */
export async function expectComponentScreenshot(
  locator: Locator,
  config: ComponentConfig,
  masks: Locator[],
  thresholds: ThresholdsFixture
): Promise<void> {
  const thresholdType = config.strict 
    ? (thresholds.strictComponent ?? thresholds.default)
    : (thresholds.component ?? thresholds.default);
    
  const options = getSnapshotOptions(
    thresholdType,
    masks,
    false // 컴포넌트는 fullPage 적용 안 함
  );

  try {
    await expect(locator).toHaveScreenshot(`${config.snapshotName}.png`, options);
  } catch (error: any) {
    const errorMsg = `[VisualSnapshotHelpers] Component visual match failed for "${config.name}" (Key: ${config.componentKey}).\n` +
      `Snapshot Name: ${config.snapshotName}.png\n` +
      `URL: ${config.url}\n` +
      `Error details: ${error.message}`;
    throw new Error(errorMsg);
  }
}

/**
 * Playwright 스냅샷 옵션을 구성합니다.
 */
export function getSnapshotOptions(
  thresholdConfig: ThresholdConfig,
  masks: Locator[],
  fullPage: boolean
) {
  return {
    animations: 'disabled' as const, // 애니메이션 비활성화
    caret: 'hide' as const,         // 텍스트 커서 숨김
    scale: 'css' as const,          // Retina 디스플레이 해상도 노이즈 방지
    mask: masks.length > 0 ? masks : undefined,
    maxDiffPixelRatio: thresholdConfig.maxDiffPixelRatio,
    threshold: thresholdConfig.threshold,
    fullPage
  };
}
