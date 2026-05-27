import type { TestInfo } from '@playwright/test';
import type { ComparisonResult } from './dataIntegrityTypes';

export function reportComparison(testInfo: TestInfo, result: ComparisonResult) {
  // 1. Playwright Annotations 등록
  for (const failure of result.failures) {
    testInfo.annotations.push({
      type: 'issue',
      description: failure,
    });
  }

  for (const warning of result.warnings) {
    testInfo.annotations.push({
      type: 'warning',
      description: warning,
    });
  }

  // 2. 상세 결과 JSON 첨부
  attachJson(testInfo, 'data-integrity-comparison-details', result);
}

export function attachJson(testInfo: TestInfo, name: string, data: unknown) {
  testInfo.attach(name, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
  });
}

export function addDataWarning(testInfo: TestInfo, message: string, metadata?: Record<string, unknown>) {
  const annotationMsg = `${message}${metadata ? ` ${JSON.stringify(metadata)}` : ''}`;
  testInfo.annotations.push({
    type: 'warning',
    description: annotationMsg,
  });
  console.warn(`[DATA_INTEGRITY_WARNING] ${annotationMsg}`);
}

export function formatFieldMismatch(context: string, field: string, expected: unknown, actual: unknown): string {
  return `Mismatch in ${context} [field: ${field}]: expected "${expected ?? 'null'}", actual "${actual ?? 'null'}"`;
}
