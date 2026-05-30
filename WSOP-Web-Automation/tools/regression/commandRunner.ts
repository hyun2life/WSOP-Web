import { spawn, spawnSync } from 'child_process';
import { RegressionStep, RegressionStepResult, RegressionStatus } from './regressionTypes';
import knownExceptions from '../../fixtures/full-regression/known-regression-exceptions.fixture.json';

interface RunCommandOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface RawCommandResult {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  isTimeout: boolean;
}

export async function runCommand(
  commandString: string,
  options: RunCommandOptions = {}
): Promise<RawCommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 600000;
  const isWindows = process.platform === 'win32';

  const child = isWindows
    ? spawn('cmd.exe', ['/d', '/s', '/c', commandString], {
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          ...options.env
        }
      })
    : spawn(commandString, {
        shell: true,
        env: {
          ...process.env,
          ...options.env
        }
      });

  let stdout = '';
  let stderr = '';
  let isTimeout = false;

  child.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  const runPromise = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      resolve(code);
    });
    child.on('error', (err) => {
      stderr += `\n[CommandRunner] Failed to start command: ${commandString}\n${err.message}`;
      resolve(-1);
    });
  });

  const timeoutPromise = new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      isTimeout = true;
      killProcessTree(child.pid);
      resolve(-1);
    }, timeoutMs);

    runPromise.finally(() => clearTimeout(timer));
  });

  const exitCode = await Promise.race([runPromise, timeoutPromise]);
  const durationMs = Date.now() - startedAt;

  return {
    exitCode,
    durationMs,
    stdout,
    stderr,
    isTimeout
  };
}

export function classifyCommandResult(
  raw: RawCommandResult,
  step: RegressionStep
): RegressionStepResult {
  const combinedOutput = stripAnsi(`${raw.stdout}\n${raw.stderr}`);
  const warningCount = countWarningSignals(combinedOutput);
  let status: RegressionStatus = 'passed';
  let failureClassification: string | undefined;
  let errorDetails: string | undefined;

  if (raw.isTimeout) {
    status = step.required ? 'failed' : 'optionalFailed';
    failureClassification = 'timeout';
    errorDetails = `Command timed out after ${raw.durationMs}ms`;
  } else if (raw.exitCode !== 0) {
    const knownException = findKnownException(combinedOutput);
    const inferredClassification = knownException?.key ?? inferFailureClassification(combinedOutput, step);
    const canDowngradeToWarning = Boolean(
      step.allowWarnings &&
      (knownException?.warningOnly || inferredClassification === 'visual-baseline-missing' || inferredClassification === 'crawler-output-missing')
    );

    status = canDowngradeToWarning ? 'warning' : (step.required ? 'failed' : 'optionalFailed');
    failureClassification = inferredClassification;
    errorDetails = extractErrorDetails(raw, combinedOutput, knownException?.reason);
  } else if (warningCount > 0) {
    status = 'warning';
    failureClassification = 'non-blocking-warning';
    errorDetails = extractWarningDetails(combinedOutput);
  }

  return {
    phase: step.phase,
    name: step.name,
    command: step.command,
    required: step.required,
    allowWarnings: step.allowWarnings,
    status,
    exitCode: raw.exitCode,
    durationMs: raw.durationMs,
    stdout: raw.stdout,
    stderr: raw.stderr,
    warningCount,
    failureClassification,
    errorDetails
  };
}

function killProcessTree(pid?: number): void {
  if (!pid) return;

  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      return;
    }

    process.kill(pid, 'SIGTERM');
  } catch {
    // Best-effort cleanup only. The timeout result is still reported above.
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function countWarningSignals(output: string): number {
  return output
    .split(/\r?\n/)
    .filter((line) => {
      if (/\b(DeprecationWarning|trace-deprecation)\b/i.test(line)) {
        return false;
      }
      return /\b(warn|warning|slow|threshold exceeded|performance threshold|third-party)\b/i.test(line) ||
             /PLAYER_PRESENTATION_WARNING/i.test(line);
    })
    .length;
}

function findKnownException(output: string): { key: string; warningOnly: boolean; reason?: string } | undefined {
  for (const [key, exception] of Object.entries(knownExceptions as Record<string, any>)) {
    if (exception.pattern && new RegExp(exception.pattern, 'i').test(output)) {
      return {
        key,
        warningOnly: Boolean(exception.warningOnly),
        reason: exception.reason
      };
    }
  }

  return undefined;
}

function inferFailureClassification(output: string, step: RegressionStep): string {
  if (isVisualBaselineMissing(output, step)) {
    return 'visual-baseline-missing';
  }

  if (isCrawlerOutputMissing(output, step)) {
    return 'crawler-output-missing';
  }

  if (/selector|locator|strict mode violation|waiting for locator/i.test(output)) {
    return 'selector-issue';
  }

  if (/timed out|timeout|test timeout/i.test(output)) {
    return 'timeout';
  }

  return 'actual-product-issue';
}

function isVisualBaselineMissing(output: string, step: RegressionStep): boolean {
  const isVisualStep = /phase 8|phase8|visual/i.test(`${step.phase} ${step.name} ${step.command}`);
  const hasMissingSnapshotSignal = /snapshot (does not|doesn't) exist|missing snapshot|toHaveScreenshot[\s\S]{0,200}snapshot/i.test(output);

  return isVisualStep && hasMissingSnapshotSignal;
}

function isCrawlerOutputMissing(output: string, step: RegressionStep): boolean {
  const isCrawlerStep = step.env?.DATA_SOURCE === 'crawler' || /crawler/i.test(`${step.phase} ${step.name} ${step.command}`);
  const hasMissingCrawlerSignal = /crawler output.*missing|missing crawler output|no crawler output|ENOENT[\s\S]{0,120}crawler|DATA_SOURCE[\s\S]{0,80}crawler/i.test(output);

  return isCrawlerStep && hasMissingCrawlerSignal;
}

function extractErrorDetails(raw: RawCommandResult, combinedOutput: string, knownReason?: string): string {
  const primary = raw.stderr.trim() || raw.stdout.trim() || combinedOutput.trim();
  const prefix = knownReason ? `${knownReason}\n\n` : '';
  return `${prefix}${primary}`.trim();
}

function extractWarningDetails(output: string): string {
  const warningLines = output
    .split(/\r?\n/)
    .filter((line) => {
      if (/\b(DeprecationWarning|trace-deprecation)\b/i.test(line)) {
        return false;
      }
      return /\b(warn|warning|slow|threshold exceeded|performance threshold|third-party)\b/i.test(line) ||
             /PLAYER_PRESENTATION_WARNING/i.test(line);
    })
    .slice(0, 8);

  return warningLines.join('\n') || 'Warning signal detected in command output.';
}
