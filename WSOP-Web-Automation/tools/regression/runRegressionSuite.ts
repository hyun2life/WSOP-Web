import * as fs from 'fs';
import * as path from 'path';
import { runCommand, classifyCommandResult } from './commandRunner';
import {
  createRegressionSummary,
  addStepResult,
  evaluateReleaseGate,
  writeRegressionArtifacts
} from './regressionReporter';

import suitesFixture from '../../fixtures/full-regression/regression-suites.fixture.json';
import rulesFixture from '../../fixtures/full-regression/release-gate-rules.fixture.json';

async function main() {
  const suiteKey = parseSuiteKey(process.argv.slice(2));
  console.log(`[RegressionRunner] Resolving suite: "${suiteKey}"`);

  const suite = resolveSuite(suiteKey);
  validateSuiteConfiguration(suite);

  console.log(`[RegressionRunner] Starting execution of suite: ${suite.name}`);
  console.log(`[RegressionRunner] Description: ${suite.description}`);
  console.log(`[RegressionRunner] Number of steps to execute: ${suite.steps.length}`);

  const summary = createRegressionSummary(suite);
  const startedAt = Date.now();

  for (let i = 0; i < suite.steps.length; i++) {
    const step = suite.steps[i];
    console.log('\n==================================================');
    console.log(`[Step ${i + 1}/${suite.steps.length}] Running Phase: ${step.phase} - ${step.name}`);
    console.log(`[Command]: ${step.command}`);
    console.log(`[Policy]: ${step.required ? 'required' : 'optional'}, allowWarnings=${step.allowWarnings}`);
    if (step.env) {
      console.log(`[Env Override]: ${JSON.stringify(step.env)}`);
    }
    console.log('==================================================');

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
        console.log(`[Details snippet]:\n${stepResult.errorDetails.substring(0, 300)}...`);
      }
    } catch (err: any) {
      console.error('[RegressionRunner] Step execution failed unexpectedly', err);
      addStepResult(summary, {
        phase: step.phase,
        name: step.name,
        command: step.command,
        required: step.required,
        allowWarnings: step.allowWarnings,
        status: step.required ? 'failed' : 'optionalFailed',
        exitCode: -999,
        durationMs: 0,
        stdout: '',
        stderr: err.message || err.toString(),
        warningCount: 0,
        failureClassification: 'runner-script-error',
        errorDetails: err.message
      });
    }
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAt;

  const gateResult = evaluateReleaseGate(summary, rulesFixture);
  writeRegressionArtifacts(summary, gateResult);

  console.log('\n==================================================');
  console.log('                 REGRESSION REPORT               ');
  console.log('==================================================');
  console.log(`Suite: ${summary.suiteName} (${summary.suiteKey})`);
  console.log(`Gate Status: ${gateResult.status} (Passed = ${gateResult.passed})`);
  console.log(`Release Blocked: ${gateResult.blocking}`);
  console.log(`Requires Review: ${gateResult.requiresReview}`);
  console.log(`Gate Reason: ${gateResult.reason}`);
  console.log(`Total Steps: ${summary.totalSteps}`);
  console.log(`Passed: ${summary.passedSteps}, Failed: ${summary.failedSteps}, Optional Failed: ${summary.optionalFailedSteps}, Warning: ${summary.warningSteps}`);
  console.log(`Total Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log('==================================================');

  if (gateResult.ci.shouldFailBuild) {
    console.error('[RegressionRunner] Release gate failed. Exiting with failure code.');
    process.exit(gateResult.ci.exitCode);
  }

  console.log('[RegressionRunner] Release gate is not blocked. Exiting with success.');
  process.exit(0);
}

function parseSuiteKey(args: string[]): string {
  for (const arg of args) {
    if (arg.startsWith('--suite=')) {
      return arg.split('=')[1];
    }
  }

  return 'standard';
}

function resolveSuite(suiteKey: string): any {
  const suites = suitesFixture.suites;
  const suite = suites.find((candidate: any) => candidate.suiteKey === suiteKey);

  if (!suite) {
    console.error(`[RegressionRunner] Error: Suite "${suiteKey}" not found in regression-suites.fixture.json`);
    process.exit(1);
  }

  if (!suite.extends) {
    return suite;
  }

  console.log(`[RegressionRunner] Suite "${suiteKey}" extends "${suite.extends}"`);
  const baseSuite = suites.find((candidate: any) => candidate.suiteKey === suite.extends);
  if (!baseSuite) {
    console.error(`[RegressionRunner] Error: Base suite "${suite.extends}" not found.`);
    process.exit(1);
  }

  return {
    ...suite,
    steps: [...(baseSuite.steps || []), ...(suite.additionalSteps || [])]
  };
}

function validateSuiteConfiguration(suite: any): void {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const scripts = packageJson.scripts ?? {};
  const errors: string[] = [];

  for (const step of suite.steps) {
    const scriptName = extractNpmScriptName(step.command);
    if (scriptName && !scripts[scriptName]) {
      errors.push(`${step.phase} - ${step.name}: command references missing package.json script "${scriptName}"`);
    }

    if (/--update-snapshots|update:visual-baseline|update:phase8-baseline/i.test(step.command)) {
      errors.push(`${step.phase} - ${step.name}: visual baseline update commands are not allowed in regression suites`);
    }
  }

  if (errors.length > 0) {
    console.error('[RegressionRunner] Suite configuration is invalid:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}

function extractNpmScriptName(command: string): string | undefined {
  const match = command.match(/^npm\s+(?:run|run-script)\s+([^\s]+)/);
  return match?.[1];
}

main().catch((err) => {
  console.error('[RegressionRunner] Fatal execution error', err);
  process.exit(1);
});
