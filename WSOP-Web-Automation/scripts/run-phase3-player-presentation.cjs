const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const automationRoot = process.cwd();
const crawlerRoot = path.resolve(automationRoot, '..', 'WSOP-Player-Standings-Crawler');
const runId = process.env.WSOP_REPORT_RUN_ID || process.env.SMOKE_REPORT_RUN_ID || timestampForFile();
const baseURL = (process.env.BASE_URL || 'https://www.wsop.com').replace(/\/+$/, '');
const standingsUrl = `${baseURL}/player-standings/`;
const outputDir = path.join(automationRoot, 'automation', 'output');
const outputBase = path.join(outputDir, `wsop-public-player-presentation-${runId}-standings-targets`);
const standingsDataPath = `${outputBase}-data.json`;
const standingsHtmlPath = `${outputBase}-report.html`;
const standingsDefectsPath = `${outputBase}-defects.csv`;
const passthrough = process.argv.slice(2);

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(crawlerRoot)) {
    throw new Error(`Crawler project not found: ${crawlerRoot}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  await runCommand(
    process.execPath,
    [
      'automation/crawl_player_standings.mjs',
      '--standings-only',
      '--players-url',
      standingsUrl,
      '--limit',
      process.env.PHASE3_STANDINGS_LIMIT || '50',
      '--browser-channel',
      process.env.PHASE3_CRAWLER_BROWSER_CHANNEL || 'none',
      '--user-data-dir',
      process.env.PHASE3_CRAWLER_USER_DATA_DIR || 'automation/.auth/wsop-player-crawler-chromium',
      '--out',
      standingsDataPath,
      '--html',
      standingsHtmlPath,
      '--defects',
      standingsDefectsPath,
    ],
    {
      cwd: crawlerRoot,
      env: {
        ...process.env,
        WSOP_NO_PAUSE: 'true',
      },
      label: 'Phase3 standings-only crawler',
    },
  );

  await runCommand(
    process.platform === 'win32' ? 'cmd.exe' : 'npx',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npx.cmd', 'playwright', 'test', 'tests/player-presentation', '--project', 'chromium-desktop', ...passthrough]
      : ['playwright', 'test', 'tests/player-presentation', '--project', 'chromium-desktop', ...passthrough],
    {
      cwd: automationRoot,
      env: {
        ...process.env,
        WSOP_REPORT_SUITE: 'player-presentation',
        WSOP_REPORT_RUN_ID: runId,
        SMOKE_REPORT_RUN_ID: runId,
        PHASE3_STANDINGS_DATA: standingsDataPath,
      },
      label: 'Phase3 player-presentation Playwright',
    },
  );
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${options.label}]`);
    console.log(`WorkingDirectory: ${options.cwd}`);
    console.log(`Command: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${options.label} interrupted by signal: ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${options.label} failed with exit code ${code}`));
        return;
      }

      resolve();
    });

    child.on('error', reject);
  });
}

function timestampForFile() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}
