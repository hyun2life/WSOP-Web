// Set env var BEFORE imports
process.env.STRICT_DATA_CHECK = 'true';

import { test, expect } from '@playwright/test';
import { compareCalculatedSummary } from '../../../../utils/dataIntegrity/calculationHelpers';
import type { ExpectedPlayerSummary } from '../../../../utils/dataIntegrity/dataIntegrityTypes';
import type { CalculatedPlayerSummary } from '../../../../utils/dataIntegrity/calculationHelpers';

test.describe('compareCalculatedSummary', () => {
  test('does not generate warnings when complete scope has failures', () => {
    const expectedSummary: ExpectedPlayerSummary = {
      playerKey: 'test-player',
      displayName: 'Test Player',
      profileUrl: 'http://test.com',
      country: 'US',
      bracelets: null,
      rings: null,
      finalTables: null,
      cashes: 10,
      totalEarnings: '5000', // Exceeds 1000 tolerance compared to 500
      knownExceptionKey: null,
    };

    const calculated: CalculatedPlayerSummary = {
      cashes: 5,
      totalEarnings: 500,
    };

    const result = compareCalculatedSummary(expectedSummary, calculated, 'complete');

    // Should have failures
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures).toContainEqual(expect.stringContaining('[FAIL]'));

    // Should NOT have warnings about "Sample Scope"
    expect(result.warnings.length).toBe(0);

    // Check that cashes detail status is fail
    const cashesDetail = result.details.find(d => d.fieldName === 'Cashes Count');
    expect(cashesDetail?.status).toBe('fail');

    // Check that earnings detail status is fail
    const earningsDetail = result.details.find(d => d.fieldName === 'Total Earnings Sum');
    expect(earningsDetail?.status).toBe('fail');
  });

  test('generates warnings when sample scope has failures', () => {
    const expectedSummary: ExpectedPlayerSummary = {
      playerKey: 'test-player',
      displayName: 'Test Player',
      profileUrl: 'http://test.com',
      country: 'US',
      bracelets: null,
      rings: null,
      finalTables: null,
      cashes: 10,
      totalEarnings: '5000', // Exceeds 1000 tolerance compared to 500
      knownExceptionKey: null,
    };

    const calculated: CalculatedPlayerSummary = {
      cashes: 5,
      totalEarnings: 500,
    };

    const result = compareCalculatedSummary(expectedSummary, calculated, 'sample');

    // Should have 0 failures because they are converted to warnings
    expect(result.failures.length).toBe(0);

    // Should have warnings about "Sample Scope"
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings).toContainEqual(expect.stringContaining('[WARN] (Sample Scope) Calculated cashes count'));
    expect(result.warnings).toContainEqual(expect.stringContaining('[WARN] (Sample Scope) Calculated earnings sum'));

    // Check that cashes detail status is warn
    const cashesDetail = result.details.find(d => d.fieldName === 'Cashes Count');
    expect(cashesDetail?.status).toBe('warn');

    // Check that earnings detail status is warn
    const earningsDetail = result.details.find(d => d.fieldName === 'Total Earnings Sum');
    expect(earningsDetail?.status).toBe('warn');
  });
});
