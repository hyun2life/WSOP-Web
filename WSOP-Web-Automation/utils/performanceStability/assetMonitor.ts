import { type Page } from '@playwright/test';

export type ImageAssetStatus = {
  src: string;
  alt: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  isBroken: boolean;
};

export type ResourceEntry = {
  name: string;
  initiatorType: string;
  durationMs: number;
  transferSize: number;
};

export async function collectImageAssetStatus(page: Page): Promise<ImageAssetStatus[]> {
  try {
    return await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.map(img => {
        const isBroken = !img.complete || img.naturalWidth === 0;
        return {
          src: img.src,
          alt: img.alt || '',
          complete: img.complete,
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          isBroken
        };
      });
    });
  } catch (error) {
    return [];
  }
}

export async function collectSlowResourceEntries(
  page: Page,
  thresholds: { slowRequestMs: { warning: number; fail: number }; slowAssetMs: { warning: number; fail: number } }
): Promise<ResourceEntry[]> {
  try {
    return await page.evaluate((limits) => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries
        .map(entry => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          durationMs: entry.duration,
          transferSize: entry.transferSize
        }))
        .filter(entry => {
          const isAsset = ['img', 'css', 'script', 'link', 'font'].includes(entry.initiatorType);
          const limit = isAsset ? limits.slowAssetMs.warning : limits.slowRequestMs.warning;
          return entry.durationMs >= limit;
        });
    }, thresholds);
  } catch (error) {
    return [];
  }
}

export function classifyAssetIssue(
  assetInfo: ImageAssetStatus | ResourceEntry,
  isCritical: boolean = false
): 'pass' | 'warning' | 'fail' {
  // Check image brokenness
  if ('isBroken' in assetInfo) {
    if (assetInfo.isBroken) {
      // If critical logo or core layout element is broken, fail, otherwise warning
      return isCritical ? 'fail' : 'warning';
    }
    return 'pass';
  }

  // Check resource timing
  const duration = assetInfo.durationMs;
  // Resource entries are generally warnings unless they completely block execution
  if (duration > 15000) {
    return 'fail'; // Extremely slow asset blocking
  } else if (duration > 5000) {
    return 'warning';
  }

  return 'pass';
}
