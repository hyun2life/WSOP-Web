const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const AUTO_LAUNCH = process.env.AUTO_LAUNCH !== 'false';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PHASES_JSON_PATH = path.join(PROJECT_ROOT, 'automation', 'phases.json');
const WEB_UI_DIR = path.join(PROJECT_ROOT, 'automation', 'web-ui');
const DEFAULT_BRAND_OPTIONS = [
  'WSOP',
  'GGPoker',
  'WPT',
  'PGT (Poker Go Tour)',
  'Irish Poker Open',
  'WSOP PARADISE',
  'WSOP EUROPE',
  'WSOP ASIA',
  'WSOP ONLINE',
  'WSOP CIRCUIT',
  'GGMASTERS',
  'GGMILLION$',
  'GGMILLIONS',
  'WPT PRIME',
  'TRITON',
  'PGT',
  'Irish Poker Tour',
];

let activeProcess = null;
let activePhaseId = null;
let sseClients = [];
let phaseStatuses = {};
let lastRunPhaseId = null;
let lastRunStartedAt = null;
let lastRunFinishedAt = null;
let lastRunExitCode = null;
let lastRunStatus = 'ready';

function terminateProcessTree(childProcess, reason = 'termination request') {
  if (!childProcess || !childProcess.pid) {
    return;
  }

  const pid = childProcess.pid;
  if (process.platform === 'win32') {
    exec(`chcp 65001 > nul && taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('').trim();
      if (output) {
        sendToSse('log', { text: `${output}\n` });
      }
      if (err) {
        sendToSse('log', { text: `[SERVER_WARN] Failed to terminate process tree ${pid}: ${err.message}\n` });
      }
    });
    return;
  }

  try {
    childProcess.kill('SIGINT');
  } catch (err) {
    sendToSse('log', { text: `[SERVER_WARN] Failed to terminate process ${pid}: ${err.message}\n` });
  }
}

// Helper to strip ANSI codes from logs for clean terminal view
function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Broadcaster to all connected SSE clients
function sendToSse(type, payload) {
  const message = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  sseClients.forEach(client => {
    client.write(message);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Static Files Serving
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    serveFile(path.join(WEB_UI_DIR, 'index.html'), 'text/html', res);
    return;
  }
  if (method === 'GET' && url === '/index.css') {
    serveFile(path.join(WEB_UI_DIR, 'index.css'), 'text/css', res);
    return;
  }
  if (method === 'GET' && url === '/index.js') {
    serveFile(path.join(WEB_UI_DIR, 'index.js'), 'application/javascript', res);
    return;
  }

  // 2. GET /api/phases
  if (method === 'GET' && url === '/api/phases') {
    if (!fs.existsSync(PHASES_JSON_PATH)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'phases.json not found' }));
      return;
    }
    const data = fs.readFileSync(PHASES_JSON_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
    return;
  }

  if (method === 'GET' && url === '/api/brand-options') {
    const payload = getLatestBrandOptionsPayload();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  // 3. GET /api/logs (SSE Channel)
  if (method === 'GET' && url === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Heartbeat to keep connection alive
    const keepAliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    sseClients.push(res);

    req.on('close', () => {
      clearInterval(keepAliveInterval);
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 4. POST /api/run
  if (method === 'POST' && url === '/api/run') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { phaseId, mode, customArgs, baseUrl } = JSON.parse(body);

        if (!phaseId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing phaseId' }));
          return;
        }

        // Kill any existing run
        if (activeProcess) {
          terminateProcessTree(activeProcess, 'new run requested');
          activeProcess = null;
        }

        // Build command arguments
        const args = ['scripts/run-phase.cjs', phaseId];

        // Mode flags override
        if (mode === 'Headed') {
          args.push('--', '--headed');
        } else if (mode === 'UI') {
          args.push('--', '--ui');
        }

        // Custom Arguments overriding
        if (customArgs && typeof customArgs === 'object') {
          // If the CLI pass-through has '--', append to it, otherwise insert it
          const passThroughIndex = args.indexOf('--');
          if (passThroughIndex === -1 && Object.keys(customArgs).length > 0) {
            args.push('--');
          }

          Object.entries(customArgs).forEach(([key, val]) => {
            if (val === null || val === undefined || val === '') {
              return;
            }

            // Boolean-like options should be emitted as standalone flags.
            if (val === true || String(val).toLowerCase() === 'true') {
              args.push(`--${key}`);
              return;
            }

            args.push(`--${key}`, String(val));
          });
        }

        // Reset phase statuses
        phaseStatuses = {};
        if (fs.existsSync(PHASES_JSON_PATH)) {
          try {
            const config = JSON.parse(fs.readFileSync(PHASES_JSON_PATH, 'utf8'));
            (config.phases || []).forEach(p => {
              if (p.implemented) {
                phaseStatuses[p.id] = 'ready';
              }
            });
          } catch (e) {
            console.error('Failed to parse phases.json for resetting status:', e);
          }
        }
        if (phaseId !== 'all') {
          phaseStatuses[phaseId] = 'running';
        }
        sendToSse('phase-statuses', { phaseStatuses });

        sendToSse('status', { status: 'running', phaseId });
        sendToSse('log', { text: `[SERVER] Starting execution: node ${args.join(' ')}\n` });
        lastRunPhaseId = phaseId;
        lastRunStartedAt = new Date().toISOString();
        lastRunFinishedAt = null;
        lastRunExitCode = null;
        lastRunStatus = 'running';

        const spawnEnv = { ...process.env };
        if (baseUrl) {
          spawnEnv.BASE_URL = baseUrl;
        }

        activeProcess = spawn('node', args, {
          cwd: PROJECT_ROOT,
          env: spawnEnv,
          shell: false
        });
        activePhaseId = phaseId;

        let stdoutBuf = '';
        activeProcess.stdout.on('data', data => {
          const text = stripAnsi(data.toString());
          sendToSse('log', { text });

          stdoutBuf += text;
          let lineEndIndex;
          while ((lineEndIndex = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.substring(0, lineEndIndex).trim();
            stdoutBuf = stdoutBuf.substring(lineEndIndex + 1);
            if (line) {
              parseLineForPhaseStatus(line);
            }
          }
        });

        let stderrBuf = '';
        activeProcess.stderr.on('data', data => {
          const text = stripAnsi(data.toString());
          sendToSse('log', { text });

          stderrBuf += text;
          let lineEndIndex;
          while ((lineEndIndex = stderrBuf.indexOf('\n')) !== -1) {
            const line = stderrBuf.substring(0, lineEndIndex).trim();
            stderrBuf = stderrBuf.substring(lineEndIndex + 1);
            if (line) {
              parseLineForPhaseStatus(line);
            }
          }
        });

        activeProcess.on('error', err => {
          sendToSse('log', { text: `[SERVER_ERROR] Failed to start process: ${err.message}\n` });
          sendToSse('status', { status: 'failed', code: -1 });
          lastRunFinishedAt = new Date().toISOString();
          lastRunExitCode = -1;
          lastRunStatus = 'failed';
          activeProcess = null;
          activePhaseId = null;
        });

        activeProcess.on('exit', (code, signal) => {
          const reason = signal ? `interrupted by ${signal}` : `exit code ${code}`;
          sendToSse('log', { text: `\n[SERVER] Process finished: ${reason}\n` });

          const finalStatus = resolveFinalStatus(activePhaseId, code);
          sendToSse('status', { status: finalStatus, code });
          lastRunFinishedAt = new Date().toISOString();
          lastRunExitCode = code ?? 1;
          lastRunStatus = finalStatus;

          if (activePhaseId && activePhaseId !== 'all') {
            updatePhaseStatus(activePhaseId, finalStatus);
          } else if (activePhaseId === 'all') {
            for (const pid in phaseStatuses) {
              if (phaseStatuses[pid] === 'running') {
                updatePhaseStatus(pid, finalStatus);
              }
            }
          }

          activeProcess = null;
          activePhaseId = null;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Test execution started' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5. POST /api/kill
  if (method === 'POST' && url === '/api/kill') {
    if (activeProcess) {
      try {
        terminateProcessTree(activeProcess, 'kill request received');
        sendToSse('log', { text: '\n[SERVER] Kill request received. Terminating process tree...\n' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Process tree termination requested' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active process to terminate' }));
    }
    return;
  }

  // 6. POST /api/open-report
  if (method === 'GET' && url.startsWith('/api/report-list')) {
    try {
      const requestUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const suite = requestUrl.searchParams.get('suite');
      const mode = requestUrl.searchParams.get('mode');

      if (!suite || !mode) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing suite or mode parameters' }));
        return;
      }

      if (suite === 'all') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ALL does not map to a single phase report. Select a specific phase.' }));
        return;
      }

      const reports = listReportCandidates(suite, mode).map((item) => ({
        path: item.path,
        displayName: item.displayName,
        modifiedAt: new Date(item.mtime).toISOString(),
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ suite, mode, reports }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7. POST /api/open-report
  if (method === 'POST' && url === '/api/open-report') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { suite, mode, reportPath } = JSON.parse(body);
        if (!suite || !mode) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing suite or mode parameters' }));
          return;
        }

        if (suite === 'all') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ALL does not map to a single phase report. Select a specific phase.' }));
          return;
        }

        try {
          const reportPathToOpen = resolveReportPathToOpen(suite, mode, reportPath);
          const reportMtimeIso = new Date(fs.statSync(reportPathToOpen).mtimeMs).toISOString();
          const selectedType = reportPath ? 'selected' : 'latest';
          sendToSse('log', { text: `[SERVER] Opening ${selectedType} ${mode} report for ${suite}: ${reportPathToOpen} (mtime: ${reportMtimeIso})\n` });
          if (lastRunStartedAt && Date.parse(reportMtimeIso) < Date.parse(lastRunStartedAt)) {
            sendToSse('log', {
              text: `[SERVER_WARN] Report file is older than the latest run start time. report=${reportMtimeIso}, runStart=${lastRunStartedAt}\n`
            });
          }

          if (process.platform === 'win32') {
            execSync(`start "" "${reportPathToOpen}"`, { stdio: 'ignore' });
          } else {
            const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            execSync(`${openCmd} "${reportPathToOpen}"`, { stdio: 'ignore' });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          sendToSse('log', { text: `[SERVER_ERROR] ${err.message}\n` });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 8. POST /api/shutdown
  if (method === 'POST' && url === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Server is shutting down...' }));

    sendToSse('log', { text: '\n[SERVER] Shutdown request received. Exiting process...\n' });

    // Terminate active child processes if any
    if (activeProcess) {
      terminateProcessTree(activeProcess, 'shutdown requested');
    }

    // Delay exit to allow response to flush to the client
    setTimeout(() => {
      console.log('WSOP Web Runner dashboard server has been shutdown by user request.');
      process.exit(0);
    }, 1000);
    return;
  }

  // 9. GET /api/status
  if (method === 'GET' && url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isRunning: activeProcess !== null,
      phaseId: activePhaseId,
      phaseStatuses: phaseStatuses,
      lastRun: {
        phaseId: lastRunPhaseId,
        startedAt: lastRunStartedAt,
        finishedAt: lastRunFinishedAt,
        exitCode: lastRunExitCode,
        status: lastRunStatus,
      },
    }));
    return;
  }

  // Route not found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function serveFile(filePath, contentType, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File Not Found');
    return;
  }
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}

function resolveReportPathToOpen(suite, mode, requestedReportPath) {
  const candidates = listReportCandidates(suite, mode);
  if (candidates.length === 0) {
    throw new Error(`No ${mode} report found for ${suite}`);
  }

  if (!requestedReportPath) {
    return candidates[0].path;
  }

  const normalizedRequested = path.normalize(String(requestedReportPath));
  const selected = candidates.find((item) => isSamePath(item.path, normalizedRequested));
  if (!selected) {
    throw new Error('Selected report is not available for this suite/mode.');
  }

  return selected.path;
}

function listReportCandidates(suite, mode) {
  const normalized = String(suite || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('Invalid suite');
  }

  let outputDir;
  let prefix;

  if (normalized === 'crawler') {
    outputDir = path.resolve(PROJECT_ROOT, '..', 'WSOP-Player-Standings-Crawler', 'automation', 'output');
    prefix = 'wsop-player-crawler-live';
  } else {
    outputDir = path.join(PROJECT_ROOT, 'automation', 'output');
    prefix = `wsop-public-${normalized}`;
  }

  if (!fs.existsSync(outputDir)) {
    throw new Error(`Output directory not found: ${outputDir}`);
  }

  const escapeRegExp = (val) => val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = {
    ko: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-report-ko\\.html$`),
    en: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-report\\.html$`),
    playwright: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-playwright-report$`),
  };
  const pattern = patterns[mode];
  if (!pattern) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const reports = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => pattern.test(entry.name))
    .map((entry) => {
      const target = path.join(outputDir, entry.name);
      const reportPath = entry.isDirectory() ? path.join(target, 'index.html') : target;
      if (!fs.existsSync(reportPath)) return null;
      return {
        path: reportPath,
        displayName: entry.name + (entry.isDirectory() ? '/index.html' : ''),
        mtime: fs.statSync(reportPath).mtimeMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  return reports;
}

function isSamePath(left, right) {
  const a = path.normalize(String(left || ''));
  const b = path.normalize(String(right || ''));
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function resolveFinalStatus(phaseId, code) {
  if (code !== 0) {
    return 'failed';
  }

  if (!phaseId || phaseId === 'all') {
    return 'success';
  }

  const suite = getReportSuiteByPhaseId(phaseId);
  if (suite && hasWarningInLatestReport(suite, lastRunStartedAt)) {
    return 'warning';
  }

  return 'success';
}

function getReportSuiteByPhaseId(phaseId) {
  if (!phaseId || !fs.existsSync(PHASES_JSON_PATH)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(PHASES_JSON_PATH, 'utf8'));
    const phase = (config.phases || []).find((item) => String(item.id || '').toLowerCase() === String(phaseId).toLowerCase());
    return phase?.reportSuite || null;
  } catch {
    return null;
  }
}

function hasWarningInLatestReport(suite, runStartedAtIso) {
  const jsonPath = getLatestReportJsonPath(suite);
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    return false;
  }

  const mtimeMs = fs.statSync(jsonPath).mtimeMs;
  if (runStartedAtIso && mtimeMs < Date.parse(runStartedAtIso)) {
    // Ignore stale report files from previous runs.
    return false;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const summaryStatus = String(parsed?.summary?.status || '').toLowerCase();
    if (summaryStatus === 'warn' || summaryStatus === 'warning') {
      return true;
    }
    if (Number(parsed?.summary?.warningSteps || 0) > 0) {
      return true;
    }
    if (Number(parsed?.warningSteps || 0) > 0) {
      return true;
    }
    if (Array.isArray(parsed?.warnings) && parsed.warnings.length > 0) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function getLatestReportJsonPath(suite) {
  const normalized = String(suite || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) {
    return null;
  }

  if (normalized === 'crawler') {
    const dir = path.resolve(PROJECT_ROOT, '..', 'WSOP-Player-Standings-Crawler', 'automation', 'output');
    return findLatestMatchingFile(dir, /^wsop-player-crawler-live-\d{8}-\d{6}(?:-\d{3})?-report\.json$/);
  }

  const dir = path.join(PROJECT_ROOT, 'automation', 'output');
  const pattern = new RegExp(`^wsop-public-${normalized}-\\d{8}-\\d{6}(?:-\\d{3})?-report\\.json$`);
  return findLatestMatchingFile(dir, pattern);
}

function findLatestMatchingFile(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const candidates = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      return {
        path: fullPath,
        mtime: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return candidates.length > 0 ? candidates[0].path : null;
}

function getLatestBrandOptionsPayload() {
  const latest = findLatestCrawlerDataWithBrandOptions();
  if (latest) {
    return latest;
  }

  return {
    source: 'default',
    sourceLabel: '기본 브랜드 목록',
    count: DEFAULT_BRAND_OPTIONS.length,
    rawCount: DEFAULT_BRAND_OPTIONS.length,
    options: DEFAULT_BRAND_OPTIONS,
    rawOptions: DEFAULT_BRAND_OPTIONS,
    updatedAt: null,
    reportPath: null,
  };
}

function findLatestCrawlerDataWithBrandOptions() {
  const dirs = [
    path.resolve(PROJECT_ROOT, '..', 'WSOP-Player-Standings-Crawler', 'automation', 'output'),
    path.join(PROJECT_ROOT, 'automation', 'output'),
  ];

  const candidates = [];
  const dataPattern = /(?:crawler|standings).*-(?:data|report)\.json$/i;

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && dataPattern.test(entry.name))
      .forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        candidates.push({
          path: fullPath,
          mtime: fs.statSync(fullPath).mtimeMs,
        });
      });
  });

  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate.path, 'utf8'));
      const normalized = normalizeBrandOptionsPayload(parsed.brandOptions);
      if (!normalized.options.length) continue;

      return {
        source: 'latest-crawler-json',
        sourceLabel: '최근 크롤러 JSON',
        count: normalized.options.length,
        rawCount: normalized.rawOptions.length,
        options: normalized.options,
        rawOptions: normalized.rawOptions,
        collectedAt: parsed.brandOptions?.collectedAt || null,
        sourceUrl: parsed.brandOptions?.sourceUrl || parsed.playersUrl || null,
        sourceCategory: parsed.brandOptions?.sourceCategory || null,
        updatedAt: new Date(candidate.mtime).toISOString(),
        reportPath: candidate.path,
      };
    } catch {
      // Ignore stale or unrelated JSON files.
    }
  }

  return null;
}

function normalizeBrandOptionsPayload(value) {
  const rawOptions = Array.isArray(value)
    ? value
    : Array.isArray(value?.rawOptions)
      ? value.rawOptions
      : Array.isArray(value?.options)
        ? value.options
        : [];
  const options = Array.isArray(value?.options) ? value.options : rawOptions;

  return {
    rawOptions: uniqueLabels(rawOptions),
    options: uniqueLabels(options),
  };
}

function uniqueLabels(values) {
  const seen = new Set();
  const result = [];

  (values || []).forEach((value) => {
    const label = String(value || '').replace(/\s+/g, ' ').trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(label);
  });

  return result;
}

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`WSOP Web Runner dashboard server running at http://${displayHost}:${PORT}`);
  console.log(`Remote access is available via network IP of this server.`);

  if (AUTO_LAUNCH) {
    // Auto-launch browser window based on OS
    const openCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`${openCmd} http://${displayHost}:${PORT}`, err => {
      if (err) {
        console.log('Skipped auto-opening browser or default browser not found.');
      }
    });
  }
});

function parseLineForPhaseStatus(line) {
  // 1. Start check
  let match = line.match(/Running\s+(phase\d+|crawler)\s*:/i) ||
    line.match(/Starting:\s*(phase\d+|crawler)/i);
  if (match) {
    const phaseId = match[1].toLowerCase();
    updatePhaseStatus(phaseId, 'running');
    return;
  }

  // 2. Success check
  match = line.match(/\[SUCCESS\]\s*(phase\d+|crawler)\s+completed/i);
  if (match) {
    const phaseId = match[1].toLowerCase();
    updatePhaseStatus(phaseId, 'success');
    return;
  }

  // 3. Failed check
  match = line.match(/\[ERROR\]\s*(phase\d+|crawler)\s+failed/i) ||
    line.match(/Execution\s+failed\s+for\s*(phase\d+|crawler)/i);
  if (match) {
    const phaseId = match[1].toLowerCase();
    updatePhaseStatus(phaseId, 'failed');
    return;
  }
}

function updatePhaseStatus(phaseId, status) {
  phaseStatuses[phaseId] = status;
  sendToSse('phase-status', { phaseId, status });
}
