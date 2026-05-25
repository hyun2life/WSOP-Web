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

let activeProcess = null;
let activePhaseId = null;
let sseClients = [];

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
          try {
            activeProcess.kill('SIGINT');
          } catch (e) { }
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
            if (val !== null && val !== undefined && val !== '') {
              args.push(`--${key}`, String(val));
            }
          });
        }

        sendToSse('status', { status: 'running', phaseId });
        sendToSse('log', { text: `[SERVER] Starting execution: node ${args.join(' ')}\n` });

        const spawnEnv = { ...process.env };
        if (baseUrl) {
          spawnEnv.BASE_URL = baseUrl;
        }

        activeProcess = spawn('node', args, {
          cwd: PROJECT_ROOT,
          env: spawnEnv,
          shell: true
        });
        activePhaseId = phaseId;

        activeProcess.stdout.on('data', data => {
          const text = stripAnsi(data.toString());
          sendToSse('log', { text });
        });

        activeProcess.stderr.on('data', data => {
          const text = stripAnsi(data.toString());
          sendToSse('log', { text });
        });

        activeProcess.on('error', err => {
          sendToSse('log', { text: `[SERVER_ERROR] Failed to start process: ${err.message}\n` });
          sendToSse('status', { status: 'failed', code: -1 });
          activeProcess = null;
          activePhaseId = null;
        });

        activeProcess.on('exit', (code, signal) => {
          const reason = signal ? `interrupted by ${signal}` : `exit code ${code}`;
          sendToSse('log', { text: `\n[SERVER] Process finished: ${reason}\n` });
          sendToSse('status', { status: code === 0 ? 'success' : 'failed', code });
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
        activeProcess.kill('SIGINT');
        sendToSse('log', { text: '\n[SERVER] Kill request received. Terminating process...\n' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Process termination signal sent' }));
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
  if (method === 'POST' && url === '/api/open-report') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { suite, mode } = JSON.parse(body);
        if (!suite || !mode) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing suite or mode parameters' }));
          return;
        }

        try {
          const reportPath = getLatestReportPath(suite, mode);
          sendToSse('log', { text: `[SERVER] Opening latest ${mode} report for ${suite}: ${reportPath}\n` });

          if (process.platform === 'win32') {
            execSync(`start "" "${reportPath}"`, { stdio: 'ignore' });
          } else {
            const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
            execSync(`${openCmd} "${reportPath}"`, { stdio: 'ignore' });
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

  // 7. POST /api/shutdown
  if (method === 'POST' && url === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Server is shutting down...' }));

    sendToSse('log', { text: '\n[SERVER] Shutdown request received. Exiting process...\n' });

    // Terminate active child processes if any
    if (activeProcess) {
      try {
        activeProcess.kill('SIGINT');
      } catch (e) {}
    }

    // Delay exit to allow response to flush to the client
    setTimeout(() => {
      console.log('WSOP Web Runner dashboard server has been shutdown by user request.');
      process.exit(0);
    }, 1000);
    return;
  }

  // 8. GET /api/status
  if (method === 'GET' && url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isRunning: activeProcess !== null,
      phaseId: activePhaseId
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

function getLatestReportPath(suite, mode) {
  const normalized = suite.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
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

  const pattern = patterns[mode] || patterns.ko;

  const candidates = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => pattern.test(entry.name))
    .map(entry => {
      const target = path.join(outputDir, entry.name);
      const reportPath = entry.isDirectory() ? path.join(target, 'index.html') : target;
      if (!fs.existsSync(reportPath)) return null;

      return {
        path: reportPath,
        mtime: fs.statSync(reportPath).mtimeMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) {
    throw new Error(`No ${mode} report found for ${suite} in ${outputDir}`);
  }

  return candidates[0].path;
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
