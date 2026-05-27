import * as fs from 'fs';
import * as path from 'path';
import { TestInfo } from '@playwright/test';

export interface VisualResult {
  key: string;
  name: string;
  url: string;
  type: 'page' | 'component';
  snapshotName: string;
  status: 'passed' | 'failed' | 'warning';
  errorDetails?: string;
  maxDiffPixelRatio: number;
  threshold: number;
  maskKeys: string[];
}

export interface VisualWarning {
  key: string;
  name: string;
  url: string;
  reason: string;
}

export interface VisualSummary {
  timestamp: string;
  stats: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  results: VisualResult[];
  warnings: VisualWarning[];
}

/**
 * 신규 시각 요약 객체를 생성합니다.
 */
export function createVisualSummary(): VisualSummary {
  return {
    timestamp: new Date().toISOString(),
    stats: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    },
    results: [],
    warnings: []
  };
}

/**
 * 요약 데이터에 테스트 결과를 추가합니다.
 */
export function addVisualResult(summary: VisualSummary, result: VisualResult): void {
  summary.stats.total++;
  if (result.status === 'passed') {
    summary.stats.passed++;
  } else if (result.status === 'failed') {
    summary.stats.failed++;
  } else if (result.status === 'warning') {
    summary.stats.warnings++;
  }
  summary.results.push(result);
}

/**
 * 요약 데이터에 워닝(예외적 실패)을 추가합니다.
 */
export function addVisualWarning(summary: VisualSummary, warning: VisualWarning): void {
  summary.stats.warnings++;
  summary.warnings.push(warning);
}

/**
 * Playwright TestInfo에 시각 메타데이터를 첨부하여 HTML 리포트에 기록되도록 합니다.
 */
export function attachVisualMetadata(testInfo: TestInfo, metadata: any): void {
  testInfo.annotations.push({
    type: 'visual-metadata',
    description: JSON.stringify(metadata, null, 2)
  });
}

/**
 * 최종 리포트 파일들을 artifacts/visual-regression/latest/ 하위에 저장합니다.
 */
export function writeLatestVisualArtifacts(summary: VisualSummary): void {
  const baseDir = path.resolve(__dirname, '../../artifacts/visual-regression/latest');

  try {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const summaryPath = path.join(baseDir, 'visual-summary.json');
    let finalSummary = summary;

    if (fs.existsSync(summaryPath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as VisualSummary;
        
        // results 병합 (중복 키는 새로운 결과로 덮어씀)
        const mergedResultsMap = new Map<string, VisualResult>();
        if (existingData.results && Array.isArray(existingData.results)) {
          existingData.results.forEach(r => mergedResultsMap.set(r.key, r));
        }
        summary.results.forEach(r => mergedResultsMap.set(r.key, r));
        
        // warnings 병합 (중복 키는 새로운 결과로 덮어씀)
        const mergedWarningsMap = new Map<string, VisualWarning>();
        if (existingData.warnings && Array.isArray(existingData.warnings)) {
          existingData.warnings.forEach(w => mergedWarningsMap.set(w.key, w));
        }
        summary.warnings.forEach(w => mergedWarningsMap.set(w.key, w));

        const results = Array.from(mergedResultsMap.values());
        const warnings = Array.from(mergedWarningsMap.values());

        // 통계 재계산
        const stats = {
          total: results.length,
          passed: results.filter(r => r.status === 'passed').length,
          failed: results.filter(r => r.status === 'failed').length,
          warnings: results.filter(r => r.status === 'warning').length + warnings.length
        };

        finalSummary = {
          timestamp: new Date().toISOString(),
          stats,
          results,
          warnings
        };
      } catch (e) {
        console.warn('[VisualReporter] Failed to parse existing summary, overwriting instead.', e);
      }
    }

    // 1. visual-summary.json 작성
    fs.writeFileSync(summaryPath, JSON.stringify(finalSummary, null, 2), 'utf-8');

    // 2. visual-diff-summary.json 작성 (실패 또는 워닝 결과만 추출)
    const diffs = {
      timestamp: finalSummary.timestamp,
      stats: {
        failed: finalSummary.stats.failed,
        warnings: finalSummary.stats.warnings
      },
      failedResults: finalSummary.results.filter(r => r.status === 'failed'),
      warnings: finalSummary.warnings
    };
    const diffPath = path.join(baseDir, 'visual-diff-summary.json');
    fs.writeFileSync(diffPath, JSON.stringify(diffs, null, 2), 'utf-8');

    console.log(`[VisualReporter] Visual regression summary saved to ${summaryPath}`);
    console.log(`[VisualReporter] Visual diff summary saved to ${diffPath}`);
  } catch (error) {
    console.error('[VisualReporter] Failed to write visual artifacts', error);
  }
}
