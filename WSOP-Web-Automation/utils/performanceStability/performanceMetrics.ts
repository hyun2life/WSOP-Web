import { type Page } from '@playwright/test';

export type PageLoadMetrics = {
  pageKey: string;
  name: string;
  url: string;
  status: number;
  domContentLoadedMs: number;
  loadMs: number;
  criticalSelectorMs: number;
  totalPageReadyMs: number;
  navigationTiming: Record<string, unknown> | null;
  warnings: string[];
  failures: string[];
};

export type StepResult = {
  label: string;
  success: boolean;
  durationMs: number;
  error?: string;
};

export async function measurePageLoad(
  page: Page,
  pageConfig: { pageKey: string; name: string; url: string; criticalSelectors?: string[]; criticalTexts?: string[] }
): Promise<PageLoadMetrics> {
  const warnings: string[] = [];
  const failures: string[] = [];
  const pageKey = pageConfig.pageKey;
  const name = pageConfig.name;
  const url = pageConfig.url;

  const startTime = Date.now();
  let domContentLoadedTime = 0;
  let loadTime = 0;
  let responseStatus = 0;

  try {
    const response = await page.goto(url, { waitUntil: 'commit' });
    responseStatus = response?.status() ?? 0;

    if (responseStatus >= 400) {
      failures.push(`HTTP status: ${responseStatus}`);
    }

    // Measure DOMContentLoaded
    const domStart = Date.now();
    await page.waitForLoadState('domcontentloaded');
    domContentLoadedTime = Date.now() - startTime;

    // Measure Load
    await page.waitForLoadState('load');
    loadTime = Date.now() - startTime;

  } catch (error) {
    failures.push(`Navigation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Measure Critical Selector/Text
  let criticalSelectorMs = 0;
  const selectorStart = Date.now();
  const waitPromises: Promise<void>[] = [];

  if (pageConfig.criticalSelectors && pageConfig.criticalSelectors.length > 0) {
    waitPromises.push(
      ...pageConfig.criticalSelectors.map(async (selector) => {
        try {
          await page.locator(selector).first().waitFor({ state: 'visible', timeout: 8000 });
        } catch (err) {
          failures.push(`Critical selector "${selector}" not visible within timeout`);
        }
      })
    );
  }

  if (pageConfig.criticalTexts && pageConfig.criticalTexts.length > 0) {
    waitPromises.push(
      ...pageConfig.criticalTexts.map(async (text) => {
        try {
          await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout: 8000 });
        } catch (err) {
          failures.push(`Critical text "${text}" not visible within timeout`);
        }
      })
    );
  }

  if (waitPromises.length > 0) {
    await Promise.all(waitPromises);
  }

  criticalSelectorMs = Date.now() - selectorStart;

  const totalPageReadyMs = Date.now() - startTime;

  // Get Browser performance timing
  let navigationTiming: Record<string, unknown> | null = null;
  try {
    navigationTiming = await getBrowserPerformanceTiming(page);
  } catch (err) {
    warnings.push(`Could not retrieve browser performance timing: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    pageKey,
    name,
    url,
    status: responseStatus,
    domContentLoadedMs: domContentLoadedTime,
    loadMs: loadTime,
    criticalSelectorMs,
    totalPageReadyMs,
    navigationTiming,
    warnings,
    failures
  };
}

export async function measureStep(
  label: string,
  action: () => Promise<void>
): Promise<StepResult> {
  const start = Date.now();
  try {
    await action();
    return {
      label,
      success: true,
      durationMs: Date.now() - start
    };
  } catch (error) {
    return {
      label,
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function getBrowserPerformanceTiming(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    try {
      const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (!nav) return null;
      return {
        dnsMs: nav.domainLookupEnd - nav.domainLookupStart,
        tcpMs: nav.connectEnd - nav.connectStart,
        sslMs: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
        requestMs: nav.responseStart - nav.requestStart,
        responseMs: nav.responseEnd - nav.responseStart,
        domInteractiveMs: nav.domInteractive,
        domCompleteMs: nav.domComplete,
        durationMs: nav.duration
      };
    } catch (e) {
      return null;
    }
  });
}
