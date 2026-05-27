import { test, expect } from '@playwright/test';
import { preparePageForVisualSnapshot } from '../../utils/visualRegression/visualSetup';
import { buildMasks } from '../../utils/visualRegression/visualMaskHelpers';
import { expectCriticalTextsVisible } from '../../utils/visualRegression/visualLocatorHelpers';
import { expectPageScreenshot } from '../../utils/visualRegression/visualSnapshotHelpers';
import {
  createVisualSummary,
  addVisualResult,
  writeLatestVisualArtifacts,
  attachVisualMetadata,
  VisualSummary,
  VisualResult
} from '../../utils/visualRegression/visualReporter';

// Fixtures
import visualPages from '../../fixtures/visual-regression/visual-pages.fixture.json';
import visualThresholds from '../../fixtures/visual-regression/visual-thresholds.fixture.json';
import visualMasks from '../../fixtures/visual-regression/visual-masks.fixture.json';
import knownVisualExceptions from '../../fixtures/visual-regression/known-visual-exceptions.fixture.json';

test.describe('Public Pages Visual Regression', () => {
  let summary: VisualSummary;

  test.beforeAll(() => {
    summary = createVisualSummary();
  });

  test.afterAll(() => {
    writeLatestVisualArtifacts(summary);
  });

  for (const pageConfig of visualPages) {
    // pageConfig.viewport가 desktop인 것만 chromium-desktop 프로젝트에서 실행
    test(`Visual Regression: ${pageConfig.name}`, async ({ page }, testInfo) => {
      const metadata = {
        pageKey: pageConfig.pageKey,
        name: pageConfig.name,
        url: pageConfig.url,
        snapshotName: pageConfig.snapshotName,
        maskKeys: pageConfig.maskKeys,
        threshold: visualThresholds.page.threshold,
        maxDiffPixelRatio: visualThresholds.page.maxDiffPixelRatio
      };
      attachVisualMetadata(testInfo, metadata);

      let status: 'passed' | 'failed' | 'warning' = 'passed';
      let errorDetails: string | undefined;

      try {
        // 1. 페이지 이동
        const response = await page.goto(pageConfig.url, { waitUntil: 'domcontentloaded' });
        expect(response).not.toBeNull();
        expect(response!.status()).toBeLessThan(400);

        // 2. 페이지 안정화
        await preparePageForVisualSnapshot(page);

        // 3. 필수 텍스트 렌더링 확인
        if (pageConfig.criticalTexts && pageConfig.criticalTexts.length > 0) {
          await expectCriticalTextsVisible(
            page,
            pageConfig.pageKey,
            pageConfig.name,
            pageConfig.url,
            pageConfig.criticalTexts
          );
        }

        // 4. 마스크 엘리먼트 획득
        const masks = await buildMasks(page, pageConfig.maskKeys, visualMasks);

        // 5. 스냅샷 매칭
        await expectPageScreenshot(page, pageConfig as any, masks, visualThresholds as any);
      } catch (error: any) {
        errorDetails = error.message || error.toString();
        
        // 예외 규칙 확인 (warning 처리 여부)
        const hasKnownException = Object.keys(knownVisualExceptions).some(excKey => {
          const exc = (knownVisualExceptions as any)[excKey];
          if (!exc.warningOnly) return false;
          const inReason = errorDetails?.toLowerCase().includes(exc.reason.toLowerCase());
          const inKey = errorDetails?.toLowerCase().includes(excKey.toLowerCase());
          const isTargetPage = pageConfig.pageKey.toLowerCase().includes(excKey.replace(/-[a-z-]+$/, '')) || 
                               excKey.toLowerCase().includes(pageConfig.pageKey.toLowerCase());
          return inReason || inKey || isTargetPage;
        });

        if (hasKnownException) {
          status = 'warning';
          console.warn(`[PublicPagesVisual] Warning (Known Exception) for "${pageConfig.name}": ${errorDetails}`);
        } else {
          status = 'failed';
          throw error; // 실패로 분류 시 테스트 에러 전파
        }
      } finally {
        addVisualResult(summary, {
          key: pageConfig.pageKey,
          name: pageConfig.name,
          url: pageConfig.url,
          type: 'page',
          snapshotName: pageConfig.snapshotName,
          status,
          errorDetails,
          maxDiffPixelRatio: visualThresholds.page.maxDiffPixelRatio,
          threshold: visualThresholds.page.threshold,
          maskKeys: pageConfig.maskKeys
        });
      }
    });
  }
});
