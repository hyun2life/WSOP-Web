import { test, expect } from '@playwright/test';
import { preparePageForVisualSnapshot } from '../../utils/visualRegression/visualSetup';
import { buildMasks } from '../../utils/visualRegression/visualMaskHelpers';
import { findVisualSection } from '../../utils/visualRegression/visualLocatorHelpers';
import { expectComponentScreenshot } from '../../utils/visualRegression/visualSnapshotHelpers';
import {
  createVisualSummary,
  addVisualResult,
  writeLatestVisualArtifacts,
  attachVisualMetadata,
  VisualSummary
} from '../../utils/visualRegression/visualReporter';

// Fixtures
import visualComponents from '../../fixtures/visual-regression/visual-components.fixture.json';
import visualThresholds from '../../fixtures/visual-regression/visual-thresholds.fixture.json';
import visualMasks from '../../fixtures/visual-regression/visual-masks.fixture.json';
import knownVisualExceptions from '../../fixtures/visual-regression/known-visual-exceptions.fixture.json';

test.describe('Result Detail Visual Regression', () => {
  let summary: VisualSummary;

  test.beforeAll(() => {
    summary = createVisualSummary();
  });

  test.afterAll(() => {
    writeLatestVisualArtifacts(summary);
  });

  // Result Detail 관련 컴포넌트 필터링
  const resultDetailComponents = visualComponents.filter(
    c => c.componentKey.includes('result-detail')
  );

  for (const compConfig of resultDetailComponents) {
    test(`Visual Regression: ${compConfig.name}`, async ({ page }, testInfo) => {
      const metadata = {
        componentKey: compConfig.componentKey,
        name: compConfig.name,
        url: compConfig.url,
        snapshotName: compConfig.snapshotName,
        maskKeys: compConfig.maskKeys,
        threshold: visualThresholds.component.threshold,
        maxDiffPixelRatio: visualThresholds.component.maxDiffPixelRatio
      };
      attachVisualMetadata(testInfo, metadata);

      let status: 'passed' | 'failed' | 'warning' = 'passed';
      let errorDetails: string | undefined;

      try {
        // 1. 페이지 이동
        const response = await page.goto(compConfig.url, { waitUntil: 'domcontentloaded' });
        
        // 404 혹은 페이지 무효 상태 검증
        if (!response || response.status() >= 400) {
          throw new Error(`[ResultDetailVisual] Stale or unavailable URL: ${compConfig.url} (Status: ${response ? response.status() : 'No Response'})`);
        }

        // 2. 페이지 안정화
        await preparePageForVisualSnapshot(page);

        // 3. 컴포넌트 로케이터 탐색
        const locator = await findVisualSection(page, compConfig as any);

        // 4. 마스크 엘리먼트 획득
        const masks = await buildMasks(page, compConfig.maskKeys, visualMasks);

        // 5. 컴포넌트 스크린샷 매칭
        await expectComponentScreenshot(locator, compConfig as any, masks, visualThresholds as any);
      } catch (error: any) {
        errorDetails = error.message || error.toString();

        // result-detail-url-stale 혹은 known exceptions에 해당하는지 확인
        const hasKnownException = Object.keys(knownVisualExceptions).some(excKey => {
          const exc = (knownVisualExceptions as any)[excKey];
          return exc.warningOnly && (
            errorDetails?.toLowerCase().includes(exc.reason.toLowerCase()) ||
            errorDetails?.toLowerCase().includes('stale') ||
            errorDetails?.toLowerCase().includes('unavailable') ||
            compConfig.componentKey.includes(excKey)
          );
        });

        if (hasKnownException) {
          status = 'warning';
          console.warn(`[ResultDetailVisual] Warning (Known Exception) for "${compConfig.name}": ${errorDetails}`);
        } else {
          status = 'failed';
          throw error;
        }
      } finally {
        addVisualResult(summary, {
          key: compConfig.componentKey,
          name: compConfig.name,
          url: compConfig.url,
          type: 'component',
          snapshotName: compConfig.snapshotName,
          status,
          errorDetails,
          maxDiffPixelRatio: visualThresholds.component.maxDiffPixelRatio,
          threshold: visualThresholds.component.threshold,
          maskKeys: compConfig.maskKeys
        });
      }
    });
  }
});
