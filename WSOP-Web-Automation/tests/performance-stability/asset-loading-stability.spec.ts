import { expect, test } from '@playwright/test';
import thresholdsConfig from '../../fixtures/performance-stability/performance-thresholds.fixture.json';
import { collectImageAssetStatus, collectSlowResourceEntries, classifyAssetIssue } from '../../utils/performanceStability/assetMonitor';
import { attachPerformanceReport } from '../../utils/performanceStability/stabilityReporter';

test.describe('Phase 7 - Asset Loading Stability', () => {
  // Test core image-heavy pages
  const targetPages = [
    { name: 'Player Standings', url: '/player-standings/' },
    { name: 'News List', url: '/news/' },
    { name: 'Phil Hellmuth Profile', url: '/players/phil-hellmuth/' }
  ];

  for (const pageConfig of targetPages) {
    test(`Analyze asset stability on: ${pageConfig.name}`, async ({ page }, testInfo) => {
      const failures: string[] = [];
      const warnings: string[] = [];

      try {
        await page.goto(pageConfig.url, { waitUntil: 'load', timeout: 30000 });
        // Allow a small timeout for lazy loaded images
        await page.waitForTimeout(2000);
      } catch (err) {
        failures.push(`Failed to load target page: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 1. Gather Image Status
      const images = await collectImageAssetStatus(page);
      for (const img of images) {
        const status = classifyAssetIssue(img, false); // Initial warning-centered policy
        if (status === 'fail') {
          failures.push(`Broken critical image: ${img.src} (alt: "${img.alt}")`);
        } else if (status === 'warning') {
          warnings.push(`Broken image: ${img.src} (alt: "${img.alt}")`);
        }
      }

      // 2. Gather Slow Resource Entries
      const slowResources = await collectSlowResourceEntries(page, thresholdsConfig.requests);
      for (const res of slowResources) {
        const status = classifyAssetIssue(res);
        if (status === 'fail') {
          failures.push(`Extremely slow resource: [${res.initiatorType}] ${res.name} took ${res.durationMs}ms`);
        } else if (status === 'warning') {
          warnings.push(`Slow resource: [${res.initiatorType}] ${res.name} took ${res.durationMs}ms`);
        }
      }

      // Add annotations to Playwright test
      for (const warn of warnings) {
        testInfo.annotations.push({ type: 'warning', description: warn });
      }

      // Attach report to run
      await attachPerformanceReport(testInfo, `asset-report-${pageConfig.name.replace(/\s+/g, '-').toLowerCase()}`, {
        images,
        slowResources
      });

      // Assert hard failure
      expect(failures.length, `Critical asset loading failures detected:\n${failures.join('\n')}`).toBe(0);
    });
  }
});
