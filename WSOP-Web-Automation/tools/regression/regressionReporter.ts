import * as fs from 'fs';
import * as path from 'path';
import {
  RegressionSummary,
  RegressionStepResult,
  ReleaseGateResult
} from './regressionTypes';

/**
 * 신규 summary 구조체를 생성합니다.
 */
export function createRegressionSummary(suite: any): RegressionSummary {
  return {
    suiteKey: suite.suiteKey,
    suiteName: suite.name,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    durationMs: 0,
    totalSteps: 0,
    passedSteps: 0,
    failedSteps: 0,
    optionalFailedSteps: 0,
    warningSteps: 0,
    skippedSteps: 0,
    stepResults: []
  };
}

/**
 * 실행 결과 단계를 요약 데이터에 갱신 및 가산합니다.
 */
export function addStepResult(
  summary: RegressionSummary,
  result: RegressionStepResult
): void {
  summary.totalSteps++;
  summary.stepResults.push(result);

  if (result.status === 'passed') {
    summary.passedSteps++;
  } else if (result.status === 'failed') {
    summary.failedSteps++;
  } else if (result.status === 'optionalFailed') {
    summary.optionalFailedSteps++;
  } else if (result.status === 'warning') {
    summary.warningSteps++;
  } else if (result.status === 'skipped') {
    summary.skippedSteps++;
  }
}

/**
 * 릴리즈 게이트 규칙을 평가하여 합격 여부를 판별합니다.
 */
export function evaluateReleaseGate(
  summary: RegressionSummary,
  rulesFixture: any
): ReleaseGateResult {
  const rules = rulesFixture.rules;
  let passed = true;
  let status: 'PASSED' | 'FAILED' | 'REQUIRES_REVIEW' = 'PASSED';
  const reasons: string[] = [];

  // 1. 필수 단계 실패 여부 체크
  if (rules.failOnRequiredStepFailure && summary.failedSteps > rules.maxAllowedRequiredFailures) {
    passed = false;
    status = 'FAILED';
    reasons.push(`Required steps failed: ${summary.failedSteps} (Allowed: ${rules.maxAllowedRequiredFailures})`);
  }

  // 2. 선택 단계 실패 여부 체크
  if (rules.failOnOptionalStepFailure && summary.optionalFailedSteps > rules.maxAllowedOptionalFailures) {
    passed = false;
    status = 'FAILED';
    reasons.push(`Optional steps failed: ${summary.optionalFailedSteps} (Allowed: ${rules.maxAllowedOptionalFailures})`);
  }

  // 3. Warning 관련 판독
  if (summary.warningSteps > 0) {
    if (rules.failOnWarning) {
      passed = false;
      status = 'FAILED';
      reasons.push(`Warnings detected: ${summary.warningSteps} (Rules policy forbids warnings)`);
    } else if (rules.warningRequiresReview) {
      status = 'REQUIRES_REVIEW';
      reasons.push(`Warnings detected: ${summary.warningSteps} (Status changed to REQUIRES_REVIEW)`);
    }
  }

  return {
    passed,
    status,
    reason: reasons.join(', ') || 'All release criteria met successfully.',
    rulesApplied: {
      failOnRequiredStepFailure: rules.failOnRequiredStepFailure,
      failOnOptionalStepFailure: rules.failOnOptionalStepFailure,
      failOnWarning: rules.failOnWarning,
      maxAllowedRequiredFailures: rules.maxAllowedRequiredFailures,
      maxAllowedOptionalFailures: rules.maxAllowedOptionalFailures
    }
  };
}

/**
 * 실행 결과 파일들을 artifacts/full-regression/latest/ 하위에 유실 없이 생성합니다.
 */
export function writeRegressionArtifacts(
  summary: RegressionSummary,
  gateResult: ReleaseGateResult
): void {
  const baseDir = path.resolve(__dirname, '../../artifacts/full-regression/latest');

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // 1. regression-summary.json
    fs.writeFileSync(path.join(baseDir, 'regression-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

    // 2. release-gate-result.json
    fs.writeFileSync(path.join(baseDir, 'release-gate-result.json'), JSON.stringify(gateResult, null, 2), 'utf-8');

    // 3. regression-failures.json
    const failures = summary.stepResults.filter(r => r.status === 'failed' || r.status === 'optionalFailed');
    fs.writeFileSync(path.join(baseDir, 'regression-failures.json'), JSON.stringify(failures, null, 2), 'utf-8');

    // 4. regression-warnings.json
    const warnings = summary.stepResults.filter(r => r.status === 'warning');
    fs.writeFileSync(path.join(baseDir, 'regression-warnings.json'), JSON.stringify(warnings, null, 2), 'utf-8');

    // 5. regression-summary.md
    const mdSummary = formatMarkdownSummary(summary, gateResult);
    fs.writeFileSync(path.join(baseDir, 'regression-summary.md'), mdSummary, 'utf-8');

    console.log(`[RegressionReporter] Regression artifacts saved to: ${baseDir}`);
  } catch (error) {
    console.error('[RegressionReporter] Failed to write regression artifacts', error);
  }
}

/**
 * 사람이 읽기 쉬운 상세 마크다운 요약 리포트를 구성합니다.
 */
export function formatMarkdownSummary(
  summary: RegressionSummary,
  gateResult: ReleaseGateResult
): string {
  const formatTime = (isoString: string) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  };

  const statusEmojis: Record<string, string> = {
    PASSED: '🟢 PASSED',
    FAILED: '🔴 FAILED',
    REQUIRES_REVIEW: '🟡 REQUIRES_REVIEW'
  };

  const stepEmojis: Record<string, string> = {
    passed: '🟢 Passed',
    failed: '🔴 Failed',
    optionalFailed: '🟠 Optional Failed',
    warning: '🟡 Warning',
    skipped: '⚪ Skipped'
  };

  let md = `# WSOP Web Automation Regression Summary\n\n`;
  md += `## 1. Execution Overview\n\n`;
  md += `| Attribute | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Suite Key** | \`${summary.suiteKey}\` |\n`;
  md += `| **Suite Name** | ${summary.suiteName} |\n`;
  md += `| **Release Gate** | **${statusEmojis[gateResult.status] ?? gateResult.status}** |\n`;
  md += `| **Gate Reason** | ${gateResult.reason} |\n`;
  md += `| **Start Time** | ${formatTime(summary.startedAt)} |\n`;
  md += `| **End Time** | ${formatTime(summary.finishedAt)} |\n`;
  md += `| **Total Duration** | ${(summary.durationMs / 1000).toFixed(1)}s |\n\n`;

  md += `## 2. Statistics\n\n`;
  md += `- **Total Steps**: ${summary.totalSteps}\n`;
  md += `- **Passed**: ${summary.passedSteps}\n`;
  md += `- **Failed**: ${summary.failedSteps}\n`;
  md += `- **Optional Failed**: ${summary.optionalFailedSteps}\n`;
  md += `- **Warning**: ${summary.warningSteps}\n`;
  md += `- **Skipped**: ${summary.skippedSteps}\n\n`;

  md += `## 3. Detailed Results by Phase\n\n`;
  md += `| Phase | Step | Required | Status | Duration | Notes |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :--- |\n`;

  for (const step of summary.stepResults) {
    const isRequired = summary.stepResults.find(s => s.name === step.name)?.status !== 'optionalFailed' ? 'Yes' : 'No';
    const duration = `${(step.durationMs / 1000).toFixed(1)}s`;
    const note = step.failureClassification
      ? `[${step.failureClassification}] ${step.errorDetails?.substring(0, 60).replace(/\n/g, ' ')}...`
      : '-';

    md += `| ${step.phase} | ${step.name} | ${isRequired} | ${stepEmojis[step.status]} | ${duration} | ${note} |\n`;
  }

  md += `\n`;

  // 실패 내역 상세
  const failures = summary.stepResults.filter(r => r.status === 'failed' || r.status === 'optionalFailed');
  if (failures.length > 0) {
    md += `## 4. Failures Detail\n\n`;
    for (const fail of failures) {
      md += `### ❌ [${fail.phase}] ${fail.name}\n`;
      md += `- **Command**: \`${fail.command}\`\n`;
      md += `- **Exit Code**: \`${fail.exitCode}\`\n`;
      md += `- **Classification**: \`${fail.failureClassification}\`\n`;
      md += `- **Error Details**:\n\`\`\`text\n${fail.errorDetails || 'No details'}\n\`\`\`\n\n`;
    }
  }

  // 경고 내역 상세
  const warnings = summary.stepResults.filter(r => r.status === 'warning');
  if (warnings.length > 0) {
    md += `## 5. Warnings Detail\n\n`;
    for (const warn of warnings) {
      md += `### ⚠️ [${warn.phase}] ${warn.name}\n`;
      md += `- **Command**: \`${warn.command}\`\n`;
      md += `- **Classification**: \`${warn.failureClassification}\`\n`;
      md += `- **Reason**: ${warn.errorDetails || 'Allowable visual or performance threshold warning.'}\n\n`;
    }
  }

  // 다음 대피책 가이드라인
  md += `## 6. Release Next Actions\n\n`;
  if (gateResult.status === 'PASSED') {
    md += `> [!NOTE]\n`;
    md += `> 모든 릴리즈 게이트 통과 기준을 충족했습니다. 배포를 진행하셔도 좋습니다.\n`;
  } else if (gateResult.status === 'REQUIRES_REVIEW') {
    md += `> [!WARNING]\n`;
    md += `> 허용된 경고(Warning)가 발견되었습니다. 시각적 baseline missing 여부 혹은 성능 저하 여부를 체크 및 분석하고 의도된 스펙 변동일 경우 베이스라인을 업데이트한 뒤 배포하십시오.\n`;
  } else {
    md += `> [!CAUTION]\n`;
    md += `> 필수 테스트 실패가 있습니다. 코드 리그레션 혹은 기능 깨짐 현상이므로 원인을 Triage하고 디버깅하여 해결 후 재빌드 하십시오.\n`;
  }

  return md;
}
