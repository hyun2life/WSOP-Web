import type { ComparisonDetail, ComparisonResult } from './dataIntegrityTypes';
import {
  normalizeDateText,
  normalizeInteger,
  normalizeMoney,
  normalizePlayerName,
  normalizeText,
  normalizeUrlPath,
} from './dataNormalizers';

const STRICT_DATA_CHECK = process.env.STRICT_DATA_CHECK === 'true';

export function compareTextField(
  actual: string | null | undefined,
  expected: string | null | undefined,
  context: string,
  options?: { mode?: 'exact' | 'contains' | 'normalizedContains' | 'date' }
): ComparisonDetail {
  const mode = options?.mode ?? 'normalizedContains';
  const expectedStr = expected ?? '';
  const actualStr = actual ?? '';

  let passed = false;
  if (mode === 'exact') {
    passed = actualStr === expectedStr;
  } else if (mode === 'contains') {
    passed = actualStr.includes(expectedStr);
  } else if (mode === 'date') {
    passed = normalizeDateText(actualStr).includes(normalizeDateText(expectedStr));
  } else {
    passed = normalizeText(actualStr).includes(normalizeText(expectedStr));
  }

  const status = passed ? 'pass' : STRICT_DATA_CHECK ? 'fail' : 'warn';
  const message = passed
    ? `[PASS] ${context} matches: expected "${expectedStr}", got "${actualStr}"`
    : `[${status.toUpperCase()}] ${context} mismatch: expected "${expectedStr}", got "${actualStr}"`;

  return {
    fieldName: context,
    expected: expectedStr,
    actual: actualStr,
    status,
    message,
  };
}

export function compareMoneyField(
  actual: string | number | null | undefined,
  expected: string | number | null | undefined,
  context: string,
  options?: { tolerance?: number }
): ComparisonDetail {
  const expectedVal = normalizeMoney(expected);
  const actualVal = normalizeMoney(actual);
  const tolerance = options?.tolerance ?? 0;

  if (expectedVal === null) {
    return {
      fieldName: context,
      expected: null,
      actual: actualVal,
      status: 'pass',
      message: `[SKIP] ${context} expected is null. Skipping validation.`,
    };
  }

  let passed = false;
  if (actualVal !== null) {
    passed = Math.abs(actualVal - expectedVal) <= tolerance;
  }

  const status = passed ? 'pass' : STRICT_DATA_CHECK ? 'fail' : 'warn';
  const message = passed
    ? `[PASS] ${context} matches: expected ${expectedVal} (tolerance ±${tolerance}), got ${actualVal}`
    : `[${status.toUpperCase()}] ${context} mismatch: expected ${expectedVal} (tolerance ±${tolerance}), got ${actualVal ?? 'null'}`;

  return {
    fieldName: context,
    expected: expectedVal,
    actual: actualVal,
    status,
    message,
  };
}

export function compareIntegerField(
  actual: string | number | null | undefined,
  expected: string | number | null | undefined,
  context: string
): ComparisonDetail {
  const expectedVal = normalizeInteger(expected);
  const actualVal = normalizeInteger(actual);

  if (expectedVal === null) {
    return {
      fieldName: context,
      expected: null,
      actual: actualVal,
      status: 'pass',
      message: `[SKIP] ${context} expected is null. Skipping validation.`,
    };
  }

  let passed = false;
  if (actualVal !== null) {
    passed = actualVal === expectedVal;
  }

  const status = passed ? 'pass' : STRICT_DATA_CHECK ? 'fail' : 'warn';
  const message = passed
    ? `[PASS] ${context} matches: expected ${expectedVal}, got ${actualVal}`
    : `[${status.toUpperCase()}] ${context} mismatch: expected ${expectedVal}, got ${actualVal ?? 'null'}`;

  return {
    fieldName: context,
    expected: expectedVal,
    actual: actualVal,
    status,
    message,
  };
}

export function compareUrlField(
  actual: string | null | undefined,
  expectedContains: string | null | undefined,
  context: string
): ComparisonDetail {
  const expectedPath = normalizeUrlPath(expectedContains);
  const actualPath = normalizeUrlPath(actual);

  const passed = actualPath.includes(expectedPath);
  const status = passed ? 'pass' : STRICT_DATA_CHECK ? 'fail' : 'warn';
  const message = passed
    ? `[PASS] ${context} matches: expected path to contain "${expectedPath}", got "${actualPath}"`
    : `[${status.toUpperCase()}] ${context} mismatch: expected path to contain "${expectedPath}", got "${actualPath}"`;

  return {
    fieldName: context,
    expected: expectedPath,
    actual: actualPath,
    status,
    message,
  };
}

export function createComparisonResult(details: ComparisonDetail[] = []): ComparisonResult {
  const warnings: string[] = [];
  const failures: string[] = [];

  for (const detail of details) {
    if (detail.status === 'fail') {
      failures.push(detail.message);
    } else if (detail.status === 'warn') {
      warnings.push(detail.message);
    }
  }

  const passed = failures.length === 0;

  return {
    passed,
    warnings,
    failures,
    details,
  };
}

export function mergeComparisonResults(results: ComparisonResult[]): ComparisonResult {
  const mergedDetails: ComparisonDetail[] = [];
  const mergedWarnings: string[] = [];
  const mergedFailures: string[] = [];

  for (const res of results) {
    mergedDetails.push(...res.details);
    mergedWarnings.push(...res.warnings);
    mergedFailures.push(...res.failures);
  }

  return {
    passed: mergedFailures.length === 0,
    warnings: mergedWarnings,
    failures: mergedFailures,
    details: mergedDetails,
  };
}

/**
 * crawler와 같은 non-source-of-truth baseline 검증 시, 
 * 단순 필드 불일치(failures)를 warnings로 강등하고, 
 * 구조적 치명성(identity split, row presence 등)만 hard fail로 유지시킵니다.
 */
export function applyBaselineDowngrade(result: ComparisonResult): ComparisonResult {
  const structuralFields = [
    'Result Row Presence', 
    'Profile URL Path', 
    'Profile Href', 
    'Result detail URL check', 
    'Identity Mapping Link Consistency'
  ];

  result.details.forEach(detail => {
    if (detail.status === 'fail') {
      const isStructural = structuralFields.some(field => detail.fieldName.includes(field));
      if (!isStructural) {
        detail.status = 'warn';
        detail.message = detail.message.replace(/\[FAIL\]/i, '[WARN]');
      }
    }
  });

  const newFailures: string[] = [];
  const newWarnings: string[] = [];

  for (const detail of result.details) {
    if (detail.status === 'fail') {
      newFailures.push(detail.message);
    } else if (detail.status === 'warn') {
      newWarnings.push(detail.message);
    }
  }

  return {
    passed: newFailures.length === 0,
    failures: newFailures,
    warnings: newWarnings,
    details: result.details
  };
}
