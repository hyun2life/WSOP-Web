import { spawn } from 'child_process';
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

/**
 * 하위 프로세스를 실행하여 쉘 명령을 구동하고 결과를 반환합니다.
 */
export async function runCommand(
  commandString: string,
  options: RunCommandOptions = {}
): Promise<RawCommandResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 600000; // 기본 10분

  let actualCommand = commandString;
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    actualCommand = commandString
      .replace(/^npm\b/, 'npm.cmd')
      .replace(/^npx\b/, 'npx.cmd');
  }
  
  const child = spawn(actualCommand, {
    shell: isWindows ? 'powershell.exe' : true,
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
      console.error(`[CommandRunner] Failed to start command: ${commandString}`, err);
      resolve(-1);
    });
  });

  // 타임아웃 타이머 연동
  const timeoutPromise = new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      isTimeout = true;
      try {
        child.kill();
      } catch (e) {
        // 무시
      }
      resolve(-1);
    }, timeoutMs);

    // 프로세스가 끝나면 타이머 정리
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

/**
 * 쉘 명령 실행 결과 원천 데이터를 가공하여 테스트 스펙에 맞게 가공합니다.
 */
export function classifyCommandResult(
  raw: RawCommandResult,
  step: RegressionStep
): RegressionStepResult {
  let status: RegressionStatus = 'passed';
  let failureClassification: string | undefined;
  let errorDetails: string | undefined;

  // 1. Warning 카운트 분석 (warn, slow, timeout 등 검색)
  const combinedOutput = (raw.stdout + '\n' + raw.stderr).toLowerCase();
  const warningRegex = /warn|slow|timeout|error/gi;
  const matches = combinedOutput.match(warningRegex);
  const warningCount = matches ? matches.length : 0;

  // 2. 에러 및 타임아웃 판정
  if (raw.isTimeout) {
    status = step.required ? 'failed' : 'optionalFailed';
    failureClassification = 'timeout';
    errorDetails = `Command timed out after ${raw.durationMs}ms`;
  } else if (raw.exitCode !== 0) {
    status = step.required ? 'failed' : 'optionalFailed';
    errorDetails = raw.stderr || raw.stdout;

    // 3. 에러 상세 분석 분류 (known exceptions 기반)
    let matchedException = false;
    for (const excKey of Object.keys(knownExceptions)) {
      const exc = (knownExceptions as any)[excKey];
      if (exc.pattern && new RegExp(exc.pattern, 'i').test(combinedOutput)) {
        failureClassification = excKey;
        matchedException = true;
        if (exc.warningOnly) {
          status = 'warning';
        }
        break;
      }
    }

    if (!matchedException) {
      if (combinedOutput.includes('snapshot') || combinedOutput.includes('screenshot') || combinedOutput.includes('visual')) {
        failureClassification = 'visual-baseline-missing';
        status = 'warning'; // baseline missing은 제품 버그가 아니므로 warning 처리 권장 정책
      } else if (combinedOutput.includes('selector') || combinedOutput.includes('locator')) {
        failureClassification = 'selector-issue';
      } else {
        failureClassification = 'actual-product-issue';
      }
    }
  }

  return {
    phase: step.phase,
    name: step.name,
    command: step.command,
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
