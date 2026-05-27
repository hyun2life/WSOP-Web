import * as fs from 'fs';
import * as path from 'path';
import { type TestInfo } from '@playwright/test';
import { type PageLoadMetrics } from './performanceMetrics';
import { type RequestInfo } from './requestMonitor';

export type PerformanceSummary = {
  generatedAt: string;
  pages: PageLoadMetrics[];
  flows: Array<{
    flowKey: string;
    name: string;
    totalFlowMs: number;
    success: boolean;
    steps: Array<{ label: string; durationMs: number; success: boolean; error?: string }>;
    failures: string[];
    warnings: string[];
  }>;
  slowRequests: RequestInfo[];
  failedRequests: RequestInfo[];
};

export function createPerformanceSummary(): PerformanceSummary {
  return {
    generatedAt: new Date().toISOString(),
    pages: [],
    flows: [],
    slowRequests: [],
    failedRequests: []
  };
}

export function addPageResult(summary: PerformanceSummary, result: PageLoadMetrics) {
  summary.pages.push(result);
}

export function addFlowResult(
  summary: PerformanceSummary,
  result: PerformanceSummary['flows'][number]
) {
  summary.flows.push(result);
}

export function addRequestIssues(
  summary: PerformanceSummary,
  issues: { slowRequests: RequestInfo[]; failedRequests: RequestInfo[] }
) {
  // Concat and avoid duplicates based on url and startTime
  const existingSlowUrls = new Set(summary.slowRequests.map(r => `${r.url}-${r.startTime}`));
  for (const r of issues.slowRequests) {
    if (!existingSlowUrls.has(`${r.url}-${r.startTime}`)) {
      summary.slowRequests.push(r);
    }
  }

  const existingFailedUrls = new Set(summary.failedRequests.map(r => `${r.url}-${r.startTime}`));
  for (const r of issues.failedRequests) {
    if (!existingFailedUrls.has(`${r.url}-${r.startTime}`)) {
      summary.failedRequests.push(r);
    }
  }
}

export async function attachPerformanceReport(testInfo: TestInfo, name: string, data: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(data, null, 2)),
    contentType: 'application/json'
  });
}

export function writeLatestArtifacts(summary: PerformanceSummary, stabilityResults?: unknown) {
  const outputDir = path.join(__dirname, '..', '..', 'artifacts', 'performance-stability', 'latest');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, 'performance-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(outputDir, 'slow-requests.json'),
    JSON.stringify(summary.slowRequests, null, 2),
    'utf-8'
  );

  fs.writeFileSync(
    path.join(outputDir, 'failed-requests.json'),
    JSON.stringify(summary.failedRequests, null, 2),
    'utf-8'
  );

  if (stabilityResults) {
    fs.writeFileSync(
      path.join(outputDir, 'stability-summary.json'),
      JSON.stringify(stabilityResults, null, 2),
      'utf-8'
    );
  } else {
    // Write an empty or baseline stability summary if not provided
    fs.writeFileSync(
      path.join(outputDir, 'stability-summary.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        description: "Stability metrics baseline.",
        runs: []
      }, null, 2),
      'utf-8'
    );
  }
}
