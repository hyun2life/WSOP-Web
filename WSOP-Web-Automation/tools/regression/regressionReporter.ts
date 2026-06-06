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

  if (result.status === 'passed' || result.status === 'minor') {
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
  const outputDir = path.resolve(__dirname, '../../automation/output');

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(path.join(baseDir, 'regression-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(path.join(baseDir, 'release-gate-result.json'), JSON.stringify(gateResult, null, 2), 'utf-8');

    const failures = summary.stepResults.filter((result) => result.status === 'failed' || result.status === 'optionalFailed');
    fs.writeFileSync(path.join(baseDir, 'regression-failures.json'), JSON.stringify(failures, null, 2), 'utf-8');

    const warnings = summary.stepResults.filter((result) => result.status === 'warning');
    fs.writeFileSync(path.join(baseDir, 'regression-warnings.json'), JSON.stringify(warnings, null, 2), 'utf-8');

    fs.writeFileSync(path.join(baseDir, 'regression-summary.md'), formatMarkdownSummary(summary, gateResult), 'utf-8');

    // Generate HTML reports
    const htmlEn = formatHtmlSummary(summary, gateResult, false);
    const htmlKo = formatHtmlSummary(summary, gateResult, true);

    fs.writeFileSync(path.join(baseDir, 'regression-summary.html'), htmlEn, 'utf-8');
    fs.writeFileSync(path.join(baseDir, 'regression-summary-ko.html'), htmlKo, 'utf-8');

    // Copy to output dir with timestamp prefix to support dashboard history selector
    const runId = timestampForFile(summary.startedAt);
    fs.writeFileSync(path.join(outputDir, `wsop-public-regression-${runId}-report.html`), htmlEn, 'utf-8');
    fs.writeFileSync(path.join(outputDir, `wsop-public-regression-${runId}-report-ko.html`), htmlKo, 'utf-8');
    
    // Also save json to output dir
    fs.writeFileSync(path.join(outputDir, `wsop-public-regression-${runId}-report.json`), JSON.stringify(summary, null, 2), 'utf-8');

    console.log(`[RegressionReporter] Regression artifacts saved to: ${baseDir}`);
  } catch (error) {
    console.error('[RegressionReporter] Failed to write regression artifacts', error);
  }
}

function timestampForFile(startedAtStr: string): string {
  try {
    const now = new Date(startedAtStr);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      '-',
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('');
  } catch {
    return 'latest';
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
  md.push('| **Phase 6 (Data Integrity)**| Playwright가 기준 데이터와 공개 UI 값을 수집해 비교| expected/actual 차이와 stale fixture 가능성을 함께 확인 |');
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
    skipped: 'Skipped',
    minor: 'Minor (Passed)'
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

export function formatHtmlSummary(
  summary: RegressionSummary,
  gateResult: ReleaseGateResult,
  isKo: boolean
): string {
  // 번역 사전 정의
  const t = isKo ? {
    title: 'WSOP Phase 9 최종 릴리즈 게이트 리포트',
    subtitle: '배포 전 필수 검증 단계들의 최종 성공 여부 및 경고 상태를 종합 조율하여 게이트 통과를 검증한 결과입니다.',
    eyebrow: 'WSOP Phase 9 Regression',
    status: '게이트 상태',
    total: '전체 검증 단계',
    passed: '정상 통과',
    failed: '실패 단계',
    warning: '경고 발생',
    passRate: '통과율',
    duration: '총 소요 시간',
    overview: '회귀 검증 개요',
    suiteLabel: '리포트 스위트',
    gateStatus: '릴리즈 게이트',
    blockedStatus: '배포 차단 여부',
    reviewStatus: '검토 필요 여부',
    started: '시작 시간',
    finished: '종료 시간',
    reason: '판정 결과 상세',
    guidance: '릴리즈 가이드라인',
    details: '단계별 검증 결과 목록',
    phase: '검증 단계',
    stepName: '시나리오명',
    policy: '검수 정책',
    runTime: '실행 시간',
    classification: '이슈 분류',
    note: '오류 스니펫 및 세부 로그',
    appendix: 'Phase별 합격 검수 기준 가이드',
    footer: '이 리포트는 WSOP Web Automation Regression Runner에 의해 자동 생성되었습니다.'
  } : {
    title: 'WSOP Phase 9 Full Regression Verification Report',
    subtitle: 'Release gate clearance status combining multiple regression suites and validation checks.',
    eyebrow: 'WSOP Phase 9 Regression',
    status: 'Gate Status',
    total: 'Total Steps',
    passed: 'Passed',
    failed: 'Failed',
    warning: 'Warning',
    passRate: 'Pass Rate',
    duration: 'Total Duration',
    overview: 'Execution Overview',
    suiteLabel: 'Suite',
    gateStatus: 'Gate Status',
    blockedStatus: 'Release Blocked',
    reviewStatus: 'Requires Review',
    started: 'Started',
    finished: 'Finished',
    reason: 'Reason',
    guidance: 'Release Guidance',
    details: 'Phase Results Details',
    phase: 'Phase',
    stepName: 'Step Name',
    policy: 'Policy',
    runTime: 'Duration',
    classification: 'Classification',
    note: 'Error Snippet / Note',
    appendix: 'Phase Verification Standards',
    footer: 'This report was automatically generated by the WSOP Web Automation Regression Runner.'
  };

  const passRate = summary.totalSteps ? Math.round((summary.passedSteps / summary.totalSteps) * 100) : 0;
  const statusClass = gateResult.passed ? (gateResult.requiresReview ? 'warn' : 'pass') : 'fail';
  const gateStatusLabel = gateResult.status;

  const rows = summary.stepResults.map((step) => {
    const errorLog = step.errorDetails || step.stderr || step.stdout || '';
    const errorBlock = errorLog ? `
      <div class="error-details-box" style="margin-top: 8px; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 6px; font-family: monospace; font-size: 11px; white-space: pre-wrap; color: #ffb4ad; max-height: 120px; overflow-y: auto; text-align: left;">
        ${escapeHtml(errorLog)}
      </div>
    ` : '';
    
    return `
      <tr>
        <td><strong>${escapeHtml(step.phase)}</strong></td>
        <td>
          <strong>${escapeHtml(step.name)}</strong><br>
          <span class="muted" style="font-size: 11px; font-family: monospace;">${escapeHtml(step.command)}</span>
        </td>
        <td><span class="policy-badge ${step.required ? 'required' : 'optional'}">${step.required ? 'Required' : 'Optional'}</span></td>
        <td><span class="badge ${escapeHtml(step.status)}">${escapeHtml(formatStepStatus(step.status))}</span></td>
        <td>${formatDuration(step.durationMs)}</td>
        <td><span class="muted">${escapeHtml(step.failureClassification || '-')}</span></td>
        <td style="max-width: 400px;">
          ${escapeHtml(compactSnippet(step.errorDetails || '', 120) || '-')}
          ${errorBlock}
        </td>
      </tr>
    `;
  }).join('');

  const releaseGuidanceList = [];
  if (gateResult.blocking) {
    releaseGuidanceList.push(isKo ? '릴리즈 게이트가 차단되었습니다. 필수(Required) 단계의 실패 원인을 먼저 해결해 주세요.' : 'Release gate is blocked. Fix required step failures first.');
  } else if (gateResult.requiresReview) {
    releaseGuidanceList.push(isKo ? '자동화 테스트는 패스했으나 검토 필요한 경고(Warning) 또는 옵션 실패 항목이 존재합니다. 승인 전 리뷰를 권장합니다.' : 'Release gate passed for CI, but review warnings or optional failures before human approval.');
  } else {
    releaseGuidanceList.push(isKo ? '릴리즈 게이트가 완벽히 통과되었습니다. 특이사항이 없습니다.' : 'Release gate passed without review items.');
  }
  releaseGuidanceList.push(isKo ? '시각적 회귀(Visual Baseline) 업데이트 명령어는 이 회귀 러너에 포함되어 있지 않으며 명시적 스크립트로 개별 검토 후 수행해야 합니다.' : 'Visual baseline updates are not run by this regression runner. Use the explicit baseline update scripts only after review.');

  return `<!doctype html>
<html lang="${isKo ? 'ko' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0d1117;
      --bg-card: #151b23;
      --bg-card-hover: #1f2733;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --border: #30363d;
      --primary: #d61f2c;
      --primary-hover: #f7c948;
      --success: #2ea043;
      --success-bg: rgba(46, 160, 67, 0.14);
      --danger: #f85149;
      --danger-bg: rgba(248, 81, 73, 0.14);
      --warning: #d29922;
      --warning-bg: rgba(210, 153, 34, 0.14);
      --info: #58a6ff;
      --shadow: 0 18px 45px rgba(0, 0, 0, 0.24);
      --card-border: 1px solid #30363d;
    }
    * { box-sizing: border-box; transition: background-color 0.2s, color 0.2s, border-color 0.2s, transform 0.2s; }
    body { margin: 0; background: var(--bg-main); color: var(--text-main); font-family: 'Inter', sans-serif; line-height: 1.5; padding-bottom: 60px; }
    h1, h2, h3, .eyebrow { font-family: 'Outfit', sans-serif; }
    header { background: linear-gradient(135deg, #080a0f 0%, #171b24 58%, #2b1016 100%); padding: 30px 40px; position: relative; overflow: hidden; border-bottom: var(--card-border); box-shadow: var(--shadow); }
    header::after { content: ''; position: absolute; inset: auto 0 0 0; height: 3px; background: linear-gradient(90deg, var(--primary), var(--primary-hover)); pointer-events: none; }
    .header-content { max-width: 1600px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 30px; flex-wrap: wrap; }
    .eyebrow { color: var(--primary-hover); font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
    .header-title h1 { margin: 0; font-size: 32px; font-weight: 800; color: var(--text-main); }
    .header-title p { margin: 8px 0 0; color: var(--text-muted); font-size: 14px; max-width: 800px; }
    
    .status-badge { display: inline-block; padding: 8px 20px; border-radius: 99px; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; text-align: center; }
    .status-badge.pass { background-color: var(--success-bg); color: var(--success); }
    .status-badge.fail { background-color: var(--danger-bg); color: var(--danger); }
    .status-badge.warn { background-color: var(--warning-bg); color: var(--warning); }

    main { max-width: 1600px; margin: 30px auto; padding: 0 30px; }
    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 45px; }
    .kpi-card { background: var(--bg-card); border-radius: 8px; padding: 25px; border: var(--card-border); box-shadow: var(--shadow); position: relative; overflow: hidden; }
    .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--primary); opacity: 0; transition: opacity 0.2s; }
    .kpi-card:hover { transform: translateY(-2px); border-color: var(--primary); }
    .kpi-card:hover::before { opacity: 1; }
    .kpi-card .kpi-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .kpi-card .kpi-value { font-size: 32px; font-weight: 800; margin-top: 10px; font-family: 'Outfit', sans-serif; }
    .kpi-card .kpi-value.pass { color: var(--success); }
    .kpi-card .kpi-value.warn { color: var(--warning); }
    .kpi-card .kpi-value.fail { color: var(--danger); }

    .grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 25px; margin-bottom: 40px; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
    .panel { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 40px; }
    .panel h2 { margin: 0; padding: 18px 24px; border-bottom: 1px solid var(--border); font-size: 18px; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 10px; }
    .panel-body { padding: 18px 20px; }
    
    .summary-line { display: flex; gap: 12px; flex-wrap: wrap; color: var(--text-muted); font-size: 14px; }
    .summary-line span { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 999px; padding: 7px 11px; }
    .bar { height: 14px; border-radius: 999px; overflow: hidden; background: #080b0f; border: 1px solid var(--border); display: flex; margin-top: 18px; }
    .bar-pass { background: var(--success); }
    .bar-fail { background: var(--danger); }
    .bar-warn { background: var(--warning); }
    
    .note { border-left: 4px solid var(--primary-hover); background: var(--warning-bg); padding: 12px 14px; border-radius: 8px; color: var(--text-main); }
    .note ul { margin: 0; padding-left: 20px; }
    
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: rgba(0, 0, 0, 0.2); color: var(--text-main); font-weight: 600; padding: 14px 18px; border-bottom: 1px solid var(--border); font-family: 'Outfit', sans-serif; }
    td { padding: 14px 18px; border-bottom: 1px solid var(--border); color: var(--text-main); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background-color: rgba(255, 255, 255, 0.015); }
    
    .badge { display: inline-block; border-radius: 99px; padding: 4px 12px; font-size: 11px; font-weight: 700; border: 1px solid currentColor; white-space: nowrap; text-transform: uppercase; }
    .badge.passed, .badge.minor { color: var(--success); background: var(--success-bg); }
    .badge.failed, .badge.optionalFailed { color: var(--danger); background: var(--danger-bg); }
    .badge.warning { color: var(--warning); background: var(--warning-bg); }
    .badge.skipped { color: var(--text-muted); background: rgba(255,255,255,0.06); }
    
    .policy-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .policy-badge.required { background: rgba(214, 31, 44, 0.15); color: #ff858d; border: 1px solid rgba(214, 31, 44, 0.3); }
    .policy-badge.optional { background: rgba(88, 166, 255, 0.15); color: #a5d6ff; border: 1px solid rgba(88, 166, 255, 0.3); }

    .muted { color: var(--text-muted); }
    footer { color: var(--text-muted); padding: 24px 0 40px; text-align: center; font-size: 13px; border-top: 1px solid var(--border); max-width: 1600px; margin: 0 auto; }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div class="header-title">
        <div class="eyebrow">${escapeHtml(t.eyebrow)}</div>
        <h1>${escapeHtml(t.title)}</h1>
        <p>${escapeHtml(t.subtitle)}</p>
      </div>
      <div>
        <span class="status-badge ${statusClass}">${escapeHtml(gateStatusLabel)}</span>
      </div>
    </div>
  </header>

  <main>
    <!-- KPIs -->
    <section class="dashboard-grid">
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.total)}</div>
        <div class="kpi-value">${summary.totalSteps}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.passed)}</div>
        <div class="kpi-value pass">${summary.passedSteps}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.failed)}</div>
        <div class="kpi-value ${summary.failedSteps ? 'fail' : ''}">${summary.failedSteps}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.warning)}</div>
        <div class="kpi-value ${summary.warningSteps ? 'warn' : ''}">${summary.warningSteps}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.passRate)}</div>
        <div class="kpi-value ${statusClass}">${passRate}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${escapeHtml(t.duration)}</div>
        <div class="kpi-value">${formatDuration(summary.durationMs)}</div>
      </div>
    </section>

    <!-- Overview and Guidance -->
    <section class="grid">
      <div class="panel">
        <h2>
          <svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
          ${escapeHtml(t.overview)}
        </h2>
        <div class="panel-body">
          <div class="summary-line">
            <span>${escapeHtml(t.suiteLabel)}: ${escapeHtml(summary.suiteName)} (${escapeHtml(summary.suiteKey)})</span>
            <span>${escapeHtml(t.gateStatus)}: ${escapeHtml(gateStatusLabel)}</span>
            <span>${escapeHtml(t.blockedStatus)}: ${gateResult.blocking ? 'YES' : 'NO'}</span>
            <span>${escapeHtml(t.reviewStatus)}: ${gateResult.requiresReview ? 'YES' : 'NO'}</span>
            <span>${escapeHtml(t.started)}: ${escapeHtml(formatKst(summary.startedAt))}</span>
            <span>${escapeHtml(t.finished)}: ${escapeHtml(formatKst(summary.finishedAt))}</span>
          </div>
          <div class="bar">
            <div class="bar-pass" style="width:${summary.totalSteps ? (summary.passedSteps / summary.totalSteps) * 100 : 0}%"></div>
            <div class="bar-fail" style="width:${summary.totalSteps ? ((summary.failedSteps + summary.optionalFailedSteps) / summary.totalSteps) * 100 : 0}%"></div>
            <div class="bar-warn" style="width:${summary.totalSteps ? (summary.warningSteps / summary.totalSteps) * 100 : 0}%"></div>
          </div>
          <div style="margin-top: 15px; font-size: 13px;">
            <strong>${escapeHtml(t.reason)}:</strong> <span class="muted">${escapeHtml(gateResult.reason)}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>
          <svg viewBox="0 0 24 24" style="fill: var(--warning); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          ${escapeHtml(t.guidance)}
        </h2>
        <div class="panel-body">
          <div class="note">
            <ul>
              ${releaseGuidanceList.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>
        <svg viewBox="0 0 24 24" style="fill: var(--primary-hover); width: 20px; height: 20px; flex-shrink: 0;"><path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z"/></svg>
        ${escapeHtml(isKo ? 'Regression Runner가 실행한 스텝' : 'Regression Runner Steps')}
      </h2>
      <div class="panel-body">
        <div class="note" style="margin-bottom:14px;">
          ${escapeHtml(isKo
            ? 'Phase 9는 브라우저 동작 하나를 직접 검증하는 리포트가 아니라, 선택한 suite에 포함된 Playwright Phase 명령들을 순서대로 실행하고 release gate 결과를 합산하는 리포트입니다.'
            : 'Phase 9 does not represent one browser action. It runs the Playwright phase commands included in the selected suite and aggregates release-gate status.')}
        </div>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(isKo ? '순서' : 'Step')}</th>
              <th>${escapeHtml(isKo ? 'Runner가 한 일' : 'Runner Action')}</th>
              <th>${escapeHtml(isKo ? '리포트에서 확인할 것' : 'What To Check')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>1</strong></td>
              <td>${escapeHtml(isKo ? '선택한 regression suite 설정을 읽습니다.' : 'Read the selected regression suite configuration.')}</td>
              <td>${escapeHtml(isKo ? 'suite 이름과 실행 대상 phase 목록을 확인합니다.' : 'Check suite name and included phase list.')}</td>
            </tr>
            <tr>
              <td><strong>2</strong></td>
              <td>${escapeHtml(isKo ? '각 step의 npm 명령이 package.json에 실제 존재하는지 확인합니다.' : 'Verify each npm command exists in package.json.')}</td>
              <td>${escapeHtml(isKo ? '없는 명령이나 baseline update 명령이 섞이지 않았는지 확인합니다.' : 'Check missing commands and blocked baseline-update commands.')}</td>
            </tr>
            <tr>
              <td><strong>3</strong></td>
              <td>${escapeHtml(isKo ? '필수/선택 정책에 따라 Phase 명령을 순서대로 실행합니다.' : 'Run phase commands in order according to required/optional policy.')}</td>
              <td>${escapeHtml(isKo ? '각 phase의 command, required 여부, 실행 시간을 확인합니다.' : 'Review command, required flag, and duration for each phase.')}</td>
            </tr>
            <tr>
              <td><strong>4</strong></td>
              <td>${escapeHtml(isKo ? '실패 로그를 known exception 정책으로 분류합니다.' : 'Classify failures using known-exception policy.')}</td>
              <td>${escapeHtml(isKo ? 'failed, warning, optionalFailed 중 무엇으로 처리됐는지 확인합니다.' : 'Check whether each result is failed, warning, or optionalFailed.')}</td>
            </tr>
            <tr>
              <td><strong>5</strong></td>
              <td>${escapeHtml(isKo ? 'release-gate-result.json을 생성합니다.' : 'Generate release-gate-result.json.')}</td>
              <td>${escapeHtml(isKo ? 'PASSED, REQUIRES_REVIEW, FAILED와 ci.shouldFailBuild 값을 확인합니다.' : 'Review PASSED, REQUIRES_REVIEW, FAILED, and ci.shouldFailBuild.')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Details Table -->
    <section class="panel">
      <h2>
        <svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
        ${escapeHtml(t.details)}
      </h2>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t.phase)}</th>
              <th>${escapeHtml(t.stepName)}</th>
              <th>${escapeHtml(t.policy)}</th>
              <th>${escapeHtml(t.status)}</th>
              <th>${escapeHtml(t.runTime)}</th>
              <th>${escapeHtml(t.classification)}</th>
              <th>${escapeHtml(t.note)}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Appendix Guide -->
    <section class="panel">
      <h2>
        <svg viewBox="0 0 24 24" style="fill: var(--info); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 11.9 12 12.5 12 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
        ${escapeHtml(t.appendix)}
      </h2>
      <div style="overflow-x: auto;">
        <table style="font-size: 12px;">
          <thead>
            <tr>
              <th style="width: 150px;">${escapeHtml(isKo ? 'Phase 단계' : 'Phase')}</th>
              <th style="width: 250px;">${escapeHtml(isKo ? 'Playwright 실행 행동' : 'Playwright Action')}</th>
              <th>${escapeHtml(isKo ? '리포트에서 확인할 기준' : 'What To Check')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Phase 1 (Smoke)</strong></td>
              <td>${escapeHtml(isKo ? '공개 URL을 열고 핵심 locator, 콘솔, 내부 링크 샘플을 확인' : 'Open public URLs and check key locators, console, and sampled links')}</td>
              <td>${escapeHtml(isKo ? '페이지 접근 실패, 치명 콘솔 오류, 깨진 내부 링크가 있는지 확인' : 'Check page access failures, critical console errors, and broken internal links')}</td>
            </tr>
            <tr>
              <td><strong>Phase 2 (Functional)</strong></td>
              <td>${escapeHtml(isKo ? 'Schedule/Search/Standings/News에서 클릭과 입력 흐름을 수행' : 'Run click and input flows across Schedule/Search/Standings/News')}</td>
              <td>${escapeHtml(isKo ? '어느 사용자 흐름에서 이동이 끊겼는지 확인' : 'Check which user flow breaks, if any')}</td>
            </tr>
            <tr>
              <td><strong>Phase 3 (Player UI)</strong></td>
              <td>${escapeHtml(isKo ? 'standings-only 대상자의 row, 프로필 링크, 국가/국기, 이미지 표시를 확인' : 'Check row, profile link, country/flag, and image display for standings-only targets')}</td>
              <td>${escapeHtml(isKo ? 'UI 표시 문제인지 환경 자산 warning인지 구분' : 'Separate UI display defects from environment asset warnings')}</td>
            </tr>
            <tr>
              <td><strong>Phase 4 (Search/Sort)</strong></td>
              <td>${escapeHtml(isKo ? '검색어 입력, 탭 전환, 필터, 정렬, pagination, Load More를 조작' : 'Operate search input, tabs, filters, sort, pagination, and Load More')}</td>
              <td>${escapeHtml(isKo ? '조작 후 목록이 멈추거나 깨지지 않는지 확인' : 'Check list remains usable and visually intact after interaction')}</td>
            </tr>
            <tr>
              <td><strong>Phase 5 (Result Detail)</strong></td>
              <td>${escapeHtml(isKo ? '프로필 Results row에서 Result 상세로 이동하고 프로필 백링크를 클릭' : 'Navigate from profile Results row to Result detail and back to profile')}</td>
              <td>${escapeHtml(isKo ? '라우팅 실패와 상세 row 미노출을 구분' : 'Separate routing failures from missing detail rows')}</td>
            </tr>
            <tr>
              <td><strong>Phase 6 (Data Integrity)</strong></td>
              <td>${escapeHtml(isKo ? '기준 데이터와 화면에서 읽은 값을 비교' : 'Compare expected data with values read from public UI')}</td>
              <td>${escapeHtml(isKo ? 'expected/actual 차이와 stale fixture 가능성을 확인' : 'Review expected/actual differences and stale fixture possibility')}</td>
            </tr>
            <tr>
              <td><strong>Phase 7 (Performance)</strong></td>
              <td>${escapeHtml(isKo ? '주요 페이지와 핵심 흐름을 실행하며 시간과 요청 상태를 측정' : 'Measure timing and request status while running key pages and flows')}</td>
              <td>${escapeHtml(isKo ? '느린 요청이 제품 경로인지 서드파티 경로인지 확인' : 'Check whether slow requests belong to product paths or third-party paths')}</td>
            </tr>
            <tr>
              <td><strong>Phase 8 (Visual)</strong></td>
              <td>${escapeHtml(isKo ? '대상 화면을 캡처하고 baseline screenshot과 비교' : 'Capture target pages and compare with baseline screenshots')}</td>
              <td>${escapeHtml(isKo ? '실제 화면 깨짐인지 의도된 UI 변경인지 확인' : 'Check whether differences are defects or intended UI changes')}</td>
            </tr>
            <tr>
              <td><strong>Phase 9 (Regression)</strong></td>
              <td>${escapeHtml(isKo ? '선택한 suite의 phase 명령을 순서대로 실행하고 결과를 집계' : 'Run configured phase commands in order and aggregate results')}</td>
              <td>${escapeHtml(isKo ? 'required 실패, warning, optional 실패, ci.shouldFailBuild 값을 확인' : 'Check required failures, warnings, optional failures, and ci.shouldFailBuild')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <footer>
    ${escapeHtml(t.footer)}
  </footer>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
