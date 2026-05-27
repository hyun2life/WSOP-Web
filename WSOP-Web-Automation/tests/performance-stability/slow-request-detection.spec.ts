import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import performancePages from '../../fixtures/performance-stability/performance-pages.fixture.json';
import thresholdsConfig from '../../fixtures/performance-stability/performance-thresholds.fixture.json';
import { startRequestMonitoring, stopRequestMonitoring, classifyRequestIssue } from '../../utils/performanceStability/requestMonitor';
import { type ThresholdConfig } from '../../utils/performanceStability/thresholdComparator';
import { createPerformanceSummary, addRequestIssues, writeLatestArtifacts, attachPerformanceReport } from '../../utils/performanceStability/stabilityReporter';

test.describe('Phase 7 - Slow & Failed Request Detection', () => {
  let summary = createPerformanceSummary();

  test.afterEach(async ({}, testInfo) => {
    // Write latest artifacts by merging with existing if possible
    const artifactsDir = path.join(__dirname, '../../artifacts/performance-stability/latest');
    const summaryPath = path.join(artifactsDir, 'performance-summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        // Merge slow and failed requests avoiding duplicates
        const currentSlow = new Set(summary.slowRequests.map(r => `${r.url}-${r.startTime}`));
        const mergedSlow = [
          ...summary.slowRequests,
          ...(existing.slowRequests || []).filter((r: any) => !currentSlow.has(`${r.url}-${r.startTime}`))
        ];

        const currentFailed = new Set(summary.failedRequests.map(r => `${r.url}-${r.startTime}`));
        const mergedFailed = [
          ...summary.failedRequests,
          ...(existing.failedRequests || []).filter((r: any) => !currentFailed.has(`${r.url}-${r.startTime}`))
        ];

        summary.slowRequests = mergedSlow;
        summary.failedRequests = mergedFailed;
        summary.pages = existing.pages || [];
        summary.flows = existing.flows || [];
      } catch (e) {
        // Ignore
      }
    }

    writeLatestArtifacts(summary);
    await attachPerformanceReport(testInfo, 'slow-requests', summary.slowRequests);
    await attachPerformanceReport(testInfo, 'failed-requests', summary.failedRequests);
  });

  // Select 3 core pages to analyze requests
  const corePages = performancePages.filter(p => ['home', 'schedule', 'player-standings'].includes(p.pageKey));

  for (const pageConfig of corePages) {
    test(`Analyze network requests on: ${pageConfig.name}`, async ({ page }, testInfo) => {
      startRequestMonitoring(page);

      try {
        await page.goto(pageConfig.url, { waitUntil: 'load', timeout: 30000 });
        // Wait a little bit for dynamic assets/ads to trigger
        await page.waitForTimeout(3000);
      } catch (err) {
        // Log navigation failure but allow analyzing other requests gathered so far
      }

      const reqSummary = stopRequestMonitoring();
      const typedThresholds = thresholdsConfig as unknown as ThresholdConfig;

      const failures: string[] = [];
      const warnings: string[] = [];

      const slowReqs = reqSummary.slowRequests.filter(req => {
        const issueType = classifyRequestIssue(req, typedThresholds.requests);
        if (issueType === 'fail') {
          failures.push(`Slow Request Fail: [${req.resourceType}] ${req.url} took ${req.durationMs}ms`);
        } else if (issueType === 'warning') {
          warnings.push(`Slow Request Warn: [${req.resourceType}] ${req.url} took ${req.durationMs}ms`);
        }
        return issueType === 'warning' || issueType === 'fail';
      });

      const failedReqs = reqSummary.failedRequests.filter(req => {
        const issueType = classifyRequestIssue(req, typedThresholds.requests);
        const errMsg = req.failure ? `(Reason: ${req.failure})` : `(Status: ${req.status})`;
        if (issueType === 'fail') {
          failures.push(`Failed Request Fail: [${req.resourceType}] ${req.url} ${errMsg}`);
        } else if (issueType === 'warning') {
          warnings.push(`Failed Request Warn: [${req.resourceType}] ${req.url} ${errMsg}`);
        }
        return issueType === 'warning' || issueType === 'fail';
      });

      // Add annotations to Playwright test
      for (const warn of warnings) {
        testInfo.annotations.push({ type: 'warning', description: warn });
      }

      addRequestIssues(summary, { slowRequests: slowReqs, failedRequests: failedReqs });

      // Assert hard failure
      expect(failures.length, `Critical network request failures or severe latency detected:\n${failures.join('\n')}`).toBe(0);
    });
  }
});
