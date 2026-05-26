const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const suite = normalizeSuite(process.argv[2]) || 'smoke';
const mode = (process.argv[3] || 'ko').toLowerCase();

let outputDir;
let prefix;

if (suite === 'crawler') {
  outputDir = path.resolve(process.cwd(), '..', 'WSOP-Player-Standings-Crawler', 'automation', 'output');
  prefix = 'wsop-player-crawler-live';
  if (mode === 'playwright') {
    fail('Crawler does not generate a Playwright Trace Report. Use KO/EN reports instead.');
  }
} else {
  outputDir = path.join(process.cwd(), 'automation', 'output');
  prefix = `wsop-public-${suite}`;
}

const patterns = {
  ko: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-report-ko\\.html$`),
  en: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-report\\.html$`),
  playwright: new RegExp(`^${escapeRegExp(prefix)}-\\d{8}-\\d{6}(?:-\\d{3})?-playwright-report$`),
};

const pattern = patterns[mode] || patterns.ko;

if (!fs.existsSync(outputDir)) {
  fail(`Output directory not found: ${outputDir}`);
}

const candidates = fs
  .readdirSync(outputDir, { withFileTypes: true })
  .filter((entry) => pattern.test(entry.name))
  .map((entry) => {
    const target = path.join(outputDir, entry.name);
    const reportPath = entry.isDirectory() ? path.join(target, 'index.html') : target;
    if (!fs.existsSync(reportPath)) {
      return null;
    }

    return {
      path: reportPath,
      mtime: fs.statSync(reportPath).mtimeMs,
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
  fail(`No ${mode} ${suite} report found in ${outputDir}`);
}

const candidateWithResults = candidates.find((candidate) => hasExecutedResults(candidate.path, mode));
openFile((candidateWithResults || candidates[0]).path);

function openFile(filePath) {
  console.log(`Opening latest ${mode} ${suite} report: ${filePath}`);

  try {
    if (process.platform === 'win32') {
      execSync(`start "" "${filePath}"`, { stdio: 'ignore' });
      return;
    }

    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${command} "${filePath}"`, { stdio: 'ignore' });
  } catch (err) {
    console.error(`Failed to open report: ${err.message}`);
  }
}

function hasExecutedResults(reportPath, reportMode) {
  const jsonPath = inferJsonPath(reportPath, reportMode);
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    return true;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!Array.isArray(payload.results)) {
      return true;
    }
    return payload.results.length > 0;
  } catch {
    return true;
  }
}

function inferJsonPath(reportPath, reportMode) {
  const normalized = reportPath.replace(/\\/g, '/');
  if (reportMode === 'ko') {
    return normalized.endsWith('-report-ko.html') ? normalized.replace(/-report-ko\.html$/, '-report.json') : '';
  }
  if (reportMode === 'en') {
    return normalized.endsWith('-report.html') ? normalized.replace(/-report\.html$/, '-report.json') : '';
  }
  if (reportMode === 'playwright') {
    return normalized.includes('-playwright-report/index.html') ? normalized.replace(/-playwright-report\/index\.html$/, '-report.json') : '';
  }
  return '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeSuite(value) {
  if (!value) {
    return '';
  }

  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
