import * as fs from 'fs';
import * as path from 'path';
import {
  RegressionSummary,
  RegressionStepResult,
  ReleaseGateResult,
  ReleaseGateStepRef
} from './regressionTypes';

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

export function evaluateReleaseGate(
  summary: RegressionSummary,
  rulesFixture: any
): ReleaseGateResult {
  const rules = rulesFixture.rules;
  const blockingFailures = summary.stepResults.filter((step) => step.status === 'failed');
  const optionalFailures = summary.stepResults.filter((step) => step.status === 'optionalFailed');
  const warnings = summary.stepResults.filter((step) => step.status === 'warning');

  const requiredFailureBlocked = rules.failOnRequiredStepFailure && blockingFailures.length > rules.maxAllowedRequiredFailures;
  const optionalFailureBlocked = rules.failOnOptionalStepFailure && optionalFailures.length > rules.maxAllowedOptionalFailures;
  const warningBlocked = rules.failOnWarning && warnings.length > 0;
  const passed = !(requiredFailureBlocked || optionalFailureBlocked || warningBlocked);
  const requiresReview = passed && (warnings.length > 0 || optionalFailures.length > 0);
  const status = passed ? (requiresReview ? 'REQUIRES_REVIEW' : 'PASSED') : 'FAILED';

  const reasons: string[] = [];
  if (requiredFailureBlocked) {
    reasons.push(`Required step failures exceed policy: ${blockingFailures.length}/${rules.maxAllowedRequiredFailures}`);
  }
  if (optionalFailureBlocked) {
    reasons.push(`Optional step failures exceed policy: ${optionalFailures.length}/${rules.maxAllowedOptionalFailures}`);
  }
  if (warningBlocked) {
    reasons.push(`Warnings are configured as blockers: ${warnings.length}`);
  }
  if (!reasons.length && requiresReview) {
    reasons.push(`Passed with non-blocking review items: warnings=${warnings.length}, optionalFailures=${optionalFailures.length}`);
  }
  if (!reasons.length) {
    reasons.push('All release gate criteria passed.');
  }

  const reviewItemCount = warnings.length + optionalFailures.length;

  return {
    suiteKey: summary.suiteKey,
    suiteName: summary.suiteName,
    generatedAt: new Date().toISOString(),
    passed,
    status,
    blocking: !passed,
    requiresReview,
    exitCode: passed ? 0 : 1,
    reason: reasons.join(' '),
    counts: {
      totalSteps: summary.totalSteps,
      passedSteps: summary.passedSteps,
      failedSteps: summary.failedSteps,
      optionalFailedSteps: summary.optionalFailedSteps,
      warningSteps: summary.warningSteps,
      skippedSteps: summary.skippedSteps
    },
    blockingFailures: blockingFailures.map(toGateStepRef),
    optionalFailures: optionalFailures.map(toGateStepRef),
    warnings: warnings.map(toGateStepRef),
    ci: {
      shouldFailBuild: !passed,
      exitCode: passed ? 0 : 1,
      blockingFailureCount: blockingFailures.length,
      reviewItemCount
    },
    rulesApplied: {
      failOnRequiredStepFailure: rules.failOnRequiredStepFailure,
      failOnOptionalStepFailure: rules.failOnOptionalStepFailure,
      failOnWarning: rules.failOnWarning,
      maxAllowedRequiredFailures: rules.maxAllowedRequiredFailures,
      maxAllowedOptionalFailures: rules.maxAllowedOptionalFailures
    }
  };
}

export function writeRegressionArtifacts(
  summary: RegressionSummary,
  gateResult: ReleaseGateResult
): void {
  const baseDir = path.resolve(__dirname, '../../artifacts/full-regression/latest');

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    fs.writeFileSync(path.join(baseDir, 'regression-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(path.join(baseDir, 'release-gate-result.json'), JSON.stringify(gateResult, null, 2), 'utf-8');

    const failures = summary.stepResults.filter((result) => result.status === 'failed' || result.status === 'optionalFailed');
    fs.writeFileSync(path.join(baseDir, 'regression-failures.json'), JSON.stringify(failures, null, 2), 'utf-8');

    const warnings = summary.stepResults.filter((result) => result.status === 'warning');
    fs.writeFileSync(path.join(baseDir, 'regression-warnings.json'), JSON.stringify(warnings, null, 2), 'utf-8');

    fs.writeFileSync(path.join(baseDir, 'regression-summary.md'), formatMarkdownSummary(summary, gateResult), 'utf-8');

    console.log(`[RegressionReporter] Regression artifacts saved to: ${baseDir}`);
  } catch (error) {
    console.error('[RegressionReporter] Failed to write regression artifacts', error);
  }
}

export function formatMarkdownSummary(
  summary: RegressionSummary,
  gateResult: ReleaseGateResult
): string {
  const rows = summary.stepResults.map((step) => {
    const classification = step.failureClassification ? `\`${escapeMd(step.failureClassification)}\`` : '-';
    const note = step.errorDetails ? escapeMd(compactSnippet(step.errorDetails, 120)) : '-';
    return `| ${escapeMd(step.phase)} | ${escapeMd(step.name)} | ${step.required ? 'Required' : 'Optional'} | ${formatStepStatus(step.status)} | ${formatDuration(step.durationMs)} | ${classification} | ${note} |`;
  });

  const md: string[] = [];
  md.push('# WSOP Web Automation Regression Summary');
  md.push('');
  md.push('## 1. Execution Overview');
  md.push('');
  md.push('| Attribute | Value |');
  md.push('| :--- | :--- |');
  md.push(`| Suite | \`${summary.suiteKey}\` - ${escapeMd(summary.suiteName)} |`);
  md.push(`| Gate Status | **${gateResult.status}** |`);
  md.push(`| Release Blocked | **${gateResult.blocking ? 'Yes' : 'No'}** |`);
  md.push(`| Requires Review | **${gateResult.requiresReview ? 'Yes' : 'No'}** |`);
  md.push(`| CI Exit Code | \`${gateResult.ci.exitCode}\` |`);
  md.push(`| Reason | ${escapeMd(gateResult.reason)} |`);
  md.push(`| Started | ${formatKst(summary.startedAt)} |`);
  md.push(`| Finished | ${formatKst(summary.finishedAt)} |`);
  md.push(`| Duration | ${formatDuration(summary.durationMs)} |`);
  md.push('');
  md.push('## 2. Step Counts');
  md.push('');
  md.push('| Total | Passed | Failed | Optional Failed | Warning | Skipped |');
  md.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
  md.push(`| ${summary.totalSteps} | ${summary.passedSteps} | ${summary.failedSteps} | ${summary.optionalFailedSteps} | ${summary.warningSteps} | ${summary.skippedSteps} |`);
  md.push('');
  md.push('## 3. Phase Results');
  md.push('');
  md.push('| Phase | Step | Policy | Status | Duration | Classification | Note |');
  md.push('| :--- | :--- | :---: | :---: | ---: | :--- | :--- |');
  md.push(...rows);
  md.push('');

  addDetailSection(md, '4. Blocking Failures', summary.stepResults.filter((step) => step.status === 'failed'));
  addDetailSection(md, '5. Optional Failures', summary.stepResults.filter((step) => step.status === 'optionalFailed'));
  addDetailSection(md, '6. Warnings / Review Items', summary.stepResults.filter((step) => step.status === 'warning'));

  md.push('## 7. Release Guidance');
  md.push('');
  if (gateResult.blocking) {
    md.push('- Release gate is blocked. Fix required step failures first.');
  } else if (gateResult.requiresReview) {
    md.push('- Release gate passed for CI, but review warnings or optional failures before human approval.');
  } else {
    md.push('- Release gate passed without review items.');
  }
  md.push('- Optional failures and warnings are intentionally reported without failing the release gate unless rules are changed.');
  md.push('- Visual baseline updates are not run by this regression runner. Use the explicit baseline update scripts only after review.');
  md.push('');
  md.push('## 8. Appendix: Phase Verification Standards (Phase별 합격 검수 기준 가이드)');
  md.push('');
  md.push('본 회귀 테스트가 성공(**PASS**)으로 마킹되기 위해 충족해야 할 단계별 검수 및 대조 기준은 다음과 같습니다:');
  md.push('');
  md.push('| Phase 단계 | 검증 시나리오 및 주요 확인 사항 | 합격 검수 기준 (Acceptance Criteria) |');
  md.push('| :--- | :--- | :--- |');
  md.push('| **Phase 1 (Smoke)** | 주요 공개 페이지 접근 및 콘솔 오류 | 모든 대상 페이지 HTTP status 200 및 화이트리스트 외 JS 런타임 에러 전무 |');
  md.push('| **Phase 2 (Functional)** | 일정 탐색, 플레이어 검색 등 기능 흐름 | 탭 전환 시 화면 목록 정상 노출 및 상세 페이지 정상 진입 성공 |');
  md.push('| **Phase 3 (Player UI)** | 플레이어 프로필 식별자 렌더링 검사 | 선수 이미지 박스, 국기 아이콘 및 뱃지 UI 정상 매핑 확인 |');
  md.push('| **Phase 4 (Search/Sort)** | 필터링 및 리스트 정렬의 조작 안정성 | 부분 검색/대소문자 처리 시 정상 노출 및 정렬 조작 시 레이아웃 무결 |');
  md.push('| **Phase 5 (Result Detail)** | 대회 결과 상세 페이지와 프로필 간 연결 | 상세 결과에 대상 선수의 순위/상금 존재 및 원래 프로필로 백링크 연결 |');
  md.push('| **Phase 6 (Data Integrity)**| API/크롤러 원천 데이터 vs 화면 실시간 대조| 금반지/팔찌 획득 수 및 상금 합산 총액 수치가 기대 데이터와 100% 일치 |');
  md.push('| **Phase 7 (Performance)** | 페이지 최초 로딩 속도 안정성 측정 | 주요 페이지 최초 로드 타임이 5.0초 임계치를 초과하지 않을 것 |');
  md.push('| **Phase 8 (Visual)** | 스크린샷 baseline 이미지 대비 회귀 분석 | 컴포넌트 픽셀 오차율이 1.5% 미만이어야 함 (동적 영역 마스킹 적용) |');
  md.push('| **Phase 9 (Regression)** | 최종 릴리즈 게이트 전체 조율 스위트 | 필수(Required) 단계(Phase 1,2,3,5,6) 100% 통과 및 경고(Warning) 로깅 확인 |');
  md.push('');

  return `${md.join('\n')}\n`;
}

function addDetailSection(md: string[], title: string, steps: RegressionStepResult[]): void {
  md.push(`## ${title}`);
  md.push('');

  if (!steps.length) {
    md.push('- None');
    md.push('');
    return;
  }

  for (const step of steps) {
    md.push(`### ${escapeMd(step.phase)} - ${escapeMd(step.name)}`);
    md.push('');
    md.push(`- Command: \`${escapeMd(step.command)}\``);
    md.push(`- Policy: ${step.required ? 'Required' : 'Optional'}`);
    md.push(`- Exit Code: \`${step.exitCode}\``);
    md.push(`- Classification: \`${escapeMd(step.failureClassification ?? 'unclassified')}\``);
    md.push(`- Duration: ${formatDuration(step.durationMs)}`);
    md.push('');
    md.push('```text');
    md.push(compactSnippet(step.errorDetails || step.stderr || step.stdout || 'No details.', 1600));
    md.push('```');
    md.push('');
  }
}

function toGateStepRef(step: RegressionStepResult): ReleaseGateStepRef {
  return {
    phase: step.phase,
    name: step.name,
    command: step.command,
    required: step.required,
    status: step.status,
    exitCode: step.exitCode,
    classification: step.failureClassification
  };
}

function formatStepStatus(status: string): string {
  const labels: Record<string, string> = {
    passed: 'Passed',
    failed: 'Failed',
    optionalFailed: 'Optional Failed',
    warning: 'Warning',
    skipped: 'Skipped'
  };

  return labels[status] ?? status;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatKst(isoString: string): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function compactSnippet(value: string, maxLength: number): string {
  const compacted = value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength)}\n... truncated ...`;
}
