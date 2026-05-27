export type RegressionStatus = 'passed' | 'failed' | 'optionalFailed' | 'warning' | 'skipped';

export interface RegressionStep {
  phase: string;
  name: string;
  command: string;
  required: boolean;
  allowWarnings: boolean;
  env?: Record<string, string>;
}

export interface RegressionStepResult {
  phase: string;
  name: string;
  command: string;
  status: RegressionStatus;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  warningCount: number;
  failureClassification?: string;
  errorDetails?: string;
}

export interface RegressionSummary {
  suiteKey: string;
  suiteName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  optionalFailedSteps: number;
  warningSteps: number;
  skippedSteps: number;
  stepResults: RegressionStepResult[];
}

export interface ReleaseGateResult {
  passed: boolean;
  status: 'PASSED' | 'FAILED' | 'REQUIRES_REVIEW';
  reason: string;
  rulesApplied: {
    failOnRequiredStepFailure: boolean;
    failOnOptionalStepFailure: boolean;
    failOnWarning: boolean;
    maxAllowedRequiredFailures: number;
    maxAllowedOptionalFailures: number;
  };
}
