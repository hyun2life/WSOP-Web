import { expect, test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import performanceFlows from '../../fixtures/performance-stability/performance-flows.fixture.json';
import thresholdsConfig from '../../fixtures/performance-stability/performance-thresholds.fixture.json';
import { measureStep } from '../../utils/performanceStability/performanceMetrics';
import { compareFlowMetrics } from '../../utils/performanceStability/thresholdComparator';
import { createPerformanceSummary, addFlowResult, writeLatestArtifacts, attachPerformanceReport } from '../../utils/performanceStability/stabilityReporter';
import { searchPlayerIfSearchInputExists, findPlayerProfileLink } from '../../utils/playerPresentation/playerSearchHelpers';

test.describe('Phase 7 - Core Flow Performance & Stability', () => {
  let summary = createPerformanceSummary();

  test.afterEach(async ({}, testInfo) => {
    // Write latest artifacts by merging with existing if possible
    const artifactsDir = path.join(__dirname, '../../artifacts/performance-stability/latest');
    const summaryPath = path.join(artifactsDir, 'performance-summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        // Keep existing pages and flows that are not in current summary
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
        // Ignore
      }
    }

    writeLatestArtifacts(summary);
    await attachPerformanceReport(testInfo, 'performance-summary', summary);
  });

  for (const flowConfig of performanceFlows) {
    test(`Measure performance for flow: ${flowConfig.name}`, async ({ page }, testInfo) => {
      const startTime = Date.now();
      const stepResults: Array<{ label: string; durationMs: number; success: boolean; error?: string }> = [];
      const failures: string[] = [];
      const warnings: string[] = [];
      let success = true;

      // 1. Start URL navigation
      try {
        await page.goto(flowConfig.startUrl, { waitUntil: 'load' });
      } catch (err) {
        success = false;
        failures.push(`Initial navigation to ${flowConfig.startUrl} failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2. Execute Steps
      if (success) {
        for (let i = 0; i < flowConfig.steps.length; i++) {
          const step = flowConfig.steps[i];
          const label = `Step ${i + 1}: ${step.type}`;

          const result = await measureStep(label, async () => {
            await executeFlowStep(page, step);
          });

          stepResults.push(result);
          if (!result.success) {
            success = false;
            failures.push(`${label} failed: ${result.error}`);
            break;
          }
        }
      }

      const totalFlowMs = Date.now() - startTime;

      // 3. Compare with thresholds
      const flowThresholds = thresholdsConfig.flow;
      const flowMetrics = {
        totalFlowMs,
        steps: stepResults.map(r => ({ label: r.label, durationMs: r.durationMs }))
      };
      
      const comparisons = compareFlowMetrics(flowMetrics, flowThresholds);

      if (comparisons.totalFlowMs === 'fail') {
        failures.push(`Total flow duration failed threshold: ${totalFlowMs}ms (Limit: ${flowThresholds.totalFlowMs.fail}ms)`);
      } else if (comparisons.totalFlowMs === 'warning') {
        warnings.push(`Total flow duration warning threshold: ${totalFlowMs}ms (Limit: ${flowThresholds.totalFlowMs.warning}ms)`);
      }

      for (const stepRes of stepResults) {
        const stepStatus = comparisons.steps[stepRes.label];
        if (stepStatus === 'fail') {
          failures.push(`${stepRes.label} failed threshold: ${stepRes.durationMs}ms (Limit: ${flowThresholds.stepMs.fail}ms)`);
        } else if (stepStatus === 'warning') {
          warnings.push(`${stepRes.label} warning threshold: ${stepRes.durationMs}ms (Limit: ${flowThresholds.stepMs.warning}ms)`);
        }
      }

      // Add annotations to Playwright test
      for (const warn of warnings) {
        testInfo.annotations.push({ type: 'warning', description: warn });
      }

      // 4. Add Results to Summary
      addFlowResult(summary, {
        flowKey: flowConfig.flowKey,
        name: flowConfig.name,
        totalFlowMs,
        success,
        steps: stepResults,
        failures,
        warnings
      });

      // 5. Assert hard failure
      expect(failures.length, `Flow performance violations detected:\n${failures.join('\n')}`).toBe(0);
    });
  }
});

async function executeFlowStep(page: Page, step: any) {
  if (step.type === 'clickFirstPlayerLink') {
    const firstPlayerLink = page.locator('a[href*="/players/"]').first();
    await firstPlayerLink.waitFor({ state: 'visible', timeout: 8000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      firstPlayerLink.click()
    ]);
    if (step.expectedUrlContains) {
      expect(page.url()).toContain(step.expectedUrlContains);
    }
  } else if (step.type === 'expectTextAny') {
    const body = page.locator('body');
    await body.waitFor({ state: 'visible', timeout: 8000 });
    const bodyText = await body.innerText();
    const hasAny = step.texts.some((text: string) => bodyText.includes(text));
    expect(hasAny, `Expected to find one of [${step.texts.join(', ')}] in body text`).toBe(true);
  } else if (step.type === 'searchPlayerIfPossible') {
    const searchInput = page.locator('input[type="text"], input[type="search"], input[placeholder*="search" i]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 8000 });
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.type(step.keyword, { delay: 50 });

    // Click search button next to the input within its parent container
    const parent = searchInput.locator('xpath=..');
    const searchBtn = parent.locator('button').first();
    if (await searchBtn.count() > 0 && await searchBtn.isVisible()) {
      await searchBtn.click();
    } else {
      await page.keyboard.press('Enter').catch(() => undefined);
    }

    await page.waitForTimeout(2500); // allow results/autocomplete to render
  } else if (step.type === 'clickPlayerLink') {
    // Race between URL navigating to profile page and player link becoming visible
    let navigated = false;
    try {
      await Promise.race([
        page.waitForURL(/\/players\//i, { timeout: 4000 }).then(() => { navigated = true; }),
        page.locator('a[href*="/players/"]').first().waitFor({ state: 'visible', timeout: 4000 })
      ]);
    } catch (e) {
      // Timeout is fine, check URL status
    }

    if (navigated || page.url().includes('/players/')) {
      if (step.expectedUrlContains) {
        expect(page.url()).toContain(step.expectedUrlContains);
      }
      return;
    }

    const dummyPlayer = { displayName: 'Phil Hellmuth', searchKeyword: 'Phil Hellmuth' };
    const linkResult = await findPlayerProfileLink(page, dummyPlayer);
    await linkResult.locator.waitFor({ state: 'visible', timeout: 5000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      linkResult.locator.click()
    ]);
    if (step.expectedUrlContains) {
      expect(page.url()).toContain(step.expectedUrlContains);
    }
  } else if (step.type === 'clickFirstNewsLink') {
    const newsLink = page.locator('a[href*="/news/"]').first();
    await newsLink.waitFor({ state: 'visible', timeout: 8000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      newsLink.click()
    ]);
  } else if (step.type === 'expectPageLoaded') {
    await page.waitForLoadState('load');
  } else {
    throw new Error(`Unknown step type: ${step.type}`);
  }
}
