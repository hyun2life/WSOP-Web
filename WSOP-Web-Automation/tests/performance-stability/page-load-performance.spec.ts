import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import performancePages from '../../fixtures/performance-stability/performance-pages.fixture.json';
import thresholdsConfig from '../../fixtures/performance-stability/performance-thresholds.fixture.json';
import { measurePageLoad } from '../../utils/performanceStability/performanceMetrics';
import { startRequestMonitoring, stopRequestMonitoring, classifyRequestIssue } from '../../utils/performanceStability/requestMonitor';
import { comparePageMetrics, type ThresholdConfig } from '../../utils/performanceStability/thresholdComparator';
import { createPerformanceSummary, addPageResult, addRequestIssues, writeLatestArtifacts, attachPerformanceReport } from '../../utils/performanceStability/stabilityReporter';

test.describe('Phase 7 - Page Load Performance & Stability', () => {
  let summary = createPerformanceSummary();

  test.afterEach(async ({}, testInfo) => {
    // Write latest artifacts by merging with existing if possible
    const artifactsDir = path.join(__dirname, '../../artifacts/performance-stability/latest');
    const summaryPath = path.join(artifactsDir, 'performance-summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        // Keep existing pages and flows that are not in current summary to avoid overwriting other spec results
        const currentKeys = new Set(summary.pages.map(p => p.pageKey));
        const mergedPages = [
          ...summary.pages,
          ...(existing.pages || []).filter((p: any) => !currentKeys.has(p.pageKey))
        ];
        
        const currentFlowKeys = new Set(summary.flows.map(f => f.flowKey));
        const mergedFlows = [
          ...summary.flows,
          ...(existing.flows || []).filter((f: any) => !currentFlowKeys.has(f.flowKey))
        ];

        summary.pages = mergedPages;
        summary.flows = mergedFlows;
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    writeLatestArtifacts(summary);
    await attachPerformanceReport(testInfo, 'performance-summary', summary);
  });

  for (const pageConfig of performancePages) {
    test(`Measure load performance for page: ${pageConfig.name}`, async ({ page }, testInfo) => {
      // 1. Start Request Monitoring
      startRequestMonitoring(page);

      // 2. Measure Page Load
      const metrics = await measurePageLoad(page, {
        pageKey: pageConfig.pageKey,
        name: pageConfig.name,
        url: pageConfig.url,
        criticalSelectors: pageConfig.criticalSelectors
      });

      // 3. Stop Request Monitoring
      const reqSummary = stopRequestMonitoring();

      // 4. Compare with Thresholds
      const pageLoadThresholds = thresholdsConfig.pageLoad;
      const comparisons = comparePageMetrics(metrics, pageLoadThresholds);

      // 5. Classify Request issues
      const typedThresholds = thresholdsConfig as unknown as ThresholdConfig;
      const slowReqs = reqSummary.slowRequests.filter(req => classifyRequestIssue(req, typedThresholds.requests) === 'warning' || classifyRequestIssue(req, typedThresholds.requests) === 'fail');
      const failedReqs = reqSummary.failedRequests.filter(req => classifyRequestIssue(req, typedThresholds.requests) === 'warning' || classifyRequestIssue(req, typedThresholds.requests) === 'fail');

      // 6. Record Warnings and Failures
      const warnings: string[] = [...metrics.warnings];
      const failures: string[] = [...metrics.failures];

      for (const [metric, status] of Object.entries(comparisons)) {
        const actual = (metrics as any)[metric];
        const threshold = (pageLoadThresholds as any)[metric];
        if (status === 'fail') {
          failures.push(`${metric} failed threshold: ${actual}ms (Limit: ${threshold.fail}ms)`);
        } else if (status === 'warning') {
          warnings.push(`${metric} warning threshold: ${actual}ms (Limit: ${threshold.warning}ms)`);
        }
      }

      // Add annotations to Playwright test
      for (const warn of warnings) {
        testInfo.annotations.push({ type: 'warning', description: warn });
      }

      metrics.warnings = warnings;
      metrics.failures = failures;

      // 7. Add Results to Summary
      addPageResult(summary, metrics);
      addRequestIssues(summary, { slowRequests: slowReqs, failedRequests: failedReqs });

      // 8. Assert hard failure
      expect(failures.length, `Performance violations detected:\n${failures.join('\n')}`).toBe(0);
    });
  }
});
