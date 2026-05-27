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
  required: boolean;
  allowWarnings: boolean;
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

export interface ReleaseGateStepRef {
  phase: string;
  name: string;
  command: string;
  required: boolean;
  status: RegressionStatus;
  exitCode: number | null;
  classification?: string;
}

export interface ReleaseGateResult {
  suiteKey: string;
  suiteName: string;
  generatedAt: string;
  passed: boolean;
  status: 'PASSED' | 'FAILED' | 'REQUIRES_REVIEW';
  blocking: boolean;
  requiresReview: boolean;
  exitCode: 0 | 1;
  reason: string;
  counts: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    optionalFailedSteps: number;
    warningSteps: number;
    skippedSteps: number;
  };
  blockingFailures: ReleaseGateStepRef[];
  optionalFailures: ReleaseGateStepRef[];
  warnings: ReleaseGateStepRef[];
  ci: {
    shouldFailBuild: boolean;
    exitCode: 0 | 1;
    blockingFailureCount: number;
    reviewItemCount: number;
  };
  rulesApplied: {
    failOnRequiredStepFailure: boolean;
    failOnOptionalStepFailure: boolean;
    failOnWarning: boolean;
    maxAllowedRequiredFailures: number;
    maxAllowedOptionalFailures: number;
  };
}
