import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'https://www.wsop.com';
const reportSuite = normalizeReportSuite(process.env.WSOP_REPORT_SUITE) ?? inferReportSuite(process.argv);
const reportRunId = process.env.WSOP_REPORT_RUN_ID ?? process.env.SMOKE_REPORT_RUN_ID ?? timestampForFile();
const reportPrefix = `wsop-public-${reportSuite}`;

process.env.WSOP_REPORT_SUITE = reportSuite;
process.env.WSOP_REPORT_RUN_ID = reportRunId;
process.env.WSOP_REPORT_PREFIX = reportPrefix;
process.env.SMOKE_REPORT_RUN_ID = reportRunId;

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `automation/output/${reportPrefix}-${reportRunId}-playwright-report` }],
    ['./scripts/wsop-smoke-html-reporter.cjs'],
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});

function inferReportSuite(argv: string[]): string {
  const command = argv.join(' ').replace(/\\/g, '/').toLowerCase();

  if (command.includes('tests/functional')) {
    return 'functional';
  }

  if (command.includes('tests/player-presentation')) {
    return 'player-presentation';
  }

  if (command.includes('tests/search-filter-sort')) {
    return 'search-filter-sort';
  }

  return 'smoke';
}

function normalizeReportSuite(value?: string): string | null {
  if (!value) {
    return null;
  }

  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

function timestampForFile(): string {
  const now = new Date();
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
}
