export type ComparisonResult = 'pass' | 'warning' | 'fail';

export type Threshold = {
  warning: number;
  fail: number;
};

export type ThresholdConfig = {
  pageLoad: {
    domContentLoadedMs: Threshold;
    loadMs: Threshold;
    criticalSelectorMs: Threshold;
    totalPageReadyMs: Threshold;
  };
  requests: {
    slowRequestMs: Threshold;
    slowAssetMs: Threshold;
    allowedThirdPartyFailurePatterns: string[];
  };
  flow: {
    totalFlowMs: Threshold;
    stepMs: Threshold;
  };
  stability: {
    repeatCount: number;
    allowedWarningRuns: number;
    allowedFailedRuns: number;
  };
};

export function compareMetric(
  metricName: string,
  actual: number,
  threshold: Threshold
): ComparisonResult {
  if (actual >= threshold.fail) {
    return 'fail';
  }
  if (actual >= threshold.warning) {
    return 'warning';
  }
  return 'pass';
}

export function comparePageMetrics(
  metrics: { domContentLoadedMs: number; loadMs: number; criticalSelectorMs: number; totalPageReadyMs: number },
  thresholds: ThresholdConfig['pageLoad']
): Record<string, ComparisonResult> {
  return {
    domContentLoadedMs: compareMetric('domContentLoadedMs', metrics.domContentLoadedMs, thresholds.domContentLoadedMs),
    loadMs: compareMetric('loadMs', metrics.loadMs, thresholds.loadMs),
    criticalSelectorMs: compareMetric('criticalSelectorMs', metrics.criticalSelectorMs, thresholds.criticalSelectorMs),
    totalPageReadyMs: compareMetric('totalPageReadyMs', metrics.totalPageReadyMs, thresholds.totalPageReadyMs)
  };
}

export function compareFlowMetrics(
  metrics: { totalFlowMs: number; steps: { label: string; durationMs: number }[] },
  thresholds: ThresholdConfig['flow']
): { totalFlowMs: ComparisonResult; steps: Record<string, ComparisonResult> } {
  const stepsResult: Record<string, ComparisonResult> = {};
  for (const step of metrics.steps) {
    stepsResult[step.label] = compareMetric('stepMs', step.durationMs, thresholds.stepMs);
  }

  return {
    totalFlowMs: compareMetric('totalFlowMs', metrics.totalFlowMs, thresholds.totalFlowMs),
    steps: stepsResult
  };
}

export function isThirdPartyAllowedFailure(url: string, patterns: string[]): boolean {
  return patterns.some(pattern => url.toLowerCase().includes(pattern.toLowerCase()));
}
