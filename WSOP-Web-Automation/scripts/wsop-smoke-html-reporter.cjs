const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTPUT_DIR = path.join(process.cwd(), 'automation', 'output');
const RUN_ID = process.env.WSOP_REPORT_RUN_ID || process.env.SMOKE_REPORT_RUN_ID || timestampForFile();
const REPORT_SUITE = normalizeReportSuite(process.env.WSOP_REPORT_SUITE) || 'smoke';
const REPORT_PREFIX = process.env.WSOP_REPORT_PREFIX || `wsop-public-${REPORT_SUITE}`;

class WsopSmokeHtmlReporter {
  constructor() {
    this.startedAt = new Date();
    this.config = null;
    this.results = [];
  }

  onBegin(config) {
    this.config = config;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  onTestEnd(test, result) {
    const titlePath = test.titlePath();
    const projectName = titlePath[1] || 'unknown';
    const file = path.relative(process.cwd(), test.location.file);
    const suiteTitle = titlePath.slice(3, -1).join(' > ') || path.basename(file);

    this.results.push({
      id: this.results.length + 1,
      projectName,
      file,
      suiteTitle,
      title: test.title,
      status: result.status,
      expectedStatus: test.expectedStatus,
      ok: result.status === test.expectedStatus,
      duration: result.duration,
      retry: result.retry,
      error: formatError(result.error),
      attachments: (result.attachments || []).map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        path: attachment.path ? path.relative(process.cwd(), attachment.path) : '',
        body: attachment.body && attachment.body.length <= 1_000_000 ? attachment.body.toString('utf8') : '',
      })),
    });
  }

  async onEnd(fullResult) {
    const report = {
      runId: RUN_ID,
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      duration: Date.now() - this.startedAt.getTime(),
      status: normalizeOverallStatus(fullResult.status, this.results),
      suite: REPORT_SUITE,
      reportPrefix: REPORT_PREFIX,
      baseURL: process.env.BASE_URL || 'https://www.wsop.com',
      playwrightHtmlReport: `automation/output/${REPORT_PREFIX}-${RUN_ID}-playwright-report/index.html`,
      node: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      projects: [...new Set(this.results.map((item) => item.projectName))],
      results: this.results,
    };

    report.summary = summarize(report);

    const jsonPath = path.join(OUTPUT_DIR, `${REPORT_PREFIX}-${RUN_ID}-report.json`);
    const htmlPath = path.join(OUTPUT_DIR, `${REPORT_PREFIX}-${RUN_ID}-report.html`);
    const koHtmlPath = path.join(OUTPUT_DIR, `${REPORT_PREFIX}-${RUN_ID}-report-ko.html`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, renderDashboard(report, false), 'utf8');
    fs.writeFileSync(koHtmlPath, renderDashboard(report, true), 'utf8');

    console.log(`WSOP ${REPORT_SUITE} report: ${htmlPath}`);
    console.log(`WSOP ${REPORT_SUITE} Korean report: ${koHtmlPath}`);
    console.log(`WSOP ${REPORT_SUITE} Playwright report: ${path.join(OUTPUT_DIR, `${REPORT_PREFIX}-${RUN_ID}-playwright-report`, 'index.html')}`);
  }
}

function summarize(report) {
  const total = report.results.length;
  const passed = report.results.filter((item) => item.status === 'passed').length;
  const failed = report.results.filter((item) => ['failed', 'timedOut', 'interrupted'].includes(item.status)).length;
  const skipped = report.results.filter((item) => item.status === 'skipped').length;
  const flaky = report.results.filter((item) => item.retry > 0 && item.status === 'passed').length;
  const totalDuration = report.results.reduce((sum, item) => sum + item.duration, 0);
  const passRate = total ? Math.round((passed / total) * 100) : 0;

  return {
    total,
    passed,
    failed,
    skipped,
    flaky,
    totalDuration,
    passRate,
    status: failed > 0 ? 'fail' : skipped > 0 ? 'warn' : 'pass',
  };
}

function normalizeOverallStatus(status, results) {
  if (results.some((item) => ['failed', 'timedOut', 'interrupted'].includes(item.status))) return 'failed';
  return status || 'passed';
}

function renderDashboard(report, isKo) {
  const t = dictionary(isKo, report.suite);
  const summary = report.summary;
  const failedTests = report.results.filter((item) => ['failed', 'timedOut', 'interrupted'].includes(item.status));
  const skippedTests = report.results.filter((item) => item.status === 'skipped');
  const bySuite = groupBy(report.results, (item) => item.suiteTitle);
  const statusClass = summary.status;
  const playerCoverage = collectPlayerPresentationCoverage(report);

  return `<!doctype html>
<html lang="${isKo ? 'ko' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t.title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #151b23;
      --surface-2: #1f2733;
      --text: #f0f6fc;
      --muted: #8b949e;
      --border: #30363d;
      --accent: #d61f2c;
      --accent-2: #f7c948;
      --pass: #2ea043;
      --warn: #d29922;
      --fail: #f85149;
      --info: #58a6ff;
      --shadow: 0 18px 45px rgba(0,0,0,.24);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: "Segoe UI", Arial, sans-serif; line-height: 1.55; }
    a { color: var(--info); text-decoration: none; }
    a:hover { text-decoration: underline; }
    header { border-bottom: 1px solid var(--border); background: linear-gradient(135deg, #080a0f 0%, #171b24 58%, #2b1016 100%); }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 28px; }
    .hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 24px; align-items: center; }
    .eyebrow { color: var(--accent-2); font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 6px 0 10px; font-size: clamp(28px, 4vw, 44px); line-height: 1.08; letter-spacing: 0; }
    .subtitle { margin: 0; color: var(--muted); max-width: 920px; }
    .status-pill { display:inline-flex; align-items:center; gap:8px; min-width: 130px; justify-content:center; padding: 12px 18px; border-radius: 999px; font-weight: 800; border: 1px solid currentColor; }
    .status-pill.pass { color: var(--pass); background: rgba(46,160,67,.12); }
    .status-pill.warn { color: var(--warn); background: rgba(210,153,34,.12); }
    .status-pill.fail { color: var(--fail); background: rgba(248,81,73,.12); }
    main.wrap { padding-top: 24px; }
    .kpis { display:grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 14px; margin: 0 0 24px; }
    .card, .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); }
    .card { padding: 18px; min-height: 112px; }
    .label { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .value { margin-top: 10px; font-size: 32px; font-weight: 850; }
    .value.pass { color: var(--pass); }
    .value.warn { color: var(--warn); }
    .value.fail { color: var(--fail); }
    .grid { display:grid; grid-template-columns: 1.15fr .85fr; gap: 18px; margin-bottom: 22px; }
    .panel { overflow: hidden; }
    .panel h2 { margin: 0; padding: 18px 20px; border-bottom: 1px solid var(--border); font-size: 18px; }
    .panel-summary { cursor:pointer; padding: 0; display:flex; align-items:center; justify-content:space-between; gap: 16px; border-bottom: 1px solid var(--border); }
    .panel-summary h2 { border-bottom: 0; }
    .panel-summary::-webkit-details-marker { display: none; }
    .panel-toggle-label { color: var(--muted); font-size: 14px; font-weight: 800; padding-right: 20px; transition: transform 0.2s ease; display: inline-block; }
    .collapsible-panel[open] .panel-toggle-label { transform: rotate(180deg); }
    .panel-body { padding: 18px 20px; }
    .summary-line { display:flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 14px; }
    .summary-line span { background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 7px 11px; }
    .bar { height: 14px; border-radius: 999px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border); display:flex; margin-top: 18px; }
    .bar-pass { background: var(--pass); }
    .bar-fail { background: var(--fail); }
    .bar-skip { background: var(--warn); }
    .note { border-left: 4px solid var(--accent-2); background: rgba(247,201,72,.08); padding: 12px 14px; border-radius: 8px; color: var(--text); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--border); text-align:left; vertical-align: top; }
    th { color: var(--muted); background: rgba(255,255,255,.025); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    tr:hover td { background: rgba(255,255,255,.018); }
    .badge { display:inline-block; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 800; border: 1px solid currentColor; white-space: nowrap; }
    .badge.passed { color: var(--pass); background: rgba(46,160,67,.10); }
    .badge.failed, .badge.timedOut, .badge.interrupted { color: var(--fail); background: rgba(248,81,73,.10); }
    .badge.skipped, .badge.warn { color: var(--warn); background: rgba(210,153,34,.10); }
    .muted { color: var(--muted); }
    .error { white-space: pre-wrap; max-width: 760px; color: #ffb4ad; }
    .attachments { display:flex; gap: 7px; flex-wrap: wrap; }
    .attachment { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; }
    .coverage-summary { display:grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
    .coverage-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .coverage-card .value { font-size: 24px; margin-top: 6px; }
    .category-strip { display:flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .category-pill { border: 1px solid var(--border); background: rgba(255,255,255,.03); border-radius: 999px; padding: 6px 10px; color: var(--muted); font-size: 12px; }
    .player-card-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .player-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; min-height: 184px; display:flex; flex-direction:column; gap: 10px; }
    .player-card.fail { border-color: rgba(248,81,73,.68); }
    .player-card.warn { border-color: rgba(210,153,34,.68); }
    .player-card.pass { border-color: rgba(46,160,67,.42); }
    .player-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; }
    .player-name { font-size: 16px; font-weight: 850; line-height: 1.25; }
    .player-meta { color: var(--muted); font-size: 12px; overflow-wrap:anywhere; }
    .check-grid { display:flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
    .check-pill { border-radius: 999px; padding: 4px 8px; border: 1px solid currentColor; font-size: 11px; font-weight: 800; }
    .check-pill.pass { color: var(--pass); background: rgba(46,160,67,.10); }
    .check-pill.fail { color: var(--fail); background: rgba(248,81,73,.10); }
    details { border-bottom: 1px solid var(--border); }
    details:last-child { border-bottom: 0; }
    details summary::-webkit-details-marker { display: none; }
    details summary { list-style: none; }
    summary { cursor:pointer; padding: 15px 20px; font-weight: 800; display:flex; justify-content:space-between; align-items:center; gap: 16px; }
    details[open] summary { background: rgba(255,255,255,.035); border-bottom: 1px solid var(--border); }
    .suite-summary-left { display: flex; align-items: center; gap: 12px; }
    .suite-toggle-icon { color: var(--muted); font-size: 14px; transition: transform 0.2s ease; display: inline-block; }
    details[open] .suite-toggle-icon { transform: rotate(180deg); }
    .suite-body { padding: 12px 20px 18px; }
    footer { color: var(--muted); padding: 24px 0 40px; }
    @media (max-width: 980px) {
      .hero, .grid { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .coverage-summary, .player-card-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 560px) {
      .wrap { padding: 20px; }
      .kpis { grid-template-columns: 1fr; }
      .coverage-summary, .player-card-grid { grid-template-columns: 1fr; }
      th, td { padding: 9px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap hero">
      <div>
        <div class="eyebrow">${escapeHtml(`WSOP WEB ${report.suite.toUpperCase()}`)}</div>
        <h1>${escapeHtml(t.title)}</h1>
        <p class="subtitle">${escapeHtml(t.subtitle)}</p>
      </div>
      <div class="status-pill ${statusClass}">${escapeHtml(formatOverallStatus(summary.status, isKo))}</div>
    </div>
  </header>

  <main class="wrap">
    <section class="kpis">
      ${kpi(t.total, summary.total)}
      ${kpi(t.passed, summary.passed, 'pass')}
      ${kpi(t.failed, summary.failed, summary.failed ? 'fail' : '')}
      ${kpi(t.skipped, summary.skipped, summary.skipped ? 'warn' : '')}
      ${kpi(t.passRate, `${summary.passRate}%`, summary.failed ? 'fail' : summary.skipped ? 'warn' : 'pass')}
      ${kpi(t.duration, formatDuration(summary.totalDuration))}
    </section>

    <section class="grid">
      <div class="panel">
        <h2>${escapeHtml(t.executionSummary)}</h2>
        <div class="panel-body">
          <div class="summary-line">
            <span>${escapeHtml(t.baseUrl)}: <a href="${escapeHtml(report.baseURL)}">${escapeHtml(report.baseURL)}</a></span>
            <span>${escapeHtml(t.projects)}: ${escapeHtml(report.projects.join(', ') || '-')}</span>
            <span>${escapeHtml(t.generated)}: ${escapeHtml(formatDate(report.generatedAt))}</span>
            <span>${escapeHtml(t.suiteLabel)}: ${escapeHtml(report.suite)}</span>
            <span>Run ID: ${escapeHtml(report.runId)}</span>
          </div>
          <div class="bar" aria-label="${escapeHtml(t.statusDistribution)}">
            <div class="bar-pass" style="width:${percent(summary.passed, summary.total)}%"></div>
            <div class="bar-fail" style="width:${percent(summary.failed, summary.total)}%"></div>
            <div class="bar-skip" style="width:${percent(summary.skipped, summary.total)}%"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>${escapeHtml(t.readMeFirst)}</h2>
        <div class="panel-body">
          <div class="note">${escapeHtml(readMeFirst(report, isKo))}</div>
        </div>
      </div>
    </section>

    ${failedTests.length ? renderFailurePanel(failedTests, t) : renderEmptyPanel(t.noCriticalFailuresTitle, t.noCriticalFailuresBody)}
    ${skippedTests.length ? renderSkippedPanel(skippedTests, t) : ''}
    ${playerCoverage ? renderPlayerPresentationCoverage(playerCoverage, t) : ''}

    <section class="panel">
      <h2>${escapeHtml(t.suiteDirectory)}</h2>
      ${[...bySuite.entries()].map(([suite, items]) => renderSuite(suite, items, t)).join('')}
    </section>

    <details class="panel collapsible-panel" open>
      <summary class="panel-summary">
        <h2>${escapeHtml(t.allTests)}</h2>
        <span class="panel-toggle-label" aria-hidden="true">▼</span>
      </summary>
      <div class="table-container">
        ${renderResultsTable(report.results, t)}
      </div>
    </details>

    <section class="panel">
      <h2>${escapeHtml(t.artifacts)}</h2>
      <div class="panel-body summary-line">
        <span>${escapeHtml(t.playwrightReport)}: <a href="${escapeHtml(`${report.reportPrefix}-${report.runId}-playwright-report/index.html`)}">${escapeHtml(report.playwrightHtmlReport)}</a></span>
        <span>Node: ${escapeHtml(report.node)}</span>
        <span>${escapeHtml(t.platform)}: ${escapeHtml(report.platform)}</span>
      </div>
    </section>
  </main>

  <footer class="wrap">${escapeHtml(t.footer)}</footer>
</body>
</html>`;
}

function dictionary(isKo) {
  return isKo ? {
    title: 'WSOP Web 자동화 리포트',
    subtitle: '공개 페이지 접근, 핵심 콘텐츠, 상단 네비게이션, 콘솔 오류, 내부 링크 샘플을 빠르게 확인한 결과입니다.',
    total: '전체 테스트',
    passed: '통과',
    failed: '실패',
    skipped: '건너뜀',
    passRate: '통과율',
    duration: '총 실행 시간',
    executionSummary: '실행 요약',
    baseUrl: '대상 사이트',
    projects: '브라우저 프로젝트',
    generated: '생성 시간',
    suiteLabel: '리포트 구분',
    statusDistribution: '상태 분포',
    readMeFirst: '먼저 볼 내용',
    noCriticalFailuresTitle: '치명 실패 없음',
    noCriticalFailuresBody: '현재 실행에서 실패 또는 타임아웃 테스트가 없습니다. 건너뜀 항목이 있다면 실제 사이트 메뉴 구조와 테스트 기준을 확인하세요.',
    failures: '실패 상세',
    skippedTests: '건너뜀 항목',
    suiteDirectory: '검증 영역별 목록',
    allTests: '전체 테스트 목록',
    artifacts: '산출물 및 환경',
    playwrightReport: 'Playwright 기본 HTML 리포트',
    platform: '실행 환경',
    footer: '이 리포트는 Playwright 실행 결과에서 자동 생성되었습니다. 링크 검증은 외부 사이트 부하를 줄이기 위해 페이지별 제한된 샘플만 확인합니다.',
    testName: '테스트명',
    suite: '검증 영역',
    project: '프로젝트',
    status: '상태',
    time: '시간',
    file: '파일',
    detail: '상세',
    attachment: '첨부',
  } : {
    title: 'WSOP Web Automation Report',
    subtitle: 'A public web check for page access, core content, top navigation, console errors, and sampled internal links.',
    total: 'Total Tests',
    passed: 'Passed',
    failed: 'Failed',
    skipped: 'Skipped',
    passRate: 'Pass Rate',
    duration: 'Total Duration',
    executionSummary: 'Execution Summary',
    baseUrl: 'Base URL',
    projects: 'Browser Projects',
    generated: 'Generated',
    suiteLabel: 'Report Suite',
    statusDistribution: 'Status Distribution',
    readMeFirst: 'Read Me First',
    noCriticalFailuresTitle: 'No Critical Failures',
    noCriticalFailuresBody: 'No failed or timed out tests were found in this run. Review skipped tests if the live site navigation differs from the test target.',
    failures: 'Failure Details',
    skippedTests: 'Skipped Tests',
    suiteDirectory: 'Validation Area Directory',
    allTests: 'All Tests',
    artifacts: 'Artifacts & Environment',
    playwrightReport: 'Playwright HTML Report',
    platform: 'Platform',
    footer: 'This report was generated from Playwright results. Link checks intentionally inspect a limited sample per page to avoid excessive traffic.',
    testName: 'Test Name',
    suite: 'Area',
    project: 'Project',
    status: 'Status',
    time: 'Time',
    file: 'File',
    detail: 'Detail',
    attachment: 'Attachment',
  };
}

function readMeFirst(report, isKo) {
  if (report.summary.failed > 0) {
    return isKo
      ? '실패 항목이 있습니다. 아래 실패 상세에서 오류 메시지와 screenshot, trace, video 첨부를 먼저 확인하세요.'
      : 'There are failed checks. Start with the failure details below and review screenshot, trace, and video attachments.';
  }
  if (report.summary.skipped > 0) {
    return isKo
      ? '치명 실패는 없지만 건너뜀 항목이 있습니다. 현재 wsop.com의 일부 상단 메뉴는 클릭 가능한 내부 링크를 노출하지 않아 smoke 기준에서 제외했습니다.'
      : 'No critical failures were found, but some checks were skipped because the current wsop.com top navigation does not expose a clickable internal link for that target.';
  }
  return isKo
    ? '모든 smoke 검증이 통과했습니다. 상세한 브라우저 실행 기록은 Playwright 기본 HTML 리포트에서 확인할 수 있습니다.'
    : 'All smoke checks passed. Browser-level run details are available in the Playwright HTML report.';
}

function renderFailurePanel(items, t) {
  return `<section class="panel">
    <h2>${escapeHtml(t.failures)}</h2>
    ${renderResultsTable(items, t, true)}
  </section>`;
}

function renderSkippedPanel(items, t) {
  return `<section class="panel">
    <h2>${escapeHtml(t.skippedTests)}</h2>
    ${renderResultsTable(items, t)}
  </section>`;
}

function renderEmptyPanel(title, body) {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2><div class="panel-body"><div class="note">${escapeHtml(body)}</div></div></section>`;
}

function renderSuite(suite, items, t) {
  const failed = items.filter((item) => ['failed', 'timedOut', 'interrupted'].includes(item.status)).length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const status = failed ? 'failed' : skipped ? 'skipped' : 'passed';
  return `<details open>
    <summary>
      <div class="suite-summary-left">
        <span>${escapeHtml(suite)}</span>
        <span><span class="badge ${status}">${escapeHtml(status)}</span> <span class="muted">${items.length} tests</span></span>
      </div>
      <span class="suite-toggle-icon" aria-hidden="true">▼</span>
    </summary>
    <div class="suite-body">${renderResultsTable(items, t)}</div>
  </details>`;
}

function renderResultsTable(items, t, includeErrors = false) {
  return `<table>
    <thead>
      <tr>
        <th>${escapeHtml(t.status)}</th>
        <th>${escapeHtml(t.testName)}</th>
        <th>${escapeHtml(t.project)}</th>
        <th>${escapeHtml(t.time)}</th>
        <th>${escapeHtml(t.file)}</th>
        ${includeErrors ? `<th>${escapeHtml(t.detail)}</th>` : ''}
        <th>${escapeHtml(t.attachment)}</th>
      </tr>
    </thead>
    <tbody>
      ${items.map((item) => `<tr>
        <td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.suiteTitle)}</span></td>
        <td>${escapeHtml(item.projectName)}</td>
        <td>${escapeHtml(formatDuration(item.duration))}</td>
        <td><span class="muted">${escapeHtml(item.file)}</span></td>
        ${includeErrors ? `<td class="error">${escapeHtml(item.error || '-')}</td>` : ''}
        <td>${renderAttachments(item.attachments)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderAttachments(attachments) {
  if (!attachments || attachments.length === 0) return '<span class="muted">-</span>';
  return `<div class="attachments">${attachments.map((item) => {
    if (!item.path) return `<span class="attachment">${escapeHtml(item.name)}</span>`;
    return `<a class="attachment" href="../../${escapeHtml(item.path)}">${escapeHtml(item.name)}</a>`;
  }).join('')}</div>`;
}

function renderPlayerPresentationCoverage(coverage, t) {
  return `<section class="panel">
    <h2>${escapeHtml(t.playerCoverageTitle)}</h2>
    <div class="panel-body">
      <div class="note">${escapeHtml(t.playerCoverageNote)}</div>
      <div class="coverage-summary" style="margin-top:18px">
        ${coverageCard(t.coverageTotal, coverage.total)}
        ${coverageCard(t.coveragePassed, coverage.passed, 'pass')}
        ${coverageCard(t.coverageWarned, coverage.warned, coverage.warned ? 'warn' : '')}
        ${coverageCard(t.coverageFailed, coverage.failed, coverage.failed ? 'fail' : '')}
        ${coverageCard(t.coverageCategories, coverage.categories.length)}
      </div>
      <div class="category-strip">
        ${coverage.categories.map((category) => `<span class="category-pill">${escapeHtml(category.name)}: ${escapeHtml(category.total)} (${escapeHtml(category.passed)}/${escapeHtml(category.warned)}/${escapeHtml(category.failed)})</span>`).join('')}
      </div>
      <div class="player-card-grid">
        ${coverage.players.map((player) => renderCoveragePlayerCard(player, t)).join('')}
      </div>
    </div>
  </section>`;
}

function renderCoveragePlayerCard(player, t) {
  const rank = player.rank == null ? '-' : `#${player.rank}`;
  const profileText = player.actualProfileUrl || player.expectedProfileUrl || '';
  const profileHref = toWsopUrl(profileText || player.expectedProfileUrl);

  return `<article class="player-card ${escapeHtml(player.status)}">
    <div class="player-card-top">
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-meta">${escapeHtml(player.category)} ${escapeHtml(rank)}</div>
      </div>
      <span class="badge ${escapeHtml(player.status)}">${escapeHtml(formatCoverageStatus(player.status, t))}</span>
    </div>
    <div class="player-meta">${escapeHtml(t.coverageSource)}: ${escapeHtml(player.sourcePath || '-')}</div>
    <div class="player-meta">${escapeHtml(t.coverageProfile)}: ${profileText ? `<a href="${escapeHtml(profileHref)}">${escapeHtml(profileText)}</a>` : '-'}</div>
    <div class="check-grid">
      ${checkPill(t.coverageRow, player.checks.row)}
      ${checkPill(t.coverageName, player.checks.name)}
      ${checkPill(t.coverageProfileLink, player.checks.profileLink)}
      ${checkPill(t.coverageCountryFlag, player.checks.countryOrFlag)}
      ${checkPill(t.coverageImage, player.checks.playerImage)}
    </div>
  </article>`;
}

function collectPlayerPresentationCoverage(report) {
  if (report.suite !== 'player-presentation') {
    return null;
  }

  const byKey = new Map();
  for (const result of report.results) {
    for (const attachment of result.attachments || []) {
      if (attachment.name !== 'player-presentation-crawler-coverage') {
        continue;
      }

      const payloadText = attachment.body || readAttachmentBody(attachment);
      if (!payloadText) {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText);
        for (const player of payload.players || []) {
          const key = `${player.sourcePath}|${player.rank}|${player.name}|${player.expectedProfileUrl}`;
          byKey.set(key, player);
        }
      } catch {
        // Keep the report renderable even if a single attachment is malformed.
      }
    }
  }

  const players = [...byKey.values()].sort((a, b) => {
    const categoryCompare = String(a.category || '').localeCompare(String(b.category || ''));
    if (categoryCompare !== 0) return categoryCompare;
    return (a.rank ?? 9999) - (b.rank ?? 9999);
  });

  if (players.length === 0) {
    return null;
  }

  const categoryMap = new Map();
  for (const player of players) {
    const name = player.category || 'Standings';
    const current = categoryMap.get(name) || { name, total: 0, passed: 0, warned: 0, failed: 0 };
    current.total += 1;
    if (player.status === 'pass') current.passed += 1;
    if (player.status === 'warn') current.warned += 1;
    if (player.status === 'fail') current.failed += 1;
    categoryMap.set(name, current);
  }

  return {
    total: players.length,
    passed: players.filter((player) => player.status === 'pass').length,
    warned: players.filter((player) => player.status === 'warn').length,
    failed: players.filter((player) => player.status === 'fail').length,
    categories: [...categoryMap.values()],
    players,
  };
}

function readAttachmentBody(attachment) {
  if (!attachment.path || !/json/i.test(attachment.contentType || '')) {
    return '';
  }

  const filePath = path.resolve(process.cwd(), attachment.path);
  if (!fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf8');
}

function toWsopUrl(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value, 'https://www.wsop.com').toString();
  } catch {
    return value;
  }
}

function coverageCard(label, value, tone = '') {
  return `<div class="coverage-card"><div class="label">${escapeHtml(label)}</div><div class="value ${tone}">${escapeHtml(String(value))}</div></div>`;
}

function checkPill(label, ok) {
  const tone = ok ? 'pass' : 'fail';
  const mark = ok ? 'OK' : 'MISS';
  return `<span class="check-pill ${tone}">${escapeHtml(label)} ${mark}</span>`;
}

function formatCoverageStatus(status, t) {
  if (status === 'pass') return t.coverageStatusPass;
  if (status === 'warn') return t.coverageStatusWarn;
  return t.coverageStatusFail;
}

function kpi(label, value, tone = '') {
  return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value ${tone}">${escapeHtml(String(value))}</div></div>`;
}

function groupBy(values, getKey) {
  const groups = new Map();
  for (const value of values) {
    const key = getKey(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatOverallStatus(status, isKo) {
  if (status === 'pass') return isKo ? '통과' : 'PASS';
  if (status === 'warn') return isKo ? '주의' : 'WARN';
  return isKo ? '실패' : 'FAIL';
}

function formatError(error) {
  if (!error) return '';
  return [error.message, error.stack].filter(Boolean).join('\n');
}

function timestampForFile() {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-',
    pad(now.getMilliseconds(), 3),
  ].join('');
}

function normalizeReportSuite(value) {
  if (!value) {
    return '';
  }

  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

dictionary = function dictionaryOverride(isKo, suite = '') {
  const isSmoke = suite === 'smoke';
  const isFunctional = suite === 'functional';
  const isPlayerPresentation = suite === 'player-presentation';

  let titleKo = 'WSOP Web 자동화 리포트';
  let titleEn = 'WSOP Web Automation Report';
  let subtitleKo = '공개 페이지 접근, 핵심 콘텐츠, 상단 네비게이션, 콘솔 오류, 내부 링크 샘플을 빠르게 확인한 결과입니다.';
  let subtitleEn = 'A public web check for page access, core content, top navigation, console errors, and sampled internal links.';

  if (isSmoke) {
    titleKo = 'WSOP Phase 1 Smoke 검증 리포트';
    titleEn = 'WSOP Phase 1 Smoke Verification Report';
    subtitleKo = '배포 후 주요 공개 페이지 접근성, 핵심 콘텐츠, 콘솔 에러 등을 신속히 검증한 리포트입니다.';
    subtitleEn = 'A quick verification of public page accessibility, core content, and console errors after deployment.';
  } else if (isFunctional) {
    titleKo = 'WSOP Phase 2 Functional Flow 검증 리포트';
    titleEn = 'WSOP Phase 2 Functional Flow Verification Report';
    subtitleKo = '사용자가 웹사이트에서 주로 탐색하는 Schedule, Search, Standings, News 등의 기능 흐름 검증 결과입니다.';
    subtitleEn = 'Exploration flow verification results for key user paths such as Schedule, Search, Standings, and News.';
  } else if (isPlayerPresentation) {
    titleKo = 'WSOP Phase 3 플레이어 표현 검증 리포트';
    titleEn = 'WSOP Phase 3 Player Presentation Verification Report';
    subtitleKo = '크롤러가 수집한 standings TOP 대상자를 기준으로 공개 화면의 이름, 프로필 링크, 국가/국기, 이미지 표현 상태를 확인한 결과입니다.';
    subtitleEn = 'A public UI presentation check for crawler-targeted standings players: name, profile link, country/flag, and image candidates.';
  }

  return isKo
    ? {
        title: titleKo,
        subtitle: subtitleKo,
        total: '전체 테스트',
        passed: '통과',
        failed: '실패',
        skipped: '건너뜀',
        passRate: '통과율',
        duration: '총 실행 시간',
        executionSummary: '실행 요약',
        baseUrl: '대상 사이트',
        projects: '브라우저 프로젝트',
        generated: '생성 시간',
        suiteLabel: '리포트 구분',
        statusDistribution: '상태 분포',
        readMeFirst: '먼저 볼 내용',
        noCriticalFailuresTitle: '치명 실패 없음',
        noCriticalFailuresBody: '이번 실행에서 실패 또는 타임아웃 테스트가 없습니다. warning 항목은 환경 차이 또는 선택 검증 여부를 함께 확인하세요.',
        failures: '실패 상세',
        skippedTests: '건너뜀 항목',
        suiteDirectory: '검증 영역별 목록',
        allTests: '전체 테스트 목록',
        artifacts: '산출물 및 환경',
        playwrightReport: 'Playwright 기본 HTML 리포트',
        platform: '실행 환경',
        footer: '이 리포트는 Playwright 실행 결과에서 자동 생성되었습니다. 외부 사이트 부하를 줄이기 위해 검증 범위는 단계별 샘플과 크롤러 대상자로 제한됩니다.',
        testName: '테스트명',
        suite: '검증 영역',
        project: '프로젝트',
        status: '상태',
        time: '시간',
        file: '파일',
        detail: '상세',
        attachment: '첨부',
        playerCoverageTitle: '크롤러 대상 플레이어 UI 커버리지',
        playerCoverageNote: '스탠딩 크롤러의 최신 output에 포함된 대상자와 같은 인원을 기준으로 공개 UI의 이름, 프로필 링크, 국가/국기, 이미지 후보를 확인합니다. 이미지는 stage/prod asset 차이로 warning이 될 수 있습니다.',
        coverageTotal: '대상 행',
        coveragePassed: '정상',
        coverageWarned: '주의',
        coverageFailed: '실패',
        coverageCategories: '카테고리',
        coverageSource: '출처',
        coverageProfile: '프로필',
        coverageRow: '행',
        coverageName: '이름',
        coverageProfileLink: '링크',
        coverageCountryFlag: '국가/국기',
        coverageImage: '이미지',
        coverageStatusPass: '정상',
        coverageStatusWarn: '주의',
        coverageStatusFail: '실패',
      }
    : {
        title: titleEn,
        subtitle: subtitleEn,
        total: 'Total Tests',
        passed: 'Passed',
        failed: 'Failed',
        skipped: 'Skipped',
        passRate: 'Pass Rate',
        duration: 'Total Duration',
        executionSummary: 'Execution Summary',
        baseUrl: 'Base URL',
        projects: 'Browser Projects',
        generated: 'Generated',
        suiteLabel: 'Report Suite',
        statusDistribution: 'Status Distribution',
        readMeFirst: 'Read Me First',
        noCriticalFailuresTitle: 'No Critical Failures',
        noCriticalFailuresBody: 'No failed or timed out tests were found in this run. Review warning items for environment differences or optional checks.',
        failures: 'Failure Details',
        skippedTests: 'Skipped Tests',
        suiteDirectory: 'Validation Area Directory',
        allTests: 'All Tests',
        artifacts: 'Artifacts & Environment',
        playwrightReport: 'Playwright HTML Report',
        platform: 'Platform',
        footer: 'This report was generated from Playwright results. External-site checks intentionally use phase samples and crawler-targeted players to avoid excessive traffic.',
        testName: 'Test Name',
        suite: 'Area',
        project: 'Project',
        status: 'Status',
        time: 'Time',
        file: 'File',
        detail: 'Detail',
        attachment: 'Attachment',
        playerCoverageTitle: 'Crawler Target Player UI Coverage',
        playerCoverageNote: 'Uses the same target players from the latest standings crawler output and checks public UI presentation for name, profile link, country/flag, and image candidates.',
        coverageTotal: 'Target Rows',
        coveragePassed: 'Pass',
        coverageWarned: 'Warn',
        coverageFailed: 'Fail',
        coverageCategories: 'Categories',
        coverageSource: 'Source',
        coverageProfile: 'Profile',
        coverageRow: 'Row',
        coverageName: 'Name',
        coverageProfileLink: 'Link',
        coverageCountryFlag: 'Country/Flag',
        coverageImage: 'Image',
        coverageStatusPass: 'PASS',
        coverageStatusWarn: 'WARN',
        coverageStatusFail: 'FAIL',
      };
};

readMeFirst = function readMeFirstOverride(report, isKo) {
  if (report.summary.failed > 0) {
    return isKo
      ? '실패 항목이 있습니다. 아래 실패 상세에서 오류 메시지와 screenshot, trace, video 첨부를 먼저 확인하세요.'
      : 'There are failed checks. Start with the failure details below and review screenshot, trace, and video attachments.';
  }
  if (report.summary.skipped > 0) {
    return isKo
      ? '치명 실패는 없지만 건너뜀 항목이 있습니다. 현재 사이트 구조 또는 테스트 기준과 맞지 않는 항목인지 확인하세요.'
      : 'No critical failures were found, but some checks were skipped. Review whether the current site structure differs from the test target.';
  }
  if (report.suite === 'player-presentation') {
    return isKo
      ? 'Phase 3는 수치 정합성이 아니라 공개 화면에서 플레이어가 올바르게 식별되고 표현되는지 확인합니다. 이미지/마크 일부는 환경 차이에 따라 warning으로 분류될 수 있습니다.'
      : 'Phase 3 checks public player identity presentation, not numeric data integrity. Some image or mark differences may be warning-only depending on environment.';
  }
  return isKo
    ? '모든 검증이 통과했습니다. 브라우저 실행 상세는 Playwright 기본 HTML 리포트에서 확인할 수 있습니다.'
    : 'All checks passed. Browser-level run details are available in the Playwright HTML report.';
};

formatOverallStatus = function formatOverallStatusOverride(status, isKo) {
  if (status === 'pass') return isKo ? '통과' : 'PASS';
  if (status === 'warn') return isKo ? '주의' : 'WARN';
  return isKo ? '실패' : 'FAIL';
};

module.exports = WsopSmokeHtmlReporter;
