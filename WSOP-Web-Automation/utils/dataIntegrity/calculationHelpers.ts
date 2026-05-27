import type { ComparisonResult, ExpectedPlayerSummary } from './dataIntegrityTypes';
import { normalizeMoney } from './dataNormalizers';
import { compareMoneyField, compareIntegerField, createComparisonResult } from './dataComparators';

export function sumMoney(values: (string | number | null | undefined)[]): number {
  return values.reduce<number>((sum, val) => {
    const money = normalizeMoney(val);
    return sum + (money ?? 0);
  }, 0);
}

export interface CalculatedPlayerSummary {
  cashes: number;
  totalEarnings: number;
}

export function calculatePlayerSummaryFromRows(
  rows: { earningsText?: string; earnings?: string | number | null }[]
): CalculatedPlayerSummary {
  const cashes = rows.length;
  const totalEarnings = sumMoney(rows.map((r) => r.earnings ?? r.earningsText));
  
  return {
    cashes,
    totalEarnings,
  };
}

export function compareCalculatedSummary(
  expectedSummary: ExpectedPlayerSummary,
  calculated: CalculatedPlayerSummary,
  scope: 'sample' | 'complete'
): ComparisonResult {
  const details = [];

  const expectedEarnings = normalizeMoney(expectedSummary.totalEarnings);
  
  // 1. 입상 횟수 비교
  if (expectedSummary.cashes !== null) {
    const checkCashes = compareIntegerField(calculated.cashes, expectedSummary.cashes, 'Cashes Count');
    if (scope === 'sample' && checkCashes.status === 'fail') {
      // 샘플 데이터 범위인 경우, 수치 불일치를 hard fail하지 않고 warn 처리
      checkCashes.status = 'warn';
      checkCashes.message = `[WARN] (Sample Scope) Calculated cashes count (${calculated.cashes}) does not cover complete expected cashes (${expectedSummary.cashes}).`;
    }
    details.push(checkCashes);
  }

  // 2. 총상금 합산 비교
  if (expectedEarnings !== null) {
    const checkEarnings = compareMoneyField(calculated.totalEarnings, expectedEarnings, 'Total Earnings Sum', {
      tolerance: 1000, // 통화 환산 등의 오차 허용 (±$1000)
    });
    if (scope === 'sample' && checkEarnings.status === 'fail') {
      checkEarnings.status = 'warn';
      checkEarnings.message = `[WARN] (Sample Scope) Calculated earnings sum ($${calculated.totalEarnings.toLocaleString()}) does not cover complete expected earnings ($${expectedEarnings.toLocaleString()}).`;
    }
    details.push(checkEarnings);
  }

  return createComparisonResult(details);
}
