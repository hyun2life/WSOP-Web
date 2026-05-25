const fs = require('fs');
const path = require('path');
process.env.WSOP_REPORT_SUITE = 'player-presentation';
const WsopSmokeHtmlReporter = require('../scripts/wsop-smoke-html-reporter.cjs');

// Mock Report Object
const mockReport = {
  runId: '20260526-000000',
  generatedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  duration: 12000,
  status: 'passed',
  suite: 'player-presentation',
  reportPrefix: 'wsop-public-player-presentation',
  baseURL: 'https://www.wsop.com',
  playwrightHtmlReport: 'dummy/path',
  node: 'v18.0.0',
  platform: 'win32',
  projects: ['chromium-desktop'],
  results: [
    {
      id: 1,
      projectName: 'chromium-desktop',
      file: 'tests/player-presentation/dummy.spec.ts',
      suiteTitle: 'Phase 3 - player presentation',
      title: 'dummy test',
      status: 'passed',
      expectedStatus: 'passed',
      ok: true,
      duration: 5000,
      retry: 0,
      error: '',
      attachments: [
        {
          name: 'player-presentation-crawler-coverage',
          contentType: 'application/json',
          body: JSON.stringify({
            players: [
              { name: 'Daniel Negreanu', rank: 1, category: '2026 Standings', status: 'pass', sourcePath: 'crawler', expectedProfileUrl: 'daniel-negreanu', checks: { row: true, name: true, profileLink: true, countryOrFlag: true, playerImage: true } },
              { name: 'Phil Hellmuth', rank: 2, category: '2026 Standings', status: 'warn', sourcePath: 'crawler', expectedProfileUrl: 'phil-hellmuth', checks: { row: true, name: true, profileLink: true, countryOrFlag: true, playerImage: false } },
              { name: 'Phil Ivey', rank: 3, category: 'All-Time Bracelets', status: 'fail', sourcePath: 'crawler', expectedProfileUrl: 'phil-ivey', checks: { row: true, name: false, profileLink: false, countryOrFlag: true, playerImage: false } },
            ]
          })
        }
      ]
    }
  ]
};

mockReport.summary = {
  total: 1,
  passed: 1,
  failed: 0,
  skipped: 0,
  flaky: 0,
  totalDuration: 5000,
  passRate: 100,
  status: 'pass'
};

// We want to test renderDashboard
// Since renderDashboard is a private helper inside wsop-smoke-html-reporter.cjs,
// but we can call it indirectly by creating an instance of the class and using its onEnd method or modifying it to export.
// Alternatively, since the class write files directly onEnd, let's trigger WsopSmokeHtmlReporter's flow.

const reporter = new WsopSmokeHtmlReporter();
reporter.startedAt = new Date(Date.now() - 5000);
reporter.results = mockReport.results;

async function run() {
  await reporter.onEnd({ status: 'passed' });
  console.log('Reporter test finished. Please inspect generated HTML files in automation/output.');
}

run().catch(console.error);
