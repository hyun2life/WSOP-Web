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
  VisualSummary
} from '../../utils/visualRegression/visualReporter';

// Fixtures
import visualPages from '../../fixtures/visual-regression/visual-pages.fixture.json';
import visualThresholds from '../../fixtures/visual-regression/visual-thresholds.fixture.json';
import visualMasks from '../../fixtures/visual-regression/visual-masks.fixture.json';
import knownVisualExceptions from '../../fixtures/visual-regression/known-visual-exceptions.fixture.json';

test.describe('Responsive Layout Visual Regression', () => {
  let summary: VisualSummary;

  test.beforeAll(() => {
    summary = createVisualSummary();
  });

  test.afterAll(() => {
    writeLatestVisualArtifacts(summary);
  });

  // Home, Player Standings, News 3개 주요 페이지 선정
  const targetPages = visualPages.filter(p => ['home', 'player-standings', 'news'].includes(p.pageKey));
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ];

  for (const pageConfig of targetPages) {
    for (const vp of viewports) {
      test(`Responsive Visual: ${pageConfig.name} on ${vp.name}`, async ({ page }, testInfo) => {
        // viewport 수동 오버라이딩
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const snapshotName = `${pageConfig.snapshotName}-${vp.name}`;
        const metadata = {
          pageKey: pageConfig.pageKey,
          name: `${pageConfig.name} (${vp.name})`,
          url: pageConfig.url,
          snapshotName,
          viewport: `${vp.width}x${vp.height}`,
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

          // 3. 필수 텍스트 확인
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
          const pageConfigWithCustomSnapshot = {
            ...pageConfig,
            snapshotName
          };
          await expectPageScreenshot(page, pageConfigWithCustomSnapshot as any, masks, visualThresholds as any);
        } catch (error: any) {
          errorDetails = error.message || error.toString();

          const hasKnownException = Object.keys(knownVisualExceptions).some(excKey => {
            const exc = (knownVisualExceptions as any)[excKey];
            return exc.warningOnly && (
              errorDetails?.toLowerCase().includes(exc.reason.toLowerCase()) ||
              pageConfig.pageKey.includes(excKey)
            );
          });

          if (hasKnownException) {
            status = 'warning';
            console.warn(`[ResponsiveVisual] Warning (Known Exception) for "${pageConfig.name} (${vp.name})": ${errorDetails}`);
          } else {
            status = 'failed';
            throw error;
          }
        } finally {
          addVisualResult(summary, {
            key: `${pageConfig.pageKey}-${vp.name}`,
            name: `${pageConfig.name} (${vp.name})`,
            url: pageConfig.url,
            type: 'page',
            snapshotName,
            status,
            errorDetails,
            maxDiffPixelRatio: visualThresholds.page.maxDiffPixelRatio,
            threshold: visualThresholds.page.threshold,
            maskKeys: pageConfig.maskKeys
          });
        }
      });
    }
  }
});
