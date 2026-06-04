const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PHASES_PATH = path.join(process.cwd(), 'automation', 'phases.json');

const [, , phaseArg, ...rawArgs] = process.argv;

if (!phaseArg || ['help', '--help', '-h'].includes(phaseArg)) {
  printHelp();
  process.exit(phaseArg ? 0 : 1);
}

const phases = loadPhases();

if (['list', '--list', '-l'].includes(phaseArg)) {
  printPhaseList(phases);
  process.exit(0);
}

const isAll = ['all', '--all', '-a'].includes(phaseArg.toLowerCase());

if (isAll) {
  const activePhases = phases.filter((p) => p.implemented);
  if (activePhases.length === 0) {
    fail('No implemented phases found to run.');
  }
  runMultiplePhases(activePhases, rawArgs);
} else {
  const phase = findPhase(phases, phaseArg);
  if (!phase) {
    fail(`Unknown phase: ${phaseArg}\nRun "npm run phase:list" to see available phases.`);
  }

  if (!phase.implemented) {
    fail(`${phase.id} (${phase.name}) is registered but not implemented yet. Target folder: ${phase.testDir}`);
  }

  runSinglePhase(phase, rawArgs);
}

function runSinglePhase(phase, rawArgs) {
  const testDir = path.join(process.cwd(), phase.testDir);
  if (!fs.existsSync(testDir)) {
    fail(`${phase.id} test directory does not exist: ${phase.testDir}`);
  }

  runPhasePromise(phase, rawArgs)
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

async function runMultiplePhases(activePhases, rawArgs) {
  let overallFailed = false;
  const results = [];

  for (const phase of activePhases) {
    console.log(`\n==================================================`);
    console.log(`[ALL PHASES] Starting: ${phase.id} (${phase.name})`);
    console.log(`==================================================\n`);

    const testDir = path.join(process.cwd(), phase.testDir);
    if (!fs.existsSync(testDir)) {
      console.error(`[ERROR] Test directory does not exist: ${phase.testDir}`);
      results.push({ phase: phase.id, name: phase.name, status: 'FAILED (Missing Dir)' });
      overallFailed = true;
      continue;
    }

    try {
      const code = await runPhasePromise(phase, rawArgs);
      if (code !== 0) {
        console.error(`\n[ERROR] ${phase.id} failed with exit code ${code}`);
        results.push({ phase: phase.id, name: phase.name, status: 'FAILED' });
        overallFailed = true;
      } else {
        console.log(`\n[SUCCESS] ${phase.id} completed successfully.`);
        results.push({ phase: phase.id, name: phase.name, status: 'SUCCESS' });
      }
    } catch (err) {
      console.error(`\n[ERROR] Execution failed for ${phase.id}:`, err.message || err);
      results.push({ phase: phase.id, name: phase.name, status: 'ERROR' });
      overallFailed = true;
    }
  }

  console.log(`\n==================================================`);
  console.log(`[ALL PHASES] RUN SUMMARY`);
  console.log(`==================================================`);
  results.forEach((r) => {
    console.log(`- ${r.phase.padEnd(8)}: [${r.status}] ${r.name || ''}`);
  });
  console.log(`==================================================`);
  console.log(`Final Result: ${overallFailed ? 'FAILED' : 'SUCCESS'}`);
  console.log(`==================================================\n`);

  process.exit(overallFailed ? 1 : 0);
}

function runPhasePromise(phase, rawArgs) {
  return new Promise((resolve, reject) => {
    const passthrough = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
    const testDir = path.resolve(process.cwd(), phase.testDir);

    let spawnCommand, spawnArgs, commandDisplay, workingDirectory;
    const env = {
      ...process.env,
      WSOP_REPORT_SUITE: phase.reportSuite,
      WSOP_NO_PAUSE: 'true',
    };

    if (phase.runnerType === 'batch') {
      spawnCommand = process.platform === 'win32' ? 'cmd.exe' : 'sh';
      spawnArgs = process.platform === 'win32' ? ['/d', '/s', '/c', phase.scriptPath] : ['./' + phase.scriptPath];
      commandDisplay = `${phase.scriptPath}`;
      workingDirectory = testDir;

      // Default to headless unless overridden by GUI passthrough flags
      env.HEADED = 'false';
      env.UI = 'false';

      parseArgsToEnv(passthrough, env);
    } else if (phase.runnerType === 'node') {
      // Node script runner (e.g. for Standings Crawler)
      const scriptPath = phase.scriptPath;
      const isTs = scriptPath.endsWith('.ts');
      const extraNodeArgs = [];
      if (passthrough.includes('--headed') || passthrough.includes('--ui')) {
        extraNodeArgs.push('--headed');
      }
      if (passthrough.includes('--ui')) {
        env.PWDEBUG = '1';
      }
      // Pass other arguments except --headed and --ui to avoid duplicates
      const otherArgs = passthrough.filter(arg => arg !== '--ui' && arg !== '--headed');

      if (isTs) {
        if (process.platform === 'win32') {
          spawnCommand = 'cmd.exe';
          spawnArgs = ['/d', '/s', '/c', 'npx', 'tsx', scriptPath, ...extraNodeArgs, ...otherArgs];
          commandDisplay = `cmd.exe /d /s /c npx tsx ${scriptPath} ${[...extraNodeArgs, ...otherArgs].join(' ')}`;
        } else {
          spawnCommand = 'npx';
          spawnArgs = ['tsx', scriptPath, ...extraNodeArgs, ...otherArgs];
          commandDisplay = `${spawnCommand} tsx ${scriptPath} ${[...extraNodeArgs, ...otherArgs].join(' ')}`;
        }
      } else {
        spawnCommand = 'node';
        spawnArgs = [scriptPath, ...extraNodeArgs, ...otherArgs];
        commandDisplay = `node ${scriptPath} ${[...extraNodeArgs, ...otherArgs].join(' ')}`;
      }
      workingDirectory = process.cwd();
    } else {
      // Playwright test runner
      const project = phase.project || 'chromium-desktop';
      if (process.platform === 'win32') {
        spawnCommand = 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', 'npx', 'playwright', 'test', phase.testDir, '--project', project, ...passthrough];
        commandDisplay = `cmd.exe /d /s /c npx playwright test ${phase.testDir} --project ${project} ${passthrough.join(' ')}`;
      } else {
        spawnCommand = 'npx';
        spawnArgs = ['playwright', 'test', phase.testDir, '--project', project, ...passthrough];
        commandDisplay = `${spawnCommand} ${spawnArgs.join(' ')}`;
      }
      workingDirectory = process.cwd();
    }

    console.log(`Running ${phase.id}: ${phase.name}`);
    console.log(`Report suite: ${phase.reportSuite}`);
    console.log(`WorkingDirectory: ${workingDirectory}`);
    console.log(`Command: ${commandDisplay}`);

    const child = spawn(spawnCommand, spawnArgs, {
      env,
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
      cwd: workingDirectory,
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Phase interrupted by signal: ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

function loadPhases() {
  if (!fs.existsSync(PHASES_PATH)) {
    fail(`Phase registry not found: ${PHASES_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(PHASES_PATH, 'utf8'));
  return config.phases || [];
}

function findPhase(phases, value) {
  const normalized = normalize(value);
  return phases.find((phase) => {
    const aliases = phase.aliases || [];
    return normalize(phase.id) === normalized || aliases.some((alias) => normalize(alias) === normalized);
  });
}

function printHelp() {
  console.log('Usage: node scripts/run-phase.cjs <phase|alias|list> [-- extra Playwright args]');
  console.log('Examples:');
  console.log('  node scripts/run-phase.cjs phase1');
  console.log('  node scripts/run-phase.cjs functional');
  console.log('  node scripts/run-phase.cjs phase2 -- --headed');
}

function printPhaseList(phases) {
  for (const phase of phases) {
    const status = phase.implemented ? 'ready' : 'planned';
    const aliases = (phase.aliases || []).join(', ');
    console.log(`${phase.id.padEnd(6)} ${status.padEnd(8)} ${phase.reportSuite.padEnd(22)} ${phase.testDir}`);
    console.log(`       ${phase.name}${aliases ? ` (aliases: ${aliases})` : ''}`);
  }
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgsToEnv(passthrough, env) {
  for (let i = 0; i < passthrough.length; i++) {
    const arg = passthrough[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      let val = '';
      if (key.includes('=')) {
        const parts = key.split('=');
        const actualKey = parts[0];
        val = parts[1];
        setEnvVar(actualKey, val, env);
      } else {
        const next = passthrough[i + 1];
        if (next && !next.startsWith('--')) {
          val = next;
          i++;
        } else {
          val = 'true';
        }
        setEnvVar(key, val, env);
      }
    }
  }
}

function setEnvVar(key, val, env) {
  const mapping = {
    'auth-wait-ms': 'AUTH_WAIT_MS',
    'limit': 'PLAYER_LIMIT',
    'result-limit': 'RESULT_LIMIT',
    'result-rank-limit': 'RESULT_RANK_LIMIT',
    'max-load-more': 'MAX_LOAD_MORE',
    'result-page-limit': 'RESULT_PAGE_LIMIT',
    'disabled-result-mode': 'DISABLED_RESULT_MODE',
    'concurrency': 'CONCURRENCY',
    'headed': 'HEADED',
    'ui': 'UI',
    'brand': 'BRAND',
    'year': 'YEAR',
    'standings-only': 'STANDINGS_ONLY',
    'profile-only': 'PROFILE_ONLY',
    'result-only': 'RESULT_ONLY',
    'from-report': 'FROM_REPORT'
  };
  const envKey = mapping[key.toLowerCase()];
  if (envKey) {
    let finalVal = val;
    if (envKey === 'YEAR') {
      finalVal = val.replace(/\|/g, '_');
    }
    env[envKey] = finalVal;
  }
}
