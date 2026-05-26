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
        href: '',
        copiedPath: '',
        missing: false,
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
    materializeAttachmentFiles(report);

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

  const playerCoverage = collectPlayerPresentationCoverage(report);
  let status = 'pass';
  if (failed > 0 || (playerCoverage && playerCoverage.failed > 0)) {
    status = 'fail';
  } else if (skipped > 0 || (playerCoverage && playerCoverage.warned > 0)) {
    status = 'warn';
  }

  return {
    total,
    passed,
    failed,
    skipped,
    flaky,
    totalDuration,
    passRate,
    status,
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-main: #0d1117;
      --bg-card: #151b23;
      --bg-card-hover: #1f2733;
      --bg-input: #080b0f;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --border: #30363d;
      --primary: #d61f2c;
      --primary-rgb: 214, 31, 44;
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
    a { color: var(--info); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; color: var(--primary-hover); }
    
    header { background: linear-gradient(135deg, #080a0f 0%, #171b24 58%, #2b1016 100%); padding: 30px 40px; position: relative; overflow: hidden; border-bottom: var(--card-border); box-shadow: var(--shadow); }
    header::after { content: ''; position: absolute; inset: auto 0 0 0; height: 3px; background: linear-gradient(90deg, var(--primary), var(--primary-hover)); pointer-events: none; }
    
    .header-content { max-width: 1600px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 30px; flex-wrap: wrap; }
    .eyebrow { color: var(--primary-hover); font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 4px; }
    .header-title h1 { margin: 0; font-family: 'Outfit', sans-serif; font-size: 32px; font-weight: 800; letter-spacing: 0; color: var(--text-main); }
    .header-title p { margin: 8px 0 0; color: var(--text-muted); font-size: 14px; }
    .header-actions { display: flex; align-items: center; gap: 15px; }

    main { max-width: 1600px; margin: 30px auto; padding: 0 30px; }

    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 45px; }
    .kpi-card { background: var(--bg-card); border-radius: 8px; padding: 25px; border: var(--card-border); box-shadow: var(--shadow); cursor: pointer; position: relative; overflow: hidden; }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 15px 30px -10px rgba(0,0,0,0.3); border-color: var(--primary); }
    .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--primary); opacity: 0; transition: opacity 0.2s; }
    .kpi-card:hover::before { opacity: 1; }
    .kpi-card .kpi-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
    .kpi-card .kpi-value { font-size: 32px; font-weight: 800; margin-top: 10px; font-family: 'Outfit', sans-serif; }
    .kpi-card .kpi-value.pass { color: var(--success); }
    .kpi-card .kpi-value.warn { color: var(--warning); }
    .kpi-card .kpi-value.fail { color: var(--danger); }

    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
    .status-badge.pass { background-color: var(--success-bg); color: var(--success); }
    .status-badge.fail { background-color: var(--danger-bg); color: var(--danger); }
    .status-badge.warn { background-color: var(--warning-bg); color: var(--warning); }
    .status-badge.pending { background-color: rgba(255,255,255,0.06); color: var(--text-muted); }
    .header-actions .status-badge { font-size: 14px; padding: 8px 20px; font-weight: 800; letter-spacing: 1px; }

    .visualizations-row { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 45px; }
    @media (max-width: 1024px) {
      .visualizations-row { grid-template-columns: 1fr; }
    }
    .chart-panel { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); padding: 25px; display: flex; flex-direction: column; }
    .chart-panel h3 { font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 700; margin: 0 0 20px; color: var(--text-main); border-left: 4px solid var(--primary); padding-left: 10px; }
    .chart-wrapper { position: relative; flex: 1; min-height: 250px; display: flex; align-items: center; justify-content: center; }

    .radial-chart-fallback { position: relative; width: 140px; height: 140px; }
    .radial-chart-fallback svg { transform: rotate(-90deg); width: 140px; height: 140px; }
    .radial-chart-fallback circle { fill: none; stroke-width: 10; }
    .radial-chart-fallback circle.bg { stroke: var(--border); }
    .radial-chart-fallback circle.fg { stroke: var(--success); stroke-linecap: round; transition: stroke-dashoffset 0.8s ease-in-out; }
    .radial-chart-fallback .percentage { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 800; }

    .grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 25px; margin-bottom: 40px; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }

    .panel { background: var(--bg-card); border-radius: 8px; border: var(--card-border); box-shadow: var(--shadow); overflow: hidden; margin-bottom: 40px; }
    .panel h2 { margin: 0; padding: 18px 24px; border-bottom: 1px solid var(--border); font-size: 18px; font-family: 'Outfit', sans-serif; display: flex; align-items: center; gap: 10px; }
    
    .panel-summary { cursor: pointer; padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); background: var(--bg-card); }
    .panel-summary h2 { border-bottom: 0; padding: 0; margin: 0; font-size: 18px; font-weight: 700; line-height: 1.2; display: flex; align-items: center; gap: 10px; }
    .panel-summary::-webkit-details-marker { display: none; }
    
    .panel-body { padding: 18px 20px; }
    .summary-line { display: flex; gap: 12px; flex-wrap: wrap; color: var(--text-muted); font-size: 14px; }
    .summary-line span { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 999px; padding: 7px 11px; }
    
    .bar { height: 14px; border-radius: 999px; overflow: hidden; background: var(--bg-input); border: 1px solid var(--border); display: flex; margin-top: 18px; }
    .bar-pass { background: var(--success); }
    .bar-fail { background: var(--danger); }
    .bar-skip { background: var(--warning); }
    
    .note { border-left: 4px solid var(--primary-hover); background: var(--warning-bg); padding: 12px 14px; border-radius: 8px; color: var(--text-main); }
    .filter-bar-panel { padding: 12px 20px !important; }
    .filter-controls { display: flex; gap: 15px; align-items: center; }
    .filter-group { display: flex; gap: 6px; background: var(--bg-card-hover); border: 1px solid var(--border); padding: 4px; border-radius: 8px; }
    .filter-btn { background: transparent; border: none; color: var(--text-muted); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; outline: none; }
    .filter-btn:hover { color: var(--text-main); }
    .filter-btn.active { background: var(--primary); color: white; }

    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; margin-top: 15px; }
    th { background: rgba(0, 0, 0, 0.2); color: var(--text-main); font-weight: 600; padding: 14px 18px; border-bottom: 1px solid var(--border); font-family: 'Outfit', sans-serif; }
    td { padding: 14px 18px; border-bottom: 1px solid var(--border); color: var(--text-main); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background-color: rgba(255, 255, 255, 0.015); }
    
    .badge { display: inline-block; border-radius: 99px; padding: 4px 12px; font-size: 11px; font-weight: 700; border: 1px solid currentColor; white-space: nowrap; text-transform: uppercase; }
    .badge.passed { color: var(--success); background: var(--success-bg); }
    .badge.failed, .badge.timedOut, .badge.interrupted { color: var(--danger); background: var(--danger-bg); }
    .badge.skipped, .badge.warn { color: var(--warning); background: var(--warning-bg); }
    
    .muted { color: var(--text-muted); }
    .error { white-space: pre-wrap; max-width: 760px; color: #ffb4ad; }
    .attachments { display: flex; gap: 7px; flex-wrap: wrap; }
    .attachment { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; }
    
    .coverage-summary { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; margin-bottom: 18px; }
    .coverage-card { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 8px; padding: 14px; transition: border-color 0.2s, transform 0.2s; }
    .coverage-card.clickable-coverage-card { cursor: pointer; }
    .coverage-card.clickable-coverage-card:hover { transform: translateY(-2px); border-color: var(--primary); }
    .coverage-card .label { color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .coverage-card .value { font-size: 24px; font-weight: 800; margin-top: 6px; font-family: 'Outfit', sans-serif; }
    .coverage-card .value.pass { color: var(--success); }
    .coverage-card .value.warn { color: var(--warning); }
    .coverage-card .value.fail { color: var(--danger); }
    
    .category-strip { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .category-pill { border: 1px solid var(--border); background: rgba(255,255,255,.03); border-radius: 999px; padding: 6px 14px; color: var(--text-muted); font-size: 12px; cursor: pointer; transition: all 0.2s; }
    .category-pill:hover { border-color: var(--primary); color: var(--text-main); }
    .category-pill.active { background: var(--primary); color: white; border-color: var(--primary); }
    
    .player-card-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .player-card { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 8px; padding: 14px; min-height: 184px; display: flex; flex-direction: column; gap: 10px; }
    .player-card.fail { border-color: rgba(248,81,73,.68); }
    .player-card.warn { border-color: rgba(210,153,34,.68); }
    .player-card.pass { border-color: rgba(46,160,67,.42); }
    .player-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .player-name { font-size: 16px; font-weight: 850; line-height: 1.25; }
    .player-meta { color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
    
    .check-grid { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
    .check-pill { border-radius: 99px; padding: 4px 8px; border: 1px solid currentColor; font-size: 11px; font-weight: 700; }
    .check-pill.pass { color: var(--success); background: var(--success-bg); }
    .check-pill.fail { color: var(--danger); background: var(--danger-bg); }
    
    details { border-bottom: 1px solid var(--border); }
    details:last-child { border-bottom: 0; }
    details summary::-webkit-details-marker { display: none; }
    details summary { list-style: none; }
    summary { cursor: pointer; padding: 18px 24px; font-weight: 800; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    summary::-webkit-details-marker,
    summary::marker {
      display: none !important;
    }
    details[open] summary { background: rgba(255,255,255,.035); border-bottom: 1px solid var(--border); }
    
    .suite-summary-left { display: flex; align-items: center; gap: 12px; }
    
    /* Dynamic Arrow rotate */
    .toggle-icon {
      width: 20px;
      height: 20px;
      fill: var(--text-muted);
      transition: transform 0.2s ease;
      transform-origin: center;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    details[open] .toggle-icon { transform: rotate(180deg); }
    
    .suite-body { padding: 12px 20px 18px; }
    footer { color: var(--text-muted); padding: 24px 0 40px; }
    
    @media (max-width: 1200px) {
      .player-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 980px) {
      .hero { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .coverage-summary { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 560px) {
      main { padding: 0 20px; }
      .kpis { grid-template-columns: 1fr; }
      .coverage-summary, .player-card-grid { grid-template-columns: 1fr; }
      th, td { padding: 9px; }
    }
    .scroll-top-btn { position: fixed; bottom: 30px; right: 30px; width: 45px; height: 45px; border-radius: 50%; background: var(--primary); color: white; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 5px 15px rgba(0,0,0,0.3); opacity: 0; transform: translateY(10px); transition: opacity 0.3s, transform 0.3s; z-index: 100; outline: none; }
    .scroll-top-btn.visible { opacity: 1; transform: translateY(0); }
    .scroll-top-btn:hover { background: var(--primary-hover); transform: scale(1.05); }
    .scroll-top-btn svg { width: 20px; height: 20px; fill: white; }
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
      <div class="header-actions">
        <span class="status-badge ${statusClass}">${escapeHtml(formatOverallStatus(summary.status, isKo))}</span>
      </div>
    </div>
  </header>

  <main>
    <section class="dashboard-grid">
      ${kpi(t.total, summary.total)}
      ${kpi(t.passed, summary.passed, 'pass')}
      ${kpi(t.failed, summary.failed, summary.failed ? 'fail' : '')}
      ${kpi(t.skipped, summary.skipped, summary.skipped ? 'warn' : '')}
      ${kpi(t.passRate, `${summary.passRate}%`, summary.failed ? 'fail' : summary.skipped ? 'warn' : 'pass')}
      ${kpi(t.duration, formatDuration(summary.totalDuration))}
    </section>

    <!-- Visualizations Row -->
    <div class="visualizations-row">
      <div class="chart-panel">
        <h3>${isKo ? "검증 무결성 통계" : "Data Integrity Status"}</h3>
        <div class="chart-wrapper">
          <canvas id="statusChart" style="display:none;"></canvas>
          <div class="radial-chart-fallback" id="radialFallback">
            <svg>
              <circle class="bg" cx="70" cy="70" r="60" />
              <circle class="fg" cx="70" cy="70" r="60" stroke-dasharray="377" stroke-dashoffset="${377 - (377 * summary.passRate / 100)}" />
            </svg>
            <div class="percentage">${summary.passRate}%</div>
          </div>
        </div>
      </div>
      <div class="chart-panel">
        <h3>${isKo ? "검증 상태 분포" : "Test Status Breakdown"}</h3>
        <div class="chart-wrapper">
          <canvas id="statusDistributionChart" style="display:none;"></canvas>
          <div id="distributionFallback" style="text-align:center;color:var(--text-muted);font-size:14px;padding:20px;">
            ${isKo ? `전체 ${summary.total}개 테스트 중 통과 ${summary.passed}개, 실패 ${summary.failed}개, 건너뜀 ${summary.skipped}개` : `Total ${summary.total} tests: Passed ${summary.passed}, Failed ${summary.failed}, Skipped ${summary.skipped}`}
          </div>
        </div>
      </div>
    </div>

    <section class="grid">
      <div class="panel">
        <h2><svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>${escapeHtml(t.executionSummary)}</h2>
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
        <h2><svg viewBox="0 0 24 24" style="fill: var(--warning); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>${escapeHtml(t.readMeFirst)}</h2>
        <div class="panel-body">
          <div class="note">${escapeHtml(readMeFirst(report, isKo))}</div>
        </div>
      </div>
    </section>

    ${playerCoverage ? renderPlayerPresentationCoverage(playerCoverage, t) : ''}

    <section class="panel">
      <h2><svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>${escapeHtml(t.suiteDirectory)}</h2>
      ${[...bySuite.entries()].map(([suite, items]) => renderSuite(suite, items, t)).join('')}
    </section>

    ${failedTests.length ? renderFailurePanel(failedTests, t) : renderEmptyPanel(t.noCriticalFailuresTitle, t.noCriticalFailuresBody)}
    ${skippedTests.length ? renderSkippedPanel(skippedTests, t) : ''}

    <details class="panel collapsible-panel" open>
      <summary class="panel-summary">
        <h2><svg viewBox="0 0 24 24" style="fill: var(--text-main); width: 20px; height: 20px; flex-shrink: 0;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.59-2.58-2.57-1.42 1.41 4 3.99z"/></svg>${escapeHtml(t.allTests)}</h2>
        <svg class="toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
        </svg>
      </summary>
      <div class="panel-body filter-bar-panel" style="border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.15);">
        <div class="filter-controls">
          <div class="filter-group">
            <button class="filter-btn active" data-filter="all">${escapeHtml(isKo ? '전체' : 'All')}</button>
            <button class="filter-btn" data-filter="passed">${escapeHtml(isKo ? '통과' : 'Passed')}</button>
            <button class="filter-btn" data-filter="failed">${escapeHtml(isKo ? '실패' : 'Failed')}</button>
            <button class="filter-btn" data-filter="skipped">${escapeHtml(isKo ? '건너뜀' : 'Skipped')}</button>
          </div>
        </div>
      </div>
      <div class="table-container">
        ${renderResultsTable(report.results, t)}
      </div>
    </details>

    <section class="panel">
      <h2><svg viewBox="0 0 24 24" style="fill: var(--text-muted); width: 20px; height: 20px; flex-shrink: 0;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/></svg>${escapeHtml(t.artifacts)}</h2>
      <div class="panel-body summary-line">
        <span>${escapeHtml(t.playwrightReport)}: <a href="${escapeHtml(`${report.reportPrefix}-${report.runId}-playwright-report/index.html`)}">${escapeHtml(report.playwrightHtmlReport)}</a></span>
        <span>Node: ${escapeHtml(report.node)}</span>
        <span>${escapeHtml(t.platform)}: ${escapeHtml(report.platform)}</span>
      </div>
    </section>
  </main>

  <footer class="wrap" style="max-width: 1600px; margin: 0 auto; padding: 24px 30px 40px;">${escapeHtml(t.footer)}</footer>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      // 1. Chart.js initialization
      const passCount = ${summary.passed};
      const failCount = ${summary.failed};
      const skipCount = ${summary.skipped};

      if (typeof Chart !== 'undefined') {
        const ctx = document.getElementById('statusChart');
        const ctxDist = document.getElementById('statusDistributionChart');

        if (ctx) {
          ctx.style.display = 'block';
          const radialFallback = document.getElementById('radialFallback');
          if (radialFallback) radialFallback.style.display = 'none';

          new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: ${isKo ? "['통과', '실패', '건너뜀']" : "['Passed', 'Failed', 'Skipped']"},
              datasets: [{
                data: [passCount, failCount, skipCount],
                backgroundColor: ['#2ea043', '#f85149', '#d29922'],
                borderWidth: 0,
                hoverOffset: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              cutout: '75%'
            }
          });
        }

        if (ctxDist) {
          ctxDist.style.display = 'block';
          const distFallback = document.getElementById('distributionFallback');
          if (distFallback) distFallback.style.display = 'none';

          new Chart(ctxDist, {
            type: 'bar',
            data: {
              labels: ${isKo ? "['통과 (Pass)', '실패 (Fail)', '건너뜀 (Skip)']" : "['Passed (Pass)', 'Failed (Fail)', 'Skipped (Skip)']"},
              datasets: [{
                data: [passCount, failCount, skipCount],
                backgroundColor: ['rgba(46,160,67,0.85)', 'rgba(248,81,73,0.85)', 'rgba(210,153,34,0.85)'],
                borderColor: ['#2ea043', '#f85149', '#d29922'],
                borderWidth: 1,
                borderRadius: 4
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  grid: { color: '#30363d' },
                  ticks: { color: '#8b949e', stepSize: 1 }
                },
                x: {
                  grid: { display: false },
                  ticks: { color: '#8b949e' }
                }
              }
            }
          });
        }
      }

      // 2. Client-side interactive table filtering
      const filterButtons = document.querySelectorAll('.filter-btn');
      const tableRows = document.querySelectorAll('details.collapsible-panel table tbody tr');

      filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          
          // Toggle active class
          filterButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const filter = btn.getAttribute('data-filter');

          tableRows.forEach(row => {
            const statusBadge = row.querySelector('td span.badge');
            if (!statusBadge) return;

            const status = statusBadge.textContent.trim().toLowerCase();

            if (filter === 'all') {
              row.style.display = '';
            } else if (filter === 'passed' && status === 'passed') {
              row.style.display = '';
            } else if (filter === 'failed' && (status === 'failed' || status === 'timedout' || status === 'interrupted')) {
              row.style.display = '';
            } else if (filter === 'skipped' && status === 'skipped') {
              row.style.display = '';
            } else {
              row.style.display = 'none';
            }
          });
        });
      });

      // 3. Player presentation coverage filtering
      const covCards = document.querySelectorAll('.coverage-card[data-status-filter]');
      const catPills = document.querySelectorAll('.category-pill[data-category-filter]');
      const playerCards = document.querySelectorAll('.player-card');

      let currentStatusFilter = 'all';
      let currentCategoryFilter = 'all';

      function filterPlayers() {
        playerCards.forEach(card => {
          const cat = card.getAttribute('data-category');
          const stat = card.getAttribute('data-status');

          // normalize stat for matching coverageStatus
          // (player.status is 'pass', 'warn', 'fail' while filter types are 'pass', 'warn', 'fail')
          const catMatch = currentCategoryFilter === 'all' || cat === currentCategoryFilter;
          const statMatch = currentStatusFilter === 'all' || stat === currentStatusFilter;

          if (catMatch && statMatch) {
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
        });
      }

      covCards.forEach(card => {
        card.addEventListener('click', (e) => {
          e.stopPropagation();
          covCards.forEach(c => c.style.borderColor = '');
          const filter = card.getAttribute('data-status-filter');
          currentStatusFilter = filter;
          
          if (filter !== 'all') {
            card.style.borderColor = 'var(--primary)';
          }
          filterPlayers();
        });
      });

      catPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          catPills.forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          currentCategoryFilter = pill.getAttribute('data-category-filter');
          filterPlayers();
        });
      });

      // Scroll to top button visibility
      const scrollTopBtn = document.getElementById('scroll-to-top');
      if (scrollTopBtn) {
        window.addEventListener('scroll', () => {
          if (window.scrollY > 300) scrollTopBtn.classList.add('visible');
          else scrollTopBtn.classList.remove('visible');
        });
      }
    });
  </script>
  <button class="scroll-top-btn" id="scroll-to-top" onclick="window.scrollTo({top:0, behavior:'smooth'})">
    <svg viewBox="0 0 24 24"><path d="M7.41,18.41L6,17L12,11L18,17L16.59,18.41L12,13.83L7.41,18.41M7.41,12.41L6,11L12,5L18,11L16.59,12.41L12,7.83L7.41,12.41Z"/></svg>
  </button>
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
    <h2><svg viewBox="0 0 24 24" style="fill: var(--danger); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 4v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>${escapeHtml(t.failures)}</h2>
    ${renderResultsTable(items, t, true)}
  </section>`;
}

function renderSkippedPanel(items, t) {
  return `<section class="panel">
    <h2><svg viewBox="0 0 24 24" style="fill: var(--warning); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>${escapeHtml(t.skippedTests)}</h2>
    ${renderResultsTable(items, t)}
  </section>`;
}

function renderEmptyPanel(title, body) {
  return `<section class="panel"><h2><svg viewBox="0 0 24 24" style="fill: var(--success); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>${escapeHtml(title)}</h2><div class="panel-body"><div class="note">${escapeHtml(body)}</div></div></section>`;
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
      <svg class="toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
      </svg>
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
    if (item.href) {
      return `<a class="attachment" href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a>`;
    }

    const label = item.missing ? `${item.name} (missing)` : item.name;
    return `<span class="attachment">${escapeHtml(label)}</span>`;
  }).join('')}</div>`;
}

function materializeAttachmentFiles(report) {
  const attachmentDirName = `${report.reportPrefix}-${report.runId}-attachments`;
  const attachmentDir = path.join(OUTPUT_DIR, attachmentDirName);

  for (const result of report.results) {
    (result.attachments || []).forEach((attachment, index) => {
      if (!attachment.path) {
        return;
      }

      const sourcePath = path.resolve(process.cwd(), attachment.path);
      if (!fs.existsSync(sourcePath)) {
        attachment.missing = true;
        return;
      }

      fs.mkdirSync(attachmentDir, { recursive: true });
      const sourceBaseName = path.basename(sourcePath);
      const safeFileName = sanitizeFileName(`${String(result.id).padStart(3, '0')}-${index + 1}-${attachment.name}-${sourceBaseName}`);
      const destinationPath = path.join(attachmentDir, safeFileName);
      fs.copyFileSync(sourcePath, destinationPath);

      attachment.copiedPath = toPosixPath(path.relative(process.cwd(), destinationPath));
      attachment.href = toPosixPath(path.relative(OUTPUT_DIR, destinationPath));
    });
  }
}

function renderPlayerPresentationCoverage(coverage, t) {
  return `<section class="panel">
    <h2><svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/></svg>${escapeHtml(t.playerCoverageTitle)}</h2>
    <div class="panel-body">
      <div class="note">${escapeHtml(t.playerCoverageNote)}</div>
      <div class="coverage-summary" style="margin-top:18px">
        ${coverageCard(t.coverageTotal, coverage.total, '', 'all')}
        ${coverageCard(t.coveragePassed, coverage.passed, 'pass', 'pass')}
        ${coverageCard(t.coverageWarned, coverage.warned, coverage.warned ? 'warn' : '', 'warn')}
        ${coverageCard(t.coverageFailed, coverage.failed, coverage.failed ? 'fail' : '', 'fail')}
        ${coverageCard(t.coverageCategories, coverage.categories.length)}
      </div>
      <div class="category-strip">
        <span class="category-pill active" data-category-filter="all">${t.allTests || '전체'}</span>
        ${coverage.categories.map((category) => `<span class="category-pill" data-category-filter="${escapeHtml(category.name)}">${escapeHtml(category.name)}: ${escapeHtml(category.total)} (${escapeHtml(category.passed)}/${escapeHtml(category.warned)}/${escapeHtml(category.failed)})</span>`).join('')}
      </div>
      <div class="player-card-grid">
        ${coverage.players.map((player) => renderCoveragePlayerCard(player, t)).join('')}
      </div>
    </div>
  </section>`;
}

function renderCoveragePlayerCard(player, t) {
  const rank = player.rank == null ? '-' : `#${player.rank}`;
  const profileText = player.actualProfileUrl || player.expectedProfileUrl || player.profileUrl || '';
  const profileHref = toWsopUrl(profileText || player.expectedProfileUrl || player.profileUrl);
  const isLegendSpecialPage = player.kind === 'legend-special-page';
  const sourceLabel = player.usedSearchFallback ? `${player.sourcePath || '-'} · search fallback` : (player.sourcePath || '-');
  const signalText = Array.isArray(player.matchedSignals) && player.matchedSignals.length
    ? player.matchedSignals.join(', ')
    : '';

  return `<article class="player-card ${escapeHtml(player.status)}" data-category="${escapeHtml(player.category || 'Standings')}" data-status="${escapeHtml(player.status)}">
    <div class="player-card-top">
      <div>
        <div class="player-name">${escapeHtml(player.name)}</div>
        <div class="player-meta">${escapeHtml(player.category)} ${escapeHtml(rank)}</div>
      </div>
      <span class="badge ${escapeHtml(player.status)}">${escapeHtml(formatCoverageStatus(player.status, t))}</span>
    </div>
    <div class="player-meta">${escapeHtml(t.coverageSource)}: ${escapeHtml(sourceLabel)}</div>
    <div class="player-meta">${escapeHtml(t.coverageProfile)}: ${profileText ? `<a href="${escapeHtml(profileHref)}">${escapeHtml(profileText)}</a>` : '-'}</div>
    ${isLegendSpecialPage && signalText ? `<div class="player-meta">${escapeHtml(t.coverageLegendSignals)}: ${escapeHtml(signalText)}</div>` : ''}
    <div class="check-grid">
      ${isLegendSpecialPage
        ? [
          checkPill(t.coverageProfileReachable, player.checks.profileReachable),
          checkPill(t.coverageSpecialPage, player.checks.specialPage),
          checkPill(t.coverageSpecialSignals, player.checks.specialSignals),
        ].join('')
        : [
          checkPill(t.coverageRow, player.checks.row),
          checkPill(t.coverageName, player.checks.name),
          checkPill(t.coverageProfileLink, player.checks.profileLink),
          checkPill(t.coverageCountryFlag, player.checks.countryOrFlag),
          checkPill(t.coverageImage, player.checks.playerImage),
        ].join('')}
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
      if (![
        'player-presentation-standings-coverage',
        'player-presentation-legend-special-page-coverage',
      ].includes(attachment.name)) {
        continue;
      }

      const payloadText = attachment.body || readAttachmentBody(attachment);
      if (!payloadText) {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText);
        for (const player of payload.players || []) {
          const profileUrl = player.expectedProfileUrl || player.actualProfileUrl || player.profileUrl || '';
          if (attachment.name === 'player-presentation-legend-special-page-coverage') {
            const key = `legend-special-page|${player.name}|${profileUrl}`;
            byKey.set(key, {
              ...player,
              kind: 'legend-special-page',
              category: player.category || 'Legend special profile',
              expectedProfileUrl: player.expectedProfileUrl || profileUrl,
              actualProfileUrl: player.actualProfileUrl || profileUrl,
              checks: {
                profileReachable: true,
                specialPage: true,
                specialSignals: true,
                ...(player.checks || {}),
              },
            });
          } else {
            const key = `${player.sourcePath}|${player.rank}|${player.name}|${profileUrl}`;
            byKey.set(key, {
              ...player,
              kind: 'standings-row',
              category: player.category || 'Standings-only crawler',
              expectedProfileUrl: player.expectedProfileUrl || profileUrl,
              actualProfileUrl: player.actualProfileUrl || profileUrl,
              checks: {
                row: true,
                ...(player.checks || {}),
              },
            });
          }
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

function coverageCard(label, value, tone = '', filterType = '') {
  const clickable = filterType ? 'clickable-coverage-card' : '';
  const dataAttr = filterType ? `data-status-filter="${filterType}"` : '';
  return `<div class="coverage-card ${clickable}" ${dataAttr}><div class="label">${escapeHtml(label)}</div><div class="value ${tone}">${escapeHtml(String(value))}</div></div>`;
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
  return `<div class="kpi-card">
    <div class="kpi-label">${escapeHtml(label)}</div>
    <div class="kpi-value ${tone}">${escapeHtml(String(value))}</div>
  </div>`;
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

function sanitizeFileName(value) {
  return String(value || 'attachment')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'attachment';
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
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
  const isSearchFilterSort = suite === 'search-filter-sort';

  let titleKo = 'WSOP Web 자동화 리포트';
  let titleEn = 'WSOP Web Automation Report';
  let subtitleKo = '공개 페이지 접근, 핵심 콘텐츠, 상단 네비게이션, 콘솔 오류, 내부 링크 샘플을 빠르게 확인한 결과입니다.';
  let subtitleEn = 'A public web check for page access, core content, top navigation, console errors, and sampled internal links.';
  let eyebrowKo = 'WSOP WEB AUTOMATION';
  let eyebrowEn = 'WSOP WEB AUTOMATION';

  if (isSmoke) {
    titleKo = 'WSOP Phase 1 Smoke 검증 리포트';
    titleEn = 'WSOP Phase 1 Smoke Verification Report';
    subtitleKo = '배포 후 주요 공개 페이지 접근성, 핵심 콘텐츠, 콘솔 에러 등을 신속히 검증한 리포트입니다.';
    subtitleEn = 'A quick verification of public page accessibility, core content, and console errors after deployment.';
    eyebrowKo = 'WSOP Phase 1 Smoke';
    eyebrowEn = 'WSOP Phase 1 Smoke';
  } else if (isFunctional) {
    titleKo = 'WSOP Phase 2 Functional Flow 검증 리포트';
    titleEn = 'WSOP Phase 2 Functional Flow Verification Report';
    subtitleKo = '사용자가 웹사이트에서 주로 탐색하는 Schedule, Search, Standings, News 등의 기능 흐름 검증 결과입니다.';
    subtitleEn = 'Exploration flow verification results for key user paths such as Schedule, Search, Standings, and News.';
    eyebrowKo = 'WSOP Phase 2 Functional Flow';
    eyebrowEn = 'WSOP Phase 2 Functional Flow';
  } else if (isPlayerPresentation) {
    titleKo = 'WSOP Phase 3 플레이어 표현 검증 리포트';
    titleEn = 'WSOP Phase 3 Player Presentation Verification Report';
    subtitleKo = 'standings-only crawler가 추출한 선수 대상자를 기준으로 공개 화면의 이름, 프로필 링크, 국가/국기, 이미지 표현 상태를 확인한 결과입니다.';
    subtitleEn = 'A public UI presentation check for standings-only crawler targets: name, profile link, country/flag, and image candidates.';
    eyebrowKo = 'WSOP Phase 3 Player Presentation';
    eyebrowEn = 'WSOP Phase 3 Player Presentation';
  } else if (isSearchFilterSort) {
    titleKo = 'WSOP Phase 4 검색/필터/정렬 검증 리포트';
    titleEn = 'WSOP Phase 4 Search / Filter / Sort Verification Report';
    subtitleKo = 'Player Search, Standings, POY 목록에서 검색어 입력, 탭/섹션 전환, 카테고리 이동, 정렬, 페이지네이션 조작이 깨지지 않는지 확인한 결과입니다.';
    subtitleEn = 'A public UI interaction check for Player Search, Standings, and POY list search, section switching, category navigation, sort controls, and pagination behavior.';
    eyebrowKo = 'WSOP Phase 4 Search / Filter / Sort';
    eyebrowEn = 'WSOP Phase 4 Search / Filter / Sort';
  }

  return isKo
    ? {
        title: titleKo,
        subtitle: subtitleKo,
        eyebrow: eyebrowKo,
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
        footer: '이 리포트는 Playwright 실행 결과에서 자동 생성되었습니다. 외부 사이트 부하를 줄이기 위해 검증 범위는 단계별 샘플과 standings-only crawler 대상자로 제한됩니다.',
        testName: '테스트명',
        suite: '검증 영역',
        project: '프로젝트',
        status: '상태',
        time: '시간',
        file: '파일',
        detail: '상세',
        attachment: '첨부',
        playerCoverageTitle: 'Phase 3 플레이어 UI 커버리지',
        playerCoverageNote: '기존 크롤러의 standings-only 모드가 추출한 선수와 Legend 10 특수 프로필 대상자를 기준으로 공개 UI의 이름, 프로필 링크, 국가/국기, 이미지 후보, 특수 페이지 신호를 확인합니다. Profile/Result 상세 크롤링은 수행하지 않으며, 이미지는 stage/prod asset 차이로 warning이 될 수 있습니다.',
        coverageTotal: '검증 행',
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
        coverageProfileReachable: '프로필 접근',
        coverageSpecialPage: '특수 페이지',
        coverageSpecialSignals: '특수 신호',
        coverageLegendSignals: '확인 신호',
        coverageStatusPass: '정상',
        coverageStatusWarn: '주의',
        coverageStatusFail: '실패',
      }
    : {
        title: titleEn,
        subtitle: subtitleEn,
        eyebrow: eyebrowEn,
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
        footer: 'This report was generated from Playwright results. External-site checks intentionally use phase samples and standings-only crawler targets to avoid excessive traffic.',
        testName: 'Test Name',
        suite: 'Area',
        project: 'Project',
        status: 'Status',
        time: 'Time',
        file: 'File',
        detail: 'Detail',
        attachment: 'Attachment',
        playerCoverageTitle: 'Phase 3 Player UI Coverage',
        playerCoverageNote: 'Uses standings-only crawler targets and the Legend 10 special profile targets to check public UI presentation for name, profile links, country/flag, image candidates, and special page signals. Profile and Result detail crawling is skipped.',
        coverageTotal: 'Checked Rows',
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
        coverageProfileReachable: 'Profile',
        coverageSpecialPage: 'Special Page',
        coverageSpecialSignals: 'Signals',
        coverageLegendSignals: 'Matched Signals',
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
  if (report.suite === 'search-filter-sort') {
    return isKo
      ? 'Phase 4는 검색/필터/정렬/페이지네이션 UI 조작이 깨지지 않는지 확인합니다. 수치 계산, API/DB 비교, POY 포인트 정합성은 Phase 6에서 다룹니다.'
      : 'Phase 4 checks search/filter/sort/pagination UI behavior. Numeric calculations, API/DB comparisons, and POY point integrity remain Phase 6 scope.';
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
