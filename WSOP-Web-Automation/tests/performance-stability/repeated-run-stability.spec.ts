import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import performancePages from '../../fixtures/performance-stability/performance-pages.fixture.json';
import performanceFlows from '../../fixtures/performance-stability/performance-flows.fixture.json';
import thresholdsConfig from '../../fixtures/performance-stability/performance-thresholds.fixture.json';
import { measurePageLoad } from '../../utils/performanceStability/performanceMetrics';
import { comparePageMetrics, compareFlowMetrics } from '../../utils/performanceStability/thresholdComparator';
import { summarizeRepeatedRuns, type RunResult } from '../../utils/performanceStability/repeatRunner';
import { writeLatestArtifacts, createPerformanceSummary, attachPerformanceReport } from '../../utils/performanceStability/stabilityReporter';

test.describe('Phase 7 - Repeated Run Stability & Flakiness Detection', () => {
  const runResults: RunResult[] = [];

  test.afterAll(async ({}, testInfo) => {
    // Summarize results
    const summary = summarizeRepeatedRuns(runResults);

    // Merge with existing artifacts
    const artifactsDir = path.join(__dirname, '../../artifacts/performance-stability/latest');
    const existingSummaryPath = path.join(artifactsDir, 'performance-summary.json');
    let perfSummary = createPerformanceSummary();

    if (fs.existsSync(existingSummaryPath)) {
      try {
        perfSummary = JSON.parse(fs.readFileSync(existingSummaryPath, 'utf-8'));
      } catch (e) {
        // Ignore
      }
    }

    // Write both stability summary and performance summary
    writeLatestArtifacts(perfSummary, summary);
    await attachPerformanceReport(testInfo, 'stability-summary', summary);

    // Initial check allowed failure/warning check
    const allowedFailedRuns = thresholdsConfig.stability.allowedFailedRuns;
    let totalFailedCount = 0;
    const failures: string[] = [];

    for (const [key, details] of Object.entries(summary.byKey)) {
      totalFailedCount += details.failCount;
      if (details.failCount > allowedFailedRuns) {
        failures.push(`${key} failed ${details.failCount} times (Limit allowed: ${allowedFailedRuns})`);
      }
    }

    expect(failures.length, `Stability limits exceeded:\n${failures.join('\n')}`).toBe(0);
  });

  const repeatCount = thresholdsConfig.stability.repeatCount || 3;

  // 1. Page Load Repeat
  const targetPages = performancePages.filter(p => ['home', 'player-standings'].includes(p.pageKey));
  for (const pageConfig of targetPages) {
    for (let r = 1; r <= repeatCount; r++) {
      test(`Repeat page load ${r}/${repeatCount} for: ${pageConfig.name}`, async ({ page }) => {
        const start = Date.now();
        let status: 'pass' | 'warning' | 'fail' = 'pass';
        const errors: string[] = [];

        try {
          const metrics = await measurePageLoad(page, {
            pageKey: pageConfig.pageKey,
            name: pageConfig.name,
            url: pageConfig.url
          });

          if (metrics.failures.length > 0) {
            status = 'fail';
            errors.push(...metrics.failures);
          } else {
            const comparisons = comparePageMetrics(metrics, thresholdsConfig.pageLoad);
            const hasFail = Object.values(comparisons).includes('fail');
            const hasWarn = Object.values(comparisons).includes('warning');
            
            if (hasFail) status = 'fail';
            else if (hasWarn) status = 'warning';
          }
        } catch (err) {
          status = 'fail';
          errors.push(err instanceof Error ? err.message : String(err));
        }

        runResults.push({
          runIndex: r,
          type: 'page',
          key: pageConfig.pageKey,
          durationMs: Date.now() - start,
          status,
          errors
        });
      });
    }
  }

  // 2. Flow Repeat
  const targetFlows = performanceFlows.filter(f => ['standings-to-profile'].includes(f.flowKey));
  for (const flowConfig of targetFlows) {
    for (let r = 1; r <= repeatCount; r++) {
      test(`Repeat flow ${r}/${repeatCount} for: ${flowConfig.name}`, async ({ page }) => {
        const start = Date.now();
        let status: 'pass' | 'warning' | 'fail' = 'pass';
        const errors: string[] = [];

        try {
          await page.goto(flowConfig.startUrl, { waitUntil: 'load' });
          
          // Execute steps sequentially
          for (let i = 0; i < flowConfig.steps.length; i++) {
            const step = flowConfig.steps[i];
            const firstPlayerLink = page.locator('a[href*="/players/"]').first();
            await firstPlayerLink.waitFor({ state: 'visible', timeout: 8000 });
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'load' }),
              firstPlayerLink.click()
            ]);
            
            const nextStep = flowConfig.steps[i + 1];
            if (nextStep && nextStep.type === 'expectTextAny') {
              const body = page.locator('body');
              await body.waitFor({ state: 'visible', timeout: 8000 });
              const bodyText = await body.innerText();
              const hasAny = nextStep.texts.some((text: string) => bodyText.includes(text));
              expect(hasAny).toBe(true);
              break; // standings-to-profile flow has 2 steps, executing them directly
            }
          }

          const durationMs = Date.now() - start;
          const flowMetrics = {
            totalFlowMs: durationMs,
            steps: []
          };
          const comparisons = compareFlowMetrics(flowMetrics, thresholdsConfig.flow);
          if (comparisons.totalFlowMs === 'fail') status = 'fail';
          else if (comparisons.totalFlowMs === 'warning') status = 'warning';
        } catch (err) {
          status = 'fail';
          errors.push(err instanceof Error ? err.message : String(err));
        }

        runResults.push({
          runIndex: r,
          type: 'flow',
          key: flowConfig.flowKey,
          durationMs: Date.now() - start,
          status,
          errors
        });
      });
    }
  }
});
