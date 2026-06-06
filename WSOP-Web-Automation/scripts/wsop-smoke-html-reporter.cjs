const fs = require('fs');
const os = require('os');
const path = require('path');

// Forward declarations — each is assigned once via the override block at the bottom of this file.
// Having them declared here avoids JS hoisting confusion and makes the dependency clear.
var dictionary;
var readMeFirst;
var formatOverallStatus;

const OUTPUT_DIR = path.join(process.cwd(), 'automation', 'output');
const RUN_ID = process.env.WSOP_REPORT_RUN_ID || process.env.SMOKE_REPORT_RUN_ID || timestampForFile();
const REPORT_SUITE = normalizeReportSuite(process.env.WSOP_REPORT_SUITE) || 'smoke';
const REPORT_PREFIX = process.env.WSOP_REPORT_PREFIX || `wsop-public-${REPORT_SUITE}`;

function getPastHtmlReports(prefix, isKo = false) {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return [];
    
    const files = fs.readdirSync(OUTPUT_DIR);
    
    const reportFiles = files.filter(f => {
      if (isKo) {
        return f.startsWith(prefix) && f.endsWith("-report-ko.html");
      } else {
        return f.startsWith(prefix) && f.endsWith("-report.html") && !f.endsWith("-report-ko.html");
      }
    });

    reportFiles.sort((a, b) => b.localeCompare(a));

    return reportFiles.map(file => {
      const match = file.match(/(\d{8})-(\d{6})/);
      let dateLabel = file;
      if (match) {
        const dateStr = match[1];
        const timeStr = match[2];
        dateLabel = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)} ${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`;
      }
      return {
        fileName: file,
        label: dateLabel
      };
    });
  } catch (err) {
    console.error("Error reading past HTML reports:", err);
    return [];
  }
}

function getSuiteReportRunIds(prefix) {
  if (!fs.existsSync(OUTPUT_DIR)) return [];

  const files = fs.readdirSync(OUTPUT_DIR);
  const runIds = [];
  const seen = new Set();
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d{8}-\\d{6}(?:-\\d{3})?)-report\\.json$`);

  for (const file of files) {
    const match = file.match(pattern);
    if (!match) continue;
    const runId = match[1];
    if (seen.has(runId)) continue;
    seen.add(runId);
    runIds.push(runId);
  }

  runIds.sort((a, b) => b.localeCompare(a));
  return runIds;
}

function refreshSuiteHtmlHistory(prefix) {
  const runIds = getSuiteReportRunIds(prefix);
  if (runIds.length === 0) return;

  const pastEnglishReports = getPastHtmlReports(prefix, false);
  const pastKoreanReports = getPastHtmlReports(prefix, true);

  for (const runId of runIds) {
    const jsonPath = path.join(OUTPUT_DIR, `${prefix}-${runId}-report.json`);
    if (!fs.existsSync(jsonPath)) continue;

    try {
      const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const htmlPath = path.join(OUTPUT_DIR, `${prefix}-${runId}-report.html`);
      const koHtmlPath = path.join(OUTPUT_DIR, `${prefix}-${runId}-report-ko.html`);

      fs.writeFileSync(htmlPath, renderDashboard(report, false, pastEnglishReports), 'utf8');
      fs.writeFileSync(koHtmlPath, renderDashboard(report, true, pastKoreanReports), 'utf8');
    } catch (err) {
      console.warn(`WSOP ${REPORT_SUITE} report history refresh skipped for run ${runId}: ${err.message}`);
    }
  }
}

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
    if (this.results.length === 0) {
      console.log(`WSOP ${REPORT_SUITE} report skipped: no executed tests.`);
      return;
    }

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

    const pastEnglishReports = getPastHtmlReports(REPORT_PREFIX, false);
    const pastKoreanReports = getPastHtmlReports(REPORT_PREFIX, true);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, renderDashboard(report, false, pastEnglishReports), 'utf8');
    fs.writeFileSync(koHtmlPath, renderDashboard(report, true, pastKoreanReports), 'utf8');
    refreshSuiteHtmlHistory(REPORT_PREFIX);

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

function renderDashboard(report, isKo, pastReports = []) {
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
    .select-dropdown { background: var(--bg-card); border: var(--card-border); color: var(--text-main); padding: 10px 20px; border-radius: 8px; outline: none; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: var(--shadow); }
    .select-dropdown:focus { border-color: var(--primary); }
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
      <div class="header-actions" style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
        ${pastReports.length > 0 ? `
          <div class="history-selector-wrapper" style="display: flex; align-items: center; gap: 8px;">
            <label for="history-select" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">
              ${isKo ? "이전 리포트 기록:" : "Past Reports:"}
            </label>
            <select id="history-select" class="select-dropdown" onchange="if(this.value) window.location.href=this.value" style="margin: 0; padding: 6px 12px; font-size: 12px; height: auto;">
              <option value="">-- ${isKo ? "리포트 선택" : "Select Report"} --</option>
              ${pastReports.map(rep => `<option value="${escapeHtml(rep.fileName)}">${escapeHtml(rep.label)}</option>`).join("")}
            </select>
          </div>
        ` : ""}
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

    ${renderReportStepGuide(report.suite, isKo)}

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

      // Set active item in history dropdown
      const currentFileName = window.location.pathname.split('/').pop();
      const historySelect = document.getElementById('history-select');
      if (historySelect && currentFileName) {
        for (let i = 0; i < historySelect.options.length; i++) {
          if (historySelect.options[i].value === currentFileName) {
            historySelect.selectedIndex = i;
            break;
          }
        }
      }
    });
  </script>
  <button class="scroll-top-btn" id="scroll-to-top" onclick="window.scrollTo({top:0, behavior:'smooth'})">
    <svg viewBox="0 0 24 24"><path d="M7.41,18.41L6,17L12,11L18,17L16.59,18.41L12,13.83L7.41,18.41M7.41,12.41L6,11L12,5L18,11L16.59,12.41L12,7.83L7.41,12.41Z"/></svg>
  </button>
</body>
</html>`;
}

// NOTE: `dictionary`, `readMeFirst`, and `formatOverallStatus` are fully defined
// in the override block at the bottom of this file (after all helper functions).
// The var declarations above ensure they are in scope throughout.

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

function renderReportStepGuide(suite, isKo) {
  const guide = getReportStepGuide(suite, isKo);
  if (!guide) return '';

  return `<section class="panel">
    <h2><svg viewBox="0 0 24 24" style="fill: var(--primary-hover); width: 20px; height: 20px; flex-shrink: 0;"><path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h12v2H3v-2z"/></svg>${escapeHtml(guide.title)}</h2>
    <div class="panel-body">
      <div class="note" style="margin-bottom:14px;">${escapeHtml(guide.note)}</div>
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(isKo ? '순서' : 'Step')}</th>
            <th>${escapeHtml(isKo ? '무엇을 하는가' : 'What It Does')}</th>
            <th>${escapeHtml(isKo ? '리포트에서 확인할 것' : 'What To Check In Report')}</th>
          </tr>
        </thead>
        <tbody>
          ${guide.steps.map((step, index) => `<tr>
            <td class="nowrap"><strong>${index + 1}</strong></td>
            <td>${escapeHtml(step.action)}</td>
            <td>${escapeHtml(step.check)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderSuite(suite, items, t) {
  const failed = items.filter((item) => ['failed', 'timedOut', 'interrupted'].includes(item.status)).length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  const status = failed ? 'failed' : skipped ? 'skipped' : 'passed';
  const displaySuite = suite;
  return `<details open>
    <summary>
      <div class="suite-summary-left">
        <span>${escapeHtml(displaySuite)}</span>
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
      ${items.map((item) => {
        const stepsHtml = t.isKo ? renderTestStepsKo(item) : renderTestStepsEn(item);
        return `<tr>
        <td><span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>
          <strong>${escapeHtml(item.title)}</strong><br>
          <span class="muted" style="font-size: 11px;">${escapeHtml(item.suiteTitle)}</span>
          ${stepsHtml}
        </td>
        <td>${escapeHtml(item.projectName)}</td>
        <td>${escapeHtml(formatDuration(item.duration))}</td>
        <td><span class="muted">${escapeHtml(item.file)}</span></td>
        ${includeErrors ? `<td class="error">${escapeHtml(item.error || '-')}</td>` : ''}
        <td>${renderAttachments(item.attachments)}</td>
      </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function renderTestStepsKo(item) {
  const steps = getTestStepsKo(item.title, item.suiteTitle);
  if (!steps || steps.length === 0) return '';
  return `
    <div class="test-steps-ko" style="margin-top: 8px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-left: 3px solid var(--primary-hover); border-radius: 4px; font-size: 12px;">
      <div style="font-weight: 700; color: var(--text-muted); margin-bottom: 4px; font-size: 11px;">[Playwright 실행 행동]</div>
      <ol style="margin: 0; padding-left: 18px; color: var(--text-muted); line-height: 1.6;">
        ${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
      </ol>
    </div>
  `;
}

function renderTestStepsEn(item) {
  const steps = getTestStepsEn(item.title, item.suiteTitle);
  if (!steps || steps.length === 0) return '';
  return `
    <div class="test-steps-en" style="margin-top: 8px; padding: 8px 12px; background: rgba(255,255,255,0.02); border-left: 3px solid var(--primary-hover); border-radius: 4px; font-size: 12px;">
      <div style="font-weight: 700; color: var(--text-muted); margin-bottom: 4px; font-size: 11px;">[Playwright Actions]</div>
      <ol style="margin: 0; padding-left: 18px; color: var(--text-muted); line-height: 1.6;">
        ${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
      </ol>
    </div>
  `;
}

function getReportStepGuide(suite = '', isKo = true) {
  const key = inferReportSuiteKey(suite);
  const ko = {
    smoke: {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 1은 Playwright가 공개 페이지를 직접 열고, 핵심 UI와 콘솔/링크 상태를 빠르게 확인한 결과입니다.',
      steps: [
        { action: 'Playwright가 대상 공개 URL로 이동합니다.', check: '페이지가 정상 응답하고 기본 렌더링이 끝났는지 확인합니다.' },
        { action: 'Playwright가 핵심 텍스트와 주요 UI locator를 찾습니다.', check: '홈, 스케줄, 스탠딩, 검색, 뉴스 등 페이지별 핵심 영역이 보이는지 확인합니다.' },
        { action: 'Playwright가 상단 메뉴 또는 주요 링크를 클릭합니다.', check: '클릭 후 브라우저 URL과 화면 제목이 기대 페이지와 맞는지 확인합니다.' },
        { action: 'Playwright가 console 이벤트를 수집합니다.', check: '알려진 외부 스크립트 소음을 제외한 치명적인 JavaScript 오류가 있는지 확인합니다.' },
        { action: 'Playwright/API 요청으로 내부 링크 샘플을 확인합니다.', check: '샘플 링크가 400 이상 응답으로 깨지지 않는지 확인합니다.' }
      ]
    },
    functional: {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 2는 Playwright가 사용자가 실제로 할 법한 탐색 흐름을 클릭/입력 중심으로 재현한 결과입니다.',
      steps: [
        { action: 'Playwright가 Tournament Schedule 화면을 열고 필터/목록을 조작합니다.', check: '필터 조작 후 목록이 유지되고 상세 페이지로 이동 가능한지 확인합니다.' },
        { action: 'Playwright가 Player Search 입력창에 선수명을 입력하거나 추천 선수를 선택합니다.', check: '검색 결과 또는 자동완성에서 올바른 프로필로 이동하는지 확인합니다.' },
        { action: 'Playwright가 Player Standings의 랭킹 row에서 선수 링크를 클릭합니다.', check: '선수 프로필 페이지가 열리고 대상 선수 정보가 보이는지 확인합니다.' },
        { action: 'Playwright가 News 목록의 첫 기사 링크를 클릭합니다.', check: '상세 기사 페이지에서 제목과 본문이 로드되는지 확인합니다.' },
        { action: 'Playwright가 각 흐름의 실패 지점과 첨부 자료를 저장합니다.', check: '어느 클릭/입력 단계에서 실패했는지 리포트에서 확인합니다.' }
      ]
    },
    'player-presentation': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 3은 Playwright가 standings-only 대상자를 화면에서 찾아, 선수 표현 UI가 깨지지 않았는지 확인한 결과입니다.',
      steps: [
        { action: 'Playwright 실행 전에 standings-only 크롤러 대상 JSON을 준비합니다.', check: '리포트의 대상 선수 수와 카테고리가 비어 있지 않은지 확인합니다.' },
        { action: 'Playwright가 Standings 화면에서 선수 row locator를 찾습니다.', check: '이름, rank, 프로필 링크가 화면에 표시되는지 확인합니다.' },
        { action: 'Playwright가 국가/국기와 이미지 후보 locator를 확인합니다.', check: '국가 표시나 이미지가 누락되었는지, 환경 차이 warning인지 확인합니다.' },
        { action: 'Playwright가 Player Search에서 선수 검색/프로필 이동을 수행합니다.', check: '검색 결과가 대상 선수 프로필로 연결되는지 확인합니다.' },
        { action: 'Playwright가 HOF, POY, Legend 특수 프로필을 직접 엽니다.', check: '특수 페이지 신호나 표시 마크가 보이는지 확인합니다.' }
      ]
    },
    'search-filter-sort': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 4는 Playwright가 검색어 입력, 탭 전환, 필터 선택, 정렬, 페이지 이동을 실제 조작한 결과입니다.',
      steps: [
        { action: 'Playwright가 Player Search 입력창에 다양한 검색어를 입력합니다.', check: '소문자, 부분 검색, 공백, 결과 없음, 비영문 검색이 화면을 깨뜨리지 않는지 확인합니다.' },
        { action: 'Playwright가 검색 탭과 섹션 버튼을 클릭합니다.', check: 'Trending, Winners, POY, Hall of Fame 영역 전환이 정상인지 확인합니다.' },
        { action: 'Playwright가 Standings 카테고리와 브랜드/필터 UI를 조작합니다.', check: '필터 적용 뒤 목록이 정상 갱신되는지 확인합니다.' },
        { action: 'Playwright가 정렬 컬럼, pagination, Load More를 클릭합니다.', check: '목록이 멈추거나 페이지 수가 비정상 증가하지 않는지 확인합니다.' },
        { action: 'Playwright가 no-result 상태와 로딩 상태를 관찰합니다.', check: '빈 결과가 정상 UI로 표시되는지, selector 오류와 구분합니다.' }
      ]
    },
    'result-detail': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 5는 Playwright가 프로필 결과 row에서 Result 상세 페이지로 이동하고 다시 프로필로 돌아오는 링크 흐름을 확인한 결과입니다.',
      steps: [
        { action: 'Playwright가 선수 프로필 페이지를 엽니다.', check: 'Results 목록과 대상 row가 보이는지 확인합니다.' },
        { action: 'Playwright가 프로필 Results row의 Result 링크를 클릭합니다.', check: 'Result 상세 페이지가 404/5xx 없이 로드되는지 확인합니다.' },
        { action: 'Playwright가 상세 페이지의 결과 테이블 locator를 찾습니다.', check: '선수명, 순위, 상금 같은 핵심 셀이 보이는지 확인합니다.' },
        { action: 'Playwright가 상세 페이지의 선수 링크를 클릭합니다.', check: '올바른 선수 프로필로 되돌아가는지 확인합니다.' },
        { action: 'Playwright가 링크 실패와 데이터 미노출을 분리해 기록합니다.', check: '라우팅 문제인지 row 탐색 문제인지 리포트 상세를 확인합니다.' }
      ]
    },
    'data-integrity': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 6은 Playwright가 화면 값을 읽고, fixture 또는 crawler snapshot 같은 기준 데이터와 비교한 결과입니다.',
      steps: [
        { action: 'Playwright가 기준 데이터 파일 또는 crawler snapshot을 로드합니다.', check: 'expected 데이터가 준비되었는지 확인합니다.' },
        { action: 'Playwright가 Standings/Profile/Result 화면을 열고 값을 추출합니다.', check: '비교 대상 텍스트와 숫자가 실제 UI에서 읽혔는지 확인합니다.' },
        { action: 'Playwright가 playerId, onepassId, profile URL 매핑을 비교합니다.', check: '대상 선수가 서로 다른 사람으로 매핑되지 않았는지 확인합니다.' },
        { action: 'Playwright가 표시값과 기준값을 비교합니다.', check: 'Bracelets, Rings, Earnings, Cashes 등 expected/actual 차이를 확인합니다.' },
        { action: 'Playwright가 stale fixture 가능성과 실제 mismatch를 구분해 기록합니다.', check: '데이터 갱신 필요인지 제품 오류인지 리포트 상세를 확인합니다.' }
      ]
    },
    'performance-stability': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 7은 Playwright가 주요 흐름을 반복 실행하면서 로딩 시간, 느린 요청, 실패 요청을 측정한 결과입니다.',
      steps: [
        { action: 'Playwright가 주요 페이지를 열고 load timing을 측정합니다.', check: '페이지 로드 시간이 warning/fail 기준을 넘는지 확인합니다.' },
        { action: 'Playwright가 Standings to Profile, Search to Profile 같은 흐름을 실행합니다.', check: '클릭/입력 후 다음 화면까지 걸린 시간을 확인합니다.' },
        { action: 'Playwright가 request/response 이벤트를 감시합니다.', check: '느린 API, 깨진 이미지, 외부 스크립트 실패를 확인합니다.' },
        { action: 'Playwright가 같은 흐름을 반복 실행합니다.', check: '반복 중 flaky failure 또는 누적 지연이 발생하는지 확인합니다.' },
        { action: 'Playwright가 제품 경로와 서드파티 경로를 분리해 기록합니다.', check: 'release blocker인지 review item인지 확인합니다.' }
      ]
    },
    'visual-regression': {
      title: 'Playwright가 실행한 테스트 스텝',
      note: 'Phase 8은 Playwright가 대상 화면을 캡처하고 baseline 이미지와 비교한 결과입니다. baseline 갱신은 자동으로 하지 않습니다.',
      steps: [
        { action: 'Playwright가 정해진 viewport로 대상 페이지를 엽니다.', check: 'desktop/mobile 조건으로 화면이 준비되었는지 확인합니다.' },
        { action: 'Playwright가 동적 영역을 마스킹한 뒤 screenshot을 찍습니다.', check: '광고, 날짜, 계속 변하는 영역이 비교를 방해하지 않는지 확인합니다.' },
        { action: 'Playwright가 현재 screenshot과 baseline을 비교합니다.', check: '허용 오차를 넘는 픽셀 차이가 있는지 확인합니다.' },
        { action: 'Playwright가 diff attachment를 저장합니다.', check: '차이가 실제 깨짐인지 의도된 UI 변경인지 확인합니다.' },
        { action: 'Playwright는 baseline update를 수행하지 않습니다.', check: 'baseline missing은 제품 버그가 아니라 관리 항목인지 확인합니다.' }
      ]
    }
  };

  const en = {};
  for (const [suiteKey, guide] of Object.entries(ko)) {
    en[suiteKey] = {
      title: 'Playwright Actions In This Report',
      note: 'This section explains the browser actions Playwright performed before producing the report.',
      steps: guide.steps.map((step) => ({
        action: step.action
          .replace(/^Playwright가 /, 'Playwright ')
          .replace(/합니다\.$/, '.')
          .replace(/확인합니다\.$/, 'checks.'),
        check: step.check
      }))
    };
  }

  return (isKo ? ko : en)[key] || null;
}

function inferReportSuiteKey(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('smoke') || text.includes('phase 1')) return 'smoke';
  if (text.includes('functional') || text.includes('phase 2')) return 'functional';
  if (text.includes('player-presentation') || text.includes('player presentation') || text.includes('phase 3')) return 'player-presentation';
  if (text.includes('search-filter-sort') || text.includes('search') || text.includes('phase 4')) return 'search-filter-sort';
  if (text.includes('result-detail') || text.includes('result detail') || text.includes('phase 5')) return 'result-detail';
  if (text.includes('data-integrity') || text.includes('data integrity') || text.includes('phase 6')) return 'data-integrity';
  if (text.includes('performance-stability') || text.includes('performance') || text.includes('phase 7')) return 'performance-stability';
  if (text.includes('visual-regression') || text.includes('visual') || text.includes('phase 8')) return 'visual-regression';
  if (text.includes('regression') || text.includes('phase 9')) return 'regression';
  return '';
}

function getStandardTestSteps(title = '', suiteTitle = '', isKo = true) {
  const suiteKey = inferReportSuiteKey(`${suiteTitle} ${title}`);
  const guide = getReportStepGuide(suiteKey, isKo);
  if (!guide) return [];
  const target = title || (isKo ? '대상 테스트' : 'target test');
  return [
    isKo ? `Playwright 테스트 케이스: ${target}` : `Playwright test case: ${target}`,
    ...guide.steps.map((step) => `${step.action} ${step.check}`)
  ];
}

function getTestStepsEn(title = '', suiteTitle = '') {
  const t = title.trim();
  const s = suiteTitle.toLowerCase();
  const standardSteps = getStandardTestSteps(t, suiteTitle, false);
  if (standardSteps.length) return standardSteps;

  const pageMap = {
    'home': 'Home page',
    'schedule': 'Event Schedule page',
    'standings': 'Player Standings page',
    'news': 'News Articles list page',
    'photos': 'Photo Gallery page',
    'videos': 'Video Clips list page',
    'tournaments': 'Tournaments list page',
    'players': 'Player Rankings page',
    'play online': 'Play Online page',
    'hall of fame': 'Hall of Fame page'
  };

  let targetPageName = 'the target page';
  let targetPageKey = '';
  for (const [key, val] of Object.entries(pageMap)) {
    if (new RegExp(key, 'i').test(t)) {
      targetPageName = val;
      targetPageKey = key;
      break;
    }
  }

  // Phase 2 Functional flows
  if (/first news item opens a detail page/i.test(t)) {
    return [
      'Navigate to the news page and click on the first news item in the list.',
      'Observe if the browser redirects to the news detail page and renders the article body (paragraphs and title).',
      'Assert that the article title on the detail page matches the clicked item and contains valid content.'
    ];
  }
  if (/search or trending list opens a player profile/i.test(t)) {
    return [
      'Open the player search section, type a search keyword (or click a player from the trending list) and select the player.',
      'Observe if the page redirects to the player\'s profile page and displays core stats (such as bracelets, cashes, earnings).',
      'Assert that the loaded player profile corresponds to the selected player with accurate summary stats.'
    ];
  }
  if (/ranking sections link through to player profiles/i.test(t)) {
    return [
      'Navigate to the Player Standings page and click on a player name link in one of the ranking tables.',
      'Observe if the browser transitions successfully to the player\'s profile details page.',
      'Assert that the player profile URL is valid and the header displays the matching player identity.'
    ];
  }
  if (/filters are clickable and a tournament detail/i.test(t)) {
    return [
      'Navigate to the Tournament Schedule page, interact with various filters (Year/Month/Type), and click on a tournament item.',
      'Observe if the schedule list filters correctly and redirects to the tournament details page upon selection.',
      'Assert that the tournament detail page loads successfully and preserves the identical event title.'
    ];
  }

  if (/opens and shows core content/i.test(t)) {
    return [
      `Perform web interaction (page navigation) to open the ${targetPageName}.`,
      `Observe the UI state transitions and check for any layout breakages or malfunctioning during page rendering.`,
      `Assert that actual loaded elements (header, navigation bar, main hero sliders) match the expected page specifications.`
    ];
  }

  if (/top menu is available/i.test(t)) {
    return [
      `Navigate to home page and hover over the [${targetPageName}] menu item in the GNB header.`,
      `Observe page transition when the menu is clicked to ensure URL changes cleanly.`,
      `Assert that the target page loaded successfully and the main page title is visible.`
    ];
  }

  if (/has no unexpected console errors/i.test(t)) {
    return [
      `Open browser and perform web interaction to navigate directly to the ${targetPageName}.`,
      `Observe browser console logs during page loading and JavaScript bootstrap execution.`,
      `Assert that no unexpected critical JavaScript console errors are captured.`
    ];
  }

  if (/has no broken sampled internal links/i.test(t)) {
    return [
      `Navigate to the ${targetPageName} and query all internal hyperlink elements (a[href]) on the page.`,
      `Sample up to 30 internal links and make background HTTP requests to check their validity.`,
      `Assert that the response status codes for all sampled links are normal (under 400).`
    ];
  }

  if (t.includes('crawler standings-only target rows') || t.includes('standings-only target rows')) {
    return [
      'Load standing targets data (JSON) and sample representative players for Phase 3 UI validation.',
      'Locate each player\'s row in the standings table and perform row-level checks.',
      'Observe the visibility of name, country text, or flag images.',
      'Assert that a player image/avatar is visible (except for All Player Stats category).'
    ];
  }

  if (t.includes('representative top players') || t.includes('representative')) {
    return [
      'Navigate to the Player Standings main page (/player-standings/) and identify representative top players.',
      'Click on the player name to navigate to their profile page.',
      'Assert that the player profile page loads successfully with matching info.'
    ];
  }

  if (t.includes('pagination') || t.includes('page count')) {
    return [
      'Interact with the pagination control at the bottom of the table.',
      'Navigate to the last page and observe if the player list updates correctly.',
      'Assert that the page count is stable and pagination controls do not malfunction.'
    ];
  }

  if (t.includes('all player stats filter') || t.includes('filtering and sorting')) {
    return [
      'Select and adjust the dropdown filters (Season, Brand, Country, Gender) in the All Player Stats section.',
      'Observe the table rows updating dynamically according to the filter and sort parameters.',
      'Assert that the row data values and order conform to the selected filters.'
    ];
  }

  if (/lowercase/i.test(t)) {
    return [
      'Enter a search query in all lowercase (e.g. "phil hellmuth") into the search input.',
      'Observe if the application performs case-insensitive matching and updates the player list.',
      'Assert that the expected player is correctly found in the results.'
    ];
  }
  if (/partial/i.test(t)) {
    return [
      'Enter a partial player name (e.g. "negreanu") into the search input.',
      'Observe if the application filters the player list to find matches containing the keyword.',
      'Assert that the expected player is included in the search results.'
    ];
  }
  if (/trim/i.test(t)) {
    return [
      'Enter a search query with leading and trailing whitespaces (e.g. "  Phil Ivey  ") into the search input.',
      'Observe if the search query is trimmed properly and updates the player list.',
      'Assert that the expected player is correctly found in the results.'
    ];
  }
  if (/no result/i.test(t)) {
    return [
      'Enter a query with no matches (e.g. "zzzz-no-player-test-qa") into the search input.',
      'Observe if the application handles empty results gracefully and displays a message.',
      'Assert that the "No results" UI message is visible.'
    ];
  }
  if (/non-english/i.test(t)) {
    return [
      'Enter a query with non-English characters (e.g. Cyrillic) into the search input.',
      'Observe if the application processes Unicode strings without errors and returns matches.',
      'Assert that the matching non-English player is correctly found.'
    ];
  }
  if (/exact full name/i.test(t)) {
    return [
      'Enter an exact full name (e.g. "Phil Hellmuth") and observe if autocomplete options are shown.',
      'Click on the autocomplete item or press enter to navigate to the player\'s profile page.',
      'Assert that the loaded profile details match the expected player.'
    ];
  }
  if (/search/i.test(t)) {
    return [
      'Enter search keywords into the player search input.',
      'Observe if the autocomplete or search results table updates dynamically.',
      'Assert that the matching search result is displayed in the list.'
    ];
  }

  if (s.includes('phase 5') && (t.includes('result row') || t.includes('row'))) {
    return [
      'Verify the tournament results row structure on the page.',
      'Observe the rendering of rank, cash prize, and player information.',
      'Assert that the results match the expected row format and contents.'
    ];
  }

  if (s.includes('phase 5') && (t.includes('result detail') || t.includes('detail'))) {
    return [
      'Click the tournament result link to navigate to the event result detail page.',
      'Observe if event details and table headers are properly rendered.',
      'Assert that page load state and server responses are valid.'
    ];
  }

  if (s.includes('phase 5') && (t.includes('backlink') || t.includes('profile'))) {
    return [
      'Click the player name link on the tournament result detail page to navigate back to the profile page.',
      'Observe the page routing action to ensure the profile loads.',
      'Assert that you successfully navigated back to the correct player profile page.'
    ];
  }

  return [
    `Perform web interaction to open the page or access the targeted functionality (${title}).`,
    'Observe UI state transitions and check for rendering defects.',
    'Assert the validity and integrity of the targeted elements.'
  ];
}

function getTestStepsKo(title = '', suiteTitle = '') {
  const t = title.trim();
  const s = suiteTitle.toLowerCase();
  const standardSteps = getStandardTestSteps(t, suiteTitle, true);
  if (standardSteps.length) return standardSteps;

  // 대상 페이지명 추출 및 한글화 맵
  const pageMap = {
    'home': '홈화면',
    'schedule': '이벤트 스케줄 화면',
    'standings': '플레이어 스탠딩 화면',
    'news': '뉴스 기사 목록 화면',
    'photos': '포토 갤러리 화면',
    'videos': '비디오 클립 화면',
    'tournaments': '토너먼트 목록 화면',
    'players': '플레이어 랭킹 화면',
    'play online': '온라인 게임 화면',
    'hall of fame': '명예의 전당 화면'
  };

  // 타이틀에서 어떤 페이지 이름이 쓰였는지 매칭
  let targetPageName = '해당 화면';
  let targetPageKey = '';
  for (const [key, val] of Object.entries(pageMap)) {
    if (new RegExp(key, 'i').test(t)) {
      targetPageName = val;
      targetPageKey = key;
      break;
    }
  }

  // Phase 2 Functional flows
  if (/first news item opens a detail page/i.test(t)) {
    return [
      '뉴스 목록 페이지에 진입하여 가장 상단에 위치한 첫 번째 뉴스 아이템을 클릭하는 웹 인터랙션을 수행합니다.',
      '상세 기사 페이지로 정상적으로 이동하고, 기사의 본문 내용(텍스트 단락, 이미지, 제목)이 올바르게 로드되는지 관찰합니다.',
      '로드된 상세 페이지의 제목이 클릭한 뉴스 아이템과 정확히 일치하며 유효한 기사 내용을 포함하고 있는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/search or trending list opens a player profile/i.test(t)) {
    return [
      '플레이어 검색/조회 탭을 활성화하여 키워드 검색을 수행하거나 트렌딩 목록의 선수를 클릭하는 웹 인터랙션을 수행합니다.',
      '해당 선수의 상세 프로필 페이지로 라우팅되며 요약 스탯(브레이슬릿 수, 입상 횟수, 총 상금 등)이 정상 렌더링되는지 관찰합니다.',
      '상세 프로필 화면의 선수 정보 및 통계 데이터가 실제 선택한 선수와 일치하는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/ranking sections link through to player profiles/i.test(t)) {
    return [
      '플레이어 Standings 화면에 진입하여 대표 순위 섹션 테이블 내의 특정 선수 링크를 클릭하는 웹 인터랙션을 수행합니다.',
      '해당 선수의 상세 프로필 페이지로 유실 없이 라우팅이 완료되는지 관찰합니다.',
      '이동한 프로필 페이지의 헤더 영역 정보가 클릭한 선수 정보와 일치하는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/filters are clickable and a tournament detail/i.test(t)) {
    return [
      '토너먼트 일정 페이지에 진입하여 연도/월/종류 등 필터 버튼을 조작하고 특정 토너먼트 상세 링크를 클릭하는 웹 인터랙션을 수행합니다.',
      '일정 데이터가 필터에 맞게 정렬 및 갱신되며, 상세 화면으로 자연스럽게 라우팅되는지 관찰합니다.',
      '로드된 토너먼트 상세 페이지의 헤더에 동일한 대회 타이틀이 유실 없이 그대로 보존되어 있는지 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 1. [Smoke] * opens and shows core content
  if (/opens and shows core content/i.test(t)) {
    return [
      `${targetPageName} 오픈 웹 인터랙션(페이지 이동)을 수행합니다.`,
      `${targetPageName} UI의 상태 변경 및 렌더링 결과에 깨짐이나 오동작이 발생하는지 관찰합니다.`,
      `${targetPageName}의 예측되는 스펙 상태(헤더, GNB, 메인 슬라이드)와 실제 로드된 요소를 단언(Assertion)하여 일치 여부를 판독합니다.`
    ];
  }

  // 2. [Smoke] * top menu is available
  if (/top menu is available/i.test(t)) {
    return [
      `홈화면에 접속한 뒤, GNB 헤더의 [${targetPageName}] 탑 메뉴를 탐색(Hover)하는 웹 인터랙션을 수행합니다.`,
      `[${targetPageName}] 메뉴 클릭 시 대상 경로로의 화면 전환이 매끄럽게 이루어지고 브라우저 주소가 바뀌는지 관찰합니다.`,
      `대상 페이지 로딩 후 해당 주소 및 대표 문구가 정상적으로 렌더링되었는지 단언(Assertion)하여 일치 여부를 판독합니다.`
    ];
  }

  // 3. [Smoke] * has no unexpected console errors
  if (/has no unexpected console errors/i.test(t)) {
    return [
      `브라우저를 열어 ${targetPageName}에 직접 진입하는 웹 인터랙션을 수행합니다.`,
      `페이지 로드와 자바스크립트 부트스트랩 실행 중 브라우저 콘솔(Console)에 에러가 수집되는지 관찰합니다.`,
      `알려진 서드파티 에러를 제외한 치명적인 스크립트 실행 오류가 없음을 단언(Assertion)하여 품질을 판독합니다.`
    ];
  }

  // 4. [Smoke] * has no broken sampled internal links
  if (/has no broken sampled internal links/i.test(t)) {
    return [
      `브라우저로 ${targetPageName}에 진입하여 페이지 내부의 모든 하이퍼링크(a[href])를 수집하는 웹 인터랙션을 수행합니다.`,
      `수집된 링크 중 내부로 연결되는 링크들을 최대 30개까지 샘플링하여 백엔드 API 요청을 날려 관찰합니다.`,
      `각 링크들의 응답 상태코드(HTTP Status)가 정상(400 미만)인지 단언(Assertion)하여 일치 여부를 판독합니다.`
    ];
  }

  // 5. [Phase 3] crawler standings-only target rows expose player identity UI
  if (t.includes('crawler standings-only target rows') || t.includes('standings-only target rows')) {
    return [
      '크롤링 수집된 플레이어 데이터 목록(JSON)을 로드하고 순위 카테고리별 샘플 대상을 선정합니다.',
      '각 샘플 플레이어가 랭킹 테이블 내에서 정상적으로 식별되는지 행(Row) 탐색 인터랙션을 수행합니다.',
      '이름, 국가(국기 이미지 또는 텍스트)의 가시성 상태를 관찰합니다.',
      'All Player Stats를 제외한 카테고리는 실제 선수 아바타 이미지가 비어있지 않은지 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 6. [Phase 3] representative top players
  if (t.includes('representative top players') || t.includes('representative')) {
    return [
      '플레이어 Standings 메인 페이지(/player-standings/)에 직접 접속하여 랜드마크 탑 플레이어 3인을 식별합니다.',
      '선수명을 클릭하여 프로필 상세화면으로 전환되는 과정의 동작을 관찰합니다.',
      '상세 프로필 화면의 선수 정보(국적, 이름, 아바타)가 정상 로딩되었음을 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 7. [Phase 4] pagination / page count
  if (t.includes('pagination') || t.includes('page count')) {
    return [
      'All Player Stats 하단 테이블이나 검색 결과 목록의 페이지네이션 컨트롤러를 클릭하는 웹 인터랙션을 수행합니다.',
      '마지막 페이지 번호 버튼을 클릭 시 데이터 목록이 정상 갱신되는지 관찰합니다.',
      '전체 페이지 수 계산기가 버그로 인해 비정상적으로 계속 증가하거나 오동작하는 에러가 없는지 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 8. [Phase 4] all player stats filter / filtering and sorting
  if (t.includes('all player stats filter') || t.includes('filtering and sorting')) {
    return [
      'All Player Stats 테이블의 드롭다운 필터(Season, Brand, Country, Gender)들을 선택 및 조작합니다.',
      '선택한 필터와 정렬 기준에 맞게 테이블 데이터 순서 및 행들이 서버 데이터에 맞게 갱신되는지 관찰합니다.',
      '정렬된 결과의 수치 및 필터 상태가 정상임을 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 9. [Phase 4] search / trim / lowercase / partial / no result / non-english / exact name
  if (/lowercase/i.test(t)) {
    return [
      '검색 바에 모든 문자를 소문자로 작성한 검색어(예: "phil hellmuth")를 입력하는 인터랙션을 수행합니다.',
      '어플리케이션이 대소문자를 구분하지 않고(Case-insensitive) 검색 요청을 소화하여 선수 목록을 갱신하는지 관찰합니다.',
      '검색된 리스트에서 대소문자 구분 없이 타겟 선수가 정확하게 도출되었는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/partial/i.test(t)) {
    return [
      '검색 바에 성이나 이름의 일부분만 포함한 검색어(예: "negreanu")를 입력하는 인터랙션을 수행합니다.',
      '어플리케이션이 부분 매칭을 지원하여 해당하는 선수 목록을 필터링 및 갱신하는지 관찰합니다.',
      '검색된 리스트에서 부분 일치하는 타겟 선수가 목록에 포함되었는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/trim/i.test(t)) {
    return [
      '검색 바에 앞뒤 불필요한 공백을 추가한 검색어(예: "  Phil Ivey  ")를 입력하는 인터랙션을 수행합니다.',
      '어플리케이션이 공백을 다듬고(Trim) 검색 요청을 안정적으로 소화하여 선수 목록을 갱신하는지 관찰합니다.',
      '검색된 리스트에서 공백이 제거된 타겟 선수가 정확하게 도출되었는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/no result/i.test(t)) {
    return [
      '검색 바에 존재하지 않는 임의의 검색어(예: "zzzz-no-player-test-qa")를 입력하는 인터랙션을 수행합니다.',
      '어플리케이션이 검색 결과가 없는 상황을 정상적으로 처리하고 화면에 안내 메시지를 노출하는지 관찰합니다.',
      '검색 결과 없음 UI(예: "No players found")가 정상적으로 활성화되었는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/non-english/i.test(t)) {
    return [
      '검색 바에 비영어권 문자(예: 키릴 문자 등)의 선수명 검색어를 입력하는 인터랙션을 수행합니다.',
      '어플리케이션이 유니코드 문자열을 깨짐 없이 안전하게 검색 요청으로 처리하고 결과를 갱신하는지 관찰합니다.',
      '검색된 리스트에 비영어권 타겟 선수가 정상적으로 도출되는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/exact full name/i.test(t)) {
    return [
      '검색 바에 특정 선수의 정확한 풀네임(예: "Phil Hellmuth")을 입력하고 자동완성(Autocomplete) 목록이 표시되는지 관찰합니다.',
      '자동완성 항목을 선택하거나 엔터를 눌러 해당 선수의 프로필로 바로 진입하는 웹 인터랙션을 수행합니다.',
      '로드된 프로필 상세화면의 정보가 실제 검색한 선수와 완벽히 일치하는지 단언(Assertion)하여 판독합니다.'
    ];
  }
  if (/search/i.test(t)) {
    return [
      '플레이어 검색창에 검색어 키워드를 입력하는 웹 인터랙션을 수행합니다.',
      '입력한 키워드에 따라 자동완성 또는 검색 결과 목록이 정상적으로 업데이트되는지 관찰합니다.',
      '도출된 검색 결과가 예상한 선수 데이터와 일치하는지 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 10. [Phase 5] result row
  if (s.includes('phase 5') && (t.includes('result row') || t.includes('row'))) {
    return [
      '대회 결과 상세 페이지의 개별 행 데이터를 확인하는 웹 인터랙션을 수행합니다.',
      '대회 순위 및 우승자 등의 정보가 정상 렌더링되는지 관찰합니다.',
      '예상되는 우승 및 랭킹 정합성 기준을 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 11. [Phase 5] result detail
  if (s.includes('phase 5') && (t.includes('result detail') || t.includes('detail'))) {
    return [
      '개별 대회 결과 링크를 클릭하여 결과 상세 페이지로 라우팅하는 웹 인터랙션을 수행합니다.',
      '대회별 이벤트 정보, 테이블 결과 데이터가 깨짐 없이 정상 렌더링되는지 관찰합니다.',
      '상세 페이지 로딩 상태 및 API 연동 무결성을 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 12. [Phase 5] backlink
  if (s.includes('phase 5') && (t.includes('backlink') || t.includes('profile'))) {
    return [
      '결과 상세 페이지에서 특정 선수의 이름을 클릭하여 해당 플레이어 프로필로 되돌아가는 백링크 웹 인터랙션을 수행합니다.',
      '플레이어 프로필 페이지로 역추적되어 로드되는 동작을 관찰합니다.',
      '선택한 플레이어 본인의 프로필 화면으로 올바르게 귀환했음을 단언(Assertion)하여 판독합니다.'
    ];
  }

  // 기본 반환용 (Fallback)
  return [
    `해당 기능(${title})에 관련된 대상 요소 및 화면 오픈 웹 인터랙션을 수행합니다.`,
    '브라우저 UI 상태 변경 과정과 렌더링 상태에 이상이 없는지 관찰합니다.',
    '지정된 타겟 요소의 유효성과 정합성 상태를 단언(Assertion)하여 일치 여부를 판독합니다.'
  ];
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
  return `<details class="panel collapsible-panel">
    <summary class="panel-summary">
      <h2><svg viewBox="0 0 24 24" style="fill: var(--primary); width: 20px; height: 20px; flex-shrink: 0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/></svg>${escapeHtml(t.playerCoverageTitle)}</h2>
      <svg class="toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
      </svg>
    </summary>
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
        ${coverage.categories.map((category) => `<span class="category-pill" data-category-filter="${escapeHtml(category.name)}">${escapeHtml(category.name)}: ${escapeHtml(String(category.total))} (${escapeHtml(String(category.passed))}/${escapeHtml(String(category.warned))}/${escapeHtml(String(category.failed))})</span>`).join('')}
      </div>
      <div class="player-card-grid">
        ${coverage.players.map((player) => renderCoveragePlayerCard(player, t)).join('')}
      </div>
    </div>
  </details>`;
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

function localizeSuiteTitleKo(value = '') {
  const normalized = value.toLowerCase();
  const suiteRules = [
    [/phase 1/i, 'Phase 1 - 퍼블릭 스모크'],
    [/phase 2/i, 'Phase 2 - 기능 플로우'],
    [/phase 3/i, 'Phase 3 - 플레이어 표현/식별 UI'],
    [/phase 4/i, 'Phase 4 - 검색/필터/정렬 심화'],
    [/phase 5/i, 'Phase 5 - 결과 상세 연결 무결성'],
    [/player presentation/i, '플레이어 표현 검증'],
    [/search[ -]?filter[ -]?sort/i, '검색/필터/정렬 검증'],
    [/result detail integrity/i, '결과 상세 무결성 검증'],
    [/functional/i, '기능 검증'],
    [/smoke/i, '스모크 검증'],
    [/legend/i, '레전드/특수 페이지 검증'],
    [/all player stats/i, 'All Player Stats 검증'],
    [/standings/i, '스탠딩 검증'],
  ];

  for (const [pattern, label] of suiteRules) {
    if (pattern.test(normalized)) {
      return `${label} (${value})`;
    }
  }

  return value;
}

function localizeTestTitleKo(value = '') {
  const rules = [
    [/numeric pagination last page click should not expand max page count unexpectedly/i, '숫자 페이지네이션 마지막 페이지 클릭 시 최대 페이지 수가 비정상 증가하지 않아야 함'],
    [/all player stats filter supports usable filtering and sorting/i, 'All Player Stats 화면에서 필터/정렬이 정상 동작해야 함'],
    [/renders a usable standings list/i, '스탠딩 목록이 정상 렌더링되고 사용 가능해야 함'],
    [/trimmed search is handled by player search/i, '앞뒤 공백이 있는 검색어를 정상 처리해야 함'],
    [/result row/i, '결과 행 정보 표시 검증'],
    [/result detail/i, '결과 상세 페이지 연결 및 표시 검증'],
    [/backlink/i, '결과 상세에서 플레이어 프로필 역링크 검증'],
    [/pagination/i, '페이지네이션/더보기 탐색 검증'],
    [/special page/i, '특수 페이지 렌더링 검증'],
    [/profile/i, '프로필 연결/표시 검증'],
    [/filter/i, '필터 동작 검증'],
    [/sort/i, '정렬 동작 검증'],
    [/search/i, '검색 동작 검증'],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(value)) {
      return `${label} (${value})`;
    }
  }

  return value;
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

// formatOverallStatus is defined in the override block at the bottom of this file.

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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const isResultDetail = suite === 'result-detail';
  const isDataIntegrity = suite === 'data-integrity';
  const isPerformanceStability = suite === 'performance-stability';
  const isVisualRegression = suite === 'visual-regression';
  const isRegression = suite === 'regression';

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
  } else if (isResultDetail) {
    titleKo = 'WSOP Phase 5 결과 상세 연결 무결성 리포트';
    titleEn = 'WSOP Phase 5 Result Detail Integrity Verification Report';
    subtitleKo = '대회 결과 목록에서 결과 상세 페이지로의 연결 무결성, 렌더링 상태 및 프로필로의 역링크 작동을 확인한 결과입니다.';
    subtitleEn = 'A validation of hyperlink integrity from tournament results to detail pages, rendering status, and profile backlinks.';
    eyebrowKo = 'WSOP Phase 5 Result Detail Integrity';
    eyebrowEn = 'WSOP Phase 5 Result Detail Integrity';
  } else if (isDataIntegrity) {
    titleKo = 'WSOP Phase 6 데이터/API 정합성 검증 리포트';
    titleEn = 'WSOP Phase 6 Data and API Integrity Verification Report';
    subtitleKo = '정적 expected 데이터와 공개 UI 수치, playerId/onepassId 매핑 및 합계 계산을 비교 검증한 결과입니다.';
    subtitleEn = 'A verification of public UI metrics, player identity mapping, and sum calculations against expected data.';
    eyebrowKo = 'WSOP Phase 6 Data & API Integrity';
    eyebrowEn = 'WSOP Phase 6 Data & API Integrity';
  } else if (isPerformanceStability) {
    titleKo = 'WSOP Phase 7 성능 및 안정성 리포트';
    titleEn = 'WSOP Phase 7 Core Flow Performance & Stability Report';
    subtitleKo = '핵심 기능 시나리오(Standings to Profile, Search to Profile)의 인터랙션 반응 시간 및 성능 지표 검증 결과입니다.';
    subtitleEn = 'Interaction response times and performance metrics validation for key user flow scenarios.';
    eyebrowKo = 'WSOP Phase 7 Performance';
    eyebrowEn = 'WSOP Phase 7 Performance';
  } else if (isVisualRegression) {
    titleKo = 'WSOP Phase 8 시각적 회귀 검증 리포트';
    titleEn = 'WSOP Phase 8 Visual Regression Verification Report';
    subtitleKo = '핵심 UI 화면들의 스크린샷을 기존 기준 이미지(Baseline)와 비교하여 예기치 못한 레이아웃 뒤틀림이 없는지 검증한 결과입니다.';
    subtitleEn = 'Layout integrity check comparing screenshot variations against active visual baselines.';
    eyebrowKo = 'WSOP Phase 8 Visual Regression';
    eyebrowEn = 'WSOP Phase 8 Visual Regression';
  } else if (isRegression) {
    titleKo = 'WSOP Phase 9 최종 릴리즈 게이트 리포트';
    titleEn = 'WSOP Phase 9 Full Regression Verification Report';
    subtitleKo = '배포 전 필수 검증 단계들의 최종 성공 여부 및 경고 상태를 종합 조율하여 게이트 통과를 검증한 결과입니다.';
    subtitleEn = 'Release gate clearance status combining multiple regression suites and validation checks.';
    eyebrowKo = 'WSOP Phase 9 Regression';
    eyebrowEn = 'WSOP Phase 9 Regression';
  }

  return isKo
    ? {
        isKo: true,
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
        isKo: false,
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
  if (report.suite === 'result-detail') {
    return isKo
      ? 'Phase 5는 대회 결과 상세 화면으로의 링크가 깨지지 않고 정상 로딩되는지, 해당 페이지에서 선수 프로필로 되돌아가는 백링크가 정상 작동하는지 확인합니다.'
      : 'Phase 5 checks whether links to tournament result detail pages are intact, load correctly, and confirm the backlink to the player profile functions properly.';
  }
  if (report.suite === 'data-integrity') {
    return isKo
      ? 'Phase 6는 공개 UI의 수치 정보가 원천 데이터(expected fixture)와 일치하는지, 계산 및 ID 매핑이 정합한지 검증합니다. 실데이터 변경에 따른 Stale Warning을 감안해 확인해 주세요.'
      : 'Phase 6 checks consistency between public UI values and source (expected) data. Review annotations for potentially stale fixtures due to real-time site updates.';
  }
  if (report.suite === 'performance-stability') {
    return isKo
      ? 'Phase 7은 주요 페이지 최초 로딩 및 핵심 시나리오 반응 속도를 측정합니다. 반응 속도가 5.0초 임계치를 초과하는 경우 실패 처리됩니다.'
      : 'Phase 7 measures initial page load and key scenario interaction latency. Latency exceeding 5.0s is flagged as failure.';
  }
  if (report.suite === 'visual-regression') {
    return isKo
      ? 'Phase 8은 기존 Baseline 스크린샷과 비교하여 레이아웃 무결성을 검증합니다. 시각적 허용 오차는 1.5% 미만이어야 합니다.'
      : 'Phase 8 checks layout visual consistency with baseline images. Pixels mismatch threshold must be under 1.5%.';
  }
  if (report.suite === 'regression') {
    return isKo
      ? 'Phase 9는 전체 릴리즈 게이트 통과를 위해 필수 단계(Phase 1~6)의 결과를 취합하여 통과 요건을 검증합니다.'
      : 'Phase 9 evaluates overall release eligibility by aggregating results from required validation steps (Phase 1 to 6).';
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
