import * as path from 'path';
import { runCommand, classifyCommandResult } from './commandRunner';
import {
  createRegressionSummary,
  addStepResult,
  evaluateReleaseGate,
  writeRegressionArtifacts
} from './regressionReporter';

// Fixtures
import suitesFixture from '../../fixtures/full-regression/regression-suites.fixture.json';
import rulesFixture from '../../fixtures/full-regression/release-gate-rules.fixture.json';

async function main() {
  // 1. CLI Arguments 파싱
  let suiteKey = 'standard';
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--suite=')) {
      suiteKey = arg.split('=')[1];
    }
  }

  console.log(`[RegressionRunner] Resolving suite: "${suiteKey}"`);

  // 2. 스위트 검색 및 extends 처리
  const suites = suitesFixture.suites;
  let suite = suites.find((s: any) => s.suiteKey === suiteKey);

  if (!suite) {
    console.error(`[RegressionRunner] Error: Suite "${suiteKey}" not found in regression-suites.fixture.json`);
    process.exit(1);
  }

  // 상속 결합 기능 처리
  if (suite.extends) {
    console.log(`[RegressionRunner] Suite "${suiteKey}" extends "${suite.extends}"`);
    const baseSuite = suites.find((s: any) => s.suiteKey === suite.extends);
    if (!baseSuite) {
      console.error(`[RegressionRunner] Error: Base suite "${suite.extends}" not found.`);
      process.exit(1);
    }
    const baseSteps = baseSuite.steps || [];
    const additionalSteps = suite.additionalSteps || [];
    suite = {
      ...suite,
      steps: [...baseSteps, ...additionalSteps]
    };
  }

  console.log(`[RegressionRunner] Starting execution of suite: ${suite.name}`);
  console.log(`[RegressionRunner] Description: ${suite.description}`);
  console.log(`[RegressionRunner] Number of steps to execute: ${suite.steps.length}`);

  const summary = createRegressionSummary(suite);
  const startedAt = Date.now();

  // 3. 각 단계 순차 구동
  for (let i = 0; i < suite.steps.length; i++) {
    const step = suite.steps[i];
    console.log(`\n==================================================`);
    console.log(`[Step ${i + 1}/${suite.steps.length}] Running Phase: ${step.phase} - ${step.name}`);
    console.log(`[Command]: ${step.command}`);
    if (step.env) {
      console.log(`[Env Override]: ${JSON.stringify(step.env)}`);
    }
    console.log(`==================================================`);

    try {
      const rawResult = await runCommand(step.command, {
        timeoutMs: suite.defaultTimeoutMs ?? 600000,
        env: step.env
      });

      const stepResult = classifyCommandResult(rawResult, step);
      addStepResult(summary, stepResult);

      console.log(`[Result]: Status = ${stepResult.status}, Exit Code = ${stepResult.exitCode}, Duration = ${(stepResult.durationMs / 1000).toFixed(1)}s`);
      if (stepResult.warningCount > 0) {
        console.log(`[Warnings Found]: ${stepResult.warningCount} occurrences`);
      }
      if (stepResult.errorDetails) {
        console.log(`[Error snippet]:\n${stepResult.errorDetails.substring(0, 200)}...`);
      }
    } catch (err: any) {
      console.error(`[RegressionRunner] Step execution failed unexpectedly`, err);
      addStepResult(summary, {
        phase: step.phase,
        name: step.name,
        command: step.command,
        status: step.required ? 'failed' : 'optionalFailed',
        exitCode: -999,
        durationMs: 0,
        stdout: '',
        stderr: err.message || err.toString(),
        warningCount: 0,
        failureClassification: 'script-error',
        errorDetails: err.message
      });
    }
  }

  // 4. 실행 완료 마킹 및 게이트 평가
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAt;

  const gateResult = evaluateReleaseGate(summary, rulesFixture);

  // 5. 아티팩트 파일 저장
  writeRegressionArtifacts(summary, gateResult);

  // 6. 콘솔 최종 출력
  console.log(`\n==================================================`);
  console.log(`                 REGRESSION REPORT               `);
  console.log(`==================================================`);
  console.log(`Suite: ${summary.suiteName} (${summary.suiteKey})`);
  console.log(`Gate Status: ${gateResult.status} (Passed = ${gateResult.passed})`);
  console.log(`Gate Reason: ${gateResult.reason}`);
  console.log(`Total Steps: ${summary.totalSteps}`);
  console.log(`Passed: ${summary.passedSteps}, Failed: ${summary.failedSteps}, Optional Failed: ${summary.optionalFailedSteps}, Warning: ${summary.warningSteps}`);
  console.log(`Total Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`==================================================`);

  // 7. 프로세스 Exit 코드 설정
  if (!gateResult.passed) {
    console.error(`[RegressionRunner] Release gate failed. Exiting with failure code.`);
    process.exit(1);
  } else {
    console.log(`[RegressionRunner] Release gate checks passed. Exiting with success.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`[RegressionRunner] Fatal execution error`, err);
  process.exit(1);
});
