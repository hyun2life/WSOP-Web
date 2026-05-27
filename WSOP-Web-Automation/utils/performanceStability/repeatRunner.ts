export type RunResult = {
  runIndex: number;
  type: 'page' | 'flow';
  key: string;
  durationMs: number;
  status: 'pass' | 'warning' | 'fail';
  errors: string[];
};

export type KeySummary = {
  key: string;
  type: 'page' | 'flow';
  totalRuns: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  minDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
  isFlaky: boolean;
  errors: string[];
};

export type RepeatedRunsSummary = {
  generatedAt: string;
  totalRepeats: number;
  byKey: Record<string, KeySummary>;
  overallStatus: 'pass' | 'warning' | 'fail';
};

export function summarizeRepeatedRuns(results: RunResult[]): RepeatedRunsSummary {
  const byKey: Record<string, RunResult[]> = {};

  for (const res of results) {
    if (!byKey[res.key]) {
      byKey[res.key] = [];
    }
    byKey[res.key].push(res);
  }

  const keySummaries: Record<string, KeySummary> = {};
  let maxRepeats = 0;
  let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';

  for (const [key, runs] of Object.entries(byKey)) {
    maxRepeats = Math.max(maxRepeats, runs.length);

    let passCount = 0;
    let warningCount = 0;
    let failCount = 0;
    let totalDuration = 0;
    let minDurationMs = Infinity;
    let maxDurationMs = -Infinity;
    const errorsSet = new Set<string>();

    for (const run of runs) {
      if (run.status === 'pass') passCount++;
      else if (run.status === 'warning') warningCount++;
      else if (run.status === 'fail') failCount++;

      totalDuration += run.durationMs;
      minDurationMs = Math.min(minDurationMs, run.durationMs);
      maxDurationMs = Math.max(maxDurationMs, run.durationMs);

      for (const err of run.errors) {
        errorsSet.add(err);
      }
    }

    const avgDurationMs = runs.length > 0 ? totalDuration / runs.length : 0;
    
    // Detect flaky: if there are both passes and failures/warnings
    const isFlaky = (passCount > 0 || warningCount > 0) && failCount > 0;

    if (failCount > 0 && overallStatus !== 'fail') {
      overallStatus = 'fail';
    } else if (warningCount > 0 && overallStatus === 'pass') {
      overallStatus = 'warning';
    }

    keySummaries[key] = {
      key,
      type: runs[0].type,
      totalRuns: runs.length,
      passCount,
      warningCount,
      failCount,
      minDurationMs: minDurationMs === Infinity ? 0 : minDurationMs,
      maxDurationMs: maxDurationMs === -Infinity ? 0 : maxDurationMs,
      avgDurationMs,
      isFlaky,
      errors: Array.from(errorsSet)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    totalRepeats: maxRepeats,
    byKey: keySummaries,
    overallStatus
  };
}
